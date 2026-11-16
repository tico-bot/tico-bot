'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DURACAO_ELEICAO_MS, DURACAO_MANDATO_MS, EMPATE_PRORROGACAO_MS } = require('./eleicoes');

test('o mandato presidencial dura 24 horas', () => {
  assert.equal(DURACAO_MANDATO_MS, 24 * 60 * 60 * 1000);
});

test('a eleição inicial dura 15 minutos e empate recebe uma prorrogação de cinco minutos', () => {
  assert.equal(DURACAO_ELEICAO_MS, 15 * 60 * 1000);
  assert.equal(EMPATE_PRORROGACAO_MS, 5 * 60 * 1000);
});
