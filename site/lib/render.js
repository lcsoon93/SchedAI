// Funzioni di rendering: restituiscono HTML a partire dai dati dell'analisi.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pct = (p, d = 0) => (p == null ? '–' : `${(p * 100).toFixed(d).replace('.', ',')}%`);
export const signedPct = (x, d = 1) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d).replace('.', ',')}%`);
export const odd = (o) => (o == null ? '–' : o.toFixed(2).replace('.', ','));
const num = (x, d = 3) => (x == null ? '–' : x.toFixed(d).replace('.', ','));
const cls = (x) => (x == null ? '' : x >= 0 ? 'pos' : 'neg');

const TZ = 'Europe/Rome';
export const time = (iso) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
export const longDate = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const dateTime = (iso) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });

export function statusBanner(data) {
  const s = data.status;
  let html;
  if (s === 'valore_positivo') {
    html = `<div class="banner ok"><strong>Il modello trova valore.</strong>
      <p>La schedina sotto ha valore atteso stimato positivo. Resta una scommessa ad alto rischio: guarda la probabilità, non solo la quota.</p></div>`;
  } else if (s === 'valore_negativo') {
    html = `<div class="banner caution"><strong>Nessuna combinazione ha valore atteso positivo.</strong>
      <p>La schedina sotto è la meno sfavorevole trovata, mostrata per trasparenza. In media fa perdere: il consiglio del modello è di non giocare.</p></div>`;
  } else {
    html = `<div class="banner none"><strong>Nessuna schedina.</strong>
      <p>Non ci sono abbastanza esiti affidabili per comporre una schedina nella fascia di quota scelta.</p></div>`;
  }
  if (data.mock) {
    html += `<div class="banner none"><strong>Dati simulati.</strong><p>Partite finte per provare la pagina: non usarle.</p></div>`;
  }
  return html;
}

function leg(l) {
  const form = l.formHome && l.formAway
    ? `<span>Forma <span class="form">${esc(l.formHome)}</span> / <span class="form">${esc(l.formAway)}</span></span>`
    : '';
  return `<li class="leg">
    <div><div class="match">${esc(l.match)}</div><div class="when">${esc(l.league)} · ${esc(time(l.kickoff))}</div></div>
    <div class="odd" title="${esc(l.bookmaker)}">${odd(l.odd)}</div>
    <div class="pick">${esc(l.marketLabel)}: <strong>${esc(l.label)}</strong></div>
    <div class="nums">
      <span>Prob. ${pct(l.p)}</span>
      <span>Quota equa ${odd(l.fairOdd)}</span>
      <span class="${cls(l.edge)}">Vantaggio ${signedPct(l.edge)}</span>
      ${form}
    </div>
    <div class="why">${esc(l.reasons.join(' · '))}</div>
  </li>`;
}

function ticket(t, negative, mainTitle) {
  const title = !t.featured ? `Schedina ${esc(t.name)}` : negative ? 'Solo esempio: nessuna giocata consigliata' : mainTitle;
  return `<div class="ticket-head">
      <h3>${title} <span class="hint">· fascia ${odd(t.minOdd)}–${odd(t.maxOdd)} · tutta su ${esc(t.bookmaker)}</span></h3>
      <span class="badge ${negative ? 'neg' : ''}">${t.legs.length} esiti</span>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="label">Quota totale</div><div class="value">${odd(t.totalOdd)}</div></div>
      <div class="kpi"><div class="label">Probabilità stimata</div><div class="value">${pct(t.prob, 1)}</div></div>
      <div class="kpi"><div class="label">Vince circa</div><div class="value">1 su ${t.oneIn}</div></div>
      <div class="kpi"><div class="label">Valore atteso</div><div class="value ${cls(t.ev)}">${signedPct(t.ev)}</div></div>
      <div class="kpi"><div class="label">Prob. secondo il mercato</div><div class="value">${pct(t.probMarket, 1)}</div></div>
      <div class="kpi"><div class="label">Valore atteso (solo mercato)</div><div class="value ${cls(t.evMarket)}">${signedPct(t.evMarket)}</div></div>
    </div>
    <ul class="legs">${t.legs.map(leg).join('')}</ul>`;
}

// Schedina principale in evidenza, alternative compresse sotto.
export function tickets(data, mainTitle = 'Schedina consigliata') {
  const negative = data.status !== 'valore_positivo';
  const main = data.tickets.find((t) => t.featured) || data.tickets[0];
  const others = data.tickets.filter((t) => t !== main);
  let html = main ? `<article class="card ticket ${negative ? '' : 'featured'}">${ticket(main, negative, mainTitle)}</article>` : '';
  if (others.length) {
    html += `<details class="card alternatives"><summary><strong>Alternative più rischiose</strong>
      <span class="hint">· ${others.map((t) => `${esc(t.name)} a quota ${odd(t.totalOdd)}, 1 su ${t.oneIn}`).join(' · ')}</span></summary>
      ${others.map((t) => `<div class="alt">${ticket(t, negative, mainTitle)}</div>`).join('')}</details>`;
  }
  return html;
}

export function shortlist(rows) {
  if (!rows?.length) return '';
  return `<details class="card"><summary><strong>Esiti con più valore</strong>
    <span class="hint">· ${rows.length} esiti giocabili, ordinati per vantaggio stimato</span></summary>
    <div class="table-scroll"><table><thead><tr>
      <th>Partita</th><th>Esito</th><th class="num">Quota</th><th class="num">Prob.</th><th class="num">Mercato</th><th class="num">Vantaggio</th>
    </tr></thead><tbody>${rows
      .map(
        (r) => `<tr>
        <td>${esc(r.match)}<br><span class="hint">${esc(r.league)} · ${esc(time(r.kickoff))}</span></td>
        <td>${esc(r.label)}</td>
        <td class="num">${odd(r.odd)}</td>
        <td class="num">${pct(r.p)}</td>
        <td class="num">${pct(r.pMarket)}</td>
        <td class="num ${cls(r.edge)}">${signedPct(r.edge)}</td>
      </tr>`
      )
      .join('')}</tbody></table></div></details>`;
}

export function stats(s) {
  let html = `<p class="verdict">${esc(s.verdict)}</p>`;

  const bands = Object.values(s.bands || {}).filter((b) => b.played);
  if (bands.length) {
    html += `<div class="table-scroll"><table><thead><tr>
      <th>Schedina</th><th class="num">Chiuse</th><th class="num">Vinte</th><th class="num">Attese</th><th class="num">ROI</th>
    </tr></thead><tbody>${bands
      .map(
        (b) => `<tr><td>${esc(b.name)}</td><td class="num">${b.played}</td><td class="num">${b.won}</td>
        <td class="num">${num(b.expectedWins, 1)}</td><td class="num ${cls(b.roi)}">${signedPct(b.roi)}</td></tr>`
      )
      .join('')}</tbody></table></div>
      <p class="hint">ROI a puntata fissa di 1 € per schedina. «Attese» = somma delle probabilità stimate: se il modello è onesto, le vinte oscillano intorno a questo numero.</p>`;
  }

  const a = s.allCandidates;
  if (a) {
    html += `<h3>Precisione delle probabilità</h3>
      <p class="hint">Su ${a.n} esiti di ${a.matches} partite concluse (non solo quelli in schedina). Più basso è meglio.</p>
      <div class="table-scroll"><table><thead><tr><th></th><th class="num">Modello</th><th class="num">Mercato</th></tr></thead><tbody>
        <tr><td>Brier score</td><td class="num">${num(a.brierModel, 4)}</td><td class="num">${num(a.brierMarket, 4)}</td></tr>
        <tr><td>Log-loss</td><td class="num">${num(a.logLossModel, 4)}</td><td class="num">${num(a.logLossMarket, 4)}</td></tr>
        ${a.brierPoisson != null ? `<tr><td>Brier solo Poisson</td><td class="num">${num(a.brierPoisson, 4)}</td><td class="num">${num(a.brierMarketOnPoisson, 4)}</td></tr>` : ''}
      </tbody></table></div>
      <p class="hint">Skill rispetto al mercato: <strong class="${cls(a.skillVsMarket)}">${signedPct(a.skillVsMarket, 2)}</strong> (positivo = il modello stima meglio delle quote pulite).</p>
      <h3>Calibrazione</h3>
      <p class="hint">La barra è la frequenza reale, la tacca la probabilità prevista: se coincidono, le percentuali sono affidabili.</p>
      <div class="calib">${a.calibration
        .map(
          (c) => `<div class="calib-row"><span>${esc(c.bin)}</span>
          <div class="bar"><div class="obs" style="width:${(c.observed * 100).toFixed(1)}%"></div><div class="pred" style="left:${(c.predicted * 100).toFixed(1)}%"></div></div>
          <span class="num">${pct(c.observed)} · ${c.n}</span></div>`
        )
        .join('')}</div>`;
  }
  return html;
}

export function resultLabel(r) {
  if (r === 'won') return '<span class="res-won">vinta</span>';
  if (r === 'lost') return '<span class="res-lost">persa</span>';
  if (r === 'void') return '<span class="res-pending">annullata</span>';
  return '<span class="res-pending">in corso</span>';
}

export function legResult(l) {
  const mark = l.result === 'won' ? '✓' : l.result === 'lost' ? '✗' : l.result === 'void' ? 'annullata' : '…';
  return `${esc(l.match)}: ${esc(l.label)} @ ${odd(l.odd)} ${l.score ? `(${esc(l.score)})` : ''} <strong>${mark}</strong>`;
}

export function compactTicketSummary(t) {
  return `<details><summary>${t.featured ? '<strong>Principale</strong> · ' : ''}${esc(t.name)} · quota ${odd(t.totalOdd)} · prob. ${pct(t.prob, 1)} · ${resultLabel(t.result)}</summary>
    <ul>${t.legs.map((l) => `<li>${legResult(l)}</li>`).join('')}</ul></details>`;
}
