'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { version } = require('../../../package.json');
const { handleBotInfo, _helpers } = require('./info');

test('formats uptime as days, hours and minutes', () => {
  assert.equal(_helpers.formatUptime(90061), '1d 1h 1min');
  assert.equal(_helpers.formatUptime(59), '59s');
  assert.equal(_helpers.formatUptime(-2), '0s');
});

test('sums persisted command counts from a Map or object', () => {
  assert.equal(_helpers.totalCommandsExecuted(new Map([['a', 12], ['b', 3]])), 15);
  assert.equal(_helpers.totalCommandsExecuted({ a: 7, b: '4', invalid: 'x', negative: -5 }), 11);
  assert.equal(_helpers.totalCommandsExecuted(null), 0);
});

test('!bot information includes uptime, command total, package and Node versions', async () => {
  let sent;
  let options;
  const sock = { sendMessage: async (_jid, payload, opts) => { sent = payload.text; options = opts; } };
  const msg = { key: { remoteJid: 'test@g.us' } };
  await handleBotInfo(sock, msg, 'test@g.us', new Map([['user-a', 12], ['user-b', 3]]));

  assert.match(sent, /INFORMAÇÕES DO TICO BOT/);
  assert.ok(sent.includes('\n'), 'response should contain real line breaks');
  assert.ok(!sent.includes('\\n'), 'response must not contain literal escaped newlines');
  assert.match(sent, /Tempo ativo:/);
  assert.match(sent, /Comandos executados:\* 15/);
  assert.ok(sent.includes(`Versão:* ${version}`));
  assert.ok(sent.includes(`Node.js:* ${process.version}`));
  assert.match(sent, /WhatsApp:\* (Conectado|Desconectado)/);
  assert.equal(options.quoted, msg);
});
