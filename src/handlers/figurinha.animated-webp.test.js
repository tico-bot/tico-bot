'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const {
  animatedWebpToMp4Buffer,
  muxStickerAudioIntoVideo,
} = require('./figurinha');

test('reconstrói WebP animado com mais de 72 quadros e preserva a duração', async () => {
  const ffmpeg = require('ffmpeg-static');
  const ffprobe = require('ffprobe-static').path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-webp-many-frames-'));
  const webpPath = path.join(dir, 'many-frames.webp');
  const mp4Path = path.join(dir, 'result.mp4');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc2=s=512x512:r=12:d=8.333333',
      '-an',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '60',
      '-loop', '0',
      '-vsync', '0',
      webpPath,
    ], { stdio: 'ignore' });

    const webpBuffer = fs.readFileSync(webpPath);
    const metadata = await sharp(webpBuffer).metadata();
    assert.equal(metadata.pages, 100);
    assert.ok(metadata.pages > 72);

    const mp4Buffer = await animatedWebpToMp4Buffer(webpBuffer, 384);
    assert.ok(Buffer.isBuffer(mp4Buffer));
    assert.equal(mp4Buffer.toString('ascii', 4, 8), 'ftyp');
    fs.writeFileSync(mp4Path, mp4Buffer);

    const probe = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_name,nb_frames,duration',
      '-of', 'json',
      mp4Path,
    ], { encoding: 'utf8' }));
    const video = probe.streams.find(stream => stream.codec_name === 'h264');

    assert.ok(video, 'o MP4 deve conter vídeo H.264');
    assert.equal(Number(video.nb_frames), 100);
    assert.ok(Number(probe.format.duration) > 8.1);
    assert.ok(Number(probe.format.duration) < 8.5);

    // O mesmo MP4 também deve aceitar o áudio separado de uma figurinha sonora.
    const audioPath = path.join(dir, 'audio.ogg');
    const muxedPath = path.join(dir, 'result-with-audio.mp4');
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=8.333333',
      '-c:a', 'libopus',
      '-f', 'ogg',
      audioPath,
    ], { stdio: 'ignore' });

    const muxedBuffer = await muxStickerAudioIntoVideo(
      mp4Buffer,
      fs.readFileSync(audioPath),
      'audio/ogg; codecs=opus'
    );
    fs.writeFileSync(muxedPath, muxedBuffer);

    const muxedProbe = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,nb_frames',
      '-of', 'json',
      muxedPath,
    ], { encoding: 'utf8' }));
    assert.ok(muxedProbe.streams.some(stream => stream.codec_type === 'video'));
    assert.ok(muxedProbe.streams.some(stream => stream.codec_type === 'audio'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bloqueia animações com quantidade extrema de quadros pelo limite de segurança', async () => {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-webp-frame-limit-'));
  const webpPath = path.join(dir, 'extreme.webp');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=64x64:r=30:d=10.033333',
      '-an',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '50',
      '-loop', '0',
      '-vsync', '0',
      webpPath,
    ], { stdio: 'ignore' });

    const webpBuffer = fs.readFileSync(webpPath);
    const metadata = await sharp(webpBuffer).metadata();
    assert.ok(metadata.pages > 300);

    await assert.rejects(
      animatedWebpToMp4Buffer(webpBuffer, 384),
      error => error.code === 'ANIMATED_WEBP_TOO_MANY_FRAMES'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
