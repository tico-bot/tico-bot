'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validDate,
  parseGameArgs,
  formatInternationalStandings,
  formatBrazilianRound,
  formatMatches,
  helpText,
  getApiBaseUrl,
  directFootballDataPath,
  resolveFootballAlias
} = require('./futebol-api');

test('validDate accepts valid ISO dates and rejects invalid calendar dates', () => {
  assert.equal(validDate('2026-10-28'), true);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('28/10/2026'), false);
});

test('parseGameArgs supports competition codes and explicit date ranges', () => {
  assert.deepEqual(parseGameArgs(['PL', '2026-10-28', '2026-10-29']), {
    code: 'PL', dateFrom: '2026-10-28', dateTo: '2026-10-29'
  });
  assert.deepEqual(parseGameArgs(['2026-10-28']), {
    code: undefined, dateFrom: '2026-10-28', dateTo: '2026-10-28'
  });
});

test('international standings format club stats as a readable WhatsApp table', () => {
  const text = formatInternationalStandings({
    competition: { name: 'Premier League' },
    season: { startDate: '2026-08-01' },
    standings: [{
      type: 'TOTAL',
      group: 'Matchday',
      table: [{
        position: 1, team: { name: 'Arsenal', shortName: 'Arsenal' },
        points: 24, playedGames: 10, won: 8, draw: 0, lost: 2, goalDifference: 15
      }]
    }]
  }, 'PL');
  assert.match(text, /Premier League/);
  assert.match(text, /Arsenal/);
  assert.match(text, /24 pts/);
  assert.doesNotMatch(text, /Matchday/);
  assert.match(text, /8V \| 0E \| 2D/);
});

test('match formatter handles scheduled matches and empty schedules', () => {
  const empty = formatMatches({ matches: [] });
  assert.match(empty, /Não encontrei jogos/);
  const text = formatMatches({
    matches: [{
      utcDate: '2026-10-28T19:00:00Z',
      status: 'FINISHED',
      homeTeam: { name: 'Arsenal', shortName: 'Arsenal' },
      awayTeam: { name: 'Chelsea', shortName: 'Chelsea' },
      score: { fullTime: { home: 2, away: 1 } },
      competition: { name: 'Premier League' }
    }]
  });
  assert.match(text, /Arsenal/);
  assert.match(text, /2 × 1/);
  assert.match(text, /PREMIER LEAGUE/);
});

test('Brazilian round formatter presents matches and score safely', () => {
  const text = formatBrazilianRound({
    rounds: [{
      number: 33, label: '33ª rodada',
      matches: [{
        date: '2026-10-28', time: '19:30', status: 'scheduled',
        homeTeam: { name: 'Fluminense', shortName: 'FLU' },
        awayTeam: { name: 'Internacional', shortName: 'INT' },
        score: { home: null, away: null }, venue: 'Maracanã'
      }]
    }]
  }, 'A');
  assert.match(text, /SÉRIE A/);
  assert.match(text, /FLU vs INT/);
  assert.match(text, /28\/10\/2026 às 19:30/);
  assert.match(text, /Maracanã/);
});

test('football help includes commands for tables, fixtures and scorers', () => {
  const text = helpText('.');
  assert.match(text, /\.brasileirao/);
  assert.match(text, /\.brasileiraojg/);
  assert.match(text, /\.classificacao PL/);
  assert.match(text, /\.jogos/);
  assert.match(text, /\.artilheiros/);
});

test('league aliases recognise configured prefixes and distinguish standings from fixtures', () => {
  assert.deepEqual(resolveFootballAlias('/champions', ['!', '.', '/', ',']), { code: 'CL', action: 'standings' });
  assert.deepEqual(resolveFootballAlias('!premier', ['!', '.', '/', ',']), { code: 'PL', action: 'standings' });
  assert.deepEqual(resolveFootballAlias('.championsjg', ['!', '.', '/', ',']), { code: 'CL', action: 'matches' });
  assert.deepEqual(resolveFootballAlias('/bundesligajg', ['!', '.', '/', ',']), { code: 'BL1', action: 'matches' });
  assert.deepEqual(resolveFootballAlias('/brasileirao', ['!', '.', '/', ',']), { code: 'A', action: 'brazilian-standings' });
  assert.deepEqual(resolveFootballAlias('/brasileirão', ['!', '.', '/', ',']), { code: 'A', action: 'brazilian-standings' });
  assert.deepEqual(resolveFootballAlias('/brasileiraojg', ['!', '.', '/', ',']), { code: 'A', action: 'brazilian-matches' });
  assert.deepEqual(resolveFootballAlias('/brasileirãojg', ['!', '.', '/', ',']), { code: 'A', action: 'brazilian-matches' });
  assert.equal(resolveFootballAlias('/naoliga', ['!', '.', '/', ',']), null);
});

test('direct fallback maps competition and matches URLs to football-data.org v4', () => {
  assert.equal(directFootballDataPath('/api/futebol/competitions/CL/standings'), '/v4/competitions/CL/standings');
  assert.equal(directFootballDataPath('/api/futebol/competitions/PL/scorers?limit=5'), '/v4/competitions/PL/scorers?limit=5');
  assert.equal(directFootballDataPath('/api/futebol/matches?dateFrom=2026-10-28&dateTo=2026-10-29&competitions=PL'), '/v4/matches?dateFrom=2026-10-28&dateTo=2026-10-29&competitions=PL');
  assert.equal(directFootballDataPath('/api/brasileirao/A/standings'), null);
});

test('API URL can be configured for local and hosted environments', () => {
  const before = process.env.FUTEBOL_API_URL;
  process.env.FUTEBOL_API_URL = 'https://example.test/';
  assert.equal(getApiBaseUrl(), 'https://example.test');
  process.env.FUTEBOL_API_URL = 'http://127.0.0.1:3100';
  assert.equal(getApiBaseUrl(), 'https://brasileirao-api-dczc.onrender.com');
  if (before === undefined) delete process.env.FUTEBOL_API_URL;
  else process.env.FUTEBOL_API_URL = before;
});


test('network failure uses configured provider fallback for international competitions', async () => {
  const { spawnSync } = require('node:child_process');
  const script = String.raw`
    const assert = require('node:assert/strict');
    const football = require('./src/handlers/futebol-api');
    process.env.FOOTBALL_DATA_API_KEY = 'unit-test-key';
    process.env.FUTEBOL_API_URL = 'https://unreachable.invalid';
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      if (String(url).startsWith('https://unreachable.invalid/')) throw new TypeError('fetch failed');
      assert.equal(String(url), 'https://api.football-data.org/v4/competitions/PL/standings');
      assert.equal(options.headers['X-Auth-Token'], 'unit-test-key');
      return { ok: true, status: 200, json: async () => ({ competition: { name: 'Premier League' }, standings: [{ table: [{ position: 1, team: { name: 'Arsenal' }, points: 3 }] }] }) };
    };
    football.requestApi('/api/futebol/competitions/PL/standings').then(data => {
      assert.equal(data.competition.name, 'Premier League');
      assert.equal(calls, 2);
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
