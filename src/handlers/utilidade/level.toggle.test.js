'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GrupoConfig = require('../../models/GrupoConfig');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const router = require('../../router');
const { handleLevelToggle } = require('./level');

const group = '120363000000000000@g.us';
const msg = { key: { remoteJid: group, participant: '5511999999999@s.whatsapp.net' } };
const originals = {
  groupConfigUpdate: GrupoConfig.findOneAndUpdate,
  walletsUpdate: CarteiraGrupo.updateMany,
  invalidate: router.invalidateGrupoConfigCache,
};
let updateConfig;
let updateWallets;
let invalidated;
let response;

GrupoConfig.findOneAndUpdate = async (...args) => { updateConfig = args; return {}; };
CarteiraGrupo.updateMany = async (...args) => { updateWallets = args; return { modifiedCount: 3 }; };
router.invalidateGrupoConfigCache = jid => { invalidated = jid; };

test.beforeEach(() => {
  updateConfig = null;
  updateWallets = null;
  invalidated = null;
  response = null;
});
test.after(() => {
  GrupoConfig.findOneAndUpdate = originals.groupConfigUpdate;
  CarteiraGrupo.updateMany = originals.walletsUpdate;
  router.invalidateGrupoConfigCache = originals.invalidate;
});
function socket() { return { async sendMessage(_jid, payload) { response = payload; } }; }

test('level on enables group XP and synchronizes the admin panel config', async () => {
  await handleLevelToggle(socket(), msg, group, 'ON', true);
  assert.deepEqual(updateConfig, [
    { idGrupo: group },
    { $set: { idGrupo: group, xpAtivo: true } },
    { upsert: true, new: true },
  ]);
  assert.deepEqual(updateWallets, [{ idGrupo: group }, { $set: { 'config.xpAtivo': true } }]);
  assert.equal(invalidated, group);
  assert.match(response.text, /Sistema de level ativado/);
});

test('level off disables group XP without deleting existing progress', async () => {
  await handleLevelToggle(socket(), msg, group, 'off', true);
  assert.deepEqual(updateConfig[1], { $set: { idGrupo: group, xpAtivo: false } });
  assert.deepEqual(updateWallets, [{ idGrupo: group }, { $set: { 'config.xpAtivo': false } }]);
  assert.match(response.text, /XP e os níveis já conquistados foram preservados/);
});

test('only group administrators can change level settings', async () => {
  await handleLevelToggle(socket(), msg, group, 'on', false);
  assert.equal(updateConfig, null);
  assert.equal(updateWallets, null);
  assert.match(response.text, /Apenas administradores/);
});

test('level on/off rejects direct messages and displays help for invalid actions', async () => {
  const privateJid = '5511999999999@s.whatsapp.net';
  await handleLevelToggle(socket(), msg, privateJid, 'on', true);
  assert.match(response.text, /só pode ser usado em grupos/);
  assert.equal(updateConfig, null);

  await handleLevelToggle(socket(), msg, group, 'talvez', true);
  assert.match(response.text, /SISTEMA DE LEVEL — ON\/OFF/);
  assert.equal(updateConfig, null);
});
