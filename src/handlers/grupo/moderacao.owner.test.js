'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LidMapping = require('../../models/LidMapping');
const { handlePromoverRebaixar, handleBan } = require('./moderacao');

const group = '120363000000000000@g.us';
const owner = '5565993354137@s.whatsapp.net';
const target = '5511999999999@s.whatsapp.net';

test('ADM+ pode promover mesmo sem ser participante ou administrador do grupo', async () => {
  const originalFindOne = LidMapping.findOne;
  const updates = [];
  const replies = [];
  LidMapping.findOne = () => ({ lean: async () => null });

  const sock = {
    async groupMetadata() {
      return { participants: [{ id: '5511888888888@s.whatsapp.net', admin: 'admin' }] };
    },
    async groupParticipantsUpdate(jid, jids, action) {
      updates.push({ jid, jids, action });
    },
    async sendMessage(_jid, payload) { replies.push(payload); },
  };
  const msg = {
    key: { remoteJid: group, participant: owner },
    message: {},
  };
  const content = {
    extendedTextMessage: {
      text: '/promover @5511999999999',
      contextInfo: { mentionedJid: [target] },
    },
  };

  try {
    await handlePromoverRebaixar(sock, msg, content, group, 'promote', '5511777777777@s.whatsapp.net', {});
    assert.deepEqual(updates, [{ jid: group, jids: [target], action: 'promote' }]);
    assert.match(replies.at(-1).text, /foi promovido\(a\) a admin/);
  } finally {
    LidMapping.findOne = originalFindOne;
  }
});

test('ADM+ consegue executar /ban sem erro de variável de identidade e não pode banir a si mesmo', async () => {
  const updates = [];
  const replies = [];
  const sock = {
    async sendMessage(_jid, payload) { replies.push(payload); },
    async groupParticipantsUpdate(jid, jids, action) { updates.push({ jid, jids, action }); },
  };
  const msg = {
    key: { remoteJid: group, participant: owner },
    message: {
      extendedTextMessage: {
        text: '/ban @5511999999999',
        contextInfo: { mentionedJid: [target] },
      },
    },
  };

  await handleBan(sock, msg, msg.message, group, '5511777777777@s.whatsapp.net', {});
  assert.deepEqual(updates, [{ jid: group, jids: [target], action: 'remove' }]);

  updates.length = 0;
  replies.length = 0;
  msg.message.extendedTextMessage.contextInfo.mentionedJid = [owner];
  await handleBan(sock, msg, msg.message, group, '5511777777777@s.whatsapp.net', {});
  assert.deepEqual(updates, []);
  assert.match(replies.at(-1).text, /Você não pode banir a si mesmo/);
});
