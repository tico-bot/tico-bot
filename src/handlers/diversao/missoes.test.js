'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Usuario = require('../../models/Usuario');
const carteira = require('../../utils/carteira');

const originalFindOne = Usuario.findOne;
const originalFindOneAndUpdate = Usuario.findOneAndUpdate;
const originalStartSession = mongoose.startSession;
const originalAlterarGold = carteira.alterarGold;

function makeMissionState(getTodayStr) {
  return {
    date: getTodayStr(),
    progress: { xp100: 100, msg50: 0, quiz5: 0, gold500: 0, pet10: 0, roubo3: 0 },
    completed: { xp100: true, msg50: false, quiz5: false, gold500: false, pet10: false, roubo3: false },
    claimed: { xp100: false, msg50: false, quiz5: false, gold500: false, pet10: false, roubo3: false },
  };
}

function setupSuccessfulClaim(t) {
  const { getTodayStr } = require('./missoes');
  const state = makeMissionState(getTodayStr);
  let claimFilter;
  let claimUpdate;
  let claimOptions;
  let walletArgs;
  let transactionCalls = 0;
  let sessionEnded = false;
  const session = {
    async withTransaction(callback) {
      transactionCalls++;
      await callback();
    },
    async endSession() { sessionEnded = true; },
  };

  Usuario.findOne = () => ({ lean: async () => ({ dailyMissions: state }) });
  Usuario.findOneAndUpdate = async (filter, update, options) => {
    claimFilter = filter;
    claimUpdate = update;
    claimOptions = options;
    return { idWhatsApp: '123456789012345@lid', dailyMissions: state };
  };
  mongoose.startSession = async () => session;
  carteira.alterarGold = async (...args) => {
    walletArgs = args;
    return { idWhatsApp: args[0], idGrupo: args[1], gold: 250 };
  };

  t.after(() => {
    Usuario.findOne = originalFindOne;
    Usuario.findOneAndUpdate = originalFindOneAndUpdate;
    mongoose.startSession = originalStartSession;
    carteira.alterarGold = originalAlterarGold;
  });

  return {
    get claimFilter() { return claimFilter; },
    get claimUpdate() { return claimUpdate; },
    get claimOptions() { return claimOptions; },
    get walletArgs() { return walletArgs; },
    get transactionCalls() { return transactionCalls; },
    get sessionEnded() { return sessionEnded; },
  };
}

test('mission reward is credited to the current group wallet in the same transaction as claiming', async t => {
  const state = setupSuccessfulClaim(t);
  const { handleMissao } = require('./missoes');
  const sent = [];
  const sock = { async sendMessage(...args) { sent.push(args); } };
  const msg = { key: { participant: '123456789012345@lid', remoteJid: '120363000000000000@g.us' } };

  await handleMissao(sock, msg, '120363000000000000@g.us', '!missao xp100', () => '!');

  assert.equal(state.transactionCalls, 1);
  assert.equal(state.sessionEnded, true);
  assert.equal(state.walletArgs[0], '123456789012345@lid');
  assert.equal(state.walletArgs[1], '120363000000000000@g.us');
  assert.equal(state.walletArgs[2], 50);
  assert.match(state.walletArgs[3], /Recompensa da missão/);
  assert.ok(state.walletArgs[4].session, 'wallet credit must use the transaction session');
  assert.equal(state.claimOptions.session, state.walletArgs[4].session);
  assert.equal(state.claimUpdate.$inc, undefined, 'mission claim must not increment legacy Usuario.gold');
  assert.equal(state.claimFilter['dailyMissions.claimed.xp100'].$ne, true);
  assert.match(sent[0][1].text, /Seu saldo atual em Prata: \*250 prata\*/);
});

test('mission reward cannot be claimed from a private chat', async () => {
  const { getTodayStr } = require('./missoes');
  const state = makeMissionState(getTodayStr);
  let sessionStarted = false;
  let walletCalled = false;
  Usuario.findOne = () => ({ lean: async () => ({ dailyMissions: state }) });
  mongoose.startSession = async () => { sessionStarted = true; throw new Error('must not start a transaction'); };
  carteira.alterarGold = async () => { walletCalled = true; };
  const { handleMissao } = require('./missoes');
  const sent = [];
  const sock = { async sendMessage(...args) { sent.push(args); } };
  const msg = { key: { participant: '123456789012345@lid', remoteJid: '123456789012345@s.whatsapp.net' } };

  try {
    await handleMissao(sock, msg, '123456789012345@s.whatsapp.net', '!missao xp100', () => '!');
    assert.equal(sessionStarted, false);
    assert.equal(walletCalled, false);
    assert.match(sent[0][1].text, /dentro do grupo/);
  } finally {
    Usuario.findOne = originalFindOne;
    Usuario.findOneAndUpdate = originalFindOneAndUpdate;
    mongoose.startSession = originalStartSession;
    carteira.alterarGold = originalAlterarGold;
  }
});
