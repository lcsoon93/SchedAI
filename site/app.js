// Rendering della pagina a partire da data/latest.json (generato dalla Action).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (p, d = 0) => (p == null ? '–' : `${(p * 100).toFixed(d).replace('.', ',')}%`);
  const signedPct = (x, d = 1) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d).replace('.', ',')}%`);
  const odd = (o) => (o == null ? '–' : o.toFixed(2).replace('.', ','));
  const num = (x, d = 3) => (x == null ? '–' : x.toFixed(d).replace('.', ','));
  const cls = (x) => (x == null ? '' : x >= 0 ? 'pos' : 'neg');

  let tz = 'Europe/Rome';
  const time = (iso) =>
    new Date(iso).toLocaleString('it-IT', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const longDate = (d) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function renderStatus(data) {
    const s = data.status;
    let html;
    if (s === 'valore_positivo') {
      html = `<div class="banner ok"><strong>Oggi il modello trova valore.</strong>
        <p>Le schedine sotto hanno valore atteso stimato positivo. Restano scommesse ad alto rischio: guarda la probabilità, non solo la quota.</p></div>`;
    } else if (s === 'valore_negativo') {
      html = `<div class="banner caution"><strong>Oggi nessuna combinazione ha valore atteso positivo.</strong>
        <p>Le schedine sotto sono le meno sfavorevoli trovate, pubblicate per trasparenza e per lo storico. In media fanno perdere: il consiglio del modello è di non giocare.</p></div>`;
    } else {
      html = `<div class="banner none"><strong>Nessuna schedina oggi.</strong>
        <p>Non ci sono abbastanza esiti affidabili per comporre una schedina tra quota 10 e 100.</p></div>`;
    }
    if (data.mock) {
      html += `<div class="banner none" style="margin-top:12px"><strong>Dati simulati.</strong><p>Questa è un'anteprima con partite finte, non usarla.</p></div>`;
    }
    $('status').innerHTML = html;
  }

  function renderLeg(l) {
    const form = l.formHome && l.formAway ? `<span>Forma <span class="form">${esc(l.formHome)}</span> / <span class="form">${esc(l.formAway)}</span></span>` : '';
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
      <div class="why">${esc(l.reasons.join(' · '))} · quota: ${esc(l.bookmaker)}</div>
    </li>`;
  }

  function renderTicket(t, negative) {
    const title = !t.featured ? `Schedina ${esc(t.name)}` : negative ? 'Solo esempio: oggi nessuna giocata consigliata' : 'Schedina del giorno';
    return `<div class="ticket-head">
          <h3>${title} <span class="hint">· fascia ${t.minOdd}–${t.maxOdd} · tutta su ${esc(t.bookmaker)}</span></h3>
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
        <ul class="legs">${t.legs.map(renderLeg).join('')}</ul>`;
  }

  function renderTickets(data) {
    const negative = data.status !== 'valore_positivo';
    const main = data.tickets.find((t) => t.featured) || data.tickets[0];
    const others = data.tickets.filter((t) => t !== main);
    let html = main ? `<article class="card ticket ${negative ? '' : 'featured'}">${renderTicket(main, negative)}</article>` : '';
    if (others.length) {
      html += `<details class="card alternatives"><summary><strong>Alternative più rischiose</strong>
        <span class="hint">· ${others.map((t) => `${esc(t.name)} a quota ${odd(t.totalOdd)}, 1 su ${t.oneIn}`).join(' · ')}</span></summary>
        ${others.map((t) => `<div class="alt">${renderTicket(t, negative)}</div>`).join('')}</details>`;
    }
    $('tickets').innerHTML = html;
  }

  function renderShortlist(data) {
    const rows = data.shortlist || [];
    if (!rows.length) {
      $('shortlist-card').hidden = true;
      return;
    }
    $('shortlist').innerHTML = `<thead><tr>
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
        .join('')}</tbody>`;
  }

  function renderStats(stats) {
    $('verdict').textContent = stats.verdict;
    let html = '';

    const bands = Object.values(stats.bands || {}).filter((b) => b.played);
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

    const a = stats.allCandidates;
    if (a) {
      html += `<h3 style="margin-top:16px">Precisione delle probabilità</h3>
        <p class="hint">Su ${a.n} esiti di ${a.matches} partite concluse (non solo quelli in schedina). Più basso è meglio.</p>
        <div class="table-scroll"><table><thead><tr><th></th><th class="num">Modello</th><th class="num">Mercato</th></tr></thead><tbody>
          <tr><td>Brier score</td><td class="num">${num(a.brierModel, 4)}</td><td class="num">${num(a.brierMarket, 4)}</td></tr>
          <tr><td>Log-loss</td><td class="num">${num(a.logLossModel, 4)}</td><td class="num">${num(a.logLossMarket, 4)}</td></tr>
          ${a.brierPoisson != null ? `<tr><td>Brier solo Poisson</td><td class="num">${num(a.brierPoisson, 4)}</td><td class="num">${num(a.brierMarketOnPoisson, 4)}</td></tr>` : ''}
        </tbody></table></div>
        <p class="hint">Skill rispetto al mercato: <strong class="${cls(a.skillVsMarket)}">${signedPct(a.skillVsMarket, 2)}</strong> (positivo = il modello stima meglio delle quote pulite).</p>
        <h3 style="margin-top:16px">Calibrazione</h3>
        <p class="hint">La barra è la frequenza reale, la tacca la probabilità prevista: se coincidono, le percentuali sono affidabili.</p>
        <div class="calib">${a.calibration
          .map(
            (c) => `<div class="calib-row"><span>${esc(c.bin)}</span>
            <div class="bar"><div class="obs" style="width:${(c.observed * 100).toFixed(1)}%"></div><div class="pred" style="left:${(c.predicted * 100).toFixed(1)}%"></div></div>
            <span class="num">${pct(c.observed)} · ${c.n}</span></div>`
          )
          .join('')}</div>`;
    }

    if (stats.legs) {
      html += `<p class="hint" style="margin-top:12px">Esiti in schedina: indovinati ${pct(stats.legs.hitRate, 1)} contro ${pct(stats.legs.expectedHitRate, 1)} attesi su ${stats.legsClosed}.</p>`;
    }
    $('stats').innerHTML = html;
  }

  function resultLabel(r) {
    if (r === 'won') return '<span class="res-won">vinta</span>';
    if (r === 'lost') return '<span class="res-lost">persa</span>';
    if (r === 'void') return '<span class="res-pending">annullata</span>';
    return '<span class="res-pending">in corso</span>';
  }

  function legResult(l) {
    const mark = l.result === 'won' ? '✓' : l.result === 'lost' ? '✗' : l.result === 'void' ? 'annullata' : '…';
    return `${esc(l.match)}: ${esc(l.label)} @ ${odd(l.odd)} ${l.score ? `(${esc(l.score)})` : ''} <strong>${mark}</strong>`;
  }

  function renderRecent(days) {
    if (!days?.length) {
      $('recent-card').hidden = true;
      return;
    }
    $('recent').innerHTML = days
      .map(
        (d) => `<div class="day">
        <div class="day-head"><span>${esc(longDate(d.date))}</span>${d.status === 'valore_negativo' ? '<span class="badge neg">senza valore</span>' : ''}</div>
        ${d.tickets.length ? '' : '<p class="hint">Nessuna schedina.</p>'}
        ${d.tickets
          .map(
            (t) => `<details><summary>${t.featured ? '<strong>Del giorno</strong> · ' : ''}${esc(t.name)} · quota ${odd(t.totalOdd)} · prob. ${pct(t.prob, 1)} · ${resultLabel(t.result)}</summary>
            <ul>${t.legs.map((l) => `<li>${legResult(l)}</li>`).join('')}</ul></details>`
          )
          .join('')}
      </div>`
      )
      .join('');
  }

  fetch('data/latest.json', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((data) => {
      tz = data.timezone || tz;
      const gen = new Date(data.generatedAt).toLocaleString('it-IT', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
      $('meta').textContent = `${longDate(data.date)} · aggiornata ${gen} · ${data.summary.fixturesAnalyzed} partite analizzate`;
      renderStatus(data);
      renderTickets(data);
      renderShortlist(data);
      renderStats(data.stats);
      renderRecent(data.recent);
    })
    .catch(() => {
      $('meta').textContent = 'Nessun dato disponibile: la prima schedina verrà pubblicata alla prossima esecuzione automatica.';
      ['shortlist-card', 'stats-card', 'recent-card'].forEach((id) => ($(id).hidden = true));
    });
})();
