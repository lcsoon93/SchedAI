# SchedAI · La schedina del giorno

Pagina statica su **GitHub Pages** che ogni mattina analizza il palinsesto di calcio con **API-Football (piano Pro)** e pubblica una schedina tra **quota 10 e 100**, con probabilità stimata, valore atteso e uno storico verificato dei risultati.

> ⚠️ Progetto di analisi statistica. Nessun esito è garantito, il gioco è vietato ai minori di 18 anni e può causare dipendenza. Telefono Verde Nazionale gioco d'azzardo: 800 558 822.

## Come funziona

```
GitHub Action (ogni giorno 06:30 UTC)
  └─ scripts/generate.mjs  ← API_FOOTBALL_KEY dai GitHub Secrets
       1. verifica gli esiti dei giorni precedenti
       2. scarica partite + quote + previsioni del giorno
       3. stima le probabilità e costruisce le schedine
       4. scrive site/data/*.json e li committa (storico)
  └─ pubblica la cartella site/ su GitHub Pages
```

La chiave API non lascia mai la Action: la pagina legge solo JSON statici.

### Il modello

| Passo | Cosa fa |
|---|---|
| Quote pulite | Toglie il margine con il metodo di Shin (3 esiti) o proporzionale (2 esiti). Pinnacle pesa 3 volte gli altri book. |
| Modello gol | Gol attesi dalle medie casa/trasferta (shrinkage verso 1,45/1,15 con poche partite), Poisson con correzione Dixon-Coles. |
| Previsione API | Percentuali 1X2 di API-Football: salvate per la ricalibrazione, peso 0 di default. |
| Fusione | Media pesata in log-odds: mercato 75%, Poisson 25% (`schedina.config.json`). |
| Filtri | Miglior quota tra i book giocabili (Bet365, Bwin, William Hill, Unibet, Betfair), quota 1,30–4,00, prob. ≥ 40%, vantaggio ≥ 2% **e** vantaggio ≥ 0 con la sola probabilità di Pinnacle, scarto modello/mercato ≤ 12 punti, almeno 3 partite giocate. |
| Schedina | Knapsack a gruppi: max 1 esito per partita e 2 per campionato; per ogni fascia (10–20, 20–50, 50–100) la combinazione **più probabile** con valore atteso ≥ +5%. |
| Nessun valore | Se non esiste una schedina con valore positivo, si pubblica la meno sfavorevole con stato `valore_negativo` e la pagina dice di non giocarla. |
| Verifica | Si salvano schedine e **tutti** gli esiti analizzati; ogni giorno si refertano e si calcolano Brier, log-loss, calibrazione, skill vs mercato, ROI e z-score. Sotto 300 partite concluse il verdetto è «campione troppo piccolo». Lo storico è solo-aggiunta: rilanciare la Action non cambia la schedina già pubblicata (salvo `--force`). |

Mercati: 1X2, doppia chance, Under/Over 1,5/2,5/3,5, Goal/No Goal.

### File

- `scripts/generate.mjs` – pipeline giornaliera
- `scripts/lib/` – client API, modello, ottimizzatore, storico, dati simulati
- `scripts/test/` – test (`npm test`)
- `schedina.config.json` – campionati, pesi, soglie, fasce di quota
- `site/` – pagina statica; `site/data/` è scritto dalla Action
- `.github/workflows/schedina.yml` – esecuzione giornaliera e deploy

## Messa in funzione

1. **Secret**: Settings → Secrets and variables → Actions → *New repository secret* → `API_FOOTBALL_KEY` = la tua chiave di api-football (dashboard.api-football.com).
2. **Pages**: Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
   Su un repository privato GitHub Pages richiede un piano a pagamento (Pro/Team); in alternativa rendi pubblico il repository (prima ruota le chiavi presenti nella storia git del vecchio bot).
3. **Prima esecuzione**: Actions → *Schedina del giorno* → *Run workflow*.

Consumo tipico: 1 richiesta per il palinsesto, ~5–30 per le quote, 1 per partita analizzata (max 90) e qualche richiesta per i risultati: ben sotto il limite giornaliero del piano Pro.

### Provare in locale

```bash
npm test                       # test del modello
npm run schedina:mock          # dati simulati in preview/data
cp site/*.* preview/ && npx serve preview
API_FOOTBALL_KEY=... node scripts/generate.mjs --date 2026-10-27 --out preview/data
```

---

# (Legacy) Bot Telegram

Bot Telegram avanzato per analisi match calcistici con AI (Gemini), previsioni, e tracking betting performance.

## ✨ Caratteristiche

✅ **Analisi AI con Gemini** - Previsioni intelligenti per match calcistici
✅ **Multi-lega** - Analizza 50+ leghe di calcio
✅ **Multi-paese** - Italia, Inghilterra, Spagna, Germania, Francia, Olanda, Croazia, Grecia, Svezia, Turchia, Marocco
✅ **Mercati Vari** - 1X2, Over/Under, BTTS, Asian HC, Correct Score, etc.
✅ **Database Supabase** - Storico di previsioni e scommesse
✅ **Performance Tracking** - ROI, Win Rate, Statistiche personali
✅ **Funziona da Smartphone** - Setup e gestione completamente mobile
✅ **Caching Intelligente** - Riduce API calls
✅ **Rate Limiting** - Gestione automatica dei limiti API

## 🔧 Requisiti

- **Node.js** 16+ con npm
- **Account Telegram** (per testare il bot)
- **Account BotFather** (@BotFather su Telegram)
- **The-Odds-API** (theoddsapi.com - tier gratuito)
- **Gemini API** (aistudio.google.com)
- **Supabase** (supabase.com - progetto gratuito)

## 📋 Setup Veloce (30 minuti)

### Fase 1: Ottieni le 5 credenziali
1. **Telegram Token** → @BotFather → /newbot
2. **The-Odds-API Key** → theoddsapi.com → Dashboard
3. **Gemini API Key** → aistudio.google.com → API keys
4. **Supabase URL & Key** → supabase.com → New Project → Settings

### Fase 2: Setup Database
- Supabase → SQL Editor → Incolla database_setup.sql → RUN

### Fase 3: GitHub
- Crea repository privato "telegram-football-bot"
- Upload file: index.ts, package.json, tsconfig.json, README.md, .gitignore

### Fase 4: Railway Deploy
- railway.app → Deploy from GitHub → telegram-football-bot
- Aggiungi 5 variabili ambiente (le credenziali)
- Deploy → Aspetta "Success"

### Fase 5: Test
- Telegram → @football_predictor_bot
- /start → Benvenuto
- /analyze → Previsioni ✅

## 🎮 Comandi Disponibili

```
/start              - Inizializza bot
/analyze            - Analizza partite di oggi
/settings           - Mostra preferenze
/set_country PAESI  - Modifica paesi
/set_confidence N   - Soglia minima (0-100)
/history            - Ultimi 10 match
/stats              - Statistiche performance
/markets            - Guida mercati
/help               - Aiuto completo
```

## 📊 Mercati Scommesse

| Mercato | Difficoltà | ROI Medio | Consiglio |
|---------|-----------|----------|-----------|
| 1X2 | Alta | -3% a +2% | Conservative |
| Over/Under 2.5 | Alta | -2% a +5% | Balanced |
| BTTS | Media | -5% a +15% | Aggressive |
| Asian HC | Media | -10% a +20% | Expert |
| Correct Score | Bassa | +50% (raro) | Selettivo |

## 💰 Gestione Bankroll

```
Kelly Criterion: stake = (confidence - 50) / 100

Esempio:
- 75% confidence → 25% bankroll
- 65% confidence → 15% bankroll
- 55% confidence → 5% bankroll
- < 50% → NO SCOMMESSA

Massimo: 5% per scommessa
Stop Loss: -20% mensile
Target: +10% mensile
```

## ⚙️ Configurazione

Copia i valori nel file .env (mai su GitHub):

```
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
THE_ODDS_API_KEY=sk_live_xxx...
GEMINI_API_KEY=AIzaSy...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJhbGc...
```

## 🗄️ Database Supabase

**Tabelle create automaticamente:**

1. **predictions** - Previsioni per ogni match
2. **user_preferences** - Preferenze personali
3. **betting_history** - Storico scommesse
4. **performance_stats** - View con statistiche

## 🚀 Deployment

### Railway (Consigliato)
- Hosting sempre online
- Free tier: 500 ore/mese
- Auto-deploy da GitHub
- Easy monitoring

### Render (Alternativa)
- Interface semplice
- Free tier con sleep
- Buono per development

## 🐛 Troubleshooting

### Bot non risponde
```
1. Railway → Deployments → View Logs
2. Cerca "ERROR"
3. Token scaduto? → @BotFather → /token
```

### Supabase connection error
```
1. Verifica SUPABASE_URL e KEY (niente spazi)
2. Ricopia da Supabase
3. Aggiorna su Railway
```

### Gemini timeout
```
Riprova tra 1 minuto
```

## 📚 Documentazione

- [Telegraf Docs](https://telegraf.js.org/)
- [The-Odds-API Docs](https://the-odds-api.com/)
- [Gemini API Docs](https://ai.google.dev/)
- [Supabase Docs](https://supabase.com/docs)

## ⚠️ DISCLAIMER IMPORTANTE

```
⚠️ LEGGI PRIMA DI USARE

1. QUESTO BOT NON GARANTISCE PROFITTI
   - Usa AI generativa, non dati completi
   - Le previsioni sono SUGGERIMENTI
   - Le scommesse comportano RISCHIO TOTALE

2. USA RESPONSABILMENTE
   - Gioca SOLO ciò che puoi perdere
   - Imposta limiti mensili
   - Traccia SEMPRE il bankroll

3. CONSULTA ESPERTI
   - Non seguire ciecamente il bot
   - Verifica dati da più fonti

4. CONFORMITÀ LEGALE
   - Scommesse NON legali ovunque
   - Verifica leggi locali
```

## 📞 Support

- GitHub Issues per problemi tecnici
- Telegram per feedback
- TIPS.md per strategie avanzate

## 📄 Licenza

MIT License

## 🙏 Credits

- Telegraf.js
- The-Odds-API
- Google Generative AI
- Supabase

---

**Creato con ❤️ per gli appassionati di calcio**

Buona fortuna! 🍀

