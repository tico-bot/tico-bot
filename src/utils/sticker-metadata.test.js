'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const WebP = require('node-webpmux');
const {
  STICKER_PACK_NAME,
  STICKER_PACK_PUBLISHER,
  addTicoStickerMetadata,
  installTicoStickerMetadata,
} = require('./sticker-metadata');

async function extractMetadata(buffer) {
  const image = new WebP.Image();
  await image.load(buffer);
  assert.ok(Buffer.isBuffer(image.exif), 'WebP deve ter um chunk EXIF');

  const length = image.exif.readUIntLE(14, 4);
  const json = image.exif.subarray(22, 22 + length).toString('utf8');
  return { image, metadata: JSON.parse(json) };
}

test('adiciona nome e telefone do Tico a figurinhas WebP estáticas', async () => {
  const source = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 30, g: 120, b: 220, alpha: 1 },
    },
  }).webp().toBuffer();

  const result = await addTicoStickerMetadata(source);
  const { image, metadata } = await extractMetadata(result);

  assert.equal(image.hasAnim, false);
  assert.equal(metadata['sticker-pack-name'], STICKER_PACK_NAME);
  assert.equal(metadata['sticker-pack-publisher'], STICKER_PACK_PUBLISHER);
  assert.ok(metadata['sticker-pack-id']);
  assert.deepEqual(metadata.emojis, []);
  assert.equal((await sharp(result).metadata()).format, 'webp');
});

test('adiciona nome e telefone do Tico a figurinhas WebP animadas sem perder os quadros', async () => {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-sticker-metadata-'));
  const sourcePath = path.join(dir, 'animated.webp');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc2=s=128x128:r=8:d=1',
      '-an',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '60',
      '-loop', '0',
      '-vsync', '0',
      sourcePath,
    ], { stdio: 'ignore' });

    const source = fs.readFileSync(sourcePath);
    const sourceImage = new WebP.Image();
    await sourceImage.load(source);
    assert.equal(sourceImage.hasAnim, true);
    const originalFrames = sourceImage.frames.length;

    const result = await addTicoStickerMetadata(source);
    const { image, metadata } = await extractMetadata(result);

    assert.equal(image.hasAnim, true);
    assert.equal(image.frames.length, originalFrames);
    assert.equal(metadata['sticker-pack-name'], STICKER_PACK_NAME);
    assert.equal(metadata['sticker-pack-publisher'], STICKER_PACK_PUBLISHER);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('intercepta envios normais e sonoros sem alterar o payload de áudio ou as opções', async () => {
  const source = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 3,
      background: '#bb44cc',
    },
  }).webp().toBuffer();
  const audio = { audio: Buffer.from('audio-test'), seconds: 1, mimetype: 'audio/ogg' };
  const options = { quoted: { key: { id: 'quoted-message' } } };
  const sock = {
    sent: [],
    async sendMessage(...args) {
      this.sent.push(args);
      return { key: { id: 'sent-message' } };
    },
  };

  assert.equal(installTicoStickerMetadata(sock), true);
  assert.equal(installTicoStickerMetadata(sock), false);

  await sock.sendMessage('group@g.us', {
    sticker: source,
    stickerAudio: audio,
  }, options);

  assert.equal(sock.sent.length, 1);
  const [jid, payload, sentOptions] = sock.sent[0];
  assert.equal(jid, 'group@g.us');
  assert.deepEqual(payload.stickerAudio, audio);
  assert.equal(sentOptions, options);
  assert.notDeepEqual(payload.sticker, source);

  const { metadata } = await extractMetadata(payload.sticker);
  assert.equal(metadata['sticker-pack-name'], STICKER_PACK_NAME);
  assert.equal(metadata['sticker-pack-publisher'], STICKER_PACK_PUBLISHER);

  const textPayload = { text: 'mensagem normal' };
  await sock.sendMessage('group@g.us', textPayload, options);
  assert.equal(sock.sent[1][1], textPayload);
});

test('preserva o envio caso o conteúdo não seja um WebP em buffer', async () => {
  const sock = {
    sent: [],
    async sendMessage(...args) {
      this.sent.push(args);
      return true;
    },
  };
  installTicoStickerMetadata(sock);

  const payload = { sticker: 'https://example.invalid/sticker.webp' };
  await sock.sendMessage('group@g.us', payload);
  assert.equal(sock.sent[0][1], payload);
});
