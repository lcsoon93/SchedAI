import * as dotenv from ‘dotenv’;
import { Telegraf, Context } from ‘telegraf’;
import { message } from ‘telegraf/filters’;
import { createClient } from ‘@supabase/supabase-js’;
import axios from ‘axios’;

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = ‘https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent’;

const supabase = createClient(
process.env.SUPABASE_URL!,
process.env.SUPABASE_KEY!
);

const SPORTS = {
‘Premier League’: ‘soccer_epl’,
‘La Liga’: ‘soccer_spain_la_liga’,
‘Bundesliga’: ‘soccer_germany_bundesliga’,
‘Serie A’: ‘soccer_italy_serie_a’,
‘Ligue 1’: ‘soccer_france_ligue_1’,
‘Eredivisie’: ‘soccer_netherlands_eredivisie’
};

interface Match {
id: string;
home_team: string;
away_team: string;
commence_time: string;
bookmakers?: any[];
}

interface Prediction {
match_id: string;
home_team: string;
away_team: string;
league: string;
prediction_value: string;
confidence: number;
reasoning: string;
}

async function getMatchesForLeague(sportKey: string): Promise<Match[]> {
try {
const response = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`, {
params: {
apiKey: ODDS_API_KEY,
regions: ‘eu’,
markets: ‘h2h’,
oddsFormat: ‘decimal’
},
timeout: 15000
});

```
return response.data || [];
```

} catch (error) {
console.error(`Error fetching ${sportKey}:`, error instanceof Error ? error.message : error);
return [];
}
}

async function analyzeWithGemini(match: Match, league: string): Promise<Prediction | null> {
try {
const prompt = `Analizza questa partita calcio: ${match.home_team} vs ${match.away_team} in ${league}. Rispondi SOLO in JSON: {"primary_prediction": "HOME|DRAW|AWAY", "confidence": 70, "reasoning": "..."}`;

```
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
  league: league,
  prediction_value: analysis.primary_prediction || 'HOME',
  confidence: Math.min(Math.max(analysis.confidence || 65, 0), 100),
  reasoning: analysis.reasoning || 'Analisi completata'
};
```

} catch (error) {
console.error(‘Gemini error:’, error instanceof Error ? error.message : error);
return null;
}
}

async function savePredictionToSupabase(prediction: Prediction): Promise<boolean> {
try {
const { error } = await supabase
.from(‘predictions’)
.insert({
match_id: prediction.match_id,
home_team: prediction.home_team,
away_team: prediction.away_team,
league: prediction.league,
country: ‘EU’,
match_date: new Date().toISOString(),
prediction_type: ‘1X2’,
prediction_value: prediction.prediction_value,
confidence: prediction.confidence,
reasoning: prediction.reasoning,
odds_available: {},
market_analysis: {},
status: ‘pending’
});

```
if (error) {
  console.error('DB insert error:', error);
  return false;
}
return true;
```

} catch (error) {
console.error(‘DB error:’, error);
return false;
}
}

async function createUserPreferences(userId: number): Promise<boolean> {
try {
const { error } = await supabase
.from(‘user_preferences’)
.insert({
user_id: userId,
countries: [‘England’, ‘Spain’, ‘Germany’],
leagues: Object.values(SPORTS),
min_confidence: 65,
markets_preferred: [‘1X2’]
});

```
if (error) {
  console.error('Create preferences error:', error);
  return false;
}
return true;
```

} catch (error) {
console.error(‘Error:’, error);
return false;
}
}

bot.command(‘start’, async (ctx: Context) => {
const userId = ctx.from?.id!;
console.log(`/start from user ${userId}`);

try {
const { data } = await supabase
.from(‘user_preferences’)
.select(’*’)
.eq(‘user_id’, userId)
.single()
.catch(() => ({ data: null }));

```
if (!data) {
  await createUserPreferences(userId);
}
```

} catch (error) {
console.error(‘Start error:’, error);
}

await ctx.replyWithHTML(`
<b>⚽ Football Prediction Bot AI</b>

Benvenuto! Questo bot analizza partite calcistiche.

<b>Comandi:</b>
/analyze - Analizza partite
/history - Ultime previsioni
/stats - Statistiche
/help - Aiuto
`);
});

bot.command(‘analyze’, async (ctx: Context) => {
const userId = ctx.from?.id!;
console.log(`/analyze from user ${userId}`);

await ctx.reply(‘🔄 Analizzando partite…’);

try {
const predictions: Prediction[] = [];

```
for (const [leagueName, sportKey] of Object.entries(SPORTS)) {
  console.log(`Fetching ${leagueName}...`);
  const matches = await getMatchesForLeague(sportKey);
  
  console.log(`Found ${matches.length} matches in ${leagueName}`);

  for (const match of matches.slice(0, 5)) {
    try {
      const prediction = await analyzeWithGemini(match, leagueName);
      
      if (prediction && prediction.confidence >= 65) {
        await savePredictionToSupabase(prediction);
        predictions.push(prediction);
        console.log(`✅ ${match.home_team} vs ${match.away_team}: ${prediction.confidence}%`);
      }
    } catch (error) {
      console.error('Analysis error:', error);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  await new Promise(r => setTimeout(r, 300));
}

console.log(`Total predictions: ${predictions.length}`);

if (predictions.length === 0) {
  await ctx.reply('❌ Nessuna previsione trovata');
  return;
}

for (const pred of predictions.slice(0, 5)) {
  await ctx.replyWithHTML(`
```

⚽ <b>${pred.home_team} vs ${pred.away_team}</b>
🏆 ${pred.league}
📊 <b>${pred.prediction_value}</b> (${pred.confidence}%)
💡 ${pred.reasoning}
`);
await new Promise(r => setTimeout(r, 300));
}

```
await ctx.reply(`✅ Analizzate ${predictions.length} partite`);
```

} catch (error) {
console.error(‘Analyze error:’, error);
await ctx.reply(‘❌ Errore durante l'analisi’);
}
});

bot.command(‘stats’, async (ctx: Context) => {
try {
const { data: predictions } = await supabase
.from(‘predictions’)
.select(‘status, confidence’)
.in(‘status’, [‘won’, ‘lost’]);

```
const won = predictions?.filter((p: any) => p.status === 'won').length || 0;
const lost = predictions?.filter((p: any) => p.status === 'lost').length || 0;
const total = won + lost;
const winRate = total > 0 ? ((won / total) * 100).toFixed(1) : 0;

await ctx.replyWithHTML(`
```

📊 <b>STATISTICHE</b>

✅ Vinte: <b>${won}</b>
❌ Perse: <b>${lost}</b>
📈 Win Rate: <b>${winRate}%</b>
📋 Totale: <b>${total}</b>
`);
} catch (error) {
console.error(‘Stats error:’, error);
await ctx.reply(‘❌ Errore’);
}
});

bot.command(‘history’, async (ctx: Context) => {
try {
const { data: predictions } = await supabase
.from(‘predictions’)
.select(’*’)
.order(‘created_at’, { ascending: false })
.limit(10);

```
if (!predictions || predictions.length === 0) {
  await ctx.reply('❌ Nessuna storia disponibile');
  return;
}

let msg = '<b>📈 ULTIME PREVISIONI</b>\n\n';
predictions.forEach((pred: any, idx: number) => {
  const status = pred.status === 'won' ? '✅' : pred.status === 'lost' ? '❌' : '⏳';
  msg += `${idx + 1}. ${status} ${pred.home_team} vs ${pred.away_team}\n`;
  msg += `   ${pred.prediction_value} (${pred.confidence}%)\n\n`;
});

await ctx.replyWithHTML(msg);
```

} catch (error) {
console.error(‘History error:’, error);
await ctx.reply(‘❌ Errore’);
}
});

bot.command(‘help’, async (ctx: Context) => {
await ctx.replyWithHTML(`
<b>🆘 COMANDI</b>

/start - Inizializza
/analyze - Analizza partite
/history - Ultime previsioni
/stats - Statistiche
/help - Questo messaggio
`);
});

bot.on(message(), async (ctx: Context) => {
const text = (ctx.message as any)?.text;
if (text && !text.startsWith(’/’)) {
await ctx.reply(‘❓ Digita /help per i comandi’);
}
});

bot.catch((err: any) => {
console.error(‘Bot error:’, err);
});

bot.launch().then(() => {
console.log(‘✅ Bot avviato con successo’);
}).catch((err) => {
console.error(‘❌ Errore avvio:’, err);
process.exit(1);
});

process.once(‘SIGINT’, () => bot.stop(‘SIGINT’));
process.once(‘SIGTERM’, () => bot.stop(‘SIGTERM’));

export default bot;