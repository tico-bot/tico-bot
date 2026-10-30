'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GrupoConfig = require('../../models/GrupoConfig');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const router = require('../../router');
const { handleBotToggle } = require('./configuracao');

const group = '120363000000000000@g.us';
const msg = { key: { remoteJid: group, participant: '5511999999999@s.whatsapp.net' } };
const originals = {
  findOne: GrupoConfig.findOne,
  groupConfigUpdate: GrupoConfig.findOneAndUpdate,
  walletsUpdate: CarteiraGrupo.updateMany,
  invalidate: router.invalidateGrupoConfigCache,
};

let currentConfig;
let configUpdate;
let walletsUpdate;
let invalidated;
let response;

GrupoConfig.findOne = () => ({ lean: async () => currentConfig });
GrupoConfig.findOneAndUpdate = async (...args) => {
  configUpdate = args;
  currentConfig = { ...currentConfig, botAtivo: args[1].$set.botAtivo };
  return {};
};
CarteiraGrupo.updateMany = async (...args) => {
  walletsUpdate = args;
  return { modifiedCount: 1 };
};
router.invalidateGrupoConfigCache = jid => { invalidated = jid; };

test.beforeEach(() => {
  currentConfig = { botAtivo: true };
  configUpdate = null;
  walletsUpdate = null;
  invalidated = null;
  response = null;
});

test.after(() => {
  GrupoConfig.findOne = originals.findOne;
  GrupoConfig.findOneAndUpdate = originals.groupConfigUpdate;
  CarteiraGrupo.updateMany = originals.walletsUpdate;
  router.invalidateGrupoConfigCache = originals.invalidate;
});

function socket() {
  return { async sendMessage(_jid, payload) { response = payload; } };
}

test('bot off saves the disabled state and immediately invalidates the router cache', async () => {
  await handleBotToggle(socket(), msg, group, 'off', true);

  assert.deepEqual(configUpdate, [
    { idGrupo: group },
    { $set: { idGrupo: group, botAtivo: false } },
    { upsert: true },
  ]);
  assert.deepEqual(walletsUpdate, [
    { idGrupo: group },
    { $set: { 'config.botAtivo': false, botAtivo: false } },
  ]);
  assert.equal(invalidated, group);
  assert.match(response.text, /Bot desligado neste grupo/);
});

test('bot on restores the enabled state and immediately invalidates the router cache', async () => {
  currentConfig = { botAtivo: false };
  await handleBotToggle(socket(), msg, group, 'on', true);

  assert.deepEqual(configUpdate[1], { $set: { idGrupo: group, botAtivo: true } });
  assert.deepEqual(walletsUpdate, [
    { idGrupo: group },
    { $set: { 'config.botAtivo': true, botAtivo: true } },
  ]);
  assert.equal(invalidated, group);
  assert.match(response.text, /Bot ligado neste grupo/);
});

test('non-admins cannot change the group bot state', async () => {
  await handleBotToggle(socket(), msg, group, 'off', false);

  assert.equal(configUpdate, null);
  assert.equal(walletsUpdate, null);
  assert.equal(invalidated, null);
  assert.match(response.text, /Apenas admins/);
});
