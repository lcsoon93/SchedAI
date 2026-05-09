# 🤖 BOT TELEGRAM - AI Football Predictions

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

