// Client minimale per API-Football v3 (api-sports.io).
// La chiave arriva solo da variabile d'ambiente e non viene mai stampata.

const BASE_URL = 'https://v3.football.api-sports.io';
const MIN_INTERVAL_MS = 250; // piano Pro: 300 richieste/minuto

export function createApiClient(apiKey) {
  let lastCall = 0;
  let calls = 0;

  async function throttle() {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  }

  async function get(path, params = {}) {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      await throttle();
      calls++;
      try {
        const res = await fetch(url, {
          headers: { 'x-apisports-key': apiKey },
          signal: AbortSignal.timeout(20000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} su ${path}`);
        const body = await res.json();
        const errors = body.errors;
        const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
        if (hasErrors) {
          const err = new Error(`API-Football ${path}: ${JSON.stringify(errors)}`);
          err.fatal = true;
          throw err;
        }
        return body;
      } catch (err) {
        if (err.fatal || attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  async function getAllPages(path, params = {}, maxPages = 60) {
    const first = await get(path, { ...params, page: 1 });
    const out = [...(first.response || [])];
    const total = Math.min(first.paging?.total || 1, maxPages);
    for (let page = 2; page <= total; page++) {
      const body = await get(path, { ...params, page });
      out.push(...(body.response || []));
    }
    return out;
  }

  return {
    get,
    getAllPages,
    get calls() {
      return calls;
    },
  };
}
