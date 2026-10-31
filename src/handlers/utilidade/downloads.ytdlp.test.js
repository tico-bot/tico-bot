'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  _normalizeYoutubeCookies,
  _parseYtDlpJson,
  _isYouTubeTarget,
} = require('./downloads');

const COOKIE_HEADER = '# Netscape HTTP Cookie File';
const YOUTUBE_COOKIE = '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\ttest-session-value';

test('normaliza cookies Netscape e preserva linhas HttpOnly', () => {
  const input = '\uFEFF' + COOKIE_HEADER + '\r\n' +
    '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\t__Secure-1PSID\ttest-session-value\r\n' +
    YOUTUBE_COOKIE + '\r\n';
  const output = _normalizeYoutubeCookies(input);

  assert.equal(output.endsWith('\n'), true);
  assert.equal(output.includes('\r'), false);
  assert.match(output, /#HttpOnly_\.youtube\.com/);
});

test('recusa cookies em JSON ou sem entradas do YouTube', () => {
  assert.throws(() => _normalizeYoutubeCookies('{"cookies":[]}'), /formato inválido/);
  assert.throws(() => _normalizeYoutubeCookies(COOKIE_HEADER + '\n.google.com\tTRUE\t/\tTRUE\t1893456000\tSID\tvalue'), /youtube\.com/);
  assert.throws(() => _normalizeYoutubeCookies(''), /vazio/);
});

test('lê JSON de metadados do yt-dlp mesmo com linhas de progresso', () => {
  const metadata = { id: 'abc123', title: 'Teste', duration: 125 };
  const output = '[download] concluído\n' + JSON.stringify(metadata) + '\n';
  assert.deepEqual(_parseYtDlpJson(output), metadata);
  assert.equal(_parseYtDlpJson('sem JSON'), null);
});

test('identifica pesquisas e URLs do YouTube sem classificar outros serviços', () => {
  assert.equal(_isYouTubeTarget('ytsearch1:calcinha preta official audio'), true);
  assert.equal(_isYouTubeTarget('https://www.youtube.com/watch?v=abc123'), true);
  assert.equal(_isYouTubeTarget('https://youtu.be/abc123'), true);
  assert.equal(_isYouTubeTarget('https://www.tiktok.com/@user/video/123'), false);
});
