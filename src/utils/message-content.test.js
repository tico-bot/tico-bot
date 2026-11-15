'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unwrapMessageContent } = require('./message-content');

test('desembrulha os formatos de visualização única usados pelo WhatsApp', () => {
  const image = { imageMessage: { caption: '!s' } };
  for (const field of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
    assert.equal(unwrapMessageContent({ [field]: { message: image } }), image, field);
  }
});

test('desembrulha envelopes temporários e de visualização única aninhados', () => {
  const image = { imageMessage: { caption: '!s' } };
  const message = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: image,
        },
      },
    },
  };

  assert.equal(unwrapMessageContent(message), image);
});

test('preserva mensagens comuns e entradas vazias', () => {
  const regular = { imageMessage: { caption: '!s' } };
  assert.equal(unwrapMessageContent(regular), regular);
  assert.equal(unwrapMessageContent(null), null);
  assert.equal(unwrapMessageContent(undefined), undefined);
});
