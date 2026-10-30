'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getOwners, isOwnerJid, isOwnerIdentity } = require('./_shared');
const LidMapping = require('../../models/LidMapping');

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


test('ADM supremo é reconhecido quando o JID principal é LID e o PN alternativo é informado', async () => {
  assert.equal(
    isOwnerJid('123456789012345@lid', '5565993354137@s.whatsapp.net'),
    true,
  );
  assert.equal(
    await isOwnerIdentity('123456789012345@lid', ['5565993354137@s.whatsapp.net']),
    true,
  );
});

test('ADM supremo é reconhecido pelo mapeamento salvo quando só chega o LID', async () => {
  const original = LidMapping.findOne;
  LidMapping.findOne = filtro => ({
    lean: async () => filtro.lid === '123456789012345@lid'
      ? { lid: filtro.lid, pn: '5565993354137@s.whatsapp.net' }
      : null,
  });
  try {
    assert.equal(await isOwnerIdentity('123456789012345@lid'), true);
  } finally {
    LidMapping.findOne = original;
  }
});
