import * as dotenv from 'dotenv';
import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

const COUNTRIES_LEAGUES: Record<string, string[]> = {
  'Italy': ['italy_serie_a', 'italy_serie_b', 'italy_serie_c'],
  'England': ['england_premier_league', 'england_championship', 'england_efl_1', 'england_efl_2'],
  'Spain': ['spain_la_liga', 'spain_segunda'],
  'Germany': ['germany_bundesliga', 'germany_2bundesliga'],
  'France': ['france_ligue_1', 'france_ligue_2'],
  'Netherlands': ['netherlands_eredivisie', 'netherlands_eerste_divisie'],
  'Croatia': ['croatia_hnl'],
  'Greece': ['greece_super_league'],
  'Sweden': ['sweden_allsvenskan', 'sweden_superettan'],
  'Turkey': ['turkey_super_lig', 'turkey_1_lig'],
  'Morocco': ['morocco_botola_pro']
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
  if (cached) return cached;

  const allMatches: Match[] = [];
  
  for (const [country, leagues] of Object.entries(COUNTRIES_LEAGUES)) {
    for (const league of leagues) {
      try {
        const response = await axios.get('https://api.the-odds-api.com/v4/sports/soccer/events', {
          params: {
            apiKey: ODDS_API_KEY,
            sport_key: league,
            daysFrom: 1,
            oddsFormat: 'decimal',
            markets: 'h2h,spreads,totals,outrights'
          },
          timeout: 8000
        });

        if (response.data && Array.isArray(response.data)) {
          allMatches.push(...response.data.map((m: any) => ({
            ...m,
            country,
            league
          })));
        }
      } catch (error) {
        console.error(`Errore fetch ${league}:`, error instanceof Error ? error.message : error);
      }
      
      await delay(200);
    }
  }
  
  setCachedData(cacheKey, allMatches);
  return allMatches;
}

async function analyzeMatchWithGemini(match: Match): Promise<Prediction | null> {
  const prompt = `Analizza questa partita di calcio e fornisci una previsione SPORTIVA basata su analisi statistica generale.

Partita: ${match.home_team} vs ${match.away_team}
Lega: ${match.league}
Paese: ${match.country}
Data: ${new Date(match.commence_time).toLocaleString()}

IMPORTANTE: Non hai accesso a dati real-time. Fornisci comunque un'analisi basata su:
1. Tipologie squadre (dedotte dai nomi)
2. Pattern storici comuni
3. Fattori ambientali (casa/trasferta)
4. Trend stagionali della lega

Fornisci risposta SOLO in JSON (valido) con questa struttura ESATTA:
{
  "primary_prediction": "HOME" | "DRAW" | "AWAY" | "OVER_2.5" | "UNDER_2.5" | "BTTS_YES" | "BTTS_NO",
  "confidence": 65,
  "reasoning": "Breve spiegazione (max 100 caratteri)",
  "market_recommendations": {
    "1X2": "HOME",
    "over_under": "2.5",
    "btts": "YES",
    "asian_handicap": "-0.5"
  },
  "risk_level": "MEDIUM",
  "value_assessment": "Fair Value"
}`;

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
      console.error('No JSON found in response:', text.substring(0, 200));
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);

    const predictionMap: Record<string, string> = {
      'HOME': '1X2',
      'AWAY': '1X2',
      'DRAW': '1X2',
      'OVER_2.5': 'TOTAL_GOALS',
      'UNDER_2.5': 'TOTAL_GOALS',
      'BTTS_YES': 'BTTS',
      'BTTS_NO': 'BTTS'
    };

    return {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      league: match.league || '',
      country: match.country || '',
      prediction_type: predictionMap[analysis.primary_prediction] || '1X2',
      prediction_value: analysis.primary_prediction,
      confidence: Math.min(Math.max(analysis.confidence || 65, 0), 100),
      reasoning: analysis.reasoning || 'Analisi completata',
      odds_available: {},
      market_analysis: analysis.market_recommendations || {}
    };
  } catch (error) {
    console.error('Errore Gemini API:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function getOddsForMatch(match: Match): Promise<Record<string, number>> {
  const odds: Record<string, number> = {};
  
  try {
    if (match.bookmakers && match.bookmakers.length > 0) {
      const bookmaker = match.bookmakers[0];
      if (bookmaker.markets) {
        for (const market of bookmaker.markets) {
          if (market.key === 'h2h' && market.outcomes) {
            for (const outcome of market.outcomes) {
              odds[`h2h_${outcome.name}`] = outcome.price || 0;
            }
          }
          if (market.key && market.key.includes('totals') && market.outcomes) {
            for (const outcome of market.outcomes) {
              odds[`${market.key}_${outcome.name}`] = outcome.price || 0;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Errore estrazione quote:', error);
  }
  
  return odds;
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
    console.error('Errore salvataggio DB:', error);
    return false;
  }
}

async function formatPredictionMessage(prediction: Prediction): Promise<string> {
  return `
🎯 <b>ANALISI MATCH</b>

⚽ <b>${prediction.home_team} vs ${prediction.away_team}</b>
🏆 ${prediction.league} - ${prediction.country}

📊 <b>PREVISIONE PRINCIPALE</b>
Risultato: <b>${prediction.prediction_value}</b>
Confidenza: <b>${prediction.confidence}%</b> ${prediction.confidence >= 75 ? '✅' : prediction.confidence >= 60 ? '⚠️' : '❌'}
Motivazione: ${prediction.reasoning}

📈 <b>ANALISI MERCATI</b>
• 1X2: ${prediction.market_analysis['1X2'] || '-'}
• Over/Under: ${prediction.market_analysis['over_under'] || '-'}
• BTTS: ${prediction.market_analysis['btts'] || '-'}
• Asian HC: ${prediction.market_analysis['asian_handicap'] || '-'}

💰 <b>VALUTAZIONE VALORE</b>
Rischio: ${prediction.market_analysis['risk_level'] || '-'}
Valore: ${prediction.market_analysis['value_assessment'] || '-'}

⚠️ Analisi AI - Usa responsabilmente!
`;
}

bot.command('start', async (ctx: Context) => {
  const userId = ctx.from?.id;
  
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single();

    if (!data) {
      await supabase
        .from('user_preferences')
        .insert({
          user_id: userId,
          countries: Object.keys(COUNTRIES_LEAGUES),
          leagues: ['italy_serie_a'],
          min_confidence: 65,
          markets_preferred: ['1X2', 'OVER_2.5', 'BTTS']
        });
    }
  } catch (error) {
    console.error('Errore start:', error);
  }

  await ctx.replyWithHTML(`
<b>🤖 Football Prediction Bot AI</b>

Benvenuto! Questo bot analizza partite calcistiche usando Gemini AI.

<b>📋 Comandi disponibili:</b>
/analyze - Analizza partite di oggi
/settings - Modifica preferenze
/history - Storico previsioni
/stats - Statistiche performance
/markets - Guida mercati
/help - Aiuto completo

<b>ℹ️ Note importanti:</b>
• L'analisi è supportata da AI generativa
• Usa sempre responsabilmente
• Non vincere più di quanto puoi perdere
• Consulta esperti sportivi per info approfondite

Digita /analyze per iniziare!
`);
});

bot.command('analyze', async (ctx: Context) => {
  const userId = ctx.from?.id;
  
  await ctx.reply('🔄 Analizzando partite... Attendi 30-60 secondi');

  try {
    const matches = await getMatchesToday();
    
    if (matches.length === 0) {
      await ctx.reply('❌ Nessuna partita trovata per oggi');
      return;
    }

    const predictions: Prediction[] = [];
    let processed = 0;

    for (const match of matches) {
      try {
        const { data: prefs } = await supabase
          .from('user_preferences')
          .select('*')
          .eq('user_id', userId!)
          .single();

        if (prefs && match.country && match.league) {
          if (prefs.countries.includes(match.country) || 
              prefs.leagues.includes(match.league)) {
            
            const prediction = await analyzeMatchWithGemini(match);
            
            if (prediction && prediction.confidence >= (prefs?.min_confidence || 65)) {
              const odds = await getOddsForMatch(match);
              prediction.odds_available = odds;
              
              await savePredictionToSupabase(prediction);
              predictions.push(prediction);
            }
          }
        }

        processed++;
        if (processed % 5 === 0) {
          console.log(`Processate ${processed} partite...`);
        }
      } catch (error) {
        console.error('Errore analisi match:', error);
      }

      await delay(300);
    }

    if (predictions.length === 0) {
      await ctx.reply('❌ Nessuna previsione con confidenza sufficiente trovata');
      return;
    }

    const predictionsToShow = predictions.slice(0, 5);
    
    for (const pred of predictionsToShow) {
      const message = await formatPredictionMessage(pred);
      await ctx.replyWithHTML(message);
      await delay(500);
    }

    if (predictions.length > 5) {
      await ctx.reply(`✅ Analizzate ${predictions.length} partite totali\n📊 Mostrando le migliori ${Math.min(5, predictions.length)}`);
    } else {
      await ctx.reply(`✅ Analizzate ${predictions.length} partite`);
    }

  } catch (error) {
    console.error('Errore in /analyze:', error);
    await ctx.reply('❌ Errore durante l\'analisi. Riprova tra poco.');
  }
});

bot.command('settings', async (ctx: Context) => {
  const userId = ctx.from?.id;

  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId!)
      .single();

    if (!data) {
      await ctx.reply('❌ Preferenze non trovate. Digita /start');
      return;
    }

    const message = `
⚙️ <b>LE TUE PREFERENZE</b>

Paesi: ${data.countries.join(', ')}
Leghe: ${data.leagues.join(', ')}
Confidenza minima: ${data.min_confidence}%
Mercati: ${data.markets_preferred.join(', ')}

<b>Modifica:</b>
/set_country Italia,Inghilterra,Spagna
/set_league Serie A, Premier League
/set_confidence 70
`;

    await ctx.replyWithHTML(message);
  } catch (error) {
    console.error('Errore settings:', error);
    await ctx.reply('❌ Errore nel caricamento preferenze');
  }
});

bot.command('set_country', async (ctx: Context) => {
  const userId = ctx.from?.id;
  const args = (ctx.message as any)?.text?.split(' ').slice(1).join(' ');

  if (!args) {
    await ctx.reply('Uso: /set_country Italia,Inghilterra,Spagna');
    return;
  }

  const countries = args.split(',').map((c: string) => c.trim());

  try {
    await supabase
      .from('user_preferences')
      .update({ countries })
      .eq('user_id', userId);
      
    await ctx.reply(`✅ Paesi aggiornati:\n${countries.join(', ')}`);
  } catch (error) {
    await ctx.reply('❌ Errore update');
  }
});

bot.command('set_confidence', async (ctx: Context) => {
  const userId = ctx.from?.id;
  const confidence = parseInt((ctx.message as any)?.text?.split(' ')[1] || '65');

  if (isNaN(confidence) || confidence < 0 || confidence > 100) {
    await ctx.reply('❌ Valore non valido. Usa numero tra 0-100');
    return;
  }

  try {
    await supabase
      .from('user_preferences')
      .update({ min_confidence: confidence })
      .eq('user_id', userId);
      
    await ctx.reply(`✅ Confidenza minima impostata a ${confidence}%`);
  } catch (error) {
    await ctx.reply('❌ Errore update');
  }
});

bot.command('stats', async (ctx: Context) => {
  try {
    const { data: predictions } = await supabase
      .from('predictions')
      .select('status, profit_loss, confidence')
      .in('status', ['won', 'lost']);

    const won = predictions?.filter((p: any) => p.status === 'won').length || 0;
    const lost = predictions?.filter((p: any) => p.status === 'lost').length || 0;
    const total = won + lost;
    const totalProfit = predictions?.reduce((sum: number, p: any) => sum + (p.profit_loss || 0), 0) || 0;
    const winRate = total > 0 ? ((won / total) * 100).toFixed(1) : 0;
    const avgConfidence = predictions && predictions.length > 0 
      ? (predictions.reduce((sum: number, p: any) => sum + p.confidence, 0) / predictions.length).toFixed(1)
      : 0;

    const message = `
📊 <b>LE TUE STATISTICHE</b>

✅ Previsioni corrette: <b>${won}</b>
❌ Previsioni sbagliate: <b>${lost}</b>
📈 Win Rate: <b>${winRate}%</b>
💰 Profitto totale: <b>€${totalProfit.toFixed(2)}</b>

Confidenza media: <b>${avgConfidence}%</b>
Previsioni totali: <b>${total}</b>
`;

    await ctx.replyWithHTML(message);
  } catch (error) {
    console.error('Errore stats:', error);
    await ctx.reply('❌ Errore nel caricamento statistiche');
  }
});

bot.command('history', async (ctx: Context) => {
  try {
    const { data: predictions } = await supabase
      .from('predictions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!predictions || predictions.length === 0) {
      await ctx.reply('❌ Nessuna storia disponibile');
      return;
    }

    let messageText = '<b>📈 ULTIMI 10 MATCH ANALIZZATI</b>\n\n';

    predictions.forEach((pred: any, idx: number) => {
      const status = pred.status === 'won' ? '✅' : pred.status === 'lost' ? '❌' : '⏳';
      messageText += `${idx + 1}. ${status} ${pred.home_team} vs ${pred.away_team}\n`;
      messageText += `   Previsione: ${pred.prediction_value} (${pred.confidence}%)\n`;
      messageText += `   Stato: ${pred.status}\n\n`;
    });

    await ctx.replyWithHTML(messageText);
  } catch (error) {
    await ctx.reply('❌ Errore nel caricamento storico');
  }
});

bot.command('markets', async (ctx: Context) => {
  await ctx.replyWithHTML(`
📊 <b>GUIDA MERCATI SCOMMESSE</b>

<b>1X2 - Risultato Partita</b>
Prevedi: Vittoria Casa, Pareggio o Vittoria Ospiti
Quote: 2.0-2.5 media | Facilità: Alta | Rischio: Medio

<b>OVER/UNDER 2.5</b>
Prevedi: più di 2.5 gol (Over) o meno (Under)
Quote: 1.9-2.1 | Facilità: Alta | Rischio: Basso-Medio

<b>BTTS - Entrambe Segnano</b>
Entrambe le squadre segnano almeno un gol
Quote: 1.6-2.2 | Facilità: Media | Rischio: Medio

<b>ASIAN HANDICAP</b>
Handicap -0.5, -1, -1.5 per favorite
Quote: 1.7-1.9 | Facilità: Media | Rischio: Medio-Alto

<b>CORRECT SCORE</b>
Indovina esito esatto (es: 2-1)
Quote: 4.0-12.0+ | Facilità: Bassa | Rischio: Alto

⚠️ <b>Gestione Bankroll:</b>
• Max 5% per scommessa
• Confidence < 60% = Non scommettere
• Usa Kelly Criterion: stake = (conf-50)/100
• Traccia ROI continuamente
`);
});

bot.command('help', async (ctx: Context) => {
  await ctx.replyWithHTML(`
<b>🆘 GUIDA COMPLETA COMANDI</b>

<b>/start</b> - Inizializza il bot e crea profilo
<b>/analyze</b> - Analizza partite di oggi
<b>/settings</b> - Mostra e modifica preferenze
<b>/set_country PAESI</b> - Es: Italia,Inghilterra,Spagna
<b>/set_confidence N</b> - Soglia minima (0-100)
<b>/history</b> - Ultimi 10 match analizzati
<b>/stats</b> - Statistiche personali
<b>/markets</b> - Guida mercati scommesse
<b>/help</b> - Questo messaggio

<b>ℹ️ Come Funziona:</b>
1. Bot recupera partite da The-Odds-API
2. Gemini AI analizza ogni partita
3. Salva previsioni nel database
4. Ti mostra risultati con confidenza

<b>⚠️ Disclaimer:</b>
Questo bot è uno strumento educativo.
Non è un sistema di scommesse garantito.
Analizza dati storici e trend, non il futuro.
Gioca responsabilmente.
`);
});

bot.on(message(), async (ctx: Context) => {
  const text = (ctx.message as any)?.text;
  if (text && !text.startsWith('/')) {
    await ctx.reply('❓ Comando non riconosciuto. Digita /help per i comandi disponibili.');
  }
});

bot.catch((err: any, ctx: Context) => {
  console.error('Errore bot:', err);
  ctx.reply('❌ Errore interno. Riprova dopo poco.');
});

bot.launch().then(() => {
  console.log('✅ Bot avviato con successo');
}).catch((err) => {
  console.error('❌ Errore avvio bot:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
