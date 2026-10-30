'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAlternateSenderJids } = require('./identity');

test('extrai e normaliza o JID telefônico alternativo em mensagens LID', () => {
  const result = getAlternateSenderJids({
    key: {
      participant: '123456789012345@lid',
      participantPn: '5565993354137:4@s.whatsapp.net',
      remoteJidPn: '5565993354137@s.whatsapp.net',
    },
  });
  assert.deepEqual(result, ['5565993354137@s.whatsapp.net']);
});

test('ignora aliases ausentes ou inválidos', () => {
  assert.deepEqual(getAlternateSenderJids({ key: { participant: '123@lid', participantPn: '' } }), []);
  assert.deepEqual(getAlternateSenderJids(null), []);
});
