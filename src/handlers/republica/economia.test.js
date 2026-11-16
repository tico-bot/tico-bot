'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ALOCACAO, calcularArrecadacao, calcularIrpfProgressivo } = require('./economia');

test('o Tesouro divide receitas nos cinco fundos sem criar ou perder Pratas', () => {
  assert.deepEqual(calcularArrecadacao(1000), {
    bolsaFamilia: 400,
    licencaParental: 200,
    eventos: 150,
    desenvolvimento: 100,
    reserva: 150,
  });
  for (const valor of [0, 1, 7, 99, 1000, 123456]) {
    const partes = calcularArrecadacao(valor);
    assert.equal(Object.values(partes).reduce((a, b) => a + b, 0), valor);
  }
  assert.equal(Object.values(ALOCACAO).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(calcularArrecadacao(1), {
    bolsaFamilia: 1, licencaParental: 0, eventos: 0, desenvolvimento: 0, reserva: 0,
  });
  assert.deepEqual(calcularArrecadacao(2), {
    bolsaFamilia: 1, licencaParental: 1, eventos: 0, desenvolvimento: 0, reserva: 0,
  });
});

test('IRPF-Tico progressivo calcula apenas as faixas acima da isenção', () => {
  assert.equal(calcularIrpfProgressivo(0), 0);
  assert.equal(calcularIrpfProgressivo(2000), 0);
  assert.equal(calcularIrpfProgressivo(8000), 120);
  assert.equal(calcularIrpfProgressivo(20000), 720);
  assert.equal(calcularIrpfProgressivo(20000, -2), 360);
  assert.equal(calcularIrpfProgressivo(20000, 2), 1080);
});
