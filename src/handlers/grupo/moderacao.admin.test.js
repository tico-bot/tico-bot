'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleBan,
  handleMute,
  handleDesmute,
  handlePromoverRebaixar,
} = require('./moderacao');

const group = '120363111111111111@g.us';
const admin = '5511888888888@s.whatsapp.net';
const target = '5511999999999@s.whatsapp.net';
const bot = '5511777777777@s.whatsapp.net';

function makeHarness(participants = [
  { id: admin, admin: 'admin' },
  { id: target, admin: null },
]) {
  global._groupMetadataCache?.delete(group);
  const updates = [];
  const replies = [];
  const sock = {
    async groupMetadata() { return { participants }; },
    async groupParticipantsUpdate(jid, jids, action) {
      updates.push({ jid, jids, action });
    },
    async sendMessage(_jid, payload) { replies.push(payload); },
  };
  const msg = {
    key: { remoteJid: group, participant: admin },
    message: {},
  };
  const content = {
    extendedTextMessage: {
      text: '',
      contextInfo: { mentionedJid: [target] },
    },
  };
  return { sock, msg, content, updates, replies };
}

test('ADM comum pode usar /promover sem autorização especial e não é rebaixado', async () => {
  const h = makeHarness();
  h.content.extendedTextMessage.text = '/promover @5511999999999';

  await handlePromoverRebaixar(h.sock, h.msg, h.content, group, 'promote', bot, {});

  assert.deepEqual(h.updates, [{ jid: group, jids: [target], action: 'promote' }]);
  assert.match(h.replies.at(-1).text, /foi promovido\(a\) a admin/);
  assert.equal(h.updates.some(update => update.jids.includes(admin) && update.action === 'demote'), false);
  assert.equal(h.replies.some(reply => /sem permissão especial|rebaixado automaticamente/.test(reply.text || '')), false);
});

test('ADM comum pode usar /rebaixar', async () => {
  const h = makeHarness([
    { id: admin, admin: 'admin' },
    { id: target, admin: 'admin' },
  ]);
  h.content.extendedTextMessage.text = '/rebaixar @5511999999999';

  await handlePromoverRebaixar(h.sock, h.msg, h.content, group, 'demote', bot, {});

  assert.deepEqual(h.updates, [{ jid: group, jids: [target], action: 'demote' }]);
  assert.match(h.replies.at(-1).text, /perdeu o admin/);
});

test('ADM comum pode usar /mute e /desmute', async () => {
  const h = makeHarness();
  h.content.extendedTextMessage.text = '/mute @5511999999999';
  await handleMute(h.sock, h.msg, h.content, group, bot, {});
  assert.match(h.replies.at(-1).text, /foi mutado/);

  h.content.extendedTextMessage.text = '/desmute @5511999999999';
  await handleDesmute(h.sock, h.msg, h.content, group, bot, {});
  assert.match(h.replies.at(-1).text, /foi desmutado/);
});

test('ADM comum pode usar /ban', async () => {
  const h = makeHarness();
  h.content.extendedTextMessage.text = '/ban @5511999999999';

  await handleBan(h.sock, h.msg, h.content, group, bot, {});

  assert.deepEqual(h.updates, [{ jid: group, jids: [target], action: 'remove' }]);
});

test('membro comum continua sem permissão para /promover', async () => {
  const nonAdmin = '5511666666666@s.whatsapp.net';
  const h = makeHarness([
    { id: nonAdmin, admin: null },
    { id: target, admin: null },
  ]);
  h.msg.key.participant = nonAdmin;
  h.content.extendedTextMessage.text = '/promover @5511999999999';

  await handlePromoverRebaixar(h.sock, h.msg, h.content, group, 'promote', bot, {});

  assert.deepEqual(h.updates, []);
  assert.match(h.replies.at(-1).text, /Apenas admins podem usar/);
});
