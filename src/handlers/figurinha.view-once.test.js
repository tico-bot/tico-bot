'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleSticker,
  processMedia,
  isViewOnceMessage,
  getViewOnceStickerWarning,
} = require('./figurinha');

const jid = 'view-once-test@g.us';

function makeSock() {
  const sent = [];
  return {
    sent,
    sock: { sendMessage: async (...args) => sent.push(args) },
  };
}

test('detecta os diferentes envelopes de visualização única', () => {
  for (const field of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
    assert.equal(isViewOnceMessage({ [field]: { message: { imageMessage: {} } } }), true, field);
  }
  assert.equal(isViewOnceMessage({
    ephemeralMessage: {
      message: { viewOnceMessageV2: { message: { imageMessage: {} } } },
    },
  }), true);
  assert.equal(isViewOnceMessage({ imageMessage: { viewOnce: true } }), true);
});

test('não classifica imagens comuns nem mensagens temporárias comuns como visualização única', () => {
  assert.equal(isViewOnceMessage({ imageMessage: { mimetype: 'image/jpeg' } }), false);
  assert.equal(isViewOnceMessage({
    ephemeralMessage: { message: { imageMessage: { mimetype: 'image/jpeg' } } },
  }), false);
  assert.equal(isViewOnceMessage({ conversation: 'mensagem normal' }), false);
});

test('oferece variantes de aviso em vez de uma frase fixa', () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const first = getViewOnceStickerWarning();
    Math.random = () => 0.999999;
    const last = getViewOnceStickerWarning();
    assert.notEqual(first, last);
    assert.match(first, /visualização única/i);
    assert.match(last, /visualização única/i);
  } finally {
    Math.random = originalRandom;
  }
});

test('!s avisa ao receber diretamente uma mídia de visualização única, sem reagir nem baixar', async () => {
  const { sock, sent } = makeSock();
  const msg = {
    key: { remoteJid: jid, participant: 'user@s.whatsapp.net' },
    message: { viewOnceMessageV2: { message: { imageMessage: {} } } },
  };
  const result = await handleSticker(sock, msg, { imageMessage: {} }, jid, 'Pessoa', new Map());

  assert.equal(result, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].text, /visualização única/i);
  assert.equal(sent[0][1].react, undefined);
});

test('!s avisa quando a mídia citada é de visualização única', async () => {
  const { sock, sent } = makeSock();
  const msg = { key: { remoteJid: jid, participant: 'user@s.whatsapp.net' } };
  const content = {
    extendedTextMessage: {
      contextInfo: {
        quotedMessage: {
          viewOnceMessageV2: { message: { imageMessage: {} } },
        },
      },
    },
  };

  const result = await handleSticker(sock, msg, content, jid, 'Pessoa', new Map());
  assert.equal(result, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].text, /visualização única/i);
});

test('Auto-Sticker também bloqueia mídia de visualização única', async () => {
  const { sock, sent } = makeSock();
  const msg = {
    key: { remoteJid: jid, participant: 'user@s.whatsapp.net' },
    message: { viewOnceMessage: { message: { imageMessage: {} } } },
  };

  await processMedia(sock, msg, { imageMessage: {} }, jid, 'Pessoa', new Map());
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].text, /visualização única/i);
});
