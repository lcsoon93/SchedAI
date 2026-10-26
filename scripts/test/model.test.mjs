import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shinProbs, poissonProbabilities, settlePick, marketProbabilities } from '../lib/model.mjs';
import { buildTicket } from '../lib/optimizer.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('Shin: probabilità a somma 1 e più margine tolto agli sfavoriti', () => {
  const odds = [1.5, 4.2, 7.0];
  const p = shinProbs(odds);
  close(p.reduce((a, b) => a + b, 0), 1);
  const implied = odds.map((o) => 1 / o);
  const s = implied.reduce((a, b) => a + b, 0);
  assert.ok(p[0] > implied[0] / s, 'il favorito guadagna rispetto alla normalizzazione');
  assert.ok(p[2] < implied[2] / s, 'lo sfavorito perde rispetto alla normalizzazione');
});

test('Poisson: mercati coerenti tra loro', () => {
  const p = poissonProbabilities({ home: 1.6, away: 1.1 });
  close(p['1X2|1'] + p['1X2|X'] + p['1X2|2'], 1);
  close(p['OU|Over 2.5'] + p['OU|Under 2.5'], 1);
  close(p['DC|1X'], p['1X2|1'] + p['1X2|X']);
  assert.ok(p['OU|Over 1.5'] > p['OU|Over 2.5']);
});

test('Mercato: peso maggiore al bookmaker sharp', () => {
  const books = {
    4: { picks: { '1X2|1': 2.0, '1X2|X': 3.6, '1X2|2': 4.0 } },
    8: { picks: { '1X2|1': 2.4, '1X2|X': 3.2, '1X2|2': 3.0 } },
  };
  const cfgA = { sharpBookmakerId: 4, sharpWeight: 3 };
  const cfgB = { sharpBookmakerId: 4, sharpWeight: 1 };
  assert.ok(marketProbabilities(books, cfgA)['1X2|1'] > marketProbabilities(books, cfgB)['1X2|1']);
});

test('Refertazione degli esiti', () => {
  assert.equal(settlePick('1X2|1', 2, 1), true);
  assert.equal(settlePick('DC|X2', 1, 1), true);
  assert.equal(settlePick('OU|Over 2.5', 1, 1), false);
  assert.equal(settlePick('OU|Under 3.5', 2, 1), true);
  assert.equal(settlePick('GG|GG', 0, 3), false);
  assert.equal(settlePick('GG|NG', 0, 3), true);
});

test('Ottimizzatore: una gamba per partita, quota nella fascia, massima probabilità', () => {
  const mk = (id, odd, p) => ({ id, odd, p });
  const groups = [
    [mk('a1', 1.5, 0.7), mk('a2', 2.2, 0.48)],
    [mk('b1', 1.8, 0.58)],
    [mk('c1', 2.0, 0.52), mk('c2', 3.0, 0.35)],
    [mk('d1', 1.6, 0.65)],
    [mk('e1', 2.5, 0.42)],
  ];
  const t = buildTicket(groups, { minLegs: 2, maxLegs: 5, minOdd: 10, maxOdd: 20 });
  assert.ok(t);
  assert.ok(t.totalOdd >= 10 && t.totalOdd <= 20);

  // forza bruta di controllo
  let best = 0;
  const rec = (g, odd, p, n) => {
    if (g === groups.length) {
      if (n >= 2 && odd >= 10 && odd <= 20) best = Math.max(best, p);
      return;
    }
    rec(g + 1, odd, p, n);
    for (const o of groups[g]) rec(g + 1, odd * o.odd, p * o.p, n + 1);
  };
  rec(0, 1, 1, 0);
  close(t.prob, best, 1e-9);
});

test('Ottimizzatore: rispetta i vincoli passati da accept', () => {
  const groups = Array.from({ length: 6 }, (_, i) => [{ id: i, odd: 2, p: 0.6 - i * 0.01, leagueId: i < 4 ? 'A' : 'B' }]);
  const t = buildTicket(groups, { minLegs: 2, maxLegs: 6, minOdd: 10, maxOdd: 20, maxPerTag: 2 });
  assert.ok(t);
  assert.equal(t.legs.filter((l) => l.leagueId === 'A').length, 2);
  assert.equal(t.legs.length, 4);
  // le due migliori del campionato A
  assert.deepEqual(t.legs.map((l) => l.id).sort(), [0, 1, 4, 5]);

  const noEv = buildTicket(groups, { minLegs: 2, maxLegs: 6, minOdd: 10, maxOdd: 20, accept: (tk) => tk.ev > 10 });
  assert.equal(noEv, null);
});

test('Ottimizzatore: nessuna schedina se la fascia è irraggiungibile', () => {
  const groups = [[{ odd: 1.5, p: 0.7 }], [{ odd: 1.5, p: 0.7 }]];
  assert.equal(buildTicket(groups, { minLegs: 2, maxLegs: 5, minOdd: 10, maxOdd: 20 }), null);
});
