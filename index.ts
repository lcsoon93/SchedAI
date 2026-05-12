import * as dotenv from 'dotenv';
import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;

async function testOddsAPI() {
  try {
    console.log('Testing The-Odds-API...');
    console.log('API Key:', ODDS_API_KEY ? 'OK' : 'MISSING');
    
    const sportKey = 'soccer_epl'; // Inserito qui per pulizia

    // 1. URL corretto con lo sportKey integrato nel path
    // 2. L'endpoint termina con /odds
    const response = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`, {
      params: {
        apiKey: ODDS_API_KEY,
        regions: 'eu',
        markets: 'h2h',
        oddsFormat: 'decimal'
      },
      timeout: 15000
    });

    console.log('Status:', response.status);
    console.log('Data count:', response.data?.length);
    
    if (response.data && Array.isArray(response.data)) {
      console.log('First match:', response.data[0]);
      return response.data;
    }
    return [];
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    
    // Metodo corretto per verificare un errore Axios in TypeScript
    if (axios.isAxiosError(error)) {
      console.error('Response:', error.response?.status, error.response?.data);
    }
    return [];
  }
}

bot.command('test', async (ctx: Context) => {
  await ctx.reply('Testing API...');
  
  const matches = await testOddsAPI();
  
  if (matches.length === 0) {
    await ctx.reply('API: No matches found\n\nCheck:\n1. API Key valid?\n2. sport_key correct?');
  } else {
    await ctx.reply('API: OK!\n\n' + matches.length + ' matches found');
    
    if (matches.length > 0) {
      const first = (matches as any)[0];
      await ctx.reply('First match:\n' + first.home_team + ' vs ' + first.away_team);
    }
  }
});

bot.command('start', async (ctx: Context) => {
  await ctx.reply('API Test Bot\n\n/test - Test The-Odds-API');
});

bot.on(message(), async (ctx: Context) => {
  await ctx.reply('/test');
});

bot.catch((err: any) => {
  console.error('Bot error:', err);
});

bot.launch().then(() => {
  console.log('Bot started');
}).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
