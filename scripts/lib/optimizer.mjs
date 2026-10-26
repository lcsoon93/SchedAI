// Costruzione della schedina come "knapsack a gruppi".
//
// Ogni partita è un gruppo: se ne può prendere al massimo un esito, così
// la probabilità combinata resta (circa) il prodotto delle probabilità.
// Tra tutte le combinazioni con quota totale nella fascia richiesta e un
// numero di esiti tra minLegs e maxLegs, scegliamo quella che massimizza
// la probabilità stimata di vincita (somma dei log p). A parità di fascia
// questo favorisce naturalmente poche gambe e la quota più bassa possibile.
// Il limite di esiti per campionato non entra nella programmazione dinamica:
// se la soluzione migliore lo viola, si riprova escludendo a turno una delle
// partite del campionato in eccesso (ricerca a rami, profondità limitata).
// Altri vincoli (es. EV minimo) passano da `accept`, verificato sugli stati
// finali in ordine di probabilità.

const STEP = 0.005; // risoluzione in log-quota

function solve(groups, { minLegs, maxLegs, minOdd, maxOdd, accept = () => true }) {
  const maxB = Math.ceil(Math.log(maxOdd) / STEP) + 1;
  const width = maxB + 1;
  const states = (maxLegs + 1) * width;

  const prepared = groups.map((opts) =>
    opts.map((o) => ({ o, logp: Math.log(o.o.p), b: Math.round(Math.log(o.o.odd) / STEP) }))
  );

  let dp = new Float64Array(states).fill(-Infinity);
  dp[0] = 0;
  const choices = [];

  for (const opts of prepared) {
    const next = Float64Array.from(dp);
    const choice = new Int16Array(states).fill(-1);
    for (let k = 0; k < maxLegs; k++) {
      for (let b = 0; b <= maxB; b++) {
        const cur = dp[k * width + b];
        if (cur === -Infinity) continue;
        for (let j = 0; j < opts.length; j++) {
          const nb = b + opts[j].b;
          if (nb > maxB) continue;
          const idx = (k + 1) * width + nb;
          const v = cur + opts[j].logp;
          if (v > next[idx]) {
            next[idx] = v;
            choice[idx] = j;
          }
        }
      }
    }
    choices.push(choice);
    dp = next;
  }

  // Stati finali candidati, dal più probabile; verifichiamo la quota esatta
  // perché la discretizzazione può spostare leggermente il totale.
  const ends = [];
  const bMin = Math.floor(Math.log(minOdd) / STEP) - 2;
  for (let k = minLegs; k <= maxLegs; k++) {
    for (let b = Math.max(0, bMin); b <= maxB; b++) {
      const v = dp[k * width + b];
      if (v > -Infinity) ends.push({ k, b, v });
    }
  }
  ends.sort((x, y) => y.v - x.v);

  for (const end of ends) {
    const legs = [];
    let { k, b } = end;
    for (let g = prepared.length - 1; g >= 0 && k > 0; g--) {
      const j = choices[g][k * width + b];
      if (j < 0) continue;
      legs.push(prepared[g][j].o);
      b -= prepared[g][j].b;
      k--;
    }
    if (k !== 0 || b !== 0) continue;
    const totalOdd = legs.reduce((a, l) => a * l.o.odd, 1);
    if (totalOdd < minOdd || totalOdd > maxOdd) continue;
    legs.reverse();
    const prob = legs.reduce((a, l) => a * l.o.p, 1);
    const ticket = { legs, totalOdd: Math.round(totalOdd * 100) / 100, prob, ev: prob * totalOdd - 1 };
    if (!accept({ ...ticket, legs: legs.map((l) => l.o) })) continue;
    return ticket;
  }
  return null;
}

export function buildTicket(groups, opts) {
  const { maxPerTag = Infinity, tagOf = (o) => o.leagueId, maxBranchDepth = 4 } = opts;
  const indexed = groups.map((g, gi) => g.map((o) => ({ o, gi })));
  const seen = new Set();
  let best = null;

  const visit = (banned, depth) => {
    const sig = [...banned].sort((a, b) => a - b).join(',');
    if (seen.has(sig)) return;
    seen.add(sig);
    const active = indexed.filter((g, gi) => g.length && !banned.has(gi));
    const t = solve(active, opts);
    if (!t || (best && t.prob <= best.prob)) return;

    const byTag = new Map();
    for (const leg of t.legs) {
      const tag = tagOf(leg.o);
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(leg.gi);
    }
    const over = [...byTag.values()].find((gis) => gis.length > maxPerTag);
    if (!over) {
      best = t;
      return;
    }
    if (depth >= maxBranchDepth) return;
    for (const gi of over) visit(new Set([...banned, gi]), depth + 1);
  };

  visit(new Set(), 0);
  if (!best) return null;
  return { ...best, legs: best.legs.map((l) => l.o) };
}
