'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAdmin, isBotJid } = require('./helpers');
const { isOwnerJid, isOwnerIdentity } = require('../extras/_shared');

test('isBotJid não interpreta um bot LID numérico sem domínio como PN', () => {
  const pn = '5565993354137@s.whatsapp.net';
  const lid = '5565993354137@lid';
  assert.equal(isBotJid(pn, '5565993354137'), false);
  assert.equal(isBotJid(pn, lid), false);
  assert.equal(isBotJid(lid, lid), true);
});

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
  const originalFind = LidMapping.find;
  const group = '120363000000000000@g.us';
  const lid = '123456789012345@lid';
  const cache = global._groupMetadataCache || (global._groupMetadataCache = new Map());
  const previous = cache.get(group);

  LidMapping.findOne = () => ({ lean: async () => null });
  LidMapping.find = () => ({ select: () => ({ lean: async () => [] }) });
  cache.set(group, {
    meta: { participants: [{ id: '5565993354137@s.whatsapp.net', lid, admin: null }] },
    fetchedAt: Date.now(),
  });

  try {
    assert.equal(await isAdmin(null, group, lid), true);
  } finally {
    LidMapping.findOne = originalFindOne;
    LidMapping.find = originalFind;
    if (previous) cache.set(group, previous);
    else cache.delete(group);
  }
});

test('não confunde PN e LID que só têm os mesmos dígitos, sem par confirmado', async () => {
  const LidMapping = require('../../models/LidMapping');
  const originalFind = LidMapping.find;
  const originalFindOne = LidMapping.findOne;
  const group = '120363000000000001@g.us';
  const lid = '123456789012345@lid';
  const cache = global._groupMetadataCache || (global._groupMetadataCache = new Map());
  const previous = cache.get(group);
  LidMapping.findOne = () => ({ lean: async () => null });
  LidMapping.find = () => ({ select: () => ({ lean: async () => [] }) });
  cache.set(group, {
    meta: { participants: [{ id: '123456789012345@s.whatsapp.net', admin: 'admin' }] },
    fetchedAt: Date.now(),
  });
  try {
    assert.equal(await isAdmin(null, group, lid), false);
  } finally {
    LidMapping.findOne = originalFindOne;
    LidMapping.find = originalFind;
    if (previous) cache.set(group, previous);
    else cache.delete(group);
  }
});

test('ADM supremo não é confundido com um LID que tenha os mesmos dígitos do telefone', async () => {
  const LidMapping = require('../../models/LidMapping');
  const originalFindOne = LidMapping.findOne;
  LidMapping.findOne = () => ({ lean: async () => null });
  try {
    assert.equal(isOwnerJid('5565993354137@s.whatsapp.net'), true);
    assert.equal(isOwnerJid('65993354137@s.whatsapp.net'), true);
    assert.equal(isOwnerJid('5565993354137@lid'), false);
    assert.equal(isOwnerJid('5565993354137@dominio-invalido'), false);
    assert.equal(await isOwnerIdentity('5565993354137@lid'), false);
  } finally {
    LidMapping.findOne = originalFindOne;
  }
});
