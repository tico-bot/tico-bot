'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../../models/Usuario');
const { registrarInicioQuiz, QUIZ_WINDOW_LIMIT, QUIZ_WINDOW_MS } = require('./quiz');

const jogador = '5511999999999@s.whatsapp.net';
const agora = new Date('2026-11-13T20:00:00.000Z');

test('limite permite até 30 quizzes e mantém a janela de 30 minutos após reinício', async t => {
  const updates = [];
  t.mock.method(Usuario, 'updateOne', async (...args) => { updates.push(args); return { upsertedCount: 0 }; });
  t.mock.method(Usuario, 'findOneAndUpdate', async (...args) => {
    updates.push(args);
    return { quizDaily: { windowStartedAt: agora, count: 30 } };
  });

  const resultado = await registrarInicioQuiz(jogador, agora);

  assert.equal(QUIZ_WINDOW_LIMIT, 30);
  assert.equal(QUIZ_WINDOW_MS, 30 * 60 * 1000);
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.count, 30);
  assert.equal(resultado.restanteMs, QUIZ_WINDOW_MS);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0][0], { idWhatsApp: jogador });
  assert.equal(updates[0][2].upsert, true);
  const [filtro, pipeline, opcoes] = updates[1];
  assert.equal(filtro.idWhatsApp, jogador);
  assert.equal(filtro.$or.length, 3);
  assert.deepEqual(filtro.$or[2]['quizDaily.count'], { $lt: 30 });
  assert.equal(pipeline[0].$set['quizDaily.count'].$cond[2].$add[1], 1);
  assert.equal(opcoes.new, true);
});

test('bloqueia ao atingir 30 e informa o tempo restante', async t => {
  const iniciadoEm = new Date(agora.getTime() - 5 * 60 * 1000);
  t.mock.method(Usuario, 'updateOne', async () => ({ upsertedCount: 0 }));
  t.mock.method(Usuario, 'findOneAndUpdate', async () => null);
  t.mock.method(Usuario, 'findOne', () => ({
    lean: async () => ({ quizDaily: { windowStartedAt: iniciadoEm, count: 30 } }),
  }));

  const resultado = await registrarInicioQuiz(jogador, agora);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.count, 30);
  assert.equal(resultado.restanteMs, 25 * 60 * 1000);
});

test('reinicia a janela quando os 30 minutos anteriores expiraram', async t => {
  const updates = [];
  t.mock.method(Usuario, 'updateOne', async () => ({ upsertedCount: 0 }));
  t.mock.method(Usuario, 'findOneAndUpdate', async (...args) => {
    updates.push(args);
    return { quizDaily: { windowStartedAt: agora, count: 1 } };
  });

  const resultado = await registrarInicioQuiz(jogador, agora);
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.count, 1);
  const [, pipeline] = updates[0];
  const reinicia = pipeline[0].$set['quizDaily.windowStartedAt'].$cond[0];
  assert.deepEqual(reinicia.$or[1].$lte[1], new Date(agora.getTime() - QUIZ_WINDOW_MS));
  assert.equal(pipeline[0].$set['quizDaily.count'].$cond[1], 1);
});
