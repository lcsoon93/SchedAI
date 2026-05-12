import * as dotenv from 'dotenv';
import { Telegraf, Context } from 'telegraf';
import axios from 'axios';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY!;

// 1. Definiamo le leghe che vogliamo monitorare.
// Ognuna ha il suo 'sport_key' per l'API, e i nomi formattati per la chat.
const LEAGUES = [
  { key: 'soccer_italy_serie_a', country: 'Italia 🇮🇹', name: 'Serie A' },
  { key: 'soccer_italy_serie_b', country: 'Italia 🇮🇹', name: 'Serie B' },
  { key: 'soccer_england_premier_league', country: 'Inghilterra 🏴󠁧󠁢󠁥󠁮󠁧󠁿', name: 'Premier League' },
  { key: 'soccer_spain_la_liga', country: 'Spagna 🇪🇸', name: 'La Liga' },
  { key: 'soccer_germany_bundesliga', country: 'Germania 🇩🇪', name: 'Bundesliga' },
  { key: 'soccer_france_ligue_1', country: 'Francia 🇫🇷', name: 'Ligue 1' },
  { key: 'soccer_netherlands_eredivisie', country: 'Olanda 🇳🇱', name: 'Eredivisie' },
  { key: 'soccer_uefa_champs_league', country: 'Europa 🇪🇺', name: 'Champions League' },
  { key: 'soccer_uefa_europa_league', country: 'Europa 🇪🇺', name: 'Europa League' }
];

// 2. Utility per verificare se una partita si gioca "Oggi" 
// (Forziamo il fuso orario su Roma per evitare sfasamenti se Replit gira negli USA)
function isToday(dateString: string) {
  const options: Intl.DateTimeFormatOptions = { 
    timeZone: 'Europe/Rome', 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  };
  const matchDateStr = new Date(dateString).toLocaleDateString('it-IT', options);
  const todayStr = new Date().toLocaleDateString('it-IT', options);
  
  return matchDateStr === todayStr;
}

// 3. Funzione per recuperare e raggruppare i match
async function getTodaysMatches() {
  const groupedMatches: Record<string, Record<string, any[]>> = {};
  let matchCount = 0;

  // Eseguiamo le chiamate sequenzialmente per non farci bloccare l'API
  for (const league of LEAGUES) {
    try {
      const response = await axios.get(`https://api.the-odds-api.com/v4/sports/${league.key}/odds`, {
        params: {
          apiKey: ODDS_API_KEY,
          regions: 'eu', // Ci basta una region per scaricare il calendario
          markets: 'h2h'
        },
        timeout: 10000
      });

      // Filtriamo per oggi
      const matches = response.data.filter((match: any) => isToday(match.commence_time));

      // Se ci sono match, raggruppiamoli per Nazione e poi per Lega
      if (matches.length > 0) {
        if (!groupedMatches[league.country]) {
          groupedMatches[league.country] = {};
        }
        groupedMatches[league.country][league.name] = matches;
        matchCount += matches.length;
      }
    } catch (error) {
      console.error(`❌ Errore nel fetch di ${league.key}:`, error instanceof Error ? error.message : error);
    }
  }

  return { groupedMatches, matchCount };
}

// 4. Comando del Bot: /partite
bot.command('partite', async (ctx: Context) => {
  // Avvisa l'utente che ci vorrà qualche secondo
  const loadingMsg = await ctx.reply('🔍 Sto recuperando le partite di oggi, attendi un momento...');

  try {
    const { groupedMatches, matchCount } = await getTodaysMatches();

    if (matchCount === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMsg.message_id,
        undefined,
        'Nessuna partita in programma per oggi nei campionati principali.'
      );
      return;
    }

    // Costruiamo il testo in Markdown
    let messageText = `📅 *PARTITE DI OGGI*\n\n`;

    for (const [country, leagues] of Object.entries(groupedMatches)) {
      messageText += `*${country}*\n`;
      for (const [leagueName, matches] of Object.entries(leagues)) {
        messageText += ` 🏆 _${leagueName}_\n`;
        
        for (const match of matches) {
          // Estrapoliamo l'orario (sempre col fuso orario di Roma)
          const time = new Date(match.commence_time).toLocaleTimeString('it-IT', { 
            timeZone: 'Europe/Rome',
            hour: '2-digit', 
            minute: '2-digit' 
          });
          
          messageText += `  ▫️ \`${time}\` | ${match.home_team} - ${match.away_team}\n`;
        }
        messageText += '\n'; // Spaziatura tra diverse leghe
      }
    }

    // Modifica il messaggio di "attesa" con i risultati finali
    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      loadingMsg.message_id,
      undefined,
      messageText,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error(error);
    await ctx.reply('❌ Si è verificato un errore durante il recupero delle partite.');
  }
});

// Comando /start
bot.command('start', async (ctx: Context) => {
  await ctx.reply(
    '👋 Ciao! Sono il bot del Calcio.\n\n' +
    'Usa il comando /partite per scaricare tutto il palinsesto delle partite di oggi!'
  );
});

// Gestore globale errori per non far crashare il bot
bot.catch((err: any) => {
  console.error('Bot error:', err);
});

// Avvio
bot.launch().then(() => {
  console.log('✅ Bot avviato con successo e in attesa di messaggi!');
}).catch((err) => {
  console.error('❌ Errore avvio:', err);
  process.exit(1);
});

// Spegnimento grazioso
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
