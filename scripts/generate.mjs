#!/usr/bin/env node
// Corsa automatica giornaliera: lo storico ufficiale di SchedAI.
//
// Le richieste fatte dalla pagina restano nel browser di chi le fa; solo
// questa corsa, a orario fisso e con parametri fissi, alimenta la sezione
// "Come sta andando", così rilanciare finché piace il risultato non falsa
// le statistiche.
//
//   API_FOOTBALL_KEY=... node scripts/generate.mjs [--date AAAA-MM-GG]
//   node scripts/generate.mjs --mock        (dati simulati, nessuna chiamata)
//   --out DIR   cartella di output (default site/data)
//   --force     sostituisce nello storico la schedina già salvata per la data
//
// Scrive in site/data: latest.json (schedina di riferimento e statistiche),
// history.json (schedine ed esiti), archive/AAAA-MM-GG.json e
// candidates/AAAA-MM-GG.json (tutti gli esiti analizzati, per la calibrazione).
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../site/lib/api.js';
import { createMockClient } from '../site/lib/mock.js';
import { runAnalysis, compactTicket } from '../site/lib/pipeline.js';
import { settleAll, computeStats } from '../site/lib/history.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const mock = args.includes('--mock');
const force = args.includes('--force');
const dateArg = argValue('--date');
const DATA_DIR = resolve(argValue('--out') || join(ROOT, 'site', 'data'));

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data, compact = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, compact ? 0 : 2) + '\n');
}

function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function main() {
  const cfg = JSON.parse(await readFile(join(ROOT, 'site', 'config.json'), 'utf8'));
  const date = dateArg || todayIn(cfg.timezone);

  let client;
  if (mock) {
    client = createMockClient(date);
  } else {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) {
      console.error('Manca API_FOOTBALL_KEY (impostala nei GitHub Secrets).');
      process.exit(1);
    }
    client = createApiClient(key);
  }

  const historyPath = join(DATA_DIR, 'history.json');
  const history = await readJson(historyPath, { days: [] });
  // I giorni simulati non devono mai contaminare lo storico reale.
  if (!mock) history.days = history.days.filter((d) => !d.mock);

  const candDir = join(DATA_DIR, 'candidates');
  let candFiles = [];
  try {
    candFiles = (await readdir(candDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch {}
  const keepFrom = candFiles.length > cfg.candidateDays ? candFiles.length - cfg.candidateDays : 0;
  const candidateDays = [];
  for (const f of candFiles.slice(keepFrom)) {
    const d = await readJson(join(candDir, f), null);
    if (d && d.date !== date && (mock || !d.mock)) candidateDays.push(d);
  }

  console.log(`Verifica esiti dello storico...`);
  await settleAll(history, candidateDays, client);
  for (const d of candidateDays) await writeJson(join(candDir, `${d.date}.json`), d, true);

  // Storico solo-aggiunta: la prima schedina pubblicata per una data resta
  // quella valutata. Un nuovo lancio aggiorna solo esiti e statistiche.
  const archivePath = join(DATA_DIR, 'archive', `${date}.json`);
  const published = history.days.some((d) => d.date === date) && !mock && !force && (await readJson(archivePath, null));
  if (published) {
    console.log(`La schedina del ${date} è già pubblicata: aggiorno solo esiti e statistiche.`);
    published.stats = computeStats(history, candidateDays);
    published.recent = history.days.slice(-14).reverse();
    await writeJson(join(DATA_DIR, 'latest.json'), published);
    await writeJson(historyPath, history);
    return;
  }

  console.log(`Analisi del ${date} (${cfg.timezone})...`);
  const { analyses, ...latest } = await runAnalysis(client, cfg, { date, bands: cfg.ticket.bands, ignoreKickoff: mock });
  console.log(`Stato: ${latest.status}, ${latest.tickets.length} schedine, ${latest.summary.fixturesAnalyzed} partite analizzate.`);

  history.days = history.days.filter((d) => d.date !== date);
  history.days.push({ date, status: latest.status, mock, tickets: latest.tickets.map(compactTicket) });
  history.days.sort((a, b) => a.date.localeCompare(b.date));

  latest.mock = mock;
  latest.stats = computeStats(history, candidateDays);
  latest.recent = history.days.slice(-14).reverse();

  await writeJson(join(DATA_DIR, 'latest.json'), latest);
  await writeJson(archivePath, latest);
  await writeJson(historyPath, history);
  // Formato compatto: f=fixture, k=esito, p=stima finale, m=mercato, g=Poisson,
  // a=API-Football, o=quota, r=risultato. g e a servono a ricalibrare i pesi.
  const rows = analyses.flatMap((a) =>
    a.options.map((o) => ({
      f: a.fixtureId,
      k: o.key,
      p: +o.p.toFixed(4),
      m: +o.pMarket.toFixed(4),
      g: o.pPoisson == null ? null : +o.pPoisson.toFixed(4),
      a: o.pApi == null ? null : +o.pApi.toFixed(4),
      o: o.odd,
      r: null,
    }))
  );
  await writeJson(join(candDir, `${date}.json`), { date, mock, rows }, true);
  console.log(`Fatto. Chiamate API usate: ${client.calls}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
