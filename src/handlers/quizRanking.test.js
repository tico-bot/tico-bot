'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const ExtraState = require('../models/ExtraState');
const {
  enviarAviso,
  executarPremiacao,
  PREMIOS_PRATA,
  PARTICIPATION_TARGET,
  PARTICIPATION_REWARD,
  calcularProximaPremiacao,
} = require('./quizRanking');

const groupJid = '120363000000000000@g.us';
const dataPremiacao = '2026-11-13';

test('aviso diário anuncia os novos prémios e o bônus de participação', async () => {
  const sent = [];
  const sock = { async sendMessage(jid, payload) { sent.push({ jid, payload }); } };
  await enviarAviso(sock, new Set([groupJid]), '60min');

  assert.equal(sent.length, 1);
  const texto = sent[0].payload.text;
  assert.match(texto, /\+10\.000 Prata/);
  assert.match(texto, /\+5\.000 Prata/);
  assert.match(texto, /\+3\.500 Prata/);
  assert.match(texto, /3 perguntas/);
  assert.match(texto, /\+500 Pratas/);
  assert.match(texto, /18h30/);
  assert.doesNotMatch(texto, /R\$|reais?/i);
});

test('premiação diária multiplica os prêmios por dez, registra o pagamento e zera o placar', async t => {
  const top3 = [
    { idWhatsApp: '5511999999991@s.whatsapp.net', quizPoints: 120 },
    { idWhatsApp: '5511999999992@s.whatsapp.net', quizPoints: 90 },
    { idWhatsApp: '5511999999993@s.whatsapp.net', quizPoints: 60 },
  ];
  const eventos = new Map();
  const pagamentos = [];
  const resets = [];
  const mensagens = [];

  t.mock.method(ExtraState, 'findById', (id) => ({
    async lean() { return eventos.has(id) ? { value: eventos.get(id) } : null; },
  }));
  t.mock.method(ExtraState, 'updateOne', async (filtro, update) => {
    const atual = eventos.get(filtro._id);
    if (update.$setOnInsert && !atual) eventos.set(filtro._id, update.$setOnInsert.value);
    if (update.$set?.value) eventos.set(filtro._id, update.$set.value);
    return { modifiedCount: 1 };
  });
  t.mock.method(CarteiraGrupo, 'find', () => ({
    sort() { return this; },
    limit() { return this; },
    async lean() { return top3; },
  }));
  t.mock.method(CarteiraGrupo, 'updateOne', async (...args) => {
    pagamentos.push(args);
    return { modifiedCount: 1 };
  });
  t.mock.method(CarteiraGrupo, 'updateMany', async (...args) => {
    resets.push(args);
    return { modifiedCount: 0 };
  });

  const sock = {
    getName(jid) { return `Jogador ${jid.slice(-1)}`; },
    async sendMessage(jid, payload) { mensagens.push({ jid, payload }); },
  };

  await executarPremiacao(sock, new Set([groupJid]), dataPremiacao);

  assert.deepEqual(PREMIOS_PRATA, [10000, 5000, 3500]);
  assert.equal(PARTICIPATION_TARGET, 3);
  assert.equal(PARTICIPATION_REWARD, 500);
  assert.equal(pagamentos.length, 3);
  for (let i = 0; i < pagamentos.length; i++) {
    const [filtro, update] = pagamentos[i];
    assert.equal(filtro.quizPrizeDate.$ne, dataPremiacao);
    assert.equal(update.$inc.gold, PREMIOS_PRATA[i]);
    assert.equal(update.$set.quizPrizeDate, dataPremiacao);
    assert.equal(update.$set.quizPoints, 0);
    assert.equal(update.$push.goldHistory.$each[0].type, 'recebido');
    assert.equal(update.$push.goldHistory.$each[0].amount, PREMIOS_PRATA[i]);
    assert.match(update.$push.goldHistory.$each[0].item, /Premiação diária de quiz/);
  }

  assert.equal(resets.length, 1);
  assert.deepEqual(resets[0][0], { idGrupo: groupJid, quizPoints: { $gt: 0 } });
  assert.deepEqual(resets[0][1], { $set: { quizPoints: 0 } });
  assert.equal(mensagens.length, 1);
  assert.match(mensagens[0].payload.text, /PREMIAÇÃO DIÁRIA/);
  assert.match(mensagens[0].payload.text, /\+10\.000 Prata/);
  assert.match(mensagens[0].payload.text, /\+5\.000 Prata/);
  assert.match(mensagens[0].payload.text, /\+3\.500 Prata/);
  assert.match(mensagens[0].payload.text, /Amanhã/);
  assert.equal([...eventos.values()][0].status, 'completed');

  // Rodar novamente a mesma data não deve pagar nem anunciar outra vez.
  await executarPremiacao(sock, new Set([groupJid]), dataPremiacao);
  assert.equal(pagamentos.length, 3);
  assert.equal(mensagens.length, 1);
});

test('próxima premiação é calculada diariamente às 18h30 de Cuiabá', () => {
  // 17h00 em Cuiabá (21h UTC): ainda será hoje às 18h30 (22h30 UTC).
  const antes = calcularProximaPremiacao(new Date('2026-11-13T21:00:00.000Z'));
  assert.equal(antes.data, '2026-11-13');
  assert.equal(antes.instante.toISOString(), '2026-11-13T22:30:00.000Z');

  // 19h00 em Cuiabá: a próxima execução será amanhã, no mesmo horário local.
  const depois = calcularProximaPremiacao(new Date('2026-11-13T23:00:00.000Z'));
  assert.equal(depois.data, '2026-11-14');
  assert.equal(depois.instante.toISOString(), '2026-11-14T22:30:00.000Z');
});
