'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GrupoConfig = require('./models/GrupoConfig');
const grupoHandler = require('./handlers/grupo');
const router = require('./router');

const group = '120363000000000000@g.us';
const member = '5511999999999@s.whatsapp.net';
const originals = {
  findOne: GrupoConfig.findOne,
  isAdmin: grupoHandler.isAdmin,
};

let currentConfig;
let sentMessages;
let configLookups;

function makeMessage(text) {
  return {
    key: { remoteJid: group, participant: member },
    pushName: 'Membro',
    message: { conversation: text },
  };
}

function makeSocket() {
  return {
    async sendMessage(_jid, payload) {
      sentMessages.push(payload);
      return {};
    },
    async groupParticipantsUpdate() {
      throw new Error('Não deveria remover participante neste teste.');
    },
  };
}

test.beforeEach(() => {
  currentConfig = { botAtivo: false, antiLink: true, linksPermitidos: [] };
  sentMessages = [];
  configLookups = 0;
  GrupoConfig.findOne = () => ({
    lean: async () => {
      configLookups += 1;
      return currentConfig;
    },
  });
  grupoHandler.isAdmin = async () => false;
  router.invalidateGrupoConfigCache(group);
});

test.after(() => {
  GrupoConfig.findOne = originals.findOne;
  grupoHandler.isAdmin = originals.isAdmin;
  router.invalidateGrupoConfigCache(group);
});

test('Anti-Link continua removendo links não autorizados quando /bot off está ativo', async () => {
  const msg = makeMessage('Confiram isto: https://site-malicioso.example.com/oferta');

  await router.handleMessage(makeSocket(), msg);

  assert.equal(configLookups, 1, 'deve ler a configuração do grupo');
  assert.equal(sentMessages.length, 2, 'deve apagar a mensagem e avisar o grupo');
  assert.deepEqual(sentMessages[0].delete, msg.key);
  assert.match(sentMessages[1].text, /removida pelo Anti-Link/);
});

test('com /bot off, comandos continuam desligados mesmo que não haja link', async () => {
  await router.handleMessage(makeSocket(), makeMessage('!menu'));

  assert.deepEqual(sentMessages, []);
});

test('com /bot off e Anti-Link desativado, links não são moderados', async () => {
  currentConfig = { botAtivo: false, antiLink: false, linksPermitidos: [] };
  router.invalidateGrupoConfigCache(group);

  await router.handleMessage(makeSocket(), makeMessage('https://site-malicioso.example.com/oferta'));

  assert.deepEqual(sentMessages, []);
});
