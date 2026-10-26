#!/usr/bin/env node
// Genera la schedina del giorno e aggiorna lo storico.
//
//   API_FOOTBALL_KEY=... node scripts/generate.mjs [--date AAAA-MM-GG]
//   node scripts/generate.mjs --mock        (dati simulati, nessuna chiamata)
//   --out DIR   cartella di output (default site/data)
//   --force     sostituisce nello storico la schedina già salvata per la data
//
// Scrive in site/data: latest.json (letto dalla pagina), history.json
// (schedine ed esiti), archive/AAAA-MM-GG.json (copia del giorno) e
// candidates/AAAA-MM-GG.json (tutti gli esiti analizzati, per la calibrazione).
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiClient } from './lib/api.mjs';
import { createMockClient } from './lib/mock.mjs';
import { analyzeFixture, eligibleOptions } from './lib/model.mjs';
import { buildTicket } from './lib/optimizer.mjs';
import { settleAll, computeStats } from './lib/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const mock = args.includes('--mock');
const dateArg = argValue('--date');
const force = args.includes('--force');
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

function makeTickets(analyses, cfg, minEdge, minMarketEdge, minTicketEV) {
  const groups = analyses
    .map((a) =>
      eligibleOptions(a, cfg.selection, minEdge, minMarketEdge).map((o) => ({
        ...o,
        fixtureId: a.fixtureId,
        kickoff: a.kickoff,
        league: a.league,
        leagueId: a.leagueId,
        country: a.country,
        match: `${a.home} – ${a.away}`,
        formHome: a.formHome,
        formAway: a.formAway,
        xg: a.xg,
        apiAdvice: a.apiAdvice,
      }))
    )
    .filter((g) => g.length);

  const tickets = [];
  for (const band of cfg.ticket.bands) {
    const t = buildTicket(groups, {
      minLegs: cfg.ticket.minLegs,
      maxLegs: cfg.ticket.maxLegs,
      minOdd: band.minOdd,
      maxOdd: band.maxOdd,
      maxPerTag: cfg.ticket.maxPerLeague,
      tagOf: (o) => o.leagueId,
      accept: (ticket) => minTicketEV === null || ticket.ev >= minTicketEV,
    });
    if (!t) continue;
    tickets.push({
      band: band.id,
      name: band.name,
      minOdd: band.minOdd,
      maxOdd: band.maxOdd,
      totalOdd: t.totalOdd,
      prob: t.prob,
      probMarket: t.legs.reduce((a, l) => a * l.pMarket, 1),
      evMarket: t.legs.reduce((a, l) => a * l.pMarket, 1) * t.totalOdd - 1,
      ev: t.ev,
      oneIn: Math.round(1 / t.prob),
      legs: t.legs.map((l) => ({ ...l, fairOdd: Math.round((100 / l.p)) / 100 })),
    });
  }
  return { tickets, candidates: groups.flat() };
}

async function main() {
  const cfg = JSON.parse(await readFile(join(ROOT, 'schedina.config.json'), 'utf8'));
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
  const keepFrom = candFiles.length > cfg.historyDays ? candFiles.length - cfg.historyDays : 0;
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

  console.log(`Palinsesto del ${date} (${cfg.timezone})...`);
  const fixturesBody = await client.get('/fixtures', { date, timezone: cfg.timezone });
  const allFixtures = fixturesBody.response || [];
  const leagues = new Set(cfg.leagues);
  const earliest = Date.now() + cfg.minutesBeforeKickoff * 60000;
  const fixtures = allFixtures.filter(
    (fx) =>
      fx.fixture.status.short === 'NS' &&
      (!leagues.size || leagues.has(fx.league.id)) &&
      (mock || new Date(fx.fixture.date).getTime() >= earliest)
  );
  console.log(`${allFixtures.length} partite in programma, ${fixtures.length} nei campionati seguiti e non ancora iniziate.`);

  const oddsList = fixtures.length ? await client.getAllPages('/odds', { date, timezone: cfg.timezone }) : [];
  const oddsByFixture = new Map(oddsList.map((o) => [o.fixture.id, o]));
  const withOdds = fixtures
    .filter((fx) => oddsByFixture.has(fx.fixture.id))
    .sort((a, b) => a.fixture.date.localeCompare(b.fixture.date))
    .slice(0, cfg.maxFixturesToAnalyze);
  console.log(`${withOdds.length} partite con quote pre-match.`);

  const analyses = [];
  for (const fx of withOdds) {
    let prediction = null;
    try {
      const body = await client.get('/predictions', { fixture: fx.fixture.id });
      prediction = body.response?.[0] || null;
    } catch (err) {
      console.warn(`Previsione non disponibile per ${fx.fixture.id}: ${err.message}`);
    }
    const a = analyzeFixture(fx, oddsByFixture.get(fx.fixture.id), prediction, cfg);
    if (a) analyses.push(a);
  }

  let status = 'valore_positivo';
  let { tickets, candidates } = makeTickets(analyses, cfg, cfg.selection.minEdge, cfg.selection.minMarketEdge, cfg.ticket.minTicketEV);
  if (!tickets.length) {
    status = 'valore_negativo';
    ({ tickets, candidates } = makeTickets(analyses, cfg, cfg.selection.fallbackMinEdge, null, null));
  }
  if (!tickets.length) status = 'nessuna_schedina';
  // La schedina del giorno è la più probabile; le altre fasce sono alternative.
  tickets.sort((a, b) => b.prob - a.prob);
  tickets.forEach((t, i) => (t.featured = i === 0));
  console.log(`Stato: ${status}, ${tickets.length} schedine, ${candidates.length} esiti candidati.`);

  history.days = history.days.filter((d) => d.date !== date);
  history.days.push({
    date,
    status,
    mock,
    tickets: tickets.map((t) => ({
      band: t.band,
      name: t.name,
      featured: t.featured,
      totalOdd: t.totalOdd,
      prob: t.prob,
      probMarket: t.probMarket,
      ev: t.ev,
      result: null,
      legs: t.legs.map((l) => ({
        fixtureId: l.fixtureId,
        key: l.key,
        label: l.label,
        match: l.match,
        league: l.league,
        kickoff: l.kickoff,
        odd: l.odd,
        p: l.p,
        pMarket: l.pMarket,
        result: null,
      })),
    })),
  });
  history.days.sort((a, b) => a.date.localeCompare(b.date));
  history.days = history.days.slice(-cfg.historyDays);

  const latest = {
    generatedAt: new Date().toISOString(),
    date,
    timezone: cfg.timezone,
    mock,
    status,
    summary: {
      fixturesScheduled: allFixtures.length,
      fixturesFollowed: fixtures.length,
      fixturesAnalyzed: analyses.length,
      candidates: candidates.length,
      apiCalls: client.calls,
    },
    tickets,
    shortlist: [...candidates].sort((a, b) => b.edge - a.edge).slice(0, 25),
    stats: computeStats(history, candidateDays),
    recent: history.days.slice(-14).reverse(),
  };

  await writeJson(join(DATA_DIR, 'latest.json'), latest);
  await writeJson(archivePath, latest);
  await writeJson(historyPath, history);
  // Formato compatto: f=fixture, k=esito, p=stima finale, m=mercato, g=Poisson,
  // a=API-Football, o=quota, r=risultato. g e a servono a ricalibrare i pesi.
  await writeJson(join(candDir, `${date}.json`), {
    date,
    mock,
    rows: analyses.flatMap((a) =>
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
    ),
  }, true);
  console.log(`Fatto. Chiamate API usate: ${client.calls}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
