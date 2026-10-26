// Modello di analisi di una singola partita.
//
// Per ogni esito combiniamo tre stime indipendenti di probabilità:
//   1. Mercato: quote di più bookmaker, ripulite dal margine (metodo di
//      Shin sui mercati a 3 esiti, proporzionale su quelli a 2), con peso
//      maggiore al bookmaker "sharp" (Pinnacle).
//   2. Poisson / Dixon-Coles: gol attesi stimati dalle medie stagionali
//      casa/trasferta delle due squadre, con shrinkage verso la media.
//   3. Previsione di API-Football (solo per gli esiti 1X2 / doppia chance;
//      peso 0 di default, salvata per ricalibrare i pesi sullo storico).
// La stima finale è una media pesata in log-odds; l'edge è p * quota - 1.
// Un esito è giocabile solo se ha edge positivo anche con la sola
// probabilità di mercato, cioè se la migliore quota giocabile batte Pinnacle.

const LINES = [1.5, 2.5, 3.5];
const MAX_GOALS = 10;
const DC_RHO = -0.08;
const PRIOR_HOME_GOALS = 1.45;
const PRIOR_AWAY_GOALS = 1.15;
const SHRINK_MATCHES = 3;

export const MARKET_LABELS = {
  '1X2': 'Esito finale',
  DC: 'Doppia chance',
  OU: 'Under/Over',
  GG: 'Goal/No Goal',
};

function pickFromBet(bet, rawValue) {
  const id = Number(bet.id);
  const name = String(bet.name || '').toLowerCase();
  const value = String(rawValue).trim();
  if (id === 1 || name === 'match winner') {
    return { Home: ['1X2', '1'], Draw: ['1X2', 'X'], Away: ['1X2', '2'] }[value] || null;
  }
  if (id === 12 || name === 'double chance') {
    return { 'Home/Draw': ['DC', '1X'], 'Home/Away': ['DC', '12'], 'Draw/Away': ['DC', 'X2'] }[value] || null;
  }
  if (id === 5 || name === 'goals over/under') {
    const m = value.match(/^(Over|Under)\s+([\d.]+)$/);
    if (!m || !LINES.includes(Number(m[2]))) return null;
    return ['OU', `${m[1]} ${m[2]}`];
  }
  if (id === 8 || name === 'both teams score') {
    return { Yes: ['GG', 'GG'], No: ['GG', 'NG'] }[value] || null;
  }
  return null;
}

// { bookmakerId: { name, picks: { '1X2|1': 2.1, ... } } }
export function parseBookmakers(oddsEntry) {
  const books = {};
  for (const bm of oddsEntry?.bookmakers || []) {
    const picks = {};
    for (const bet of bm.bets || []) {
      for (const v of bet.values || []) {
        const p = pickFromBet(bet, v.value);
        const odd = Number(v.odd);
        if (p && odd > 1) picks[`${p[0]}|${p[1]}`] = odd;
      }
    }
    if (Object.keys(picks).length) books[bm.id] = { name: bm.name, picks };
  }
  return books;
}

// Metodo di Shin: corregge il favourite-longshot bias togliendo più margine
// alle quote alte. Per due esiti coincide di fatto con la normalizzazione.
export function shinProbs(odds) {
  const implied = odds.map((o) => 1 / o);
  const total = implied.reduce((a, b) => a + b, 0);
  if (odds.length === 2 || total <= 1) return implied.map((p) => p / total);
  let lo = 0, hi = 0.4, probs = implied;
  for (let i = 0; i < 100; i++) {
    const z = (lo + hi) / 2;
    probs = implied.map((p) => (Math.sqrt(z * z + (4 * (1 - z) * p * p) / total) - z) / (2 * (1 - z)));
    if (probs.reduce((a, b) => a + b, 0) > 1) lo = z;
    else hi = z;
  }
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

// Probabilità "fair" dal mercato per un gruppo di esiti mutuamente esclusivi.
function fairGroup(books, keys, cfg) {
  let wsum = 0;
  const acc = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const [id, book] of Object.entries(books)) {
    const odds = keys.map((k) => book.picks[k]);
    if (odds.some((o) => !o)) continue;
    const fair = shinProbs(odds);
    const w = Number(id) === cfg.sharpBookmakerId ? cfg.sharpWeight : 1;
    keys.forEach((k, i) => (acc[k] += w * fair[i]));
    wsum += w;
  }
  if (!wsum) return null;
  return Object.fromEntries(keys.map((k) => [k, acc[k] / wsum]));
}

export function marketProbabilities(books, cfg) {
  const out = {};
  const r = fairGroup(books, ['1X2|1', '1X2|X', '1X2|2'], cfg);
  if (r) {
    Object.assign(out, r);
    out['DC|1X'] = r['1X2|1'] + r['1X2|X'];
    out['DC|12'] = r['1X2|1'] + r['1X2|2'];
    out['DC|X2'] = r['1X2|X'] + r['1X2|2'];
  }
  for (const l of LINES) {
    const g = fairGroup(books, [`OU|Over ${l}`, `OU|Under ${l}`], cfg);
    if (g) Object.assign(out, g);
  }
  const gg = fairGroup(books, ['GG|GG', 'GG|NG'], cfg);
  if (gg) Object.assign(out, gg);
  return out;
}

// Quota giocabile: la migliore tra i bookmaker dove si può davvero giocare
// (line shopping). Pinnacle serve solo da riferimento per le probabilità.
export function offeredOdd(books, key, cfg) {
  let best = null;
  for (const id of cfg.playableBookmakerIds) {
    const odd = books[id]?.picks[key];
    if (odd && (!best || odd > best.odd)) best = { odd, bookmaker: books[id].name };
  }
  return best;
}

function num(x) {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

export function expectedGoals(prediction, cfg) {
  const h = prediction?.teams?.home?.league;
  const a = prediction?.teams?.away?.league;
  if (!h || !a) return null;
  const hPlayed = h.fixtures?.played?.home ?? 0;
  const aPlayed = a.fixtures?.played?.away ?? 0;
  if ((h.fixtures?.played?.total ?? 0) < cfg.selection.minTeamMatchesPlayed) return null;
  if ((a.fixtures?.played?.total ?? 0) < cfg.selection.minTeamMatchesPlayed) return null;

  const hFor = num(h.goals?.for?.average?.home);
  const hAg = num(h.goals?.against?.average?.home);
  const aFor = num(a.goals?.for?.average?.away);
  const aAg = num(a.goals?.against?.average?.away);
  if ([hFor, hAg, aFor, aAg].some((v) => v === null)) return null;

  const n = Math.min(hPlayed, aPlayed);
  const w = n / (n + SHRINK_MATCHES);
  return {
    home: w * ((hFor + aAg) / 2) + (1 - w) * PRIOR_HOME_GOALS,
    away: w * ((aFor + hAg) / 2) + (1 - w) * PRIOR_AWAY_GOALS,
  };
}

function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

// Matrice dei risultati con correzione Dixon-Coles sui punteggi bassi.
export function poissonProbabilities(xg) {
  if (!xg) return null;
  const ph = Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonPmf(xg.home, k));
  const pa = Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonPmf(xg.away, k));
  const tau = (i, j) => {
    if (i === 0 && j === 0) return 1 - xg.home * xg.away * DC_RHO;
    if (i === 0 && j === 1) return 1 + xg.home * DC_RHO;
    if (i === 1 && j === 0) return 1 + xg.away * DC_RHO;
    if (i === 1 && j === 1) return 1 - DC_RHO;
    return 1;
  };

  const out = { '1X2|1': 0, '1X2|X': 0, '1X2|2': 0, 'GG|GG': 0 };
  for (const l of LINES) out[`OU|Over ${l}`] = 0;
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j] * tau(i, j);
      total += p;
      out[i > j ? '1X2|1' : i === j ? '1X2|X' : '1X2|2'] += p;
      if (i > 0 && j > 0) out['GG|GG'] += p;
      for (const l of LINES) if (i + j > l) out[`OU|Over ${l}`] += p;
    }
  }
  for (const k of Object.keys(out)) out[k] /= total;
  out['GG|NG'] = 1 - out['GG|GG'];
  for (const l of LINES) out[`OU|Under ${l}`] = 1 - out[`OU|Over ${l}`];
  out['DC|1X'] = out['1X2|1'] + out['1X2|X'];
  out['DC|12'] = out['1X2|1'] + out['1X2|2'];
  out['DC|X2'] = out['1X2|X'] + out['1X2|2'];
  return out;
}

export function apiProbabilities(prediction) {
  const pct = prediction?.predictions?.percent;
  if (!pct) return null;
  const h = num(pct.home), d = num(pct.draw), a = num(pct.away);
  if (h === null || d === null || a === null || h + d + a <= 0) return null;
  const s = h + d + a;
  const r = { '1X2|1': h / s, '1X2|X': d / s, '1X2|2': a / s };
  r['DC|1X'] = r['1X2|1'] + r['1X2|X'];
  r['DC|12'] = r['1X2|1'] + r['1X2|2'];
  r['DC|X2'] = r['1X2|X'] + r['1X2|2'];
  return r;
}

// Media pesata in log-odds: più corretta di una media semplice vicino a 0 e 1.
function blend(parts) {
  let s = 0, w = 0;
  for (const [p, weight] of parts) {
    if (p === undefined || p === null || !weight) continue;
    const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
    s += weight * Math.log(q / (1 - q));
    w += weight;
  }
  return w ? 1 / (1 + Math.exp(-s / w)) : null;
}

export function pickLabel(market, pick, home, away) {
  switch (`${market}|${pick}`) {
    case '1X2|1': return `1 · vince ${home}`;
    case '1X2|X': return 'X · pareggio';
    case '1X2|2': return `2 · vince ${away}`;
    case 'DC|1X': return `1X · ${home} o pareggio`;
    case 'DC|12': return '12 · nessun pareggio';
    case 'DC|X2': return `X2 · ${away} o pareggio`;
    case 'GG|GG': return 'Goal · segnano entrambe';
    case 'GG|NG': return 'No Goal · almeno una non segna';
    default: return pick;
  }
}

const pct = (p) => `${Math.round(p * 100)}%`;

// Analizza una partita e restituisce tutti gli esiti con probabilità e edge.
export function analyzeFixture(fx, oddsEntry, prediction, cfg) {
  const books = parseBookmakers(oddsEntry);
  if (!Object.keys(books).length) return null;

  const market = marketProbabilities(books, cfg);
  const xg = expectedGoals(prediction, cfg);
  const poisson = poissonProbabilities(xg);
  const api = apiProbabilities(prediction);

  const home = fx.teams.home.name;
  const away = fx.teams.away.name;
  const formHome = prediction?.teams?.home?.league?.form?.slice(-5) || null;
  const formAway = prediction?.teams?.away?.league?.form?.slice(-5) || null;

  const options = [];
  for (const key of Object.keys(market)) {
    const [mk, pick] = key.split('|');
    const offer = offeredOdd(books, key, cfg);
    if (!offer) continue;

    const w = mk === '1X2' || mk === 'DC' ? cfg.weights.result : cfg.weights.goals;
    const pM = market[key];
    const pP = poisson?.[key];
    const pA = api?.[key];
    const p = blend([[pM, w.market], [pP, w.poisson], [pA, w.api || 0]]);
    if (p === null) continue;

    const reasons = [`Mercato ${pct(pM)}`];
    if (pP !== undefined) reasons.push(`Poisson ${pct(pP)} (xG ${xg.home.toFixed(2)}–${xg.away.toFixed(2)})`);
    if (pA !== undefined) reasons.push(`API-Football ${pct(pA)}`);

    options.push({
      key,
      market: mk,
      marketLabel: MARKET_LABELS[mk],
      pick,
      label: pickLabel(mk, pick, home, away),
      odd: offer.odd,
      bookmaker: offer.bookmaker,
      p,
      pMarket: pM,
      pPoisson: pP ?? null,
      pApi: pA ?? null,
      edge: p * offer.odd - 1,
      edgeMarket: pM * offer.odd - 1,
      reasons,
    });
  }

  return {
    fixtureId: fx.fixture.id,
    kickoff: fx.fixture.date,
    league: fx.league.name,
    country: fx.league.country,
    leagueId: fx.league.id,
    home,
    away,
    xg,
    formHome,
    formAway,
    apiAdvice: prediction?.predictions?.advice || null,
    bookmakers: Object.keys(books).length,
    options,
  };
}

// Filtra gli esiti giocabili secondo le soglie di configurazione.
export function eligibleOptions(analysis, sel, minEdge, minMarketEdge = null) {
  return analysis.options.filter((o) => {
    if (o.odd < sel.minOdd || o.odd > sel.maxOdd) return false;
    if (o.p < sel.minProb) return false;
    if (o.edge < minEdge) return false;
    // Il valore deve esistere anche secondo il solo mercato pulito: così
    // un errore del modello dei gol non basta a creare un edge.
    if (minMarketEdge !== null && o.edgeMarket < minMarketEdge) return false;
    if (o.pPoisson !== null && Math.abs(o.pPoisson - o.pMarket) > sel.maxModelDisagreement) return false;
    return true;
  });
}

export function settlePick(key, h, a) {
  const [, pick] = key.split('|');
  const tot = h + a;
  switch (pick) {
    case '1': return h > a;
    case 'X': return h === a;
    case '2': return h < a;
    case '1X': return h >= a;
    case '12': return h !== a;
    case 'X2': return h <= a;
    case 'GG': return h > 0 && a > 0;
    case 'NG': return !(h > 0 && a > 0);
    default: {
      const m = pick.match(/^(Over|Under) ([\d.]+)$/);
      if (!m) return null;
      return m[1] === 'Over' ? tot > Number(m[2]) : tot < Number(m[2]);
    }
  }
}
