'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAlternateSenderJids, registrarLidEMapping } = require('./identity');
const { isAdmin } = require('../handlers/grupo/helpers');
const grupoHandler = require('../handlers/grupo');
const router = require('../router');

test('extrai e normaliza o JID telefônico alternativo em mensagens LID', () => {
  const result = getAlternateSenderJids({
    key: {
      participant: '123456789012345@lid',
      participantPn: '5565993354137:4@s.whatsapp.net',
      remoteJidPn: '5565993354137@s.whatsapp.net',
    },
  });
  assert.deepEqual(result, ['5565993354137@s.whatsapp.net']);
});

test('ignora aliases ausentes ou inválidos', () => {
  assert.deepEqual(getAlternateSenderJids({ key: { participant: '123@lid', participantPn: '' } }), []);
  assert.deepEqual(getAlternateSenderJids(null), []);
});

test('extrai a identidade do ADM supremo quando o Baileys v2 informa o telefone em senderPn', async () => {
  const group = '120363000000000000@g.us';
  const lid = '123456789012345@lid';
  const msg = {
    key: {
      remoteJid: group,
      participant: lid,
      senderPn: '5565993354137@s.whatsapp.net',
      senderLid: lid,
      participantLid: lid,
    },
  };

  const aliases = getAlternateSenderJids(msg);
  assert.ok(aliases.includes('5565993354137@s.whatsapp.net'));
  assert.equal(await isAdmin(null, group, lid, aliases), true);
});

test('persiste o par PN/LID quando o Baileys v2 entrega o telefone em senderPn', async () => {
  const LidMapping = require('../models/LidMapping');
  const Usuario = require('../models/Usuario');
  const originalMappingUpdate = LidMapping.updateOne;
  const originalUsuarioUpdate = Usuario.updateOne;
  const updates = [];
  let mappingUpdate;

  LidMapping.updateOne = async (...args) => { mappingUpdate = args; return {}; };
  Usuario.updateOne = async (...args) => { updates.push(args); return {}; };

  try {
    await registrarLidEMapping({
      key: {
        remoteJid: '120363000000000000@g.us',
        participant: '123456789012345@lid',
        senderPn: '5565993354137@s.whatsapp.net',
        senderLid: '123456789012345@lid',
      },
    }, 'ADM Supremo');

    assert.deepEqual(mappingUpdate, [
      { lid: '123456789012345@lid' },
      { $set: { pn: '5565993354137@s.whatsapp.net' } },
      { upsert: true },
    ]);
    assert.equal(updates.length, 2);
    assert.equal(updates[0][1].$set.telefone, '5565993354137');
  } finally {
    LidMapping.updateOne = originalMappingUpdate;
    Usuario.updateOne = originalUsuarioUpdate;
  }
});

test('roteador autoriza /bot off do ADM supremo quando o Baileys v2 envia senderPn', async () => {
  const LidMapping = require('../models/LidMapping');
  const Usuario = require('../models/Usuario');
  const originalMappingUpdate = LidMapping.updateOne;
  const originalUsuarioUpdate = Usuario.updateOne;
  const originalHandleBotToggle = grupoHandler.handleBotToggle;
  let argsRecebidos;

  LidMapping.updateOne = async () => ({});
  Usuario.updateOne = async () => ({});
  grupoHandler.handleBotToggle = async (...args) => { argsRecebidos = args; };

  try {
    const group = '120363000000000000@g.us';
    const lid = '123456789012345@lid';
    const ownerPn = '5565993354137@s.whatsapp.net';
    const msg = {
      key: {
        remoteJid: group,
        participant: lid,
        senderPn: ownerPn,
        senderLid: lid,
        participantLid: lid,
      },
      pushName: 'ADM Supremo',
      message: { conversation: '/bot off' },
    };

    await router.handleMessage({ async sendMessage() {} }, msg);

    assert.ok(argsRecebidos, 'o roteador deve encaminhar /bot off ao handler');
    assert.equal(argsRecebidos[2], group);
    assert.equal(argsRecebidos[3], 'off');
    assert.equal(argsRecebidos[4], true, 'o ADM supremo deve passar na autorização global');
  } finally {
    LidMapping.updateOne = originalMappingUpdate;
    Usuario.updateOne = originalUsuarioUpdate;
    grupoHandler.handleBotToggle = originalHandleBotToggle;
  }
});

test('preserva aliases de telefone em dígitos quando o provedor não inclui domínio', () => {
  const result = getAlternateSenderJids({
    key: {
      participant: '123456789012345@lid',
      participantPn: '5565993354137',
    },
  });
  assert.deepEqual(result, ['5565993354137']);
});
