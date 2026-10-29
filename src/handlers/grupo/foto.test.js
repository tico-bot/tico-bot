'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getImageSource, unwrapMessage } = require('./foto');

test('unwrapMessage unwraps ephemeral and view-once wrappers', () => {
  const imageMessage = { imageMessage: { mimetype: 'image/jpeg' } };
  assert.equal(unwrapMessage({ ephemeralMessage: { message: { viewOnceMessage: { message: imageMessage } } } }), imageMessage);
});

test('getImageSource accepts an image sent with a command in its caption', () => {
  const msg = { key: { remoteJid: '123@g.us', id: 'msg1' }, message: { imageMessage: { mimetype: 'image/jpeg' } } };
  const source = getImageSource(msg, { imageMessage: { mimetype: 'image/jpeg', caption: '!fotogp' } }, '123@g.us');
  assert.equal(source.image.mimetype, 'image/jpeg');
  assert.equal(source.message.key.id, 'msg1');
});

test('getImageSource extracts a replied-to image and preserves its message key', () => {
  const msg = { key: { remoteJid: '123@g.us', id: 'reply1' } };
  const content = {
    extendedTextMessage: {
      text: '!fotogp',
      contextInfo: {
        stanzaId: 'image1', participant: '5511999999999@s.whatsapp.net',
        quotedMessage: { ephemeralMessage: { message: { imageMessage: { mimetype: 'image/jpeg' } } } },
      },
    },
  };
  const source = getImageSource(msg, content, '123@g.us');
  assert.equal(source.image.mimetype, 'image/jpeg');
  assert.equal(source.message.key.id, 'image1');
  assert.equal(source.message.key.remoteJid, '123@g.us');
  assert.equal(source.message.message.imageMessage.mimetype, 'image/jpeg');
});

test('getImageSource rejects a reply that does not contain an image', () => {
  const source = getImageSource({}, {
    extendedTextMessage: { contextInfo: { quotedMessage: { conversation: 'hello' } } },
  }, '123@g.us');
  assert.equal(source, null);
});
