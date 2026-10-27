/**
 * Alteradores de áudio e vídeo do Tico Bot.
 * Processamento isolado, limites de tamanho/tempo e limpeza garantida dos temporários.
 */
'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const path = require('path');
const fs = require('fs');
const { tmpdir } = require('os');
const { randomUUID } = require('crypto');

// O pacote ffmpeg-static pode ter sido instalado em outra plataforma (ex.: Windows).
// Só usa os binários empacotados se existirem; caso contrário, fluent-ffmpeg procura no PATH.
if (typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
if (ffprobeStatic?.path && fs.existsSync(ffprobeStatic.path)) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT_JOBS = 2;
let activeJobs = 0;
let logger = { level: 'silent' };

function setLogger(newLogger) {
  if (newLogger && typeof newLogger === 'object') logger = newLogger;
}

function unwrapMessage(message) {
  let current = message;
  for (let i = 0; i < 4 && current; i++) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else break;
  }
  return current;
}

function getMediaKind(message) {
  const content = unwrapMessage(message);
  if (content?.videoMessage) return 'video';
  if (content?.audioMessage) return 'audio';
  if (content?.documentMessage) {
    const mime = String(content.documentMessage.mimetype || '').toLowerCase();
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }
  return null;
}

async function sendText(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text }, { quoted: msg }).catch(() => {});
}

async function getMediaFromMsg(sock, msg, jid, expectedType) {
  const content = unwrapMessage(msg.message);
  const contextInfo =
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;

  if (!quoted) {
    await sendText(sock, jid, msg, '⚠️ Responda diretamente à mensagem de áudio ou vídeo que deseja alterar.');
    return null;
  }

  const kind = getMediaKind(quoted);
  if (!kind) {
    await sendText(sock, jid, msg, '⚠️ A mensagem citada não contém áudio ou vídeo compatível.');
    return null;
  }
  if (expectedType && kind !== expectedType) {
    await sendText(sock, jid, msg, expectedType === 'video'
      ? '⚠️ Este comando funciona com vídeos. Responda a um vídeo e tente novamente.'
      : '⚠️ Este comando funciona com áudios. Responda a um áudio e tente novamente.');
    return null;
  }

  const stanzaId = contextInfo.stanzaId;
  if (!stanzaId) {
    await sendText(sock, jid, msg, '❌ Não consegui identificar a mensagem citada. Tente citar a mídia novamente.');
    return null;
  }

  try {
    const participant = contextInfo.participant;
    const quotedKey = {
      remoteJid: jid,
      id: stanzaId,
      fromMe: Boolean(contextInfo.fromMe),
      ...(participant ? { participant } : {}),
    };
    const buffer = await downloadMediaMessage(
      { key: quotedKey, message: unwrapMessage(quoted) },
      'buffer',
      {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      await sendText(sock, jid, msg, '❌ A mídia baixada está vazia ou indisponível.');
      return null;
    }
    if (buffer.length > MAX_INPUT_BYTES) {
      await sendText(sock, jid, msg, '❌ A mídia excede o limite de 40 MB para processamento.');
      return null;
    }
    return { buffer, kind };
  } catch (err) {
    console.error('[alteradores] Falha ao baixar mídia:', err.message);
    await sendText(sock, jid, msg, '❌ Não foi possível baixar a mídia. Ela pode ter expirado; tente enviá-la novamente.');
    return null;
  }
}

function runFfmpeg(inputPath, outputPath, configureFfmpeg) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const command = ffmpeg(inputPath);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      command.kill('SIGKILL');
      reject(new Error('Tempo limite de processamento excedido.'));
    }, PROCESS_TIMEOUT_MS);
    timer.unref?.();

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    try {
      configureFfmpeg(command)
        .outputOptions(['-y', '-threads', '2'])
        .output(outputPath)
        .on('error', finish)
        .on('end', () => finish())
        .run();
    } catch (err) {
      finish(err);
    }
  });
}

async function processMedia(sock, msg, jid, {
  mediaType = 'audio',
  ext = 'mp3',
  mimetype = 'audio/mpeg',
  ptt = false,
  configureFfmpeg,
}) {
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    await sendText(sock, jid, msg, '⏳ O processador de mídia está ocupado. Aguarde alguns segundos e tente novamente.');
    return;
  }
  if (typeof configureFfmpeg !== 'function') {
    await sendText(sock, jid, msg, '❌ Este efeito está configurado incorretamente.');
    return;
  }

  activeJobs++;
  const tmpId = randomUUID();
  const inPath = path.join(tmpdir(), tmpId + '_in.' + ext);
  const outPath = path.join(tmpdir(), tmpId + '_out.' + ext);
  let reacted = false;

  try {
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
    const media = await getMediaFromMsg(sock, msg, jid, mediaType === 'video' ? 'video' : 'audio');
    if (!media) return;

    await fs.promises.writeFile(inPath, media.buffer, { flag: 'wx', mode: 0o600 });
    await runFfmpeg(inPath, outPath, configureFfmpeg);

    const stat = await fs.promises.stat(outPath);
    if (!stat.size) throw new Error('O FFmpeg gerou um arquivo vazio.');
    if (stat.size > MAX_OUTPUT_BYTES) {
      await sendText(sock, jid, msg, '❌ O resultado ultrapassou o limite de 64 MB. Tente uma mídia menor.');
      return;
    }

    const resultBuffer = await fs.promises.readFile(outPath);
    if (mediaType === 'video') {
      await sock.sendMessage(jid, { video: resultBuffer, mimetype: 'video/mp4' }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, { audio: resultBuffer, mimetype, ptt }, { quoted: msg });
    }
    reacted = true;
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});
  } catch (err) {
    console.error('[alteradores] Erro em ' + mediaType + ':', err.message);
    await sendText(sock, jid, msg, err.message.includes('Tempo limite')
      ? '⌛ O processamento demorou demais e foi interrompido. Tente um arquivo menor.'
      : '❌ Não foi possível processar a mídia. Verifique se o arquivo está íntegro e tente outro.');
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
    await Promise.all([inPath, outPath].map(file => fs.promises.unlink(file).catch(() => {})));
  }
}

// Vídeo
function handleVideoLento(sock, msg, jid) {
  return processMedia(sock, msg, jid, { mediaType: 'video', ext: 'mp4', configureFfmpeg: cmd => cmd.videoFilter('setpts=2.0*PTS').audioFilter('atempo=0.5') });
}
function handleVideoRapido(sock, msg, jid) {
  return processMedia(sock, msg, jid, { mediaType: 'video', ext: 'mp4', configureFfmpeg: cmd => cmd.videoFilter('setpts=0.5*PTS').audioFilter('atempo=2.0') });
}
function handleVideoContrario(sock, msg, jid) {
  return processMedia(sock, msg, jid, { mediaType: 'video', ext: 'mp4', configureFfmpeg: cmd => cmd.videoFilter('reverse').audioFilter('areverse') });
}
function handleReverseVideo(sock, msg, jid) {
  return processMedia(sock, msg, jid, { mediaType: 'video', ext: 'mp4', configureFfmpeg: cmd => cmd.audioFilter('areverse') });
}
function handleVideoSemAudio(sock, msg, jid) {
  return processMedia(sock, msg, jid, { mediaType: 'video', ext: 'mp4', configureFfmpeg: cmd => cmd.noAudio() });
}

// Áudio e voz
function audio(sock, msg, jid, filter, options = {}) {
  return processMedia(sock, msg, jid, {
    mediaType: 'audio', ext: 'mp3', mimetype: 'audio/mpeg',
    configureFfmpeg: cmd => cmd.audioFilter(filter), ...options,
  });
}
const handleAudioLento = (s, m, j) => audio(s, m, j, 'atempo=0.5');
const handleAudioRapido = (s, m, j) => audio(s, m, j, 'atempo=2.0');
const handleGrave = (s, m, j) => audio(s, m, j, 'equalizer=f=100:width_type=h:width=50:g=-10');
const handleGraveProfundo = (s, m, j) => audio(s, m, j, 'bass=g=12:f=90:w=0.6');
const handleEsquilo = (s, m, j) => audio(s, m, j, 'asetrate=44100*1.5,aresample=44100,atempo=1.0');
const handleBass = (s, m, j) => audio(s, m, j, 'bass=g=9:f=80:w=0.6');
const handleVozMenino = (s, m, j) => audio(s, m, j, 'asetrate=44100*1.18,aresample=44100,atempo=0.95');
const handleVozGrossa = (s, m, j) => audio(s, m, j, 'asetrate=44100*0.82,aresample=44100,atempo=1.08');
const handleVozMulher = (s, m, j) => audio(s, m, j, 'asetrate=44100*1.12,aresample=44100,atempo=0.96');
const handleAudioReverse = (s, m, j) => audio(s, m, j, 'areverse');
const handleVozRobo = (s, m, j) => audio(s, m, j, 'aecho=0.8:0.9:50:0.6,chorus=0.5:0.9:50:0.4:0.25:2');
const handleVozAlien = (s, m, j) => audio(s, m, j, 'asetrate=44100*0.7,aresample=44100,atempo=1.4');
const handleVozVelho = (s, m, j) => audio(s, m, j, 'asetrate=44100*0.88,aresample=44100,atempo=1.1,equalizer=f=200:width_type=h:width=50:g=-5');
const handleVozCrianca = (s, m, j) => audio(s, m, j, 'asetrate=44100*1.3,aresample=44100,atempo=0.9');
const handleVozDemonio = (s, m, j) => audio(s, m, j, 'asetrate=44100*0.75,aresample=44100,atempo=1.3,bass=g=6:f=70:w=0.7');
const handleEco = (s, m, j) => audio(s, m, j, 'aecho=0.8:0.8:80:0.5');
const handleCaverna = (s, m, j) => audio(s, m, j, 'aecho=0.8:0.9:120:0.7');
const handleTelefone = (s, m, j) => audio(s, m, j, 'highpass=f=300,lowpass=f=3400');
const handleRadio = (s, m, j) => audio(s, m, j, 'highpass=f=200,lowpass=f=4000,volume=0.9,acrusher=level_in=1:level_out=1:bits=10:mode=log:aa=1');
const handleMegafone = (s, m, j) => audio(s, m, j, 'highpass=f=300,lowpass=f=5000,volume=1.4,acompressor=threshold=0.1:ratio=4:attack=20:release=200');
const handleUnderwater = (s, m, j) => audio(s, m, j, 'lowpass=f=800,aecho=0.7:0.8:40:0.5');
const handleAudioNormalizar = (s, m, j) => audio(s, m, j, 'loudnorm=I=-16:TP=-1.5:LRA=11');
const handleAudioLimpar = (s, m, j) => audio(s, m, j, 'highpass=f=100,lowpass=f=7500,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11');
const handleAudioVolume = (s, m, j) => audio(s, m, j, 'volume=2.0,alimiter=limit=0.95');
const handleAudioReverb = (s, m, j) => audio(s, m, j, 'aecho=0.8:0.88:60|120:0.35|0.25');
const handleVozNightcore = (s, m, j) => audio(s, m, j, 'asetrate=44100*1.22,aresample=44100,atempo=0.95');

module.exports = {
  handleVideoLento, handleVideoRapido, handleVideoContrario, handleReverseVideo, handleVideoSemAudio,
  handleAudioLento, handleAudioRapido, handleGrave, handleGraveProfundo, handleEsquilo, handleBass,
  handleVozMenino, handleVozGrossa, handleVozMulher, handleAudioReverse, handleVozRobo, handleVozAlien,
  handleVozVelho, handleVozCrianca, handleVozDemonio, handleEco, handleCaverna, handleTelefone,
  handleRadio, handleMegafone, handleUnderwater, handleAudioNormalizar, handleAudioLimpar,
  handleAudioVolume, handleAudioReverb, handleVozNightcore, setLogger,
};
