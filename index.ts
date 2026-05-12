import * as dotenv from 'dotenv';
import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config();

console.log('🔧 Avvio bot...');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

const COUNTRIES_LEAGUES: Record<string, string[]> = {
  'England': ['england_premier_league', 'england_championship'],
  'Spain': ['spain_la_liga'],
  'Germany': ['germany_bundesliga'],
  'France': ['france_ligue_1'],
  'Italy': ['italy_serie_a'],
  'Netherlands': ['netherlands_eredivisie'],
  'Portugal': ['portugal_primeira_liga'],
  'Brazil': ['brazil_serie_a'],
  'USA': ['usa_mls'],
  'Mexico': ['mexico_liga_bbva_mx']
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

const cache: Map<string, any> = new Map();
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
    console.log(`📦 Cache: ${cached.length} partite`);
    return cached;
  }

  const allMatches: Match[] = [];
  
  for (const [country, leagues] of Object.entries(COUNTRIES_LEAGUES)) {
    for (const league of leagues) {
      try {
        console.log(`🔍 ${league}...`);
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
        console.error(`   ❌ ${league}:`, error instanceof Error ? error.message : error);
      }
      
      await delay(300);
    }
  }
  
  console.log(`📊 Totale: ${allMatches.length} partite`);
  setCachedData(cacheKey, allMatches);
  return allMatches;
}

async function analyzeMatchWithGemini(match: Match): Promise<Prediction | null> {
  const prompt = `Analizza: ${match.home_team} vs ${match.away_team}. JSON: {"primary_prediction": "HOME|DRAW|AWAY", "confidence": 70, "reasoning": "..."}`;

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

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

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
      market_analysis: {}
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
      console.error('Errore DB:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Errore salvataggio:', error);
    return false;
  }
}

bot.command('start', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`👤 /start user ${userId}`);
  
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single()
      .catch(() => ({ data: null }));

    if (!data) {
      console.log(`   Creando preferenze`);
      await supabase.from('user_preferences').insert({
        user_id: userId,
        countries: Object.keys(COUNTRIES_LEAGUES),
        leagues: ['england_premier_league'],
        min_confidence: 65,
        markets_preferred: ['1X2']
      });
    }
  } catch (error) {
    console.error('Errore start:', error);
  }

  await ctx.reply('✅ Bot avviato!\n/analyze - Analizza\n/init - Crea preferenze');
});

bot.command('init', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`🔧 /init user ${userId}`);
  
  try {
    console.log(`   Cercando preferenze...`);
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single()
      .catch(() => ({ data: null }));

    if (existing) {
      console.log(`   Aggiornando...`);
      const { error } = await supabase
        .from('user_preferences')
        .update({
          countries: Object.keys(COUNTRIES_LEAGUES),
          leagues: ['england_premier_league'],
          min_confidence: 65
        })
        .eq('user_id', userId);

      if (error) throw error;
    } else {
      console.log(`   Creando nuove...`);
      const { error } = await supabase
        .from('user_preferences')
        .insert({
          user_id: userId,
          countries: Object.keys(COUNTRIES_LEAGUES),
          leagues: ['england_premier_league'],
          min_confidence: 65,
          markets_preferred: ['1X2']
        });

      if (error) throw error;
    }

    console.log(`   ✅ Preferenze OK`);
    await ctx.reply('✅ Preferenze create!');
  } catch (error) {
    console.error('Errore /init:', error);
    await ctx.reply('❌ Errore: ' + (error instanceof Error ? error.message : 'Errore'));
  }
});

bot.command('analyze', async (ctx: Context) => {
  const userId = ctx.from?.id;
  console.log(`📊 /analyze user ${userId}`);
  
  await ctx.reply('🔄 Analizzando...');

  try {
    const matches = await getMatchesToday();
    console.log(`   Trovate ${matches.length} partite`);
    
    if (matches.length === 0) {
      console.log(`   ❌ Nessuna partita`);
      await ctx.reply('❌ Nessuna partita trovata');
      return;
    }

    const predictions: Prediction[] = [];

    for (const match of matches.slice(0, 15)) {
      try {
        const prediction = await analyzeMatchWithGemini(match);
        
        if (prediction && prediction.confidence >= 60) {
          await savePredictionToSupabase(prediction);
          predictions.push(prediction);
          console.log(`   ✅ ${match.home_team} vs ${match.away_team}: ${prediction.confidence}%`);
        }
      } catch (error) {
        console.error('Errore analisi:', error);
      }

      await delay(500);
    }

    console.log(`   Previsioni: ${predictions.length}`);

    if (predictions.length === 0) {
      await ctx.reply('❌ Nessuna previsione');
      return;
    }

    for (const pred of predictions.slice(0, 5)) {
      await ctx.replyWithHTML(`
⚽ <b>${pred.home_team} vs ${pred.away_team}</b>
📊 ${pred.prediction_value} (${pred.confidence}%)
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

  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single()
      .catch(() => ({ data: null }));

    if (!data) {
      await ctx.reply('❌ /init');
      return;
    }

    await ctx.reply(`Paesi: ${data.countries.slice(0, 3).join(', ')}`);
  } catch (error) {
    await ctx.reply('❌ Errore');
  }
});

bot.command('help', async (ctx: Context) => {
  await ctx.reply(`
/start - Inizializza
/init - Crea preferenze
/analyze - Analizza
/settings - Preferenze
  `);
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
  console.error('❌ Errore:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
