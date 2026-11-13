'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatarSaldo } = require('./index');
const { formatWalletAmount } = require('./wallet');
const { formatarNumeroBR } = require('../numberFormat');

test('formata valores inteiros com separador de milhar brasileiro', () => {
  assert.equal(formatarNumeroBR(231030), '231.030');
  assert.equal(formatarNumeroBR(123456789), '123.456.789');
  assert.equal(formatarNumeroBR(999), '999');
  assert.equal(formatarNumeroBR(0), '0');
});

test('as duas APIs centrais de moeda usam a mesma formatação brasileira', () => {
  assert.equal(formatarSaldo(231030), '231.030 prata');
  assert.equal(formatWalletAmount(231030), '231.030 Prata');
});

test('mantém o sinal de valores negativos e casas decimais quando presentes', () => {
  assert.equal(formatarNumeroBR(-231030), '-231.030');
  assert.equal(formatarNumeroBR(1234.5), '1.234,5');
});
