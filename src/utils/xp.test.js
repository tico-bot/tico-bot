'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isXpEnabledForMessage, getBonusHorario } = require('./xp');

test('XP/níveis só são concedidos em grupos explicitamente ativados', () => {
  assert.equal(isXpEnabledForMessage(true, { xpAtivo: true }), true);
  assert.equal(isXpEnabledForMessage(true, { xpAtivo: false }), false);
  assert.equal(isXpEnabledForMessage(true, null), false);
  assert.equal(isXpEnabledForMessage(true, {}), false);
});

test('XP global de mensagens privadas não depende da configuração de grupos', () => {
  assert.equal(isXpEnabledForMessage(false, null), true);
  assert.equal(isXpEnabledForMessage(false, { xpAtivo: false }), true);
});

test('XP por mensagem foi reduzido para uma progressão mais lenta', () => {
  const casos = [
    ['2026-06-15T06:00:00-04:00', 2],
    ['2026-06-15T12:00:00-04:00', 3],
    ['2026-06-15T18:00:00-04:00', 4],
    ['2026-06-15T00:00:00-04:00', 5],
  ];
  for (const [data, xpEsperado] of casos) {
    assert.equal(getBonusHorario(new Date(data)).xp, xpEsperado, data);
  }
});
