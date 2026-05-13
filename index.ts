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

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

interface CacheEntry {
data: any;
timestamp: number;
ttl: number;
}

class SmartCache {
private cache: Map<string, CacheEntry> = new Map();

set(key: string, data: any, ttlSeconds: number = 3600) {
this.cache.set(key, { data, timestamp: Date.now(), ttl: ttlSeconds * 1000 });
}

get(key: string): any | null {
const entry = this.cache.get(key);
if (!entry) return null;
if (Date.now() - entry.timestamp > entry.ttl) {
this.cache.delete(key);
return null;
}
return entry.data;
}
}

const cache = new SmartCache();

class RateLimiter {
private lastCall: number = 0;
private minInterval: number;

constructor(callsPerSecond: number = 1) {
this.minInterval = 1000 / callsPerSecond;
}

async wait() {
const now = Date.now();
const timeSinceLastCall = now - this.lastCall;
if (timeSinceLastCall < this.minInterval) {
await new Promise(r => setTimeout(r, this.minInterval - timeSinceLastCall));
}
this.lastCall = Date.now();
}
}

const apiLimiter = new RateLimiter(2);
const geminiLimiter = new RateLimiter(1);

class Logger {
log(level: ‘INFO’ | ‘WARN’ | ‘ERROR’, message: string, data?: any) {
const timestamp = new Date().toISOString();
const emoji = level === ‘INFO’ ? ‘✅’ : level === ‘WARN’ ? ‘⚠️’ : ‘❌’;
console.log(`[${timestamp}] ${emoji} ${level}: ${message}`, data || ‘’);
}

info(msg: string, data?: any) { this.log(‘INFO’, msg, data); }
warn(msg: string, data?: any) { this.log(‘WARN’, msg, data); }
error(msg: string, data?: any) { this.log(‘ERROR’, msg, data); }
}

const logger = new Logger();

const SPORTS: Record<string, { key: string; country: string }> = {
‘Premier League’: { key: ‘soccer_epl’, country: ‘England’ },
‘La Liga’: { key: ‘soccer_spain_la_liga’, country: ‘Spain’ },
‘Bundesliga’: { key: ‘soccer_germany_bundesliga’, country: ‘Germany’ },
‘Serie A’: { key: ‘soccer_italy_serie_a’, country: ‘Italy’ },
‘Ligue 1’: { key: ‘soccer_france_ligue_1’, country: ‘France’ },
‘Eredivisie’: { key: ‘soccer_netherlands_eredivisie’, country: ‘Netherlands’ }
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
country: string;
prediction_value: string;
confidence: number;
reasoning: string;
expectedValue: number;
bestOdds: number;
bookmakerCount: number;
}

async function retryAsync<T>(
fn: () => Promise<T>,
maxRetries: number = 3,
delayMs: number = 1000
): Promise<T | null> {
for (let attempt = 1; attempt <= maxRetries; attempt++) {
try {
return await fn();
} catch (error) {
if (attempt === maxRetries) {
logger.error(`Final attempt failed after ${maxRetries} retries`, error);
return null;
}
logger.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms`);
await new Promise(r => setTimeout(r, delayMs));
}
}
return null;
}

async function getMatchesForLeague(sportKey: string, leagueName: string): Promise<Match[]> {
const cacheKey = `matches_${sportKey}`;
const cached = cache.get(cacheKey);

if (cached) {
logger.info(`Cache hit: ${leagueName} (${cached.length} matches)`);
return cached;
}

await apiLimiter.wait();

const result = await retryAsync(async () => {
logger.info(`Fetching ${leagueName}...`);

```
const response = await axios.get(
  `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`,
  {
    params: {
      apiKey: ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h',
      oddsFormat: 'decimal'
    },
    timeout: 15000
  }
);

const matches = response.data || [];
logger.info(`Found ${matches.length} matches in ${leagueName}`);
cache.set(cacheKey, matches, 1800);
return matches;
```

}, 2, 2000);

return result || [];
}

function analyzeOdds(bookmakers: any[] = []): { bestOdds: number; count: number } {
if (!bookmakers.length) return { bestOdds: 0, count: 0 };

const odds: number[] = [];

for (const bookmaker of bookmakers) {
const markets = bookmaker.markets || [];
for (const market of markets) {
if (market.key === ‘h2h’ && market.outcomes) {
for (const outcome of market.outcomes) {
if (outcome.price) odds.push(outcome.price);
}
}
}
}

if (odds.length === 0) return { bestOdds: 0, count: 0 };

return {
bestOdds: Math.max(…odds),
count: bookmakers.length
};
}

function buildAdvancedPrompt(match: Match, league: string, oddInfo: any): string {
return `Analizza questa partita calcio come esperto con 20 anni di esperienza.

PARTITA: ${match.home_team} vs ${match.away_team}
LEGA: ${league}
QUOTE: ${oddInfo.count} bookmaker (Miglior: ${oddInfo.bestOdds.toFixed(2)})

ANALIZZA CONSIDERANDO:

1. Differenza qualità squadre
1. Fattore casa/trasferta
1. Forma stagionale
1. Motivazione

RISPONDI SOLO IN QUESTO JSON:
{
“prediction”: “HOME|DRAW|AWAY”,
“confidence”: 72,
“reasoning”: “Analisi (max 100 caratteri)”,
“expectedValue”: 1.05,
“riskLevel”: “BASSO|MEDIO|ALTO”
}`;
}

async function analyzeWithGemini(match: Match, league: string): Promise<Prediction | null> {
const oddInfo = analyzeOdds(match.bookmakers);
const prompt = buildAdvancedPrompt(match, league, oddInfo);

await geminiLimiter.wait();

const result = await retryAsync(async () => {
logger.info(`Analyzing ${match.home_team} vs ${match.away_team}...`);

```
const response = await axios.post(
  `${GEMINI_URL}?key=${GEMINI_API_KEY}`,
  { contents: [{ parts: [{ text: prompt }] }] },
  { timeout: 20000 }
);

const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) throw new Error('Empty response');

const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error('No JSON');

const analysis = JSON.parse(jsonMatch[0]);

if (!analysis.prediction || !analysis.confidence) throw new Error('Invalid format');

const leagueName = Object.keys(SPORTS).find(k => SPORTS[k].key === league) || league;
const country = Object.values(SPORTS).find(s => s.key === league)?.country || 'EU';

return {
  match_id: match.id,
  home_team: match.home_team,
  away_team: match.away_team,
  league: leagueName,
  country: country,
  prediction_value: analysis.prediction,
  confidence: analysis.confidence,
  reasoning: analysis.reasoning,
  expectedValue: analysis.expectedValue || 1.0,
  bestOdds: oddInfo.bestOdds,
  bookmakerCount: oddInfo.count
};
```

}, 2, 3000);

return result || null;
}

async function savePredictionToSupabase(prediction: Prediction): Promise<boolean> {
const result = await retryAsync(async () => {
const { error } = await supabase.from(‘predictions’).insert({
match_id: prediction.match_id,
home_team: prediction.home_team,
away_team: prediction.away_team,
league: prediction.league,
country: prediction.country,
match_date: new Date().toISOString(),
prediction_type: ‘1X2’,
prediction_value: prediction.prediction_value,
confidence: prediction.confidence,
reasoning: prediction.reasoning,
odds_available: { bestOdds: prediction.bestOdds, count: prediction.bookmakerCount },
market_analysis: { expectedValue: prediction.expectedValue },
status: ‘pending’
});

```
if (error) throw error;
return true;
```

}, 2, 1000);

return result || false;
}

async function createUserPreferences(userId: number): Promise<boolean> {
const result = await retryAsync(async () => {
const { error } = await supabase.from(‘user_preferences’).insert({
user_id: userId,
countries: [‘England’, ‘Spain’, ‘Germany’, ‘Italy’, ‘France’, ‘Netherlands’],
leagues: Object.values(SPORTS).map(s => s.key),
min_confidence: 70,
markets_preferred: [‘1X2’]
});

```
if (error) throw error;
return true;
```

}, 2, 1000);

return result || false;
}

bot.command(‘start’, async (ctx: Context) => {
const userId = ctx.from?.id!;
logger.info(`/start from user ${userId}`);

try {
const { data, error } = await supabase
.from(‘user_preferences’)
.select(’*’)
.eq(‘user_id’, userId)
.single();

```
if (!data || error) {
  await createUserPreferences(userId);
}
```

} catch (err) {
logger.error(‘Start error’, err);
}

await ctx.replyWithHTML(`
<b>⚽ Football Prediction Bot AI PRO</b>

Analisi avanzata con Gemini + The-Odds-API

<b>🎯 Comandi:</b>
/analyze - Analizza tutte le partite
/top - Top 5 previsioni
/history - Ultime previsioni
/stats - Statistiche
/help - Aiuto
`);
});

bot.command(‘analyze’, async (ctx: Context) => {
const userId = ctx.from?.id!;
logger.info(`/analyze from user ${userId}`);

await ctx.reply(‘🔄 Analizzando con AI…’);

try {
const predictions: Prediction[] = [];

```
for (const [leagueName, leagueInfo] of Object.entries(SPORTS)) {
  const matches = await getMatchesForLeague(leagueInfo.key, leagueName);

  for (const match of matches.slice(0, 3)) {
    try {
      const prediction = await analyzeWithGemini(match, leagueName);

      if (prediction && prediction.confidence >= 70) {
        await savePredictionToSupabase(prediction);
        predictions.push(prediction);
        logger.info(`✅ ${match.home_team} vs ${match.away_team} (${prediction.confidence}%)`);
      }
    } catch (err) {
      logger.warn(`Analysis failed for ${match.home_team}`);
    }

    await new Promise(r => setTimeout(r, 600));
  }
}

if (predictions.length === 0) {
  await ctx.reply('❌ Nessuna previsione trovata');
  return;
}

predictions.sort((a, b) => (b.expectedValue || 0) - (a.expectedValue || 0));

for (const pred of predictions.slice(0, 5)) {
  const emoji = pred.confidence >= 80 ? '🟢' : '🟡';
  await ctx.replyWithHTML(`
```

${emoji} <b>${pred.home_team} vs ${pred.away_team}</b>
🏆 ${pred.league}
📊 <b>${pred.prediction_value}</b> • ${pred.confidence}%
💰 Quote: ${pred.bestOdds.toFixed(2)}
📈 EV: ${(pred.expectedValue || 1).toFixed(2)}x
`);
await new Promise(r => setTimeout(r, 300));
}

```
await ctx.reply(`✅ ${predictions.length} previsioni`);
```

} catch (err) {
logger.error(‘Analyze error’, err);
await ctx.reply(‘❌ Errore’);
}
});

bot.command(‘top’, async (ctx: Context) => {
try {
const { data: predictions } = await supabase
.from(‘predictions’)
.select(’*’)
.eq(‘status’, ‘pending’)
.order(‘confidence’, { ascending: false })
.limit(5);

```
if (!predictions || predictions.length === 0) {
  await ctx.reply('❌ Nessuna previsione');
  return;
}

let msg = '<b>🏆 TOP 5</b>\n\n';
(predictions as any[]).forEach((pred, idx) => {
  msg += `${idx + 1}. ${pred.home_team} vs ${pred.away_team}\n`;
  msg += `   ${pred.prediction_value} • ${pred.confidence}%\n\n`;
});

await ctx.replyWithHTML(msg);
```

} catch (err) {
logger.error(‘Top error’, err);
await ctx.reply(‘❌ Errore’);
}
});

bot.command(‘stats’, async (ctx: Context) => {
try {
const { data: predictions } = await supabase
.from(‘predictions’)
.select(‘status, confidence’);

```
if (!predictions) {
  await ctx.reply('❌ Errore');
  return;
}

const won = (predictions as any[]).filter((p: any) => p.status === 'won').length;
const lost = (predictions as any[]).filter((p: any) => p.status === 'lost').length;
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
} catch (err) {
logger.error(‘Stats error’, err);
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
  await ctx.reply('❌ Nessuna storia');
  return;
}

let msg = '<b>📈 ULTIME</b>\n\n';
(predictions as any[]).forEach((pred, idx) => {
  const status = pred.status === 'won' ? '✅' : pred.status === 'lost' ? '❌' : '⏳';
  msg += `${idx + 1}. ${status} ${pred.home_team} vs ${pred.away_team}\n`;
  msg += `   ${pred.prediction_value} (${pred.confidence}%)\n\n`;
});

await ctx.replyWithHTML(msg);
```

} catch (err) {
logger.error(‘History error’, err);
await ctx.reply(‘❌ Errore’);
}
});

bot.command(‘help’, async (ctx: Context) => {
await ctx.replyWithHTML(`
<b>🆘 COMANDI</b>

/start - Inizializza
/analyze - Analizza partite
/top - Top 5
/history - Ultime previsioni
/stats - Statistiche
/help - Aiuto
`);
});

bot.on(message(), async (ctx: Context) => {
const text = (ctx.message as any)?.text;
if (text && !text.startsWith(’/’)) {
await ctx.reply(’/help’);
}
});

bot.catch((err: any) => {
logger.error(‘Bot error’, err);
});

bot.launch().then(() => {
logger.info(‘Bot PRO avviato’);
}).catch((err) => {
logger.error(‘Launch error’, err);
process.exit(1);
});

process.once(‘SIGINT’, () => bot.stop(‘SIGINT’));
process.once(‘SIGTERM’, () => bot.stop(‘SIGTERM’));

export default bot;