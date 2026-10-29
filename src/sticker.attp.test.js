'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { convertAttp3Sticker, isAnimatedWebp } = require('./sticker');
const { handleAttp } = require('./handlers/figurinha');

test('convertAttp3Sticker rejects blank text', async () => {
  await assert.rejects(() => convertAttp3Sticker('   '), /texto inválido/);
});

test('convertAttp3Sticker rejects overly long text', async () => {
  await assert.rejects(
    () => convertAttp3Sticker('x'.repeat(81)),
    (error) => error.code === 'ATTP_TEXT_TOO_LONG',
  );
});

test('convertAttp3Sticker generates an animated WebP for Portuguese text and emoji', async () => {
  const sticker = await convertAttp3Sticker('Bom dia, galera! Árvore 🌈🔥');
  assert.ok(Buffer.isBuffer(sticker));
  assert.ok(sticker.length > 100);
  assert.equal(sticker.toString('ascii', 0, 4), 'RIFF');
  assert.equal(sticker.toString('ascii', 8, 12), 'WEBP');
  assert.equal(isAnimatedWebp(sticker), true);
});


test('handleAttp asks for the phrase when called without text', async () => {
  const sent = [];
  const sock = { sendMessage: async (_jid, payload) => sent.push(payload) };
  const msg = { key: { remoteJid: 'attp-test@g.us', participant: 'user@s.whatsapp.net' } };
  const result = await handleAttp(sock, msg, 'attp-test@g.us', '!attp3', () => '!', new Map(), 3);
  assert.equal(result, false);
  assert.match(sent.find((payload) => payload.text)?.text || '', /Escreva a frase/);
  assert.doesNotMatch(sent.find((payload) => payload.text)?.text || '', /!attp _\(texto\)_/i);
});

test('handleAttp sends the locally generated animated sticker and increments the count for attp3', async () => {
  const sent = [];
  const sock = { sendMessage: async (_jid, payload) => sent.push(payload) };
  const msg = { key: { remoteJid: 'attp-test@g.us', participant: 'user@s.whatsapp.net' } };
  const counts = new Map();
  const result = await handleAttp(sock, msg, 'attp-test@g.us', '!attp3 Bom dia 🌈🔥', () => '!', counts, 3);
  const stickerPayload = sent.find((payload) => payload.sticker);
  assert.equal(result, true);
  assert.ok(stickerPayload);
  assert.equal(isAnimatedWebp(stickerPayload.sticker), true);
  assert.equal(counts.get('user@s.whatsapp.net'), 1);
  assert.ok(sent.some((payload) => payload.react?.text === '✅'));
});
