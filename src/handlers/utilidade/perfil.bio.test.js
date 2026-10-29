'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../../models/Usuario');
const LidMapping = require('../../models/LidMapping');
const { handleBio } = require('./perfil');

const original = {
  updateMany: Usuario.updateMany,
  findOneAndUpdate: Usuario.findOneAndUpdate,
  lidFindOne: LidMapping.findOne,
};
const pn = '5511999999999@s.whatsapp.net';
const lid = '1234567890@lid';
let lastMultiUpdate;
let lastCanonicalUpdate;
let lastMappingQuery;
let lastMessage;
let matchedCount = 2;

Usuario.updateMany = async (filter, update) => {
  lastMultiUpdate = { filter, update };
  return { modifiedCount: matchedCount, matchedCount };
};
Usuario.findOneAndUpdate = (filter, update, options) => {
  lastCanonicalUpdate = { filter, update, options };
  return Promise.resolve({ idWhatsApp: pn, bio: update.$set.bio });
};
LidMapping.findOne = query => ({
  select() { return this; },
  async lean() {
    lastMappingQuery = query;
    return query.lid === lid ? { lid, pn } : null;
  },
});

test.beforeEach(() => {
  lastMultiUpdate = null;
  lastCanonicalUpdate = null;
  lastMappingQuery = null;
  lastMessage = null;
  matchedCount = 2;
});
test.after(() => {
  Usuario.updateMany = original.updateMany;
  Usuario.findOneAndUpdate = original.findOneAndUpdate;
  LidMapping.findOne = original.lidFindOne;
});

function mockSocket() {
  return { async sendMessage(_jid, content) { lastMessage = content; } };
}

test('!bio sincroniza texto no perfil PN e no alias LID para o site e ranking', async () => {
  const bio = 'Gosto de jogos e <filosofia>.';
  await handleBio(mockSocket(), {
    key: { participant: lid, participantPn: pn },
  }, '120363000000000000@g.us', `!bio ${bio}`);

  assert.deepEqual(lastMappingQuery, { lid });
  assert.deepEqual(lastMultiUpdate.filter, { idWhatsApp: { $in: [lid, pn] } });
  assert.deepEqual(lastMultiUpdate.update, { $set: { bio } });
  assert.equal(lastCanonicalUpdate, null, 'should not create a duplicate PN account when aliases already exist');
  assert.match(lastMessage.text, /Bio atualizada/);
});

test('!bio creates a profile under the actual sender identity only when none exists', async () => {
  matchedCount = 0;
  await handleBio(mockSocket(), { key: { participant: lid, participantPn: pn } }, '120363000000000000@g.us', '!bio Bio nova');
  assert.deepEqual(lastCanonicalUpdate.filter, { idWhatsApp: lid });
  assert.deepEqual(lastCanonicalUpdate.update, { $set: { bio: 'Bio nova' } });
  assert.equal(lastCanonicalUpdate.options.upsert, true);
});

test('!bio rejects overlong text before writing anything', async () => {
  await handleBio(mockSocket(), { key: { participant: pn } }, '120363000000000000@g.us', `!bio ${'x'.repeat(151)}`);
  assert.equal(lastMultiUpdate, null);
  assert.equal(lastCanonicalUpdate, null);
  assert.match(lastMessage.text, /Bio muito longa/);
});
