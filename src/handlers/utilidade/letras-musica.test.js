'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  API_BASE,
  MAX_EXCERPT_CHARS,
  makeShortExcerpt,
  searchLyrics,
  handleLetraMusica,
} = require('./letras-musica');
const { PESADOS } = require('../../utils/cooldown');

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

test('searchLyrics queries LRCLIB with encoded terms and identifies the client', async () => {
  let requestUrl = '';
  let requestOptions;
  const result = await searchLyrics('Águas de Março Tom Jobim', async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return response(200, [{ trackName: 'Águas de Março', artistName: 'Tom Jobim', plainLyrics: 'Trecho da música' }]);
  });
  assert.match(requestUrl, new RegExp(`^${API_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?q=`));
  assert.match(requestUrl, /%C3%81guas%20de%20Mar%C3%A7o/);
  assert.match(requestOptions.headers['User-Agent'], /^Tico-Bot\//);
  assert.equal(result.trackName, 'Águas de Março');
});

test('makeShortExcerpt never returns more than 90 characters and strips LRC timestamps', () => {
  const excerpt = makeShortExcerpt({ plainLyrics: '[00:12.50] ' + 'á'.repeat(200) });
  assert.equal(Array.from(excerpt).length, MAX_EXCERPT_CHARS);
  assert.equal(excerpt.includes('[00:12.50]'), false);
  assert.ok(excerpt.endsWith('…'));
});

test('makeShortExcerpt handles instrumental and missing lyric fields', () => {
  assert.equal(makeShortExcerpt({ instrumental: true, plainLyrics: 'not shown' }), '');
  assert.equal(makeShortExcerpt({ plainLyrics: null, syncedLyrics: null }), '');
});

test('handleLetraMusica explains usage when no query is supplied', async () => {
  const sent = [];
  const result = await handleLetraMusica({ sendMessage: async (_jid, payload) => sent.push(payload) }, {}, 'test@g.us', '/letramúsica');
  assert.equal(result, false);
  assert.match(sent[0].text, /Ex\.: \/letramúsica Evidências/);
});

test('handleLetraMusica sends track details, a short excerpt and a search link', async () => {
  const sent = [];
  const lyrics = 'Primeira linha da música. ' + 'segunda linha '.repeat(30);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response(200, [{
    id: 7,
    trackName: 'Canção de teste',
    artistName: 'Artista Teste',
    albumName: 'Álbum Teste',
    plainLyrics: lyrics,
    instrumental: false,
  }]);
  try {
    const result = await handleLetraMusica({ sendMessage: async (_jid, payload) => sent.push(payload) }, {}, 'test@g.us', '/letramusica Canção de teste');
    assert.equal(result, true);
    assert.match(sent[0].text, /Canção de teste/);
    assert.match(sent[0].text, /Artista Teste/);
    assert.match(sent[0].text, /https:\/\/genius\.com\/search\?q=/);
    const excerpt = sent[0].text.split('*Prévia curta:*\n')[1].split('\n\n')[0];
    assert.ok(Array.from(excerpt).length <= MAX_EXCERPT_CHARS);
    assert.doesNotMatch(sent[0].text, /segunda linha segunda linha segunda linha segunda linha segunda linha/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleLetraMusica gives a friendly result when no song is found', async () => {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response(200, []);
  try {
    const result = await handleLetraMusica({ sendMessage: async (_jid, payload) => sent.push(payload) }, {}, 'test@g.us', '/letramsc música inexistente');
    assert.equal(result, false);
    assert.match(sent[0].text, /Não encontrei uma letra/);
    assert.match(sent[0].text, /genius\.com\/search/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchLyrics surfaces rate limiting without trying to parse a response body', async () => {
  await assert.rejects(() => searchLyrics('música', async () => response(429, null)), (error) => error.code === 'LYRICS_RATE_LIMITED');
});

test('lyrics aliases are covered by the heavy-command cooldown', () => {
  for (const alias of ['letramúsica', 'letramusica', 'letramsc']) assert.equal(PESADOS.has(alias), true);
});


test('searchLyrics uses Lyrics.ovh when LRCLIB is unavailable', async () => {
  const calls = [];
  const result = await searchLyrics('Coldplay Yellow', async (url) => {
    calls.push(url);
    if (calls.length === 1) return response(503, { message: 'unavailable' });
    if (calls.length === 2) return response(200, {
      data: [{ title: 'Yellow', artist: { name: 'Coldplay' }, album: { title: 'Parachutes' } }],
    });
    return response(200, { lyrics: 'Look at the stars\nLook how they shine for you\n' + 'and everything '.repeat(20) });
  });
  assert.equal(result.trackName, 'Yellow');
  assert.equal(result.artistName, 'Coldplay');
  assert.equal(result.source, 'Lyrics.ovh');
  assert.equal(calls.length, 3);
  assert.match(calls[1], /^https:\/\/api\.lyrics\.ovh\/suggest\//);
  assert.match(calls[2], /\/v1\/Coldplay\/Yellow$/);
  assert.ok(Array.from(makeShortExcerpt(result)).length <= MAX_EXCERPT_CHARS);
});

test('handleLetraMusica includes the search link when both providers fail', async () => {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response(503, {});
  try {
    const result = await handleLetraMusica({ sendMessage: async (_jid, payload) => sent.push(payload) }, {}, 'test@g.us', '/letramúsica faixa ausente');
    assert.equal(result, false);
    assert.match(sent[0].text, /Não consegui consultar a prévia/);
    assert.match(sent[0].text, /genius\.com\/search/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
