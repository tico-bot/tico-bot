'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  videoToStickerBuffer,
  getVideoAccelerationNotice,
} = require('./figurinha');

test('só avisa sobre aceleração quando o vídeo ultrapassa 9 segundos', () => {
  assert.equal(getVideoAccelerationNotice(9), null);
  assert.equal(getVideoAccelerationNotice(8.5), null);

  const notice = getVideoAccelerationNotice(10);
  assert.match(notice, /Vou acelerá-lo para caber no limite/);
  assert.match(notice, /envie um vídeo de até \*9 segundos\*/i);
});

test('usa a duração real do vídeo para avisar mesmo quando o WhatsApp informa duração menor', async () => {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tico-duration-warning-'));
  const videoPath = path.join(dir, 'ten-seconds.mp4');

  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=128x128:r=8:d=10',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      videoPath,
    ], { stdio: 'ignore' });

    let detectedDuration = 0;
    const videoBuffer = fs.readFileSync(videoPath);
    const sticker = await videoToStickerBuffer(
      videoBuffer,
      'mp4',
      8,
      9,
      duration => { detectedDuration = duration; }
    );

    assert.ok(Buffer.isBuffer(sticker) && sticker.length > 100);
    assert.ok(detectedDuration > 9 && detectedDuration <= 10.1);
    assert.match(getVideoAccelerationNotice(detectedDuration), /Vou acelerá-lo/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
