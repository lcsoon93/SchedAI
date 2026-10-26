// Analisi completa di una giornata, condivisa tra la pagina (su richiesta)
// e la corsa automatica giornaliera (scripts/generate.mjs).
import { analyzeFixture, eligibleOptions, priceAt } from './model.js';
import { buildTicket } from './optimizer.js';

// Divide [minOdd, maxOdd] in fasce uguali in scala logaritmica.
export function splitBands(minOdd, maxOdd, n = 3) {
  const lo = Math.log(minOdd), hi = Math.log(maxOdd);
  const names = n === 3 ? ['Prudente', 'Equilibrata', 'Ambiziosa'] : null;
  return Array.from({ length: n }, (_, i) => ({
    id: `fascia${i + 1}`,
    name: names ? names[i] : `Fascia ${i + 1}`,
    minOdd: Math.round(Math.exp(lo + ((hi - lo) * i) / n) * 100) / 100,
    maxOdd: Math.round(Math.exp(lo + ((hi - lo) * (i + 1)) / n) * 100) / 100,
  }));
}

function context(a) {
  return {
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
    oddsUpdatedAt: a.oddsUpdatedAt,
  };
}

// Una multipla si gioca su un solo bookmaker: per ogni book giocabile si
// costruiscono le schedine con le sue quote, poi per ogni fascia si tiene
// la più probabile tra i book.
export function makeTickets(analyses, cfg, { bands, maxLegs, minEdge, minMarketEdge, minTicketEV }) {
  const best = {};
  for (const bookId of cfg.playableBookmakerIds) {
    const groups = analyses
      .map((a) => {
        const priced = a.options.map((o) => priceAt(o, bookId)).filter(Boolean);
        return eligibleOptions(priced, cfg.selection, minEdge, minMarketEdge).map((o) => ({ ...o, ...context(a) }));
      })
      .filter((g) => g.length);
    if (groups.length < cfg.ticket.minLegs) continue;

    for (const band of bands) {
      const t = buildTicket(groups, {
        minLegs: cfg.ticket.minLegs,
        maxLegs,
        minOdd: band.minOdd,
        maxOdd: band.maxOdd,
        maxPerTag: cfg.ticket.maxPerLeague,
        tagOf: (o) => o.leagueId,
        accept: (ticket) => minTicketEV === null || ticket.ev >= minTicketEV,
      });
      if (t && (!best[band.id] || t.prob > best[band.id].t.prob)) best[band.id] = { t, band };
    }
  }

  const tickets = Object.values(best).map(({ t, band }) => {
    const probMarket = t.legs.reduce((a, l) => a * l.pMarket, 1);
    return {
      band: band.id,
      name: band.name,
      minOdd: band.minOdd,
      maxOdd: band.maxOdd,
      bookmaker: t.legs[0].bookmaker,
      totalOdd: t.totalOdd,
      prob: t.prob,
      probMarket,
      evMarket: probMarket * t.totalOdd - 1,
      ev: t.ev,
      oneIn: Math.round(1 / t.prob),
      legs: t.legs.map((l) => ({ ...l, fairOdd: Math.round(100 / l.p) / 100 })),
    };
  });

  // Elenco degli esiti con valore, alla quota migliore tra i book.
  const candidates = analyses.flatMap((a) =>
    eligibleOptions(a.options, cfg.selection, minEdge, minMarketEdge).map((o) => ({ ...o, ...context(a) }))
  );
  return { tickets, candidates };
}

// Quote pre-match per campionato (una richiesta per campionato e stagione
// invece di scaricare le quote di tutte le partite del mondo).
async function fetchOdds(client, date, cfg, fixtures) {
  const groups = new Map();
  for (const fx of fixtures) groups.set(`${fx.league.id}|${fx.league.season}`, fx.league);
  const out = new Map();
  for (const league of groups.values()) {
    const rows = await client.getAllPages('/odds', { league: league.id, season: league.season, date, timezone: cfg.timezone });
    for (const r of rows) out.set(r.fixture.id, r);
  }
  return out;
}

// Esegue l'analisi di una data.
//   leagues:       id dei campionati da considerare (vuoto = cfg.leagues)
//   minOdd/maxOdd: fascia di quota della schedina (dentro 10–100)
//   bands:         fasce già pronte (altrimenti 3 fasce dentro min/max)
//   getPrediction: lettura con cache opzionale di /predictions
//   onProgress:    callback (fase, fatto, totale) per la pagina
export async function runAnalysis(client, cfg, opts) {
  const { date, now = Date.now(), ignoreKickoff = false, onProgress = () => {} } = opts;
  const leagues = new Set(opts.leagues?.length ? opts.leagues : cfg.leagues);
  const minOdd = Math.max(opts.minOdd ?? cfg.ticket.minOdd, cfg.ticket.minOdd);
  const maxOdd = Math.min(opts.maxOdd ?? cfg.ticket.maxOdd, cfg.ticket.maxOdd);
  const maxLegs = Math.min(opts.maxLegs ?? cfg.ticket.maxLegs, cfg.ticket.maxLegs);
  const bands = opts.bands || splitBands(minOdd, maxOdd);
  const getPrediction =
    opts.getPrediction || (async (id) => (await client.get('/predictions', { fixture: id })).response?.[0] || null);

  onProgress('Palinsesto', 0, 1);
  const allFixtures = (await client.get('/fixtures', { date, timezone: cfg.timezone })).response || [];
  // Partite già iniziate o troppo vicine al calcio d'inizio restano fuori.
  const earliest = now + cfg.minutesBeforeKickoff * 60000;
  const fixtures = allFixtures.filter(
    (fx) =>
      fx.fixture.status.short === 'NS' &&
      leagues.has(fx.league.id) &&
      (ignoreKickoff || new Date(fx.fixture.date).getTime() >= earliest)
  );

  onProgress('Quote', 0, 1);
  const oddsByFixture = fixtures.length ? await fetchOdds(client, date, cfg, fixtures) : new Map();
  const withOdds = fixtures
    .filter((fx) => oddsByFixture.has(fx.fixture.id))
    .sort((a, b) => a.fixture.date.localeCompare(b.fixture.date))
    .slice(0, cfg.maxFixturesToAnalyze);

  const analyses = [];
  for (let i = 0; i < withOdds.length; i++) {
    const fx = withOdds[i];
    onProgress('Statistiche squadre', i, withOdds.length);
    let prediction = null;
    try {
      prediction = await getPrediction(fx.fixture.id);
    } catch {
      // senza statistiche resta solo il mercato
    }
    const a = analyzeFixture(fx, oddsByFixture.get(fx.fixture.id), prediction, cfg);
    if (a) analyses.push(a);
  }
  onProgress('Schedina', 0, 1);

  const sel = cfg.selection;
  let status = 'valore_positivo';
  let { tickets, candidates } = makeTickets(analyses, cfg, {
    bands, maxLegs, minEdge: sel.minEdge, minMarketEdge: sel.minMarketEdge, minTicketEV: cfg.ticket.minTicketEV,
  });
  if (!tickets.length) {
    status = 'valore_negativo';
    ({ tickets, candidates } = makeTickets(analyses, cfg, {
      bands, maxLegs, minEdge: sel.fallbackMinEdge, minMarketEdge: null, minTicketEV: null,
    }));
  }
  if (!tickets.length) status = 'nessuna_schedina';
  // La schedina principale è la più probabile; le altre fasce sono alternative.
  tickets.sort((a, b) => b.prob - a.prob);
  tickets.forEach((t, i) => (t.featured = i === 0));

  return {
    generatedAt: new Date(now).toISOString(),
    date,
    timezone: cfg.timezone,
    status,
    request: { leagues: [...leagues], minOdd, maxOdd, maxLegs },
    summary: {
      fixturesScheduled: allFixtures.length,
      fixturesFollowed: fixtures.length,
      fixturesAnalyzed: analyses.length,
      candidates: candidates.length,
      apiCalls: client.calls,
    },
    tickets,
    shortlist: [...candidates].sort((a, b) => b.edge - a.edge).slice(0, 25),
    analyses,
  };
}

// Forma compatta di una schedina per lo storico.
export function compactTicket(t) {
  return {
    band: t.band,
    name: t.name,
    featured: t.featured,
    bookmaker: t.bookmaker,
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
      bookmaker: l.bookmaker,
      oddsUpdatedAt: l.oddsUpdatedAt,
      p: l.p,
      pMarket: l.pMarket,
      result: null,
    })),
  };
}
