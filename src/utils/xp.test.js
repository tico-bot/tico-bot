'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isXpEnabledForMessage } = require('./xp');

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
