import * as dotenv from 'dotenv';
import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config();

console.log('🔧 Avvio bot...');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? '✅' : '❌');
console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌');
console.log('THE_ODDS_API_KEY:', process.env.THE_ODDS_API_KEY ? '✅' : '❌');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅' : '❌');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

const COUNTRIES_LEAGUES: Record<string, string[]> = {
  'Italy': ['italy_serie_a', 'italy_serie_b'],
  'England': ['england_premier_league'],
  'Spain': ['spain_la_liga'],
  'Germany': ['germany_bundesliga'],
  'France': ['france_ligue_1'],
  'Netherlands': ['netherlands_eredivisie']
};

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  sport_key: string;
  bookmakers?: any[];
  country?: string;
  league?: string;
}

interface Prediction {
  match_id: string;
  home_team: string;
  away_team: string;
  league: string;
  country: string;
  prediction_type: string;
  prediction_value: string;
  confidence: number;
  reasoning: string;
  odds_available: Record<string, number>;
  market_analysis: Record<string, any>;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_DURATION = 3600000;

function getCachedData(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCachedData(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMatchesToday(): Promise<Match[]> {
  const cacheKey = 'matches_today';
  const cached = getCachedData(cacheKey);
  if (cached) {
    console.log(`📦 Cache: ${cached.length} partite in cache`);
    return cached;
  }

  const allMatches: Match[] = [];
  
  for (const [country, leagues] of Object.entries(COUNTRIES_LEAGUES)) {
    for (const league of leagues) {
      try {
        console.log(`🔍 Fetching ${league}...`);
        const response = await axios.get('https://api.the-odds-api.com/v4/sports/soccer/events', {
          params: {
            apiKey: ODDS_API_KEY,
            sport_key: league,
            daysFrom: 1,
            oddsFormat: 'decimal',
            markets: 'h2h'
          },
          timeout: 8000
        });

        const count = response.data?.length || 0;
        console.log(`   ✅ ${league}: ${count} partite`);

        if (response.data && Array.isArray(response.data)) {
          allMatches.push(...response.data.map((m: any) => ({
            ...m,
            country,
            league
          })));
        }
      } catch (error) {
        console.error(`   ❌ Errore ${league}:`, error instanceof Error ? error.message : error);
      }
      
      await delay(200);
    }
  }
  
  console.log(`📊 Totale partite trovate: ${allMatches.length}`);
  setCachedData(cacheKey, allMatches);
  return allMatches;
}

async function analyzeMatchWithGemini(match: Match): Promise<Prediction | null> {
  const prompt = `Analizza: ${match.home_team} vs ${match.away_team}. Rispondi in JSON: {"primary_prediction": "HOME|DRAW|AWAY", "confidence": 70, "reasoning": "...", "market_recommendations": {}}`;

  try {
    const response = await axios.post(
      `${GEMINI_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{ text: prompt }]
        }]
      },
      { timeout: 15000 }
    );

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Risposta Gemini vuota');
    }

    const text = response.data.candidates[0].content.parts[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      league: match.league || '',
      country: match.country || '',
      prediction_type: '1X2',
      prediction_value: analysis.primary_prediction || 'HOME',
      confidence: Math.min(Math.max(analysis.confidence || 65, 0), 100),
      reasoning: analysis.reasoning || 'Analisi',
      odds_available: {},
      market_analysis: analysis.market_recommendations || {}
    };
  } catch (error) {
    console.error('Errore Gemini:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function savePredictionToSupabase(prediction: Prediction): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('predictions')
      .insert({
        match_id: prediction.match_id,
        home_team: prediction.home_team,
        away_team: prediction.away_team,
        league: prediction.league,
        country: prediction.country,
        match_date: new Date().toISOString(),
        prediction_type: prediction.prediction_type,
        prediction_value: prediction.prediction_value,
        confidence: prediction.confidence,
        reasoning: prediction.reasoning,
        odds_available: prediction.odds_available,
        market_analysis: prediction.market_analysis,
        status: 'pending'
      });

    if (error) {
      console.error('Errore DB insert:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Errore salvataggio DB:', error);
    return false;
  }
}

bot.command('start', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`👤 /start da user ${userId}`);
  
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single();

    if (!data) {
      console.log(`   Creando preferenze per ${userId}`);
      const { error } = await supabase
        .from('user_preferences')
        .insert({
          user_id: userId,
          countries: Object.keys(COUNTRIES_LEAGUES),
          leagues: ['italy_serie_a'],
          min_confidence: 65,
          markets_preferred: ['1X2']
        });
      
      if (error) {
        console.error(`   ❌ Errore insert:`, error);
      } else {
        console.log(`   ✅ Preferenze create`);
      }
    }
  } catch (error) {
    console.error('Errore start:', error);
  }

  await ctx.reply('✅ Bot avviato!\n/analyze - Analizza partite\n/init - Crea preferenze');
});

bot.command('init', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`🔧 /init da user ${userId}`);
  
  try {
    console.log(`   Tentando upsert...`);
    const { error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        countries: Object.keys(COUNTRIES_LEAGUES),
        leagues: ['italy_serie_a'],
        min_confidence: 65,
        markets_preferred: ['1X2']
      }, {
        onConflict: 'user_id'
      });

    if (error) {
      console.error(`   ❌ Errore upsert:`, error.message);
      throw error;
    }

    console.log(`   ✅ Upsert riuscito`);
    await ctx.reply('✅ Preferenze create!');
  } catch (error) {
    console.error('Errore /init:', error);
    await ctx.reply('❌ Errore: ' + (error instanceof Error ? error.message : 'Errore sconosciuto'));
  }
});

bot.command('analyze', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`📊 /analyze da user ${userId}`);
  
  await ctx.reply('🔄 Analizzando...');

  try {
    const matches = await getMatchesToday();
    console.log(`   Trovate ${matches.length} partite`);
    
    if (matches.length === 0) {
      await ctx.reply('❌ Nessuna partita trovata');
      return;
    }

    const predictions: Prediction[] = [];

    for (const match of matches.slice(0, 10)) {
      try {
        const prediction = await analyzeMatchWithGemini(match);
        
        if (prediction && prediction.confidence >= 60) {
          await savePredictionToSupabase(prediction);
          predictions.push(prediction);
          console.log(`   ✅ ${match.home_team} vs ${match.away_team}`);
        }
      } catch (error) {
        console.error('Errore analisi:', error);
      }

      await delay(500);
    }

    console.log(`   Previsioni salvate: ${predictions.length}`);

    if (predictions.length === 0) {
      await ctx.reply('❌ Nessuna previsione');
      return;
    }

    for (const pred of predictions.slice(0, 3)) {
      await ctx.replyWithHTML(`
⚽ <b>${pred.home_team} vs ${pred.away_team}</b>
Previsione: <b>${pred.prediction_value}</b>
Confidenza: <b>${pred.confidence}%</b>
      `);
      await delay(300);
    }

    await ctx.reply(`✅ ${predictions.length} previsioni`);

  } catch (error) {
    console.error('Errore /analyze:', error);
    await ctx.reply('❌ Errore');
  }
});

bot.command('settings', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`⚙️ /settings da user ${userId}`);

  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single();

    if (!data) {
      console.log(`   Preferenze non trovate`);
      await ctx.reply('❌ Digita /init');
      return;
    }

    console.log(`   ✅ Preferenze trovate`);
    await ctx.reply(`Paesi: ${data.countries.join(', ')}`);
  } catch (error) {
    console.error('Errore settings:', error);
    await ctx.reply('❌ Errore');
  }
});

bot.command('help', async (ctx: Context) => {
  await ctx.reply(`
/start - Inizializza
/init - Crea preferenze
/analyze - Analizza
/settings - Preferenze
/logs - Vedi logs
  `);
});

bot.command('logs', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`📝 /logs da user ${userId}`);
  await ctx.reply('Vedi i log in Railway console');
});

bot.on(message(), async (ctx: Context) => {
  const text = (ctx.message as any)?.text;
  if (text && !text.startsWith('/')) {
    await ctx.reply('❓ /help');
  }
});

bot.catch((err: any) => {
  console.error('Errore bot:', err);
});

bot.launch().then(() => {
  console.log('✅ Bot avviato');
}).catch((err) => {
  console.error('❌ Errore avvio:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
