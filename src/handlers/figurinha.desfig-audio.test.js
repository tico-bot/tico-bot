'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { muxStickerAudioIntoVideo } = require('./figurinha');

test('!desfig consegue muxar o áudio de uma figurinha sonora no MP4', async () => {
  const ffmpeg = require('ffmpeg-static');
  const ffprobe = require('ffprobe-static').path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-desfig-audio-test-'));
  const videoPath = path.join(dir, 'video.mp4');
  const audioPath = path.join(dir, 'audio.ogg');

  try {
    execFileSync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=256x256:r=8:d=1',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
    ], { stdio: 'ignore' });
    execFileSync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'libopus', '-f', 'ogg', audioPath,
    ], { stdio: 'ignore' });

    const result = await muxStickerAudioIntoVideo(
      fs.readFileSync(videoPath),
      fs.readFileSync(audioPath),
      'audio/ogg; codecs=opus'
    );

    const outputPath = path.join(dir, 'result.mp4');
    fs.writeFileSync(outputPath, result);
    const streams = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error', '-show_entries', 'stream=codec_type',
      '-of', 'json', outputPath,
    ], { encoding: 'utf8' })).streams;

    assert.ok(streams.some(stream => stream.codec_type === 'video'));
    assert.ok(streams.some(stream => stream.codec_type === 'audio'));
    assert.equal(result.toString('ascii', 4, 8), 'ftyp');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
