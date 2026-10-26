// Pagina SchedAI: analisi su richiesta nel browser + storico ufficiale.
//
// La chiave api-football resta solo nel localStorage di questo browser e
// viene inviata solo a api-football. Con ?demo la pagina usa dati simulati.
import { createApiClient } from './lib/api.js';
import { createMockClient } from './lib/mock.js';
import { runAnalysis, compactTicket } from './lib/pipeline.js';
import { settleAll } from './lib/history.js';
import * as R from './lib/render.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has('demo');

const KEY_STORE = 'schedai.apiKey';
const REQ_STORE = 'schedai.requests';
const PRED_PREFIX = 'schedai.pred.';
const PRED_TTL = 6 * 3600 * 1000;
const MEM_TTL = 10 * 60 * 1000;
const MAX_SAVED = 100;

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

function todayRome(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Cache in memoria per palinsesto e quote (10 minuti), così rilanciare con
// altri campionati o un'altra fascia di quota non consuma richieste.
function withMemoryCache(client) {
  const mem = new Map();
  const cached = (name, fn) => async (path, params = {}) => {
    const k = `${name}:${path}:${JSON.stringify(params)}`;
    const hit = mem.get(k);
    if (hit && Date.now() - hit.t < MEM_TTL) return hit.v;
    const v = await fn(path, params);
    mem.set(k, { t: Date.now(), v });
    return v;
  };
  return {
    get: cached('get', client.get),
    getAllPages: cached('pages', client.getAllPages),
    get calls() {
      return client.calls;
    },
  };
}

// Le statistiche delle squadre cambiano poco: cache di 6 ore nel browser.
function predictionGetter(client) {
  return async (fixtureId) => {
    const k = PRED_PREFIX + fixtureId;
    try {
      const hit = JSON.parse(store.get(k) || 'null');
      if (hit && Date.now() - hit.t < PRED_TTL) return hit.v;
    } catch {}
    const v = (await client.get('/predictions', { fixture: fixtureId })).response?.[0] || null;
    store.set(k, JSON.stringify({ t: Date.now(), v }));
    return v;
  };
}

function prunePredictionCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PRED_PREFIX)) continue;
      const hit = JSON.parse(localStorage.getItem(k) || 'null');
      if (!hit || Date.now() - hit.t > PRED_TTL) localStorage.removeItem(k);
    }
  } catch {}
}

let cfg;
let cachedClient = null;

function apiKey() {
  return store.get(KEY_STORE);
}

function clientFor(date) {
  if (demo) return createMockClient(date);
  const key = apiKey();
  if (!key) return null;
  if (cachedClient?.key !== key) cachedClient = { key, client: withMemoryCache(createApiClient(key)) };
  return cachedClient.client;
}

// --- Chiave --------------------------------------------------------------

async function renderKey() {
  const key = apiKey();
  const box = $('key-box');
  if (demo) {
    box.innerHTML = `<p>Modalità <strong>demo</strong>: dati simulati, nessuna chiave usata. <a href="./">Esci dalla demo</a></p>`;
    return;
  }
  if (!key) {
    box.innerHTML = `<form id="key-form" class="row">
        <label class="grow">Chiave api-football
          <input id="key-input" type="password" autocomplete="off" required placeholder="Incolla qui la tua chiave">
        </label>
        <button type="submit">Salva</button>
      </form>
      <p class="hint">La chiave resta solo in questo browser e viene inviata solo a api-football: non finisce su GitHub. Vuoi solo provare? <a href="?demo">Apri la demo</a>.</p>`;
    $('key-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('key-input').value.trim();
      if (!v) return;
      if (!store.set(KEY_STORE, v)) {
        alert('Il browser non permette di salvare la chiave (navigazione privata?).');
        return;
      }
      renderKey();
      updateFormState();
    });
    return;
  }

  box.innerHTML = `<div class="row"><p class="grow">Chiave salvata in questo browser. <span id="quota" class="hint"></span></p>
    <button type="button" id="key-remove" class="secondary">Rimuovi chiave</button></div>`;
  $('key-remove').addEventListener('click', () => {
    store.del(KEY_STORE);
    cachedClient = null;
    renderKey();
    updateFormState();
  });
  try {
    // /status non consuma richieste del piano.
    const body = await createApiClient(key).get('/status');
    const req = body.response?.requests;
    if (req) $('quota').textContent = `Richieste usate oggi: ${req.current} su ${req.limit_day}.`;
  } catch (err) {
    $('quota').textContent = `La chiave non funziona: ${err.message}`;
  }
}

// --- Richiesta -----------------------------------------------------------

function renderForm() {
  const dateIn = $('f-date');
  dateIn.value = todayRome();
  dateIn.min = todayRome();
  dateIn.max = todayRome(7);
  $('f-preset').innerHTML = cfg.leaguePresets.map((p) => `<option value="${R.esc(p.id)}">${R.esc(p.name)}</option>`).join('');
  for (const id of ['f-min', 'f-max']) {
    $(id).min = cfg.ticket.minOdd;
    $(id).max = cfg.ticket.maxOdd;
  }
  $('f-min').value = cfg.ticket.minOdd;
  $('f-max').value = cfg.ticket.maxOdd;
  $('f-legs').innerHTML = Array.from({ length: cfg.ticket.maxLegs - cfg.ticket.minLegs + 1 }, (_, i) => {
    const n = cfg.ticket.minLegs + i;
    return `<option value="${n}" ${n === cfg.ticket.maxLegs ? 'selected' : ''}>fino a ${n}</option>`;
  }).join('');
  $('query-form').addEventListener('submit', onSubmit);
  updateFormState();
}

function updateFormState() {
  const ready = demo || !!apiKey();
  $('f-submit').disabled = !ready;
  $('f-hint').textContent = ready ? '' : 'Salva prima la chiave api-football qui sopra.';
}

async function onSubmit(e) {
  e.preventDefault();
  const date = $('f-date').value;
  let minOdd = Number($('f-min').value);
  let maxOdd = Number($('f-max').value);
  if (minOdd > maxOdd) [minOdd, maxOdd] = [maxOdd, minOdd];
  const preset = cfg.leaguePresets.find((p) => p.id === $('f-preset').value);
  const maxLegs = Number($('f-legs').value);
  const client = clientFor(date);
  if (!client) return;

  const btn = $('f-submit');
  btn.disabled = true;
  $('result').innerHTML = '';
  $('progress').hidden = false;
  const callsBefore = client.calls;

  try {
    const result = await runAnalysis(client, cfg, {
      date,
      leagues: preset?.leagues,
      minOdd,
      maxOdd,
      maxLegs,
      ignoreKickoff: demo,
      getPrediction: demo ? undefined : predictionGetter(client),
      onProgress: (phase, done, total) => {
        $('progress-text').textContent = total > 1 ? `${phase}: ${done + 1} di ${total}…` : `${phase}…`;
        $('progress-bar').value = total > 1 ? done / total : 0;
      },
    });
    result.mock = demo;
    renderResult(result, client.calls - callsBefore);
    saveRequest(result);
    renderRequests();
  } catch (err) {
    $('result').innerHTML = `<div class="banner none"><strong>Analisi non riuscita.</strong><p>${R.esc(err.message)}</p></div>`;
  } finally {
    $('progress').hidden = true;
    btn.disabled = false;
  }
}

function renderResult(r, calls) {
  const s = r.summary;
  $('result').innerHTML = `
    <p class="meta">${R.esc(R.longDate(r.date))} · ${s.fixturesAnalyzed} partite analizzate su ${s.fixturesFollowed} in programma nei campionati scelti · ${calls} richieste API</p>
    ${R.statusBanner(r)}
    ${R.tickets(r)}
    ${R.shortlist(r.shortlist)}`;
}

// --- Le mie richieste (solo in questo browser) ----------------------------

function loadRequests() {
  try {
    return JSON.parse(store.get(REQ_STORE) || '[]');
  } catch {
    return [];
  }
}

function saveRequests(list) {
  store.set(REQ_STORE, JSON.stringify(list.slice(-MAX_SAVED)));
}

// Ogni richiesta viene salvata, non solo quelle che piacciono: così il
// riepilogo non diventa ottimista per selezione.
function saveRequest(r) {
  if (r.mock) return;
  const list = loadRequests();
  list.push({ at: r.generatedAt, date: r.date, status: r.status, request: r.request, tickets: r.tickets.map(compactTicket) });
  saveRequests(list);
}

function renderRequests() {
  const list = loadRequests();
  $('mine-card').hidden = !list.length;
  if (!list.length) return;

  // Nel riepilogo conta solo la prima richiesta di ogni data, così rilanciare
  // più volte lo stesso giorno non pesa di più.
  const firstPerDate = new Map();
  for (const x of list) if (!firstPerDate.has(x.date)) firstPerDate.set(x.date, x);
  const main = [...firstPerDate.values()].map((x) => x.tickets.find((t) => t.featured)).filter(Boolean);
  const closed = main.filter((t) => t.result === 'won' || t.result === 'lost');
  const won = closed.filter((t) => t.result === 'won').length;
  const expected = closed.reduce((a, t) => a + t.prob, 0);
  $('mine-summary').textContent = closed.length
    ? `Prima schedina di ogni giorno: ${closed.length} chiuse, vinte ${won} (attese ${expected.toFixed(1).replace('.', ',')}).`
    : 'Nessuna schedina ancora chiusa.';

  $('mine').innerHTML = [...list]
    .reverse()
    .slice(0, 20)
    .map(
      (x) => `<div class="day">
      <div class="day-head"><span>${R.esc(R.longDate(x.date))}</span><span class="hint">richiesta ${R.esc(R.dateTime(x.at))} · quota ${x.request.minOdd}–${x.request.maxOdd}</span></div>
      ${x.status === 'valore_negativo' ? '<span class="badge neg">senza valore</span>' : ''}
      ${x.tickets.length ? x.tickets.map(R.compactTicketSummary).join('') : '<p class="hint">Nessuna schedina.</p>'}
    </div>`
    )
    .join('');
}

async function refreshResults() {
  const client = clientFor(todayRome());
  if (!client) return;
  const btn = $('mine-refresh');
  btn.disabled = true;
  try {
    const list = loadRequests();
    await settleAll({ days: list }, [], client);
    saveRequests(list);
    renderRequests();
  } catch (err) {
    alert(`Verifica non riuscita: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// --- Storico ufficiale (corsa automatica giornaliera) ---------------------

async function renderOfficial() {
  try {
    const r = await fetch('data/latest.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    $('official-meta').textContent = `Riferimento del ${R.longDate(data.date)}, generato ${R.dateTime(data.generatedAt)} con parametri fissi.`;
    $('official-ticket').innerHTML = R.statusBanner(data) + R.tickets(data, 'Schedina di riferimento');
    $('stats').innerHTML = R.stats(data.stats);
    $('recent').innerHTML = (data.recent || [])
      .map(
        (d) => `<div class="day"><div class="day-head"><span>${R.esc(R.longDate(d.date))}</span>${d.status === 'valore_negativo' ? '<span class="badge neg">senza valore</span>' : ''}</div>
        ${d.tickets.length ? d.tickets.map(R.compactTicketSummary).join('') : '<p class="hint">Nessuna schedina.</p>'}</div>`
      )
      .join('');
  } catch {
    $('official-meta').textContent = 'La corsa automatica non ha ancora pubblicato dati.';
  }
}

async function main() {
  cfg = await (await fetch('config.json', { cache: 'no-store' })).json();
  prunePredictionCache();
  renderForm();
  renderKey();
  renderRequests();
  $('mine-refresh').addEventListener('click', refreshResults);
  $('mine-clear').addEventListener('click', () => {
    if (confirm('Cancellare le richieste salvate in questo browser?')) {
      saveRequests([]);
      renderRequests();
    }
  });
  renderOfficial();
}

main();
