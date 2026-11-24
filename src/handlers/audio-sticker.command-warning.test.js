'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const baileysPath = require.resolve('@whiskeysockets/baileys');
const persistencePath = require.resolve('../utils/persistence');
require(baileysPath);
require(persistencePath);

const originalBaileysExports = require.cache[baileysPath].exports;
const originalPersistenceExports = require.cache[persistencePath].exports;

let mediaBuffer = null;
require.cache[baileysPath].exports = {
  ...originalBaileysExports,
  downloadMediaMessage: async () => mediaBuffer,
};
require.cache[persistencePath].exports = {
  ...originalPersistenceExports,
  contarSticker: () => {},
};

const {
  handleVideoSoundSticker,
  handleSoundStickerImage,
} = require('./audio-sticker');

const jid = 'sound-sticker-test@s.whatsapp.net';
const sent = [];
const sock = {
  sendMessage: async (_jid, payload) => {
    sent.push(payload);
    return {};
  },
};

test.after(() => {
  require.cache[baileysPath].exports = originalBaileysExports;
  require.cache[persistencePath].exports = originalPersistenceExports;
});

test('/sa envia o aviso de aceleração antes de enviar a figurinha sonora', async () => {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-sa-warning-'));
  const videoPath = path.join(dir, 'seven-seconds-with-audio.mp4');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=128x128:r=8:d=7',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=7',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      videoPath,
    ], { stdio: 'ignore' });

    mediaBuffer = fs.readFileSync(videoPath);
    sent.length = 0;
    const msg = {
      key: { remoteJid: jid },
      message: { videoMessage: { mimetype: 'video/mp4', seconds: 5 } },
    };
    const content = {
      videoMessage: { mimetype: 'video/mp4', seconds: 5 },
    };

    await handleVideoSoundSticker(sock, msg, content, jid, null, null);

    const warningIndex = sent.findIndex(payload =>
      typeof payload?.text === 'string' && /Vou acelerar o vídeo e o áudio/.test(payload.text));
    const stickerIndex = sent.findIndex(payload => Boolean(payload?.sticker));

    assert.ok(warningIndex >= 0, 'should send the acceleration warning');
    assert.ok(stickerIndex > warningIndex, 'warning should arrive before the sound sticker');
    assert.match(sent[warningIndex].text, /até \*5 segundos\*/);
  } finally {
    mediaBuffer = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/saudio esclarece que recebe imagem ou vídeo, seguido de áudio separado', async () => {
  sent.length = 0;
  const msg = { key: { remoteJid: jid }, message: {} };

  await handleSoundStickerImage(sock, msg, {}, jid, null);

  const prompt = sent.find(payload => typeof payload?.text === 'string')?.text || '';
  assert.match(prompt, /imagem ou vídeo/);
  assert.match(prompt, /áudio ou nota de voz/);
  assert.match(prompt, /até \*10 segundos\*/);
  assert.match(prompt, /áudio não será acelerado/);
});

test('/saudio avisa que não acelera áudios acima de 10 segundos', async () => {
  const ffmpeg = require('ffmpeg-static');
  const sharp = require('sharp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-saudio-limit-'));
  const audioPath = path.join(dir, 'eleven-seconds.ogg');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=11',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'ogg',
      audioPath,
    ], { stdio: 'ignore' });

    mediaBuffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    sent.length = 0;

    const imageMsg = {
      key: { remoteJid: jid },
      message: { imageMessage: { mimetype: 'image/png' } },
    };
    await handleSoundStickerImage(sock, imageMsg, imageMsg.message, jid, null);

    const readyPrompt = sent.find(payload =>
      typeof payload?.text === 'string' && /Imagem preparada/.test(payload.text));
    assert.ok(readyPrompt, 'should ask the user to send the audio');

    mediaBuffer = fs.readFileSync(audioPath);
    const audioMsg = {
      key: { remoteJid: jid },
      message: { audioMessage: { mimetype: 'audio/ogg' } },
    };
    const handled = await require('./audio-sticker').handlePendingAudio(
      sock,
      audioMsg,
      { audioMessage: { mimetype: 'audio/ogg', seconds: 8 } },
      jid,
      null,
      jid,
      null,
    );

    const rejection = sent.find(payload =>
      typeof payload?.text === 'string' && /Não vou acelerar o áudio/.test(payload.text));
    assert.equal(handled, true);
    assert.ok(rejection, 'should explain that long audio is not accelerated');
    assert.match(rejection.text, /até \*10 segundos\*/);
  } finally {
    mediaBuffer = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/saudio aceita vídeo animado e depois anexa o áudio enviado separadamente', async () => {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-saudio-video-'));
  const videoPath = path.join(dir, 'twelve-seconds.mp4');
  const audioPath = path.join(dir, 'three-seconds.ogg');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=purple:s=128x128:r=8:d=12',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      videoPath,
    ], { stdio: 'ignore' });
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=660:duration=3',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'ogg',
      audioPath,
    ], { stdio: 'ignore' });

    mediaBuffer = fs.readFileSync(videoPath);
    sent.length = 0;
    const videoMsg = {
      key: { remoteJid: jid },
      message: { videoMessage: { mimetype: 'video/mp4', seconds: 12 } },
    };

    await handleSoundStickerImage(sock, videoMsg, videoMsg.message, jid, null);

    const accelerationNotice = sent.find(payload =>
      typeof payload?.text === 'string' && /Vou acelerar apenas a animação/.test(payload.text));
    const readyPrompt = sent.find(payload =>
      typeof payload?.text === 'string' && /Vídeo preparado/.test(payload.text));
    assert.ok(accelerationNotice, 'should explain that the long video animation will be accelerated');
    assert.ok(readyPrompt, 'should ask the user to send a separate audio track');
    assert.match(readyPrompt.text, /até \*10 segundos\*/);

    mediaBuffer = fs.readFileSync(audioPath);
    const audioMsg = {
      key: { remoteJid: jid },
      message: { audioMessage: { mimetype: 'audio/ogg' } },
    };
    const handled = await require('./audio-sticker').handlePendingAudio(
      sock,
      audioMsg,
      { audioMessage: { mimetype: 'audio/ogg', seconds: 3 } },
      jid,
      null,
      jid,
      null,
    );

    const soundSticker = sent.find(payload => payload?.sticker && payload?.stickerAudio);
    assert.equal(handled, true);
    assert.ok(soundSticker, 'should send the animated sticker with the separately provided audio');
  } finally {
    mediaBuffer = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});