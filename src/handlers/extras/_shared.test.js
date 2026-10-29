'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getOwners, isOwnerJid } = require('./_shared');

test('número cadastrado como ADM supremo mantém permissão global fixa', () => {
  const original = process.env.BOT_OWNERS;
  try {
    delete process.env.BOT_OWNERS;
    assert.ok(getOwners().includes('5565993354137'));
    assert.equal(isOwnerJid('5565993354137@s.whatsapp.net'), true);
    assert.equal(isOwnerJid('5565993354137:4@s.whatsapp.net'), true);
    assert.equal(isOwnerJid('+55 65 99335-4137'), true);
  } finally {
    if (original === undefined) delete process.env.BOT_OWNERS;
    else process.env.BOT_OWNERS = original;
  }
});
