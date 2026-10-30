'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAdmin } = require('./helpers');

test('ADM supremo recebe permissão global quando remetente vem como LID com PN alternativo', async () => {
  assert.equal(
    await isAdmin(null, 'grupo@g.us', '123456789012345@lid', ['5565993354137@s.whatsapp.net']),
    true,
  );
});

test('ADM+ é reconhecido diretamente pelo número, sem consultar metadados do grupo', async () => {
  assert.equal(
    await isAdmin(null, 'grupo@g.us', '5565993354137@s.whatsapp.net'),
    true,
  );
});

test('ADM+ é reconhecido pelo PN da metadata mesmo quando o remetente só chega como LID', async () => {
  const LidMapping = require('../../models/LidMapping');
  const originalFindOne = LidMapping.findOne;
  const group = '120363000000000000@g.us';
  const lid = '123456789012345@lid';
  const cache = global._groupMetadataCache || (global._groupMetadataCache = new Map());
  const previous = cache.get(group);

  LidMapping.findOne = () => ({ lean: async () => null });
  cache.set(group, {
    meta: { participants: [{ id: '5565993354137@s.whatsapp.net', lid, admin: null }] },
    fetchedAt: Date.now(),
  });

  try {
    assert.equal(await isAdmin(null, group, lid), true);
  } finally {
    LidMapping.findOne = originalFindOne;
    if (previous) cache.set(group, previous);
    else cache.delete(group);
  }
});
