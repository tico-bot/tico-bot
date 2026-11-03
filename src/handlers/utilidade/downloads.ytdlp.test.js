'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  _normalizeYoutubeCookies,
  _parseYtDlpJson,
  _isYouTubeTarget,
  _getYtDlpUserError,
  _findPendingMusicForMessage,
  _storePendingMusicForMessage,
  _createYoutubeCookieContext,
  _argsWithoutYoutubeCookies,
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


test('diferencia limite de requisições HTTP 429 de acesso negado HTTP 403', () => {
  assert.match(_getYtDlpUserError('HTTP Error 429: Too Many Requests', 'fallback'), /limite de requisições/);
  assert.match(_getYtDlpUserError('ERROR: HTTP Error 403: Forbidden', 'fallback'), /recusou o acesso ao áudio/);
});

test('mantém mensagem específica quando o YouTube exige autenticação', () => {
  assert.match(_getYtDlpUserError('Sign in to confirm you are not a bot', 'fallback'), /recusou a autenticação/);
});


test('localiza a música pendente quando o WhatsApp alterna entre LID e telefone', () => {
  const pendingMusic = new Map();
  const pending = { titulo: 'Música de teste', audioBuffer: Buffer.from('audio') };
  const lidMessage = {
    key: {
      participant: '123456789012345@lid',
      participantPn: '5565993354137:4@s.whatsapp.net',
    },
  };
  const phoneMessage = {
    key: { participant: '5565993354137@s.whatsapp.net' },
  };

  _storePendingMusicForMessage(pendingMusic, lidMessage, pending, 60_000);
  assert.equal(_findPendingMusicForMessage(pendingMusic, phoneMessage), pending);
});

test('normaliza o identificador do remetente quando muda o sufixo do dispositivo', () => {
  const pendingMusic = new Map();
  const pending = { titulo: 'Outra música', audioBuffer: Buffer.from('audio') };
  const firstMessage = { key: { participant: '5565993354137:4@s.whatsapp.net' } };
  const nextMessage = { key: { participant: '5565993354137@s.whatsapp.net' } };

  _storePendingMusicForMessage(pendingMusic, firstMessage, pending, 60_000);
  assert.equal(_findPendingMusicForMessage(pendingMusic, nextMessage), pending);
});

test('a expiração antiga não apaga uma música mais recente do mesmo remetente', async () => {
  const pendingMusic = new Map();
  const msg = { key: { participant: '5565993354137@s.whatsapp.net' } };
  const older = { titulo: 'Antiga' };
  const newer = { titulo: 'Nova' };

  _storePendingMusicForMessage(pendingMusic, msg, older, 20);
  await new Promise(resolve => setTimeout(resolve, 5));
  _storePendingMusicForMessage(pendingMusic, msg, newer, 60_000);
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(_findPendingMusicForMessage(pendingMusic, msg), newer);
});


test('playdoc recupera a música guardada pela identidade LID/telefone e envia o documento', async () => {
  const downloads = require('./downloads');
  const pendingMusic = new Map();
  const audioBuffer = Buffer.from('audio-de-teste');
  const pending = {
    audioBuffer,
    titulo: 'Música de teste',
    nome: 'busca de teste',
    meta: { title: 'Música de teste', webpage_url: 'https://www.youtube.com/watch?v=abc123' },
  };
  const messageOriginal = {
    key: {
      remoteJid: '120363000000000000@g.us',
      participant: '123456789012345@lid',
      participantPn: '5565993354137@s.whatsapp.net',
    },
  };
  const messagePlayDoc = {
    key: {
      remoteJid: '120363000000000000@g.us',
      participant: '5565993354137:4@s.whatsapp.net',
    },
  };
  const sent = [];
  const sock = {
    sendMessage: async (_jid, content, options) => {
      sent.push({ content, options });
      return {};
    },
  };

  _storePendingMusicForMessage(pendingMusic, messageOriginal, pending, 60_000);
  await downloads.handlePlayDoc(sock, messagePlayDoc, '120363000000000000@g.us', () => '/', pendingMusic);

  const documentMessage = sent.find(item => item.content.document);
  assert.ok(documentMessage, 'playdoc deveria enviar uma mensagem de documento');
  assert.equal(documentMessage.content.document, audioBuffer);
  assert.equal(documentMessage.content.mimetype, 'audio/mpeg');
  assert.equal(documentMessage.content.fileName, 'Msica_de_teste.mp3');
  assert.ok(sent.some(item => item.content.react?.text === '✅'));
});


test('reutiliza os cookies do YouTube no contexto do playmp4 e remove o ficheiro temporário', () => {
  const previousCookies = process.env.YOUTUBE_COOKIES;
  const cookieFixture = COOKIE_HEADER + '\n' + YOUTUBE_COOKIE;
  process.env.YOUTUBE_COOKIES = cookieFixture;
  const id = 'test-playmp4-cookie-context';
  const context = _createYoutubeCookieContext(id);

  try {
    assert.equal(context.cookieArgs.length, 2);
    assert.equal(context.cookieArgs[0], '--cookies');
    const fs = require('node:fs');
    assert.equal(fs.readFileSync(context.cookieArgs[1], 'utf8'), cookieFixture + '\n');
    context.cleanup();
    assert.equal(fs.existsSync(context.cookieArgs[1]), false);
  } finally {
    context.cleanup();
    if (previousCookies === undefined) delete process.env.YOUTUBE_COOKIES;
    else process.env.YOUTUBE_COOKIES = previousCookies;
  }
});

test('remove apenas os argumentos de cookies ao preparar uma tentativa sem sessão', () => {
  const args = ['--no-playlist', '--cookies', '/tmp/session.txt', '-o', 'out.mp4', 'https://youtube.com/watch?v=abc'];
  assert.deepEqual(_argsWithoutYoutubeCookies(args), ['--no-playlist', '-o', 'out.mp4', 'https://youtube.com/watch?v=abc']);
});
