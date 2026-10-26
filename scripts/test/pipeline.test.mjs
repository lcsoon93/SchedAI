import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockClient } from '../../site/lib/mock.js';
import { runAnalysis, splitBands } from '../../site/lib/pipeline.js';

const cfg = JSON.parse(await readFile(new URL('../../site/config.json', import.meta.url), 'utf8'));

test('Fasce: dividono la quota richiesta in parti contigue', () => {
  const b = splitBands(10, 100);
  assert.equal(b.length, 3);
  assert.equal(b[0].minOdd, 10);
  assert.equal(b[2].maxOdd, 100);
  assert.equal(b[0].maxOdd, b[1].minOdd);
});

test('Analisi su richiesta: una schedina principale e vincoli rispettati', async () => {
  const r = await runAnalysis(createMockClient('2026-10-26'), cfg, {
    date: '2026-10-26', leagues: [], minOdd: 5, maxOdd: 500, maxLegs: 6, ignoreKickoff: true,
  });
  assert.deepEqual([r.request.minOdd, r.request.maxOdd], [10, 100], 'fascia limitata a 10–100');
  assert.equal(r.tickets.filter((t) => t.featured).length, 1);
  const main = r.tickets.find((t) => t.featured);
  assert.ok(r.tickets.every((t) => main.prob >= t.prob));
  for (const t of r.tickets) {
    assert.ok(t.totalOdd >= 10 && t.totalOdd <= 100);
    assert.ok(t.legs.length <= 6);
    assert.equal(new Set(t.legs.map((l) => l.fixtureId)).size, t.legs.length, 'una gamba per partita');
    assert.equal(new Set(t.legs.map((l) => l.bookmaker)).size, 1, 'un solo bookmaker');
    const perLeague = {};
    for (const l of t.legs) perLeague[l.leagueId] = (perLeague[l.leagueId] || 0) + 1;
    assert.ok(Object.values(perLeague).every((n) => n <= cfg.ticket.maxPerLeague));
  }
});

test('Analisi su richiesta: esclude le partite che iniziano entro 60 minuti', async () => {
  const client = createMockClient('2026-10-26');
  const fixtures = (await client.get('/fixtures', {})).response;
  const latest = Math.max(...fixtures.map((f) => new Date(f.fixture.date).getTime()));
  const r = await runAnalysis(client, cfg, { date: '2026-10-26', now: latest - 30 * 60000 });
  assert.equal(r.summary.fixturesFollowed, 0);
});

test('Analisi su richiesta: filtro per campionati', async () => {
  const r = await runAnalysis(createMockClient('2026-10-26'), cfg, {
    date: '2026-10-26', leagues: [135], ignoreKickoff: true,
  });
  assert.ok(r.analyses.length > 0);
  assert.ok(r.analyses.every((a) => a.leagueId === 135));
});
