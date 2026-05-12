import * as dotenv from ‘dotenv’;
import { Telegraf, Context } from ‘telegraf’;
import { message } from ‘telegraf/filters’;
import { createClient } from ‘@supabase/supabase-js’;
import axios from ‘axios’;

dotenv.config();

console.log(‘🔧 BOT DIAGNOSTICA’);

const supabase = createClient(
process.env.SUPABASE_URL!,
process.env.SUPABASE_KEY!
);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;

async function testOddsAPI(league: string) {
try {
console.log(`\n🧪 Test: ${league}`);
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
const count = response.data?.length || 0;
console.log(`   ✅ ${count} partite`);
return count;
```

} catch (error) {
console.error(`   ❌`, error instanceof Error ? error.message : error);
return 0;
}
}

async function testSupabase(userId: number) {
try {
console.log(`\n🧪 Test DB user_id ${userId}`);

```
const { data, error: selectError } = await supabase
  .from('user_preferences')
  .select('*')
  .eq('user_id', userId)
  .single();

if (selectError) {
  console.log(`   ℹ️ Non esiste, creando...`);
  
  const { error: insertError } = await supabase
    .from('user_preferences')
    .insert({
      user_id: userId,
      countries: ['England'],
      leagues: ['england_premier_league'],
      min_confidence: 65,
      markets_preferred: ['1X2']
    });

  if (insertError) {
    console.error(`   ❌ Insert:`, insertError.message);
    return false;
  }
  console.log(`   ✅ Creato`);
  return true;
} else {
  console.log(`   ✅ Trovato`);
  return true;
}
```

} catch (error) {
console.error(`   ❌`, error instanceof Error ? error.message : error);
return false;
}
}

bot.command(‘test’, async (ctx: Context) => {
await ctx.reply(‘🧪 Diagnostica in corso…’);

console.log(’\n===== DIAGNOSTICA COMPLETA =====’);

let apiCount = 0;
const leagues = [‘england_premier_league’, ‘spain_la_liga’, ‘germany_bundesliga’];

for (const league of leagues) {
const count = await testOddsAPI(league);
apiCount += count;
await new Promise(r => setTimeout(r, 300));
}

const userId = ctx.from?.id || 999999;
const dbWorks = await testSupabase(userId);

console.log(`\n📊 RISULTATI:`);
console.log(`   API: ${apiCount} partite`);
console.log(`   DB: ${dbWorks ? 'OK' : 'ERRORE'}`);

let msg = `📊 TEST RISULTATI:\n\n`;

if (apiCount > 0) {
msg += `✅ API: ${apiCount} partite trovate\n`;
} else {
msg += `❌ API: 0 partite (PROBLEMA!)\n`;
}

if (dbWorks) {
msg += `✅ DATABASE: OK\n`;
} else {
msg += `❌ DATABASE: ERRORE\n`;
}

msg += `\n`;

if (apiCount === 0 && !dbWorks) {
msg += `❌ ENTRAMBI OFFLINE\n\nVerifica:\n1. API Key valida?\n2. Credenziali Supabase giuste?`;
} else if (apiCount === 0) {
msg += `❌ PROBLEMA API\n\nNessuna partita trovata.\nPossibili cause:\n• API Key scaduta\n• Rate limit\n• Nessuna partita in programma`;
} else if (!dbWorks) {
msg += `❌ PROBLEMA DATABASE\n\nVerifica permessi Supabase`;
} else {
msg += `✅ TUTTO OK!\n\nBot pronto`;
}

await ctx.reply(msg);
});

bot.command(‘start’, async (ctx: Context) => {
await ctx.reply(‘🧪 BOT DIAGNOSTICA\n\n/test - Esegui diagnostica completa’);
});

bot.on(message(), async (ctx: Context) => {
const text = (ctx.message as any)?.text;
if (text && !text.startsWith(’/’)) {
await ctx.reply(‘❓ /test’);
}
});

bot.catch((err: any) => {
console.error(‘Errore:’, err);
});

bot.launch().then(() => {
console.log(‘✅ Bot avviato’);
}).catch((err) => {
console.error(‘❌ Errore:’, err);
process.exit(1);
});

process.once(‘SIGINT’, () => bot.stop(‘SIGINT’));
process.once(‘SIGTERM’, () => bot.stop(‘SIGTERM’));

export default bot;