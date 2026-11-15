'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  respostaCorresponde,
  resolverBancoQuiz,
  resolverFiltroQuiz,
  normalizarComandoQuiz,
  perguntasQuiz,
  perguntasQuizTikTok,
  perguntasQuizModa,
  QUIZ_GOLD_BASE_REWARD,
  QUIZ_GOLD_MULTIPLIER,
  QUIZ_GOLD_REWARD,
} = require('./quiz');

function validarBanco(nome, banco) {
  assert.equal(banco.length, 150, nome + ' deve conter exactamente 150 perguntas');
  assert.equal(new Set(banco.map(q => q.p)).size, 150, nome + ' não pode repetir enunciados');

  for (const [index, q] of banco.entries()) {
    assert.ok(q.p?.trim(), nome + ': enunciado ' + index);
    assert.ok(q.r?.trim(), nome + ': resposta ' + index);
    assert.ok(q.d?.trim(), nome + ': categoria ' + index);
    assert.equal(
      respostaCorresponde(q.r, q.r, q.aliases || []),
      true,
      nome + ': resposta oficial ' + index + ' não foi reconhecida'
    );
  }
}

test('/quiztiktok possui 150 perguntas de diferentes épocas e casos públicos', () => {
  validarBanco('TikTok', perguntasQuizTikTok);
  for (const categoria of [
    'Plataforma', 'Trend 2019', 'Trend 2020', 'Trend 2021',
    'Trend 2022', 'Trend 2023', 'Trend 2024', 'Trend 2025',
    'Casos famosos',
  ]) {
    assert.ok(perguntasQuizTikTok.some(q => q.d === categoria), 'categoria ausente: ' + categoria);
  }
});

test('/quizmoda possui 150 perguntas distribuídas pelos temas de moda', () => {
  validarBanco('Moda', perguntasQuizModa);
  for (const categoria of [
    'História da moda', 'Designers e marcas', 'Peças e modelagens',
    'Tecidos e materiais', 'Estilos e subculturas',
    'Eventos e conceitos', 'Peças e acessórios',
  ]) {
    assert.ok(perguntasQuizModa.some(q => q.d === categoria), 'categoria ausente: ' + categoria);
  }
});

test('o parser reconhece comandos de quiz em maiúsculas e com prefixos diferentes', () => {
  assert.equal(normalizarComandoQuiz('/QUIZFUT'), 'quizfut');
  assert.equal(normalizarComandoQuiz('/quizfutebol   extra'), 'quizfutebol');
  assert.equal(normalizarComandoQuiz('#QUIZFUTEBOL'), 'quizfutebol');
  assert.equal(normalizarComandoQuiz('!QUIZFUT'), 'quizfut');
});

test('os comandos /quizfut e /quizfutebol seleccionam as mesmas perguntas de Futebol', () => {
  const filtroCurto = resolverFiltroQuiz('quizfut');
  const filtroCompleto = resolverFiltroQuiz('quizfutebol');
  assert.equal(typeof filtroCurto, 'function');
  assert.equal(typeof filtroCompleto, 'function');
  const curto = perguntasQuiz.filter(filtroCurto);
  const completo = perguntasQuiz.filter(filtroCompleto);
  assert.ok(curto.length > 0, 'o banco de Futebol não pode estar vazio');
  assert.deepEqual(completo, curto);
  assert.ok(curto.every(q => q.d === 'Futebol'));
  assert.equal(resolverFiltroQuiz('quizgremio'), null);
});

test('cada comando selecciona exclusivamente o seu banco de perguntas', () => {
  assert.equal(resolverBancoQuiz('quiztiktok'), perguntasQuizTikTok);
  assert.equal(resolverBancoQuiz('quizmoda'), perguntasQuizModa);
  assert.equal(resolverBancoQuiz('quiz'), null);
  assert.equal(resolverBancoQuiz('quizfut'), null);
});

test('a recompensa de Pratas foi multiplicada exactamente por 30', () => {
  assert.equal(QUIZ_GOLD_BASE_REWARD, 15);
  assert.equal(QUIZ_GOLD_MULTIPLIER, 30);
  assert.equal(QUIZ_GOLD_REWARD, QUIZ_GOLD_BASE_REWARD * QUIZ_GOLD_MULTIPLIER);
  assert.equal(QUIZ_GOLD_REWARD, 450);
});
