'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const { convertImageToSticker } = require('../sticker');
const { videoToStickerBuffer, isViewOnceMessage } = require('./figurinha');
const { unwrapMessageContent } = require('../utils/message-content');
const { contarSticker: registrarSticker } = require('../utils/persistence');

const MAX_SOUND_SECONDS = 10;
const VIDEO_SOUND_SECONDS = 5;
const PENDING_TTL_MS = 2 * 60 * 1000;
const pendingSoundStickers = new Map();

function getFfmpeg() {
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch { /* fall through to PATH */ }

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* try the next PATH entry */ }
  }
  throw new Error('FFmpeg não encontrado. Reinstale ffmpeg-static ou instale FFmpeg no sistema.');
}

function detectExt(buffer, mimetype = '') {
  if (mimetype.includes('webm') || (buffer[0] === 0x1A && buffer[1] === 0x45)) return 'webm';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('ogg')) return 'ogg';
  if (buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  return 'ogg';
}

function buildQuotedMsg(jid, contextInfo, quoted) {
  return {
    key: {
      remoteJid: jid,
      id: contextInfo.stanzaId,
      fromMe: false,
      participant: contextInfo.participant,
    },
    message: quoted,
  };
}

function runExec(file, args, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function getDuration(buffer, ext, hint = 0) {
  const known = Number(hint);
  if (Number.isFinite(known) && known > 0) return known;

  const ffprobe = require('ffprobe-static').path;
  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), 'tico_sound_probe_' + id + '.' + ext);
  try {
    fs.writeFileSync(inputPath, buffer);
    const result = await runExec(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ], 15_000);
    const duration = Number(result.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Não consegui identificar a duração da mídia.');
    return duration;
  } finally {
    try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
  }
}

function buildAtempoFilter(speed) {
  if (!Number.isFinite(speed) || speed <= 1.001) return null;
  const filters = [];
  let remaining = speed;
  while (remaining > 2.001) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  if (remaining > 1.001) filters.push('atempo=' + remaining.toFixed(5));
  return filters.join(',');
}

async function toOpusAudio(buffer, ext, outputSeconds, speed = 1) {
  const ffmpeg = getFfmpeg();
  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), 'tico_sound_in_' + id + '.' + ext);
  const outputPath = path.join(os.tmpdir(), 'tico_sound_out_' + id + '.ogg');

  try {
    fs.writeFileSync(inputPath, buffer);
    const args = ['-y', '-i', inputPath, '-map', '0:a:0', '-vn'];
    const atempo = buildAtempoFilter(speed);
    if (atempo) args.push('-filter:a', atempo);
    args.push(
      '-t', String(outputSeconds),
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-application', 'voip',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'ogg',
      outputPath,
    );

    await runExec(ffmpeg, args, 90_000);
    const audio = fs.readFileSync(outputPath);
    if (audio.length < 100) throw new Error('O áudio convertido ficou vazio.');
    let actualSeconds = outputSeconds;
    try {
      actualSeconds = await getDuration(audio, 'ogg');
    } catch { /* mantém a duração estimada se o ffprobe não conseguir ler o OGG */ }
    return {
      buffer: audio,
      seconds: Math.max(1, Math.ceil(Math.min(outputSeconds, actualSeconds || outputSeconds))),
      mimetype: 'audio/ogg; codecs=opus',
    };
  } finally {
    for (const file of [inputPath, outputPath]) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
}

function sendReaction(sock, msg, emoji) {
  return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});
}

function pendingKey(jid, senderJid) {
  return String(jid) + ':' + String(senderJid || jid);
}

function clearPending(key) {
  const pending = pendingSoundStickers.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingSoundStickers.delete(key);
}

async function sendSoundSticker(sock, msg, jid, sticker, audio, senderJid, stickerCount) {
  await sock.sendMessage(jid, {
    sticker,
    stickerAudio: {
      audio: audio.buffer,
      seconds: audio.seconds,
      mimetype: audio.mimetype,
    },
  }, { quoted: msg });

  if (senderJid) registrarSticker(senderJid, jid, stickerCount);
  await sendReaction(sock, msg, '✅');
}

async function handleVideoSoundSticker(sock, msg, content, jid, author, stickerCount) {
  if (isViewOnceMessage(msg?.message) || isViewOnceMessage(content)) {
    await sock.sendMessage(jid, { text: 'Não consigo criar uma figurinha sonora a partir de mídia de visualização única.' }, { quoted: msg });
    return;
  }

  let video = content.videoMessage;
  let sourceMsg = msg;
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quotedRaw = contextInfo?.quotedMessage;

  if (!video && quotedRaw) {
    if (isViewOnceMessage(quotedRaw)) {
      await sock.sendMessage(jid, { text: 'O vídeo citado é de visualização única. Envie-o normalmente e tente novamente.' }, { quoted: msg });
      return;
    }
    const quoted = unwrapMessageContent(quotedRaw);
    video = quoted?.videoMessage;
    if (video) sourceMsg = buildQuotedMsg(jid, contextInfo, quoted);
  }

  if (!video) {
    await sock.sendMessage(jid, {
      text: 'Responda a um *vídeo com áudio* usando */su*.\nO vídeo pode ter até 20 segundos; a figurinha leva até 5 segundos de imagem e som.',
    }, { quoted: msg });
    return;
  }

  await sendReaction(sock, msg, '⏳');
  try {
    const buffer = await downloadMediaMessage(
      sourceMsg, 'buffer', {},
      { logger: { level: 'silent' }, reuploadRequest: sock.updateMediaMessage },
    );
    const ext = detectExt(buffer, video.mimetype || '');
    const duration = await getDuration(buffer, ext, video.seconds);
    if (duration > 20.25) {
      await sock.sendMessage(jid, { text: 'O vídeo tem *' + Math.ceil(duration) + 's*. O limite do */su* é *20 segundos*.' }, { quoted: msg });
      await sendReaction(sock, msg, '❌');
      return;
    }

    const visualSeconds = Math.min(VIDEO_SOUND_SECONDS, duration);
    const speed = duration > VIDEO_SOUND_SECONDS ? duration / VIDEO_SOUND_SECONDS : 1;
    const sticker = await videoToStickerBuffer(buffer, ext, duration, VIDEO_SOUND_SECONDS);
    if (!sticker || sticker.length < 100) throw new Error('Não consegui converter o vídeo em WebP animado.');

    const audio = await toOpusAudio(buffer, ext, visualSeconds, speed);
    const senderJid = msg.key.participant || msg.key.remoteJid;
    await sendSoundSticker(sock, msg, jid, sticker, audio, senderJid, stickerCount);
  } catch (error) {
    console.error('[su] Falha ao criar figurinha sonora:', error.message);
    const detail = /matches no streams|does not contain any stream|Stream map/i.test(error.stderr || error.message)
      ? 'O vídeo não contém uma faixa de áudio.'
      : error.code === 'VIDEO_TOO_LONG'
        ? 'O vídeo excede o limite de 20 segundos.'
        : 'Não consegui processar o vídeo. Confirme se ele tem áudio e tente outro arquivo.';
    await sock.sendMessage(jid, { text: '❌ ' + detail }, { quoted: msg }).catch(() => {});
    await sendReaction(sock, msg, '❌');
  }
}

async function handleSoundStickerImage(sock, msg, content, jid, author) {
  if (isViewOnceMessage(msg?.message) || isViewOnceMessage(content)) {
    await sock.sendMessage(jid, { text: 'Não consigo usar imagens de visualização única em figurinhas sonoras.' }, { quoted: msg });
    return;
  }

  let image = content.imageMessage;
  let sourceMsg = msg;
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quotedRaw = contextInfo?.quotedMessage;

  if (!image && quotedRaw) {
    if (isViewOnceMessage(quotedRaw)) {
      await sock.sendMessage(jid, { text: 'A imagem citada é de visualização única. Envie-a normalmente e tente novamente.' }, { quoted: msg });
      return;
    }
    const quoted = unwrapMessageContent(quotedRaw);
    image = quoted?.imageMessage;
    if (image) sourceMsg = buildQuotedMsg(jid, contextInfo, quoted);
  }

  if (!image) {
    await sock.sendMessage(jid, {
      text: 'Responda a uma *imagem* com */saudio*. Depois, envie o áudio ou nota de voz que será anexado à figurinha (até 10 segundos).',
    }, { quoted: msg });
    return;
  }

  await sendReaction(sock, msg, '⏳');
  try {
    const buffer = await downloadMediaMessage(
      sourceMsg, 'buffer', {},
      { logger: { level: 'silent' }, reuploadRequest: sock.updateMediaMessage },
    );
    let sticker;
    try {
      sticker = await convertImageToSticker(buffer);
    } catch (error) {
      sticker = await sharp(buffer, { limitInputPixels: 16_000_000 })
        .rotate()
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(384, 384, { fit: 'fill' })
        .webp({ quality: 85 })
        .toBuffer();
    }
    if (!sticker || sticker.length < 100) throw new Error('Imagem não pôde ser convertida para WebP.');

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const key = pendingKey(jid, senderJid);
    clearPending(key);
    const pending = { sticker, author, senderJid, timer: null };
    pending.timer = setTimeout(async () => {
      if (pendingSoundStickers.get(key) !== pending) return;
      pendingSoundStickers.delete(key);
      await sock.sendMessage(jid, {
        text: '⌛ O pedido de figurinha sonora expirou. Responda novamente à imagem com */saudio* para começar de novo.',
      }).catch(() => {});
    }, PENDING_TTL_MS);
    pending.timer.unref?.();
    pendingSoundStickers.set(key, pending);

    await sock.sendMessage(jid, {
      text: '🖼️ Imagem preparada! Agora envie, nesta conversa, um áudio ou uma nota de voz de até *10 segundos*. Vou juntar os dois numa única figurinha sonora.',
    }, { quoted: msg });
    await sendReaction(sock, msg, '✅');
  } catch (error) {
    console.error('[saudio] Falha ao preparar a imagem:', error.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui preparar essa imagem. Tente outra.' }, { quoted: msg }).catch(() => {});
    await sendReaction(sock, msg, '❌');
  }
}

async function handlePendingAudio(sock, msg, content, jid, author, senderJid, stickerCount) {
  const key = pendingKey(jid, senderJid);
  const pending = pendingSoundStickers.get(key);
  if (!pending || !content.audioMessage) return false;

  if (isViewOnceMessage(msg?.message) || isViewOnceMessage(content)) {
    clearPending(key);
    await sock.sendMessage(jid, { text: 'Não consigo anexar áudio de visualização única. Comece novamente com */saudio*.' }, { quoted: msg });
    return true;
  }

  await sendReaction(sock, msg, '⏳');
  try {
    const audioMessage = content.audioMessage;
    const buffer = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger: { level: 'silent' }, reuploadRequest: sock.updateMediaMessage },
    );
    const ext = detectExt(buffer, audioMessage.mimetype || '');
    const duration = await getDuration(buffer, ext, audioMessage.seconds);
    if (duration > MAX_SOUND_SECONDS + 0.25) {
      clearPending(key);
      await sock.sendMessage(jid, {
        text: '❌ O áudio tem *' + Math.ceil(duration) + ' segundos*. O limite do */saudio* é *10 segundos*. Responda novamente à imagem com */saudio* e envie um áudio mais curto.',
      }, { quoted: msg });
      await sendReaction(sock, msg, '❌');
      return true;
    }

    const audio = await toOpusAudio(buffer, ext, Math.min(MAX_SOUND_SECONDS, duration));
    await sendSoundSticker(sock, msg, jid, pending.sticker, audio, senderJid, stickerCount);
    clearPending(key);
  } catch (error) {
    console.error('[saudio] Falha ao anexar áudio:', error.message);
    clearPending(key);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui processar esse áudio. Responda novamente à imagem com */saudio* e tente outro ficheiro de até 10 segundos.',
    }, { quoted: msg }).catch(() => {});
    await sendReaction(sock, msg, '❌');
  }

  return true;
}

module.exports = {
  handleVideoSoundSticker,
  handleSoundStickerImage,
  handlePendingAudio,
};