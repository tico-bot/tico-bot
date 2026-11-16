'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LICENCA_MS, calcularBolsa, idadeTico } = require('./social');

const dependente = idade => ({ idade });

test('Bolsa Família do Tico calcula o valor diário por composição familiar', () => {
  assert.equal(calcularBolsa([]), 200);
  assert.equal(calcularBolsa([dependente(0)]), 300);
  assert.equal(calcularBolsa([dependente(6)]), 300);
  assert.equal(calcularBolsa([dependente(7)]), 250);
  assert.equal(calcularBolsa([dependente(17)]), 250);
  assert.equal(calcularBolsa([dependente(18)]), 200);
  assert.equal(calcularBolsa(Array.from({ length: 8 }, () => dependente(2))), 600);
});

test('a idade dos filhos segue a escala temporal de sete dias por ano', () => {
  const agora = Date.now();
  assert.equal(idadeTico(new Date(agora - 7 * 24 * 60 * 60 * 1000), agora), 1);
  assert.equal(idadeTico(new Date(agora - 14 * 24 * 60 * 60 * 1000), agora), 2);
});

test('a licença de maternidade e paternidade dura exactamente 48 horas', () => {
  assert.equal(LICENCA_MS, 2 * 24 * 60 * 60 * 1000);
});
