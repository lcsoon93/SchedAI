// Client finto con dati simulati ma coerenti, per provare la pipeline e la
// pagina senza consumare richieste (node scripts/generate.mjs --mock, o la
// pagina aperta con ?demo).
import { poissonProbabilities } from './model.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LEAGUES = [
  [135, 'Serie A', 'Italy'], [39, 'Premier League', 'England'], [140, 'La Liga', 'Spain'],
  [78, 'Bundesliga', 'Germany'], [61, 'Ligue 1', 'France'], [88, 'Eredivisie', 'Netherlands'],
  [94, 'Primeira Liga', 'Portugal'], [136, 'Serie B', 'Italy'],
];
const BOOKS = [[4, 'Pinnacle', 0.025], [8, 'Bet365', 0.06], [6, 'Bwin', 0.07], [16, 'Unibet', 0.065]];

function poissonSample(r, lambda) {
  let k = 0, p = Math.exp(-lambda), s = p;
  const u = r();
  while (u > s && k < 10) {
    k++;
    p *= lambda / k;
    s += p;
  }
  return k;
}

export function createMockClient(date) {
  const r = rng([...date].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const fixtures = [];
  const odds = [];
  const predictions = new Map();
  const day = new Date(`${date}T00:00:00Z`).getTime();

  for (let i = 0; i < 36; i++) {
    const [lid, lname, country] = LEAGUES[i % LEAGUES.length];
    const id = 900000 + Math.floor(day / 86400000) * 100 + i;
    const lh = 0.8 + r() * 1.4;
    const la = 0.6 + r() * 1.2;
    const truth = poissonProbabilities({ home: lh, away: la });
    const kickoff = new Date(day + (13 + Math.floor(r() * 9)) * 3600000).toISOString();

    fixtures.push({
      fixture: { id, date: kickoff, status: { short: 'NS' } },
      league: { id: lid, name: lname, country, season: 2026 },
      teams: { home: { name: `Casa ${i + 1}` }, away: { name: `Ospite ${i + 1}` } },
      goals: { home: null, away: null },
    });

    const bookmakers = BOOKS.map(([bid, bname, margin]) => {
      const price = (p) => Math.max(1.01, Math.round((1 / (p * (1 + margin) * (0.95 + r() * 0.1))) * 100) / 100);
      return {
        id: bid,
        name: bname,
        bets: [
          { id: 1, name: 'Match Winner', values: [['Home', '1X2|1'], ['Draw', '1X2|X'], ['Away', '1X2|2']].map(([v, k]) => ({ value: v, odd: String(price(truth[k])) })) },
          { id: 12, name: 'Double Chance', values: [['Home/Draw', 'DC|1X'], ['Home/Away', 'DC|12'], ['Draw/Away', 'DC|X2']].map(([v, k]) => ({ value: v, odd: String(price(truth[k])) })) },
          { id: 5, name: 'Goals Over/Under', values: [1.5, 2.5, 3.5].flatMap((l) => [{ value: `Over ${l}`, odd: String(price(truth[`OU|Over ${l}`])) }, { value: `Under ${l}`, odd: String(price(truth[`OU|Under ${l}`])) }]) },
          { id: 8, name: 'Both Teams Score', values: [{ value: 'Yes', odd: String(price(truth['GG|GG'])) }, { value: 'No', odd: String(price(truth['GG|NG'])) }] },
        ],
      };
    });
    odds.push({ fixture: { id }, league: { id: lid }, bookmakers });

    const noisy = (x) => (x * (0.8 + r() * 0.4)).toFixed(1);
    const form = () => Array.from({ length: 5 }, () => 'WDL'[Math.floor(r() * 3)]).join('');
    const played = 6 + Math.floor(r() * 6);
    predictions.set(id, {
      predictions: {
        advice: 'Double chance : home or draw',
        percent: { home: `${Math.round(truth['1X2|1'] * 100)}%`, draw: `${Math.round(truth['1X2|X'] * 100)}%`, away: `${Math.round(truth['1X2|2'] * 100)}%` },
      },
      teams: {
        home: { league: { form: form(), fixtures: { played: { home: played, away: played, total: played * 2 } }, goals: { for: { average: { home: noisy(lh) } }, against: { average: { home: noisy(la) } } } } },
        away: { league: { form: form(), fixtures: { played: { home: played, away: played, total: played * 2 } }, goals: { for: { average: { away: noisy(la) } }, against: { average: { away: noisy(lh) } } } } },
      },
    });

    fixtures[i].truth = { lh, la };
  }

  return {
    calls: 0,
    async get(path, params) {
      if (path === '/fixtures' && params.ids) {
        // Partite passate: risultati simulati.
        const response = params.ids.split('-').map((id) => {
          const h = poissonSample(r, 1.4), a = poissonSample(r, 1.1);
          return { fixture: { id: Number(id), status: { short: 'FT' } }, goals: { home: h, away: a }, score: { fulltime: { home: h, away: a } } };
        });
        return { response };
      }
      if (path === '/fixtures') return { response: fixtures };
      if (path === '/predictions') return { response: [predictions.get(Number(params.fixture))] };
      throw new Error(`mock: ${path} non gestito`);
    },
    async getAllPages(path, params = {}) {
      if (path === '/odds') return odds.filter((o) => !params.league || o.league.id === Number(params.league));
      throw new Error(`mock: ${path} non gestito`);
    },
  };
}
