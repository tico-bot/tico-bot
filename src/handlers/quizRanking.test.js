'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const {
  enviarAviso,
  executarPremiacao,
  PREMIOS_PRATA,
} = require('./quizRanking');

const groupJid = '120363000000000000@g.us';

test('aviso de uma hora anuncia os três prémios em Prata, não em reais', async () => {
  const sent = [];
  const sock = {
    async sendMessage(jid, payload) {
      sent.push({ jid, payload });
    },
  };

  await enviarAviso(sock, new Set([groupJid]), '60min');

  assert.equal(sent.length, 1);
  const texto = sent[0].payload.text;
  assert.match(texto, /🥇 \+1\.000 Prata/);
  assert.match(texto, /🥈 \+500 Prata/);
  assert.match(texto, /🥉 \+350 Prata/);
  assert.doesNotMatch(texto, /R\$|reais?/i);
});

test('premiação dominical credita Prata e registra cada recebimento no extrato', async t => {
  const top3 = [
    { idWhatsApp: '5511999999991@s.whatsapp.net', quizPoints: 120 },
    { idWhatsApp: '5511999999992@s.whatsapp.net', quizPoints: 90 },
    { idWhatsApp: '5511999999993@s.whatsapp.net', quizPoints: 60 },
  ];
  const atualizacoes = [];
  const mensagens = [];

  t.mock.method(CarteiraGrupo, 'find', () => ({
    sort() { return this; },
    limit() { return this; },
    async lean() { return top3; },
  }));
  t.mock.method(CarteiraGrupo, 'findOneAndUpdate', async (...args) => {
    atualizacoes.push(args);
    return {};
  });
  t.mock.method(CarteiraGrupo, 'updateMany', async () => ({ modifiedCount: 0 }));

  const sock = {
    getName(jid) { return `Jogador ${jid.slice(-1)}`; },
    async sendMessage(jid, payload) {
      mensagens.push({ jid, payload });
    },
  };

  await executarPremiacao(sock, new Set([groupJid]));

  assert.equal(PREMIOS_PRATA.length, 3);
  assert.deepEqual(PREMIOS_PRATA, [1000, 500, 350]);
  assert.equal(atualizacoes.length, 3);
  for (let i = 0; i < atualizacoes.length; i++) {
    const update = atualizacoes[i][1];
    assert.equal(update.$inc.gold, PREMIOS_PRATA[i]);
    assert.equal(update.$push.goldHistory.$each[0].type, 'recebido');
    assert.equal(update.$push.goldHistory.$each[0].amount, PREMIOS_PRATA[i]);
    assert.ok(update.$push.goldHistory.$each[0].date instanceof Date);
    assert.match(update.$push.goldHistory.$each[0].item, /Premiação semanal de quiz/);
  }

  assert.equal(mensagens.length, 1);
  assert.match(mensagens[0].payload.text, /\+1\.000 Prata/);
  assert.match(mensagens[0].payload.text, /\+500 Prata/);
  assert.match(mensagens[0].payload.text, /\+350 Prata/);
  assert.doesNotMatch(mensagens[0].payload.text, /R\$/);
});
