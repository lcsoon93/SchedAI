import * as dotenv from ‘dotenv’;
import { Telegraf, Context } from ‘telegraf’;
import { message } from ‘telegraf/filters’;
import { createClient } from ‘@supabase/supabase-js’;
import axios from ‘axios’;

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;

async function testOddsAPI(league: string) {
try {
const response = await axios.get(‘https://api.the-odds-api.com/v4/sports/soccer/events’, {
params: {
apiKey: ODDS_API_KEY,
sport_key: league,
daysFrom: 7,
oddsFormat: ‘decimal’
},
timeout: 10000
});

```
return response.data?.length || 0;
```

} catch (error) {
console.error(‘API error:’, error);
return 0;
}
}

async function testSupabase(userId: number) {
try {
const { data, error: selectError } = await supabase
.from(‘user_preferences’)
.select(’*’)
.eq(‘user_id’, userId)
.single();

```
if (selectError) {
  const { error: insertError } = await supabase
    .from('user_preferences')
    .insert({
      user_id: userId,
      countries: ['England'],
      leagues: ['england_premier_league'],
      min_confidence: 65,
      markets_preferred: ['1X2']
    });

  return !insertError;
}
return true;
```

} catch (error) {
console.error(‘DB error:’, error);
return false;
}
}

bot.command(‘test’, async (ctx: Context) => {
await ctx.reply(‘Testing…’);

let apiCount = 0;
for (const league of [‘england_premier_league’, ‘spain_la_liga’]) {
const count = await testOddsAPI(league);
apiCount += count;
await new Promise(r => setTimeout(r, 300));
}

const userId = ctx.from?.id || 999999;
const dbWorks = await testSupabase(userId);

let msg = ‘RESULTS:\n\n’;

if (apiCount > 0) {
msg += ‘API: OK (’ + apiCount + ’ matches)\n’;
} else {
msg += ‘API: FAIL (0 matches)\n’;
}

if (dbWorks) {
msg += ‘DB: OK\n’;
} else {
msg += ‘DB: FAIL\n’;
}

await ctx.reply(msg);
});

bot.command(‘start’, async (ctx: Context) => {
await ctx.reply(‘Test Bot\n\n/test - Run diagnostics’);
});

bot.on(message(), async (ctx: Context) => {
const text = (ctx.message as any)?.text;
if (text && !text.startsWith(’/’)) {
await ctx.reply(‘Type /test’);
}
});

bot.catch((err: any) => {
console.error(‘Error:’, err);
});

bot.launch().then(() => {
console.log(‘Bot started’);
}).catch((err) => {
console.error(‘Launch error:’, err);
process.exit(1);
});

process.once(‘SIGINT’, () => bot.stop(‘SIGINT’));
process.once(‘SIGTERM’, () => bot.stop(‘SIGTERM’));

export default bot;