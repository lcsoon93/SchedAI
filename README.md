# SchedAI

Pagina web su **GitHub Pages** che analizza il palinsesto di calcio **quando vuoi**, con **API-Football**, e propone una schedina tra **quota 10 e 100** con probabilità stimata, valore atteso e quota equa per ogni esito.

> ⚠️ Progetto di analisi statistica. Nessun esito è garantito, il gioco è vietato ai minori di 18 anni e può causare dipendenza. Telefono Verde Nazionale gioco d'azzardo: 800 558 822.

## Come si usa

1. Apri la pagina e incolla una volta la tua chiave api-football: resta **solo nel tuo browser** (localStorage) e viene inviata solo a api-football.
2. Scegli data (oggi + 7 giorni), campionati, fascia di quota (dentro 10–100) e numero massimo di esiti.
3. Premi **Analizza**: la pagina scarica partite, quote e statistiche, calcola le probabilità e mostra la schedina consigliata, le alternative più rischiose e gli esiti con più valore.

Ogni richiesta costa circa 20–100 chiamate API (piano Pro: 7.500 al giorno). Palinsesto e quote restano in cache per 10 minuti e le statistiche delle squadre per 6 ore, quindi cambiare fascia o campionati subito dopo costa poco.

Senza chiave: `?demo` in fondo all'indirizzo usa dati simulati.

## Il modello

| Passo | Cosa fa |
|---|---|
| Quote pulite | Toglie il margine con il metodo di Shin (3 esiti) o proporzionale (2 esiti). Pinnacle pesa 3 volte gli altri book. |
| Modello gol | Gol attesi dalle medie casa/trasferta (shrinkage verso 1,45/1,15 con poche partite), Poisson con correzione Dixon-Coles. |
| Fusione | Media in log-odds: mercato 75%, Poisson 25%. La previsione di API-Football è salvata ma pesa 0. |
| Filtri | Quote Bet365, quota 1,30–4,00, prob. ≥ 40%, vantaggio ≥ 2% **e** ≥ 0 con la sola probabilità di Pinnacle, scarto modello/mercato ≤ 12 punti, almeno 3 partite giocate, calcio d'inizio fra più di 60 minuti. |
| Schedina | Knapsack a gruppi: max 1 esito per partita e 2 per campionato, tutto sullo stesso bookmaker. La fascia scelta è divisa in tre; in ognuna si cerca la combinazione **più probabile** con valore atteso ≥ +5%. La consigliata è la più probabile delle tre. |
| Nessun valore | Se non esiste una schedina con valore positivo si mostra la meno sfavorevole come «solo esempio», con il consiglio di non giocare. |

Mercati: 1X2, doppia chance, Under/Over 1,5/2,5/3,5, Goal/No Goal. Parametri in `site/config.json`.

## Storico

- **Le mie richieste**: ogni analisi fatta dalla pagina viene salvata nel browser (tutte, non solo quelle giocate) e si può verificarne l'esito con «Aggiorna esiti».
- **Storico ufficiale**: una GitHub Action gira ogni mattina con parametri fissi, salva la schedina di riferimento e *tutti* gli esiti analizzati e referta i risultati. Da lì vengono Brier score, log-loss, calibrazione, skill rispetto al mercato e ROI. Le richieste manuali non entrano qui, così rilanciare finché piace il risultato non falsa le statistiche. La schedina di riferimento si scrive solo dalla corsa programmata (mai da un push o da un lancio manuale), una data già registrata non viene mai riscritta e non si accettano date passate. Sotto le 300 partite concluse il verdetto è «campione troppo piccolo».

## Struttura

- `site/` – la pagina (HTML, CSS, `app.js`) e `config.json`
- `site/lib/` – moduli condivisi tra pagina e Action: client API, modello, ottimizzatore, pipeline, storico, dati simulati, rendering
- `site/data/` – storico ufficiale, scritto dalla Action
- `scripts/generate.mjs` – corsa di riferimento giornaliera
- `scripts/test/` – test (`npm test`)
- `.github/workflows/schedina.yml` – pubblica la pagina a ogni push su `main` e fa la corsa giornaliera

## Messa in funzione

1. **Pages**: Settings → Pages → *Build and deployment* → Source: **GitHub Actions** (su un repository privato serve un piano GitHub a pagamento).
2. **Storico ufficiale** (facoltativo): Settings → Secrets and variables → Actions → `API_FOOTBALL_KEY`. Senza secret la pagina funziona lo stesso, manca solo lo storico ufficiale.
3. Al primo push su `main` la pagina viene pubblicata.

### In locale

```bash
npm test            # test del modello
npm run serve       # apre la pagina su http://localhost:3000 (prova con ?demo)
npm run daily:mock  # corsa giornaliera con dati simulati in preview/data
```
