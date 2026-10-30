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
