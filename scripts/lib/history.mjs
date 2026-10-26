// Storico delle schedine: verifica degli esiti e metriche di calibrazione.
import { settlePick } from './model.mjs';

const FINISHED = new Set(['FT', 'AET', 'PEN']);
const VOID = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

// Esito di una partita: 'void' (rinviata/annullata), { h, a } se finita,
// null se ancora da giocare. Si refertano i 90 minuti regolamentari.
function outcome(fx) {
  if (!fx) return null;
  const status = fx.fixture.status.short;
  if (VOID.has(status)) return 'void';
  if (!FINISHED.has(status)) return null;
  const ft = fx.score?.fulltime;
  if (ft?.home != null && ft?.away != null) return { h: ft.home, a: ft.away };
  // Senza il 90' esplicito, i gol di una partita ai supplementari non valgono.
  if (status !== 'FT') return null;
  return { h: fx.goals.home, a: fx.goals.away };
}

function settleOne(key, fx) {
  const o = outcome(fx);
  if (!o) return null;
  if (o === 'void') return { result: 'void' };
  return { result: settlePick(key, o.h, o.a) ? 'won' : 'lost', score: `${o.h}-${o.a}` };
}

// Verifica gli esiti delle schedine e di tutti i candidati dei giorni
// passati. I candidati servono a misurare la calibrazione senza la
// distorsione di guardare solo le gambe scelte.
export async function settleAll(history, candidateDays, client) {
  const pending = new Set();
  for (const day of history.days) {
    for (const t of day.tickets) for (const leg of t.legs) if (!leg.result) pending.add(leg.fixtureId);
  }
  for (const day of candidateDays) for (const c of day.rows) if (!c.r) pending.add(c.f);
  if (!pending.size) return;

  const results = new Map();
  const ids = [...pending];
  for (let i = 0; i < ids.length; i += 20) {
    const body = await client.get('/fixtures', { ids: ids.slice(i, i + 20).join('-') });
    for (const fx of body.response || []) results.set(fx.fixture.id, fx);
  }

  for (const day of history.days) {
    for (const t of day.tickets) {
      for (const leg of t.legs) {
        if (leg.result) continue;
        const s = settleOne(leg.key, results.get(leg.fixtureId));
        if (s) Object.assign(leg, s);
      }
      settleTicket(t);
    }
  }
  for (const day of candidateDays) {
    for (const c of day.rows) {
      if (c.r) continue;
      const s = settleOne(c.k, results.get(c.f));
      if (s) c.r = s.result;
    }
  }
}

function settleTicket(t) {
  const results = t.legs.map((l) => l.result);
  if (results.includes('lost')) t.result = 'lost';
  else if (results.every((r) => r === 'void')) t.result = 'void'; // posta restituita
  else if (results.every((r) => r === 'won' || r === 'void')) {
    t.result = 'won';
    t.settledOdd = Math.round(t.legs.reduce((a, l) => a * (l.result === 'void' ? 1 : l.odd), 1) * 100) / 100;
  } else t.result = null;
}

// Metriche pubblicate nella sezione "Affidabilità" della pagina.
// Brier e log-loss: più bassi = previsioni migliori. Lo skill vs mercato è
// 1 - Brier(modello) / Brier(mercato): > 0 significa che battiamo le quote.
// La soglia conta le partite distinte: gli esiti della stessa partita sono
// correlati e non valgono come osservazioni indipendenti.
const MIN_MATCHES_FOR_VERDICT = 300;

function brier(pairs) {
  return pairs.reduce((a, [p, y]) => a + (p - y) ** 2, 0) / pairs.length;
}

function logLoss(pairs) {
  const eps = 1e-6;
  return -pairs.reduce((a, [p, y]) => a + Math.log(Math.max(eps, y ? p : 1 - p)), 0) / pairs.length;
}

function calibration(pairs, bins = 10) {
  const rows = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const sel = pairs.filter(([p]) => p >= lo && (p < hi || (b === bins - 1 && p <= 1)));
    if (!sel.length) continue;
    rows.push({
      bin: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      n: sel.length,
      predicted: sel.reduce((a, [p]) => a + p, 0) / sel.length,
      observed: sel.reduce((a, [, y]) => a + y, 0) / sel.length,
    });
  }
  return rows;
}

function verdict(n, skill) {
  if (n < MIN_MATCHES_FOR_VERDICT) {
    return `Campione troppo piccolo (${n} partite concluse): servono almeno ${MIN_MATCHES_FOR_VERDICT} partite prima di giudicare il modello.`;
  }
  if (skill > 0.01) return 'Il modello batte le quote pulite del mercato: il vantaggio è misurabile.';
  if (skill > -0.01) return 'Il modello è pari al mercato: nessun vantaggio dimostrato.';
  return 'Il modello è peggiore del mercato: meglio abbassare il peso del modello e fidarsi delle quote.';
}

const newBand = (name) => ({ name, played: 0, won: 0, expectedWins: 0, staked: 0, returned: 0 });

export function computeStats(history, candidateDays = []) {
  const bands = {};
  const featured = {};
  const legPairs = [];
  const marketPairs = [];
  let wins = 0, expected = 0, variance = 0, closed = 0;

  for (const day of history.days) {
    for (const t of day.tickets) {
      if (t.result === 'won' || t.result === 'lost') {
        // Le gambe annullate escono dalla probabilità attesa, come dalla quota.
        const prob = t.legs.reduce((a, l) => a * (l.result === 'void' ? 1 : l.p), 1);
        // La schedina del giorno ha la sua riga, in cima, oltre a quella della fascia.
        const rows = [(bands[t.band] ||= newBand(t.name))];
        if (t.featured) rows.push((featured.row ||= newBand('Schedina del giorno')));
        for (const s of rows) {
          s.played++;
          s.staked += 1;
          s.expectedWins += prob;
          if (t.result === 'won') {
            s.won++;
            s.returned += t.settledOdd;
          }
        }
        if (t.featured) {
          closed++;
          expected += prob;
          variance += prob * (1 - prob);
          if (t.result === 'won') wins++;
        }
      }
      for (const leg of t.legs) {
        if (leg.result !== 'won' && leg.result !== 'lost') continue;
        const y = leg.result === 'won' ? 1 : 0;
        legPairs.push([leg.p, y]);
        if (leg.pMarket != null) marketPairs.push([leg.pMarket, y]);
      }
    }
  }

  const allBands = featured.row ? { giorno: featured.row, ...bands } : bands;
  for (const s of Object.values(allBands)) s.roi = s.staked ? s.returned / s.staked - 1 : null;

  // ticketsClosed e z-score si riferiscono alla sola schedina del giorno.
  const out = { ticketsClosed: closed, legsClosed: legPairs.length, bands: allBands };

  // Calibrazione su tutti gli esiti analizzati (non solo quelli giocati).
  const allModel = [], allMarket = [], poissonModel = [], poissonMarket = [];
  const matches = new Set();
  for (const day of candidateDays) {
    for (const c of day.rows) {
      if (c.r !== 'won' && c.r !== 'lost') continue;
      matches.add(c.f);
      const y = c.r === 'won' ? 1 : 0;
      allModel.push([c.p, y]);
      allMarket.push([c.m, y]);
      if (c.g != null) {
        poissonModel.push([c.g, y]);
        poissonMarket.push([c.m, y]);
      }
    }
  }
  if (allModel.length) {
    const bm = brier(allModel), bk = brier(allMarket);
    out.allCandidates = {
      n: allModel.length,
      matches: matches.size,
      brierModel: bm,
      brierMarket: bk,
      skillVsMarket: 1 - bm / bk,
      logLossModel: logLoss(allModel),
      logLossMarket: logLoss(allMarket),
      calibration: calibration(allModel),
      // Il Poisson da solo, sugli stessi esiti, per capire quanto vale.
      brierPoisson: poissonModel.length ? brier(poissonModel) : null,
      brierMarketOnPoisson: poissonModel.length ? brier(poissonMarket) : null,
    };
  }
  if (closed) {
    out.tickets = { wins, expectedWins: expected, zScore: variance ? (wins - expected) / Math.sqrt(variance) : 0 };
  }
  if (legPairs.length) {
    const bm = brier(legPairs);
    const bk = marketPairs.length === legPairs.length ? brier(marketPairs) : null;
    const skill = bk ? 1 - bm / bk : null;
    out.legs = {
      hitRate: legPairs.reduce((a, [, y]) => a + y, 0) / legPairs.length,
      expectedHitRate: legPairs.reduce((a, [p]) => a + p, 0) / legPairs.length,
      brierModel: bm,
      brierMarket: bk,
      skillVsMarket: skill,
      logLossModel: logLoss(legPairs),
      logLossMarket: bk ? logLoss(marketPairs) : null,
      calibration: calibration(legPairs),
    };
  }
  if (out.allCandidates) out.verdict = verdict(out.allCandidates.matches, out.allCandidates.skillVsMarket);
  else out.verdict = 'Nessuna selezione ancora chiusa: lo storico si riempie giorno dopo giorno.';
  return out;
}
