'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  getDuration,
  getVideoSoundAccelerationNotice,
} = require('./audio-sticker');

test('/sa avisa antes de acelerar vídeos acima de 5 segundos', () => {
  assert.equal(getVideoSoundAccelerationNotice(5), null);
  assert.equal(getVideoSoundAccelerationNotice(4.8), null);

  const notice = getVideoSoundAccelerationNotice(7);
  assert.match(notice, /acima do limite de \*5 segundos\*/);
  assert.match(notice, /Vou acelerar o vídeo e o áudio proporcionalmente/);
  assert.match(notice, /envie um vídeo de até \*5 segundos\*/i);
});

test('/sa e /saudio usam a duração real do arquivo em vez de confiar no valor arredondado do WhatsApp', async () => {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-sound-duration-'));
  const videoPath = path.join(dir, 'seven-seconds.mp4');

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

    const buffer = fs.readFileSync(videoPath);
    const actualDuration = await getDuration(buffer, 'mp4', 5);

    assert.ok(actualDuration > 6.5 && actualDuration <= 7.1, 'should use the probed 7-second duration');
    assert.match(getVideoSoundAccelerationNotice(actualDuration), /Vou acelerar o vídeo e o áudio/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});