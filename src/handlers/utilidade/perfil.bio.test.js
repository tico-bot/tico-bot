'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../../models/Usuario');
const LidMapping = require('../../models/LidMapping');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const { handleBio } = require('./perfil');

const originals = {
  usuarioUpdateMany: Usuario.updateMany,
  usuarioFindOneAndUpdate: Usuario.findOneAndUpdate,
  lidFindOne: LidMapping.findOne,
  walletUpdateMany: CarteiraGrupo.updateMany,
  walletFindOneAndUpdate: CarteiraGrupo.findOneAndUpdate,
};
const pn = '5511999999999@s.whatsapp.net';
const lid = '1234567890@lid';
const group = '120363000000000000@g.us';
let globalUpdate;
let globalUpsert;
let groupUpdate;
let groupUpsert;
let lastMappingQuery;
let lastMessage;
let groupMatchedCount = 2;
let globalMatchedCount = 2;

Usuario.updateMany = async (filter, update) => {
  globalUpdate = { filter, update };
  return { modifiedCount: globalMatchedCount, matchedCount: globalMatchedCount };
};
Usuario.findOneAndUpdate = (filter, update, options) => {
  globalUpsert = { filter, update, options };
  return Promise.resolve({ idWhatsApp: pn, bio: update.$set.bio });
};
CarteiraGrupo.updateMany = async (filter, update) => {
  groupUpdate = { filter, update };
  return { modifiedCount: groupMatchedCount, matchedCount: groupMatchedCount };
};
CarteiraGrupo.findOneAndUpdate = (filter, update, options) => {
  groupUpsert = { filter, update, options };
  return Promise.resolve({ idWhatsApp: filter.idWhatsApp, idGrupo: filter.idGrupo, bio: update.$set.bio });
};
LidMapping.findOne = query => ({
  select() { return this; },
  async lean() {
    lastMappingQuery = query;
    return query.lid === lid || query.pn === pn ? { lid, pn } : null;
  },
});

test.beforeEach(() => {
  globalUpdate = null;
  globalUpsert = null;
  groupUpdate = null;
  groupUpsert = null;
  lastMappingQuery = null;
  lastMessage = null;
  groupMatchedCount = 2;
  globalMatchedCount = 2;
});
test.after(() => {
  Usuario.updateMany = originals.usuarioUpdateMany;
  Usuario.findOneAndUpdate = originals.usuarioFindOneAndUpdate;
  LidMapping.findOne = originals.lidFindOne;
  CarteiraGrupo.updateMany = originals.walletUpdateMany;
  CarteiraGrupo.findOneAndUpdate = originals.walletFindOneAndUpdate;
});

function mockSocket() {
  return { async sendMessage(_jid, content) { lastMessage = content; } };
}

test('!bio em grupo salva a bio somente nas carteiras daquele grupo e sincroniza PN/LID', async () => {
  const bio = 'Gosto de jogos e <filosofia>.';
  await handleBio(mockSocket(), {
    key: { participant: lid, participantPn: pn },
  }, group, `!bio ${bio}`);

  assert.deepEqual(lastMappingQuery, { lid });
  assert.deepEqual(groupUpdate.filter, { idGrupo: group, idWhatsApp: { $in: [lid, pn] } });
  assert.deepEqual(groupUpdate.update, { $set: { bio } });
  assert.equal(globalUpdate, null, 'a group bio must not overwrite the global bio');
  assert.equal(groupUpsert, null);
  assert.match(lastMessage.text, /Bio atualizada neste grupo/);
});

test('!bio em grupo cria uma carteira com a bio quando o usuário ainda não tem registro ali', async () => {
  groupMatchedCount = 0;
  await handleBio(mockSocket(), {
    key: { participant: lid, participantPn: pn },
  }, group, '!bio Bio desta comunidade');
  assert.deepEqual(groupUpsert.filter, { idWhatsApp: lid, idGrupo: group });
  assert.deepEqual(groupUpsert.update, { $set: { bio: 'Bio desta comunidade' } });
  assert.equal(groupUpsert.options.upsert, true);
  assert.equal(globalUpdate, null);
});

test('!bio no privado continua atualizando a bio global do usuário', async () => {
  await handleBio(mockSocket(), { key: { remoteJid: pn } }, pn, '!bio Bio global');
  assert.deepEqual(globalUpdate.filter, { idWhatsApp: { $in: [pn] } });
  assert.deepEqual(globalUpdate.update, { $set: { bio: 'Bio global' } });
  assert.equal(groupUpdate, null);
  assert.match(lastMessage.text, /Bio atualizada!/);
});

test('!bio rejeita textos acima de 150 caracteres sem escrever no banco', async () => {
  await handleBio(mockSocket(), { key: { participant: pn } }, group, `!bio ${'x'.repeat(151)}`);
  assert.equal(groupUpdate, null);
  assert.equal(groupUpsert, null);
  assert.equal(globalUpdate, null);
  assert.equal(globalUpsert, null);
  assert.match(lastMessage.text, /Bio muito longa/);
});
