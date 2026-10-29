'use strict';

/**
 * Handler de Figurinhas — Tico Bot
 * Comandos: !s, !f, !desfig, !brat, !figtexto, !attp, !attp2, !attp3,
 *           !toimg, !togif,
 *           !figemoji, !figroblox, !figmeme,
 *           !figcoreana, !figraiva, !figengracada, !figdesenho,
 *           !fig, !pesquisafig, !qc, !qc2, !emojimix, !emoji, !menufig,
 *           !estourar
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sharp     = require('sharp');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const crypto    = require('crypto');
const { execFile } = require('child_process');

const {
  convertImageToSticker,
  convertVideoToSticker,
  convertBratSticker,
  convertTextoSticker,
  convertAttp3Sticker,
  isSupportedRasterImage,
} = require(path.join(__dirname, '..', 'sticker'));

const { fetchBuffer } = require(path.join(__dirname, '..', 'fetchurl'));
const { contarSticker: registrarSticker } = require(path.join(__dirname, '..', 'utils', 'persistence'));

// ═══════════════════════════════════════════════════════════════
// ─── CONSTANTS ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const VIDEO_FPS      = 8;
const VIDEO_SIZE     = 384;
const VIDEO_QUALITY  = 25;
const VIDEO_MAX_FRAMES = 72;
const VIDEO_STICKER_MAX_SECONDS = 9;
const VIDEO_INPUT_MAX_SECONDS = 20;

// Usa o binário empacotado quando existe; em Linux, pode usar o ffmpeg do sistema.
function resolveFfmpegBin() {
  let bundled = null;
  try { bundled = require('ffmpeg-static'); } catch { /* pacote opcional/incompatível */ }
  if (bundled && fs.existsSync(bundled)) return bundled;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* tenta o próximo */ }
  }
  throw new Error('FFmpeg não encontrado. Instale ffmpeg no sistema ou reinstale ffmpeg-static para esta plataforma.');
}

// ─── Logger (substituível externamente) ──────────────────────
let logger = { level: 'silent' };
function setLogger(newLogger) { logger = newLogger; }

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: detecta WebP animado pelo buffer ─────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta se um buffer é um WebP animado verificando a presença do
 * chunk ANIM na estrutura binária — independente do metadata do WhatsApp.
 *
 * O campo `stickerMessage.isAnimated` do Baileys é NÃO confiável:
 * vários clientes WhatsApp não o preenchem corretamente.
 * Esta função é a fonte de verdade para distinguir sticker de vídeo
 * de sticker de imagem.
 *
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isAnimatedWebp(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  // Chunk ANIM só existe em WebP animados — busca nos primeiros 64 KB
  const limit = Math.min(buf.length - 4, 65536);
  for (let i = 12; i < limit; i++) {
    if (buf.toString('ascii', i, i + 4) === 'ANIM') return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: detecta extensão real do buffer ──────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta o formato de um buffer de vídeo/imagem pela sua assinatura binária.
 * @param {Buffer} buffer
 * @returns {'mp4'|'webm'|'gif'|'webp'|'mkv'}
 */
function detectExt(buffer) {
  if (!buffer || buffer.length < 12) return 'mp4';
  // MP4: ftyp box nos bytes 4–7
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return 'mp4';
  // WebM / MKV: EBML header
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'webm';
  // GIF: "GIF"
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  // WebP: RIFF....WEBP
  if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
  return 'mp4';
}

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: vídeo/GIF → WebP animado (sticker) ──────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Converte um buffer de vídeo ou GIF em WebP animado via ffmpeg.
 * Usa parâmetros otimizados para mobile: 384px, 8fps, qualidade 25.
 *
 * @param {Buffer} inputBuffer
 * @param {string} [inputExt='mp4']
 * @returns {Promise<Buffer|null>} WebP animado, ou null em caso de falha.
 */
async function videoToStickerBuffer(inputBuffer, inputExt = 'mp4', durationHint = 0) {
  const ffmpegBin = resolveFfmpegBin();
  const tmpId     = crypto.randomUUID();
  const tmpDir    = os.tmpdir();
  const inPath    = path.join(tmpDir, `${tmpId}_in.${inputExt}`);
  const framesDir = path.join(tmpDir, `${tmpId}_frames`);
  const outPath   = path.join(tmpDir, `${tmpId}_out.webp`);

  /**
   * Executa ffmpeg com timeout e retorna Promise<boolean>.
   * @param {string[]} args
   * @param {number} [timeoutMs=60000]
   * @returns {Promise<boolean>}
   */
  function runFfmpeg(args, timeoutMs = 60_000) {
    return new Promise((resolve) => {
      execFile(ffmpegBin, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
        if (err) console.log('ffmpeg err:', stderr?.slice(-300));
        resolve(!err);
      });
    });
  }

  fs.writeFileSync(inPath, inputBuffer);
  fs.mkdirSync(framesDir, { recursive: true });

  try {
    // Use a duração informada pelo WhatsApp; se faltar, consulte o arquivo via ffprobe.
    let duration = Number(durationHint);
    if (!Number.isFinite(duration) || duration <= 0) {
      const ffprobeBin = require('ffprobe-static').path;
      duration = await new Promise((resolve) => {
        execFile(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inPath],
          { timeout: 10_000 }, (err, stdout) => {
            const parsed = Number(String(stdout || '').trim());
            resolve(!err && Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
          });
      });
    }
    if (duration > VIDEO_INPUT_MAX_SECONDS + 0.25) {
      const error = new Error(`VIDEO_TOO_LONG:${Math.ceil(duration)}`);
      error.code = 'VIDEO_TOO_LONG';
      throw error;
    }
    // Acelera apenas quando necessário para caber em 9s, mantendo o vídeo inteiro.
    const playbackFactor = duration > VIDEO_STICKER_MAX_SECONDS
      ? VIDEO_STICKER_MAX_SECONDS / duration
      : 1;
    const videoFilter = [
      ...(playbackFactor < 1 ? [`setpts=${playbackFactor.toFixed(8)}*PTS`] : []),
      `fps=${VIDEO_FPS}`,
      `scale=${VIDEO_SIZE}:${VIDEO_SIZE}`,
    ].join(',');

    // ─── Extração de frames ──────────────────────────────────
    const extractOk = await runFfmpeg([
      '-y', '-i', inPath,
      '-vf', videoFilter,
      '-frames:v', String(VIDEO_MAX_FRAMES),
      '-f', 'image2',
      path.join(framesDir, 'f_%04d.png'),
    ]);

    console.log(`🎬 FFmpeg extração: ${extractOk ? 'OK' : 'FALHA'}`);
    if (!extractOk) return null;

    const frameFiles = fs
      .readdirSync(framesDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .slice(0, VIDEO_MAX_FRAMES);

    console.log(`📹 Frames extraídos: ${frameFiles.length} (duração original:${duration ? duration.toFixed(2) + 's' : 'desconhecida'}, aceleração:${playbackFactor < 1 ? (1 / playbackFactor).toFixed(2) + 'x' : 'normal'}, fps:${VIDEO_FPS}, size:${VIDEO_SIZE}x${VIDEO_SIZE})`);
    if (frameFiles.length === 0) return null;

    // ─── Montagem do WebP animado ─────────────────────────────
    const webpOk = await runFfmpeg([
      '-y',
      '-framerate', String(VIDEO_FPS),
      '-i', path.join(framesDir, 'f_%04d.png'),
      '-vcodec', 'libwebp',
      '-lossless', '0',
      '-q:v', String(VIDEO_QUALITY),
      '-method', '6',
      '-loop', '0',
      '-preset', 'default',
      '-an', '-fps_mode', 'passthrough',
      '-f', 'webp',
      outPath,
    ]);

    if (!webpOk || !fs.existsSync(outPath)) return null;

    const result = fs.readFileSync(outPath);
    console.log(`✅ Sticker gerado: ${(result.length / 1024).toFixed(0)}KB (fps:${VIDEO_FPS} q:${VIDEO_QUALITY} frames:${frameFiles.length})`);
    return result;

  } finally {
    for (const p of [inPath, outPath]) {
      try { fs.unlinkSync(p); } catch { /* ignora */ }
    }
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignora */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: monta objeto quotedMsg para downloadMediaMessage ─
// ═══════════════════════════════════════════════════════════════

/**
 * Constrói o objeto de mensagem citada no formato esperado pelo Baileys.
 * @param {string} jid
 * @param {object} contextInfo
 * @param {object} quoted
 * @returns {object}
 */
function buildQuotedMsg(jid, contextInfo, quoted) {
  return {
    key: {
      remoteJid:   jid,
      id:          contextInfo.stanzaId,
      fromMe:      false,
      participant: contextInfo.participant,
    },
    message: quoted,
  };
}

// ═══════════════════════════════════════════════════════════════
// ─── !s / !f ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleSticker(sock, msg, content, jid, author, stickerCount) {
  const imageMsg = content.imageMessage;
  const videoMsg = content.videoMessage;

  if (imageMsg || videoMsg) {
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
    await processMedia(sock, msg, content, jid, author, stickerCount);
    return true;
  }

  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quoted      = contextInfo?.quotedMessage;

  if (quoted) {
    const qImage = quoted.imageMessage;
    const qVideo = quoted.videoMessage;
    if (!qImage && !qVideo) {
      await sock.sendMessage(jid, { text: '⚠️ Responda a uma *imagem* ou *vídeo* com !s.' }, { quoted: msg });
      return false;
    }
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
    await processMedia(sock, buildQuotedMsg(jid, contextInfo, quoted), quoted, jid, author, stickerCount);
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
// ─── processMedia ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function processMedia(sock, msg, content, jid, author, stickerCount) {
  const imageMsg = content.imageMessage;
  const videoMsg = content.videoMessage;
  if (!imageMsg && !videoMsg) return;

  let buffer;
  try {
    buffer = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );
  } catch {
    await sock.sendMessage(jid, { text: '❌ Não consegui baixar a mídia. Tente reenviar.' }, { quoted: msg });
    return;
  }

  if (!buffer || buffer.length === 0) {
    await sock.sendMessage(jid, { text: '❌ Mídia vazia. Tente reenviar.' }, { quoted: msg });
    return;
  }
  if (imageMsg && (buffer.length > 25 * 1024 * 1024 || !isSupportedRasterImage(buffer))) {
    await sock.sendMessage(jid, {
      text: '⚠️ Imagem não suportada. Envie JPEG, PNG, GIF ou WebP de até 25 MB.',
    }, { quoted: msg });
    return;
  }

  const senderJid = msg.key.participant || msg.key.remoteJid;
  let sticker = null;

  if (videoMsg) {
    const durSec = Number(videoMsg.seconds) || 0;
    if (durSec > VIDEO_INPUT_MAX_SECONDS) {
      await sock.sendMessage(jid, {
        text: `⚠️ O vídeo tem *${durSec}s*. O limite para criar figurinha é *${VIDEO_INPUT_MAX_SECONDS} segundos*. Envie um vídeo mais curto.`,
      }, { quoted: msg });
      return;
    }
    if (durSec > VIDEO_STICKER_MAX_SECONDS) {
      await sock.sendMessage(jid, {
        text: `🎬 Vídeo de *${durSec}s* detectado. Vou acelerar para caber em até *${VIDEO_STICKER_MAX_SECONDS}s*, preservando o conteúdo inteiro.`,
      }, { quoted: msg });
    }

    try {
      sticker = await videoToStickerBuffer(buffer, detectExt(buffer), durSec);
      if (!sticker || sticker.length < 100) {
        console.log('⚠️ Tentando fallback convertVideoToSticker...');
        sticker = await convertVideoToSticker(buffer, durSec);
      }
    } catch (e) {
      console.log('❌ Erro sticker vídeo:', e.message);
      if (e.code === 'VIDEO_TOO_LONG' || e.message?.startsWith('VIDEO_TOO_LONG:')) {
        await sock.sendMessage(jid, {
          text: `⚠️ O vídeo ultrapassa o limite de *${VIDEO_INPUT_MAX_SECONDS} segundos*. Envie um vídeo mais curto.`,
        }, { quoted: msg });
        return;
      }
      try {
        sticker = await convertVideoToSticker(buffer, durSec);
      } catch (fallbackError) {
        if (fallbackError.code === 'VIDEO_TOO_LONG' || fallbackError.message?.startsWith('VIDEO_TOO_LONG:')) {
          await sock.sendMessage(jid, {
            text: `⚠️ O vídeo ultrapassa o limite de *${VIDEO_INPUT_MAX_SECONDS} segundos*. Envie um vídeo mais curto.`,
          }, { quoted: msg });
          return;
        }
        await sock.sendMessage(jid, {
          text: '❌ Não consegui converter o vídeo para figurinha. Tente outro vídeo com até 20 segundos.',
        }, { quoted: msg });
        return;
      }
    }
  } else {
    try {
      sticker = await convertImageToSticker(buffer);
    } catch (e) {
      console.log('⚠️ Tentativa 1 falhou, normalizando imagem...', e.message);
      try {
        const normalized = await sharp(buffer, { limitInputPixels: 16_000_000 })
          .rotate()
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(384, 384, { fit: 'fill' })
          .webp({ quality: 85 })
          .toBuffer();
        sticker = await convertImageToSticker(normalized);
      } catch {
        await sock.sendMessage(jid, { text: '❌ Erro ao converter imagem. Tente outro arquivo.' }, { quoted: msg });
        return;
      }
    }
  }

  if (!sticker || sticker.length < 100) {
    await sock.sendMessage(jid, { text: '❌ Não consegui gerar a figurinha. Tente outro arquivo.' }, { quoted: msg });
    return;
  }

  if (senderJid) registrarSticker(senderJid, jid, stickerCount);

  try {
    await sock.sendMessage(jid, { sticker });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (e) {
    console.log('❌ Erro ao enviar sticker:', e.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui enviar a figurinha.' }, { quoted: msg });
  }

  console.log(`✅ Figurinha enviada! (${(sticker.length / 1024).toFixed(0)}KB)`);
}

// ═══════════════════════════════════════════════════════════════
// ─── !desfig / !toimg ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleDesfig(sock, msg, content, jid) {
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quoted      = contextInfo?.quotedMessage;

  if (!quoted?.stickerMessage) {
    await sock.sendMessage(jid, { text: '⚠️ Responda a uma *figurinha* com !desfig.' }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const buffer = await downloadMediaMessage(
    buildQuotedMsg(jid, contextInfo, quoted),
    'buffer', {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );
  if (!buffer || buffer.length > 25 * 1024 * 1024 || !isSupportedRasterImage(buffer)
      || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    await sock.sendMessage(jid, { text: '⚠️ Figurinha WebP inválida ou muito grande.' }, { quoted: msg });
    return;
  }

  // ✅ FIX: NÃO confiar no campo isAnimated do metadata — alguns clientes
  // WhatsApp não o enviam corretamente. Detectamos direto no buffer.
  const isAnimated = isAnimatedWebp(buffer);
  console.log(`🔍 desfig: isAnimated(metadata)=${quoted.stickerMessage.isAnimated} | isAnimated(buffer)=${isAnimated}`);

  if (isAnimated) {
    // O ffmpeg-static não consegue ler WebP animado diretamente como input.
    // Solução: extrair cada frame com sharp (que suporta WebP animado nativamente)
    // e montar o MP4 a partir dos PNGs — igual ao pipeline do videoToStickerBuffer.
    const ffmpegBin = resolveFfmpegBin();
    const tmpId     = crypto.randomUUID();
    const framesDir = path.join(os.tmpdir(), `${tmpId}_frames`);
    const outPath   = path.join(os.tmpdir(), `${tmpId}_out.mp4`);

    fs.mkdirSync(framesDir, { recursive: true });

    let frameCount = 0;
    try {
      // sharp lê todas as páginas (frames) de um WebP animado com { pages: -1 }
      const img   = sharp(buffer, { animated: true, limitInputPixels: 16_000_000 });
      const meta  = await img.metadata();
      const pages = meta.pages || 1;
      if (pages > VIDEO_MAX_FRAMES) throw new Error('Figurinha com quadros demais.');

      for (let i = 0; i < pages; i++) {
        const frameBuf = await sharp(buffer, { animated: false, page: i, limitInputPixels: 16_000_000 })
          .resize(512, 512, { fit: 'fill' })
          .png()
          .toBuffer();
        fs.writeFileSync(path.join(framesDir, `f_${String(i).padStart(4, '0')}.png`), frameBuf);
        frameCount++;
      }
    } catch (e) {
      console.log('❌ desfig sharp extract err:', e.message);
      try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
      await sock.sendMessage(jid, { text: '⚠️ Não consegui extrair os frames dessa figurinha.' }, { quoted: msg });
      return;
    }

    console.log(`📹 desfig: ${frameCount} frames extraídos via sharp`);

    const ok = await new Promise((resolve) => {
      execFile(ffmpegBin, [
        '-y',
        '-framerate', String(VIDEO_FPS),
        '-i', path.join(framesDir, 'f_%04d.png'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ], { timeout: 30000 }, (err, _, stderr) => {
        if (err) console.log('❌ desfig mp4 err:', stderr?.slice(-500));
        resolve(!err);
      });
    });

    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignora */ }

    if (!ok || !fs.existsSync(outPath)) {
      await sock.sendMessage(jid, { text: '⚠️ Não consegui montar o vídeo da figurinha.' }, { quoted: msg });
      return;
    }

    const videoBuffer = fs.readFileSync(outPath);
    try { fs.unlinkSync(outPath); } catch { /* ignora */ }

    await sock.sendMessage(jid, {
      video: videoBuffer, mimetype: 'video/mp4', caption: '🎬 Vídeo da figurinha!',
    }, { quoted: msg });

  } else {
    const jpegBuffer = await sharp(buffer, { limitInputPixels: 16_000_000 }).jpeg({ quality: 90 }).toBuffer();
    await sock.sendMessage(jid, {
      image: jpegBuffer, mimetype: 'image/jpeg', caption: '🖼️ Imagem da figurinha!',
    }, { quoted: msg });
  }
}

async function handleToImg(sock, msg, content, jid) {
  return handleDesfig(sock, msg, content, jid);
}

// ═══════════════════════════════════════════════════════════════
// ─── !togif ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleToGif(sock, msg, content, jid) {
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quoted      = contextInfo?.quotedMessage;

  if (!quoted?.stickerMessage) {
    await sock.sendMessage(jid, { text: '⚠️ Responda a uma *figurinha animada* com !togif.' }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const buffer = await downloadMediaMessage(
    buildQuotedMsg(jid, contextInfo, quoted),
    'buffer', {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );
  if (!buffer || buffer.length > 25 * 1024 * 1024 || !isSupportedRasterImage(buffer)
      || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    await sock.sendMessage(jid, { text: '⚠️ Figurinha WebP inválida ou muito grande.' }, { quoted: msg });
    return;
  }

  // ✅ FIX: detecta animação pelo buffer, não pelo metadata
  if (!isAnimatedWebp(buffer)) {
    await sock.sendMessage(jid, { text: '⚠️ Essa figurinha não é animada.' }, { quoted: msg });
    return;
  }

  const ffmpegBin = resolveFfmpegBin();
  const tmpId     = crypto.randomUUID();
  const framesDir = path.join(os.tmpdir(), `${tmpId}_frames`);
  const outPath   = path.join(os.tmpdir(), `${tmpId}_out.gif`);

  fs.mkdirSync(framesDir, { recursive: true });

  let frameCount = 0;
  try {
    const meta  = await sharp(buffer, { animated: true, limitInputPixels: 16_000_000 }).metadata();
    const pages = meta.pages || 1;
    if (pages > VIDEO_MAX_FRAMES) throw new Error('Figurinha com quadros demais.');
    for (let i = 0; i < pages; i++) {
      const frameBuf = await sharp(buffer, { animated: false, page: i, limitInputPixels: 16_000_000 })
        .resize(384, 384, { fit: 'fill' })
        .png()
        .toBuffer();
      fs.writeFileSync(path.join(framesDir, `f_${String(i).padStart(4, '0')}.png`), frameBuf);
      frameCount++;
    }
  } catch (e) {
    console.log('❌ togif sharp extract err:', e.message);
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
    await sock.sendMessage(jid, { text: '❌ Não consegui extrair os frames dessa figurinha.' }, { quoted: msg });
    return;
  }

  const ok = await new Promise((resolve) => {
    execFile(ffmpegBin, [
      '-y',
      '-framerate', String(VIDEO_FPS),
      '-i', path.join(framesDir, 'f_%04d.png'),
      '-vf', `fps=${VIDEO_FPS},scale=384:-1:flags=lanczos`,
      outPath,
    ], { timeout: 30000 }, (err) => resolve(!err));
  });

  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignora */ }

  if (!ok || !fs.existsSync(outPath)) {
    await sock.sendMessage(jid, { text: '❌ Não consegui converter para GIF.' }, { quoted: msg });
    return;
  }

  const gifBuf = fs.readFileSync(outPath);
  try { fs.unlinkSync(outPath); } catch { /* ignora */ }

  await sock.sendMessage(jid, {
    video: gifBuf, mimetype: 'video/mp4', gifPlayback: true, caption: '🎞️ GIF da figurinha!',
  }, { quoted: msg });
}

// (comando !roubar removido)

// ═══════════════════════════════════════════════════════════════
// ─── !estourar ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// ✅ Limite de duração — mesmo padrão do !audio (290s ≈ 4:50min).
// Checado ANTES do download, usando o campo "seconds" que o próprio
// WhatsApp já envia nos metadados do áudio — sem custo extra.
const MAX_DURATION_ESTOURAR = 290; // segundos

async function handleEstourar(sock, msg, content, jid) {
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quoted      = contextInfo?.quotedMessage;
  const textMsg     = content.conversation || content.extendedTextMessage?.text || '';

  const audioMsg = quoted?.audioMessage || quoted?.pttMessage;
  if (!audioMsg) {
    await sock.sendMessage(jid, {
      text: '⚠️ Responda a um *áudio* com *!estourar*.\nEx: *!estourar 80* _(padrão: 20x | máx: 100)_',
    }, { quoted: msg });
    return;
  }

  // ── Checar duração antes de baixar/processar ──────────────────
  const duracao = Number(audioMsg.seconds) || 0;
  if (duracao > MAX_DURATION_ESTOURAR) {
    const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    await sock.sendMessage(jid, {
      text:
        `❌ *Áudio muito longo!*\n\n` +
        `⏱️ Duração do áudio: *${fmt(duracao)}*\n` +
        `📏 Limite máximo: *${fmt(MAX_DURATION_ESTOURAR)}*\n\n` +
        `_Responda a um áudio mais curto._`,
    }, { quoted: msg });
    return;
  }

  const match  = textMsg.match(/estourar\s+(\d+)/i);
  const volume = Math.max(1, Math.min(100, match ? parseInt(match[1], 10) : 20));

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  let audioBuffer;
  try {
    audioBuffer = await downloadMediaMessage(
      buildQuotedMsg(jid, contextInfo, quoted),
      'buffer',
      {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );
  } catch (err) {
    console.error('[estourar] Erro no download do áudio:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não foi possível baixar o áudio. Tente novamente.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return;
  }

  const ffmpegBin = resolveFfmpegBin();
  const tmpId     = crypto.randomUUID();

  // ── Detectar extensão correta pelo mimetype ──────────────────
  const mimetype = audioMsg.mimetype || '';
  const inExt    = mimetype.includes('mp4') ? 'mp4'
                 : mimetype.includes('mp3') || mimetype.includes('mpeg') ? 'mp3'
                 : mimetype.includes('webm') ? 'webm'
                 : 'ogg';

  const inPath  = path.join(os.tmpdir(), `${tmpId}_in.${inExt}`);
  const outPath = path.join(os.tmpdir(), `${tmpId}_out.ogg`);

  const cleanup = () => {
    for (const f of [inPath, outPath]) {
      try { fs.unlinkSync(f); } catch { /* ignora */ }
    }
  };

  fs.writeFileSync(inPath, audioBuffer);

  const ok = await new Promise((resolve) => {
    execFile(
      ffmpegBin,
      [
        '-y', '-i', inPath,
        '-filter:a', `volume=${volume}`,
        '-c:a', 'libopus',
        '-b:a', '128k',       // aumentado para evitar truncamento
        '-vn',
        '-map_metadata', '-1',
        '-f', 'ogg',          // forçar formato OGG explicitamente
        outPath,
      ],
      { timeout: 60000 },     // aumentado para áudios longos
      (err) => {
        if (err) console.error('[estourar] FFmpeg erro:', err.message);
        resolve(!err);
      }
    );
  });

  if (!ok || !fs.existsSync(outPath)) {
    cleanup();
    await sock.sendMessage(jid, { text: '❌ Erro ao processar o áudio com FFmpeg.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return;
  }

  const outBuffer = fs.readFileSync(outPath);
  cleanup();

  try {
    await sock.sendMessage(jid, {
      audio:    outBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt:      true,
    }, { quoted: msg });

    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (err) {
    console.error('[estourar] Erro ao enviar áudio:', err.message);
    await sock.sendMessage(jid, { text: '❌ Áudio processado, mas falhou ao enviar.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
  }
}
// ═══════════════════════════════════════════════════════════════
// ─── !brat / !figtexto ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleBrat(sock, msg, jid, caption, getPrefix, stickerCount) {
  const P    = getPrefix(jid);
  const text = caption.replace(/^[!.,\/]brat\s*/i, '').trim();

  if (!text) {
    await sock.sendMessage(jid, {
      text: `⚠️ Digite um texto!\nEx: *${P}brat seu texto aqui*`,
    }, { quoted: msg });
    return false;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  try {
    const sticker   = await convertBratSticker(text);
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (senderJid) registrarSticker(senderJid, jid, stickerCount);
    await sock.sendMessage(jid, { sticker });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    return true;
  } catch (err) {
    console.error('[brat] Erro ao gerar sticker:', err.message);
    await sock.sendMessage(jid, { text: '❌ Erro ao gerar o sticker. Tente novamente.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return false;
  }
}

// !figtexto
async function handleFigtexto(sock, msg, jid, caption, getPrefix, stickerCount) {
  const P    = getPrefix(jid);
  const text = caption.replace(/^[!.,\/]figtexto\s*/i, '').trim();

  if (!text) {
    await sock.sendMessage(jid, {
      text: `⚠️ Digite um texto!\nEx: *${P}figtexto seu texto aqui*`,
    }, { quoted: msg });
    return false;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  try {
    const sticker   = await convertTextoSticker(text);
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (senderJid) registrarSticker(senderJid, jid, stickerCount);
    await sock.sendMessage(jid, { sticker });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    return true;
  } catch (err) {
    console.error('[figtexto] Erro ao gerar sticker:', err.message);
    await sock.sendMessage(jid, { text: '❌ Erro ao gerar o sticker. Tente novamente.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !attp / !attp2 / !attp3 ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleAttp(sock, msg, jid, caption, getPrefix, stickerCount, versao = 1) {
  const P = getPrefix(jid);
  const cmd = versao === 2 ? 'attp2' : versao === 3 ? 'attp3' : 'attp';
  const text = caption.replace(new RegExp(`^[!.,\\/]*${cmd}\\s*`, 'i'), '').trim();

  if (!text) {
    await sock.sendMessage(jid, {
      text: `⚠️ Escreva a frase que deseja colocar na figurinha.\nEx: *${P}${cmd} Bom dia galera!*`,
    }, { quoted: msg });
    return false;
  }

  if (Array.from(text).length > 80) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use até 80 caracteres para a figurinha ficar legível.',
    }, { quoted: msg });
    return false;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const senderJid = msg.key.participant || msg.key.remoteJid;
  const registerSticker = () => {
    if (senderJid) registrarSticker(senderJid, jid, stickerCount);
  };

  // O terceiro estilo é produzido localmente e não depende de API externa.
  if (versao === 3) {
    try {
      const sticker = await convertAttp3Sticker(text);
      await sock.sendMessage(jid, { sticker });
      registerSticker();
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
      return true;
    } catch (err) {
      console.error('[attp3] Falha ao gerar animação local:', err.message);
      await sock.sendMessage(jid, { text: '❌ Não consegui gerar a figurinha animada agora. Tente novamente mais tarde.' }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      return false;
    }
  }

  try {
    const endpoint = versao === 1 ? 'textsticker' : 'textsticker2';
    const url = `https://api.lolhuman.xyz/api/${endpoint}?apikey=galanggg&text=${encodeURIComponent(text)}`;
    const buf = await fetchBuffer(url);

    if (!buf || buf.length < 100) throw new Error('Buffer inválido ou vazio');
    if (!isAnimatedWebp(buf)) throw new Error('A API não retornou um WebP animado válido');

    await sock.sendMessage(jid, { sticker: buf });
    registerSticker();
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    return true;
  } catch (err) {
    console.error(`[${cmd}] API falhou; tentando gerar animação local:`, err.message);
    await sock.sendMessage(jid, { react: { text: '', key: msg.key } });

    try {
      const sticker = await convertAttp3Sticker(text);
      await sock.sendMessage(jid, { sticker });
      registerSticker();
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
      return true;
    } catch (fallbackErr) {
      console.error(`[${cmd}] Fallback animado falhou:`, fallbackErr.message);
      await sock.sendMessage(jid, {
        text: '❌ Não consegui gerar a figurinha animada agora. Tente novamente mais tarde.',
      }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      return false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !qc / !qc2 ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleQc(sock, msg, jid, caption, getPrefix, stickerCount, versao = 1) {
  const P   = getPrefix(jid);
  const cmd = versao === 2 ? 'qc2' : 'qc';
  const text = caption.replace(new RegExp(`^[!.,\\/]*${cmd}\\s*`, 'i'), '').trim();

  if (!text) {
    await sock.sendMessage(jid, {
      text: `⚠️ Digite um texto!\nEx: *${P}${cmd} Frase aqui*`,
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  try {
    const bgColor  = versao === 1 ? '#1a1a2e' : '#2d1b69';
    const txtColor = versao === 1 ? '#e0e0e0' : '#f8c6ff';
    const acColor  = versao === 1 ? '#e94560' : '#c084fc';

    // ── Quebra em linhas de até 28 caracteres (sem cortar palavras)
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > 28) {
        lines.push(cur.trim());
        cur = w;
      } else {
        cur = cur ? cur + ' ' + w : w;
      }
    }
    if (cur.trim()) lines.push(cur.trim());

    // ── Limita o número de linhas para não gerar imagens absurdas
    const MAX_LINES = 15;
    if (lines.length > MAX_LINES) {
      lines.length = MAX_LINES;
      lines[MAX_LINES - 1] = lines[MAX_LINES - 1].slice(0, 25).trim() + '...';
    }

    const lineHeight = 38;
    const padding    = 80;
    const h          = Math.max(200, lines.length * lineHeight + padding);

    // ── Escapar caracteres especiais XML
    const escape = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // ── Centraliza o bloco de texto verticalmente
    const blockHeight = lines.length * lineHeight;
    const startY      = (h - blockHeight) / 2 + lineHeight * 0.7;

    const textSvgLines = lines
      .map((l, i) =>
        `<text x="256" y="${startY + i * lineHeight}" font-family="Arial, sans-serif" font-size="24" fill="${txtColor}" text-anchor="middle">${escape(l)}</text>`
      )
      .join('\n    ');

    const svg = `<svg width="512" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="${h}" rx="20" fill="${bgColor}"/>
  <rect x="20" y="20" width="6" height="${h - 40}" rx="3" fill="${acColor}"/>
  ${textSvgLines}
</svg>`;

    const imgBuf    = await sharp(Buffer.from(svg)).resize(512, h).webp().toBuffer();
    const sticker   = await convertImageToSticker(imgBuf);
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (senderJid) registrarSticker(senderJid, jid, stickerCount);
    await sock.sendMessage(jid, { sticker });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (err) {
    console.error(`[${cmd}] Erro ao gerar sticker:`, err.message);
    await sock.sendMessage(jid, { text: '❌ Erro ao gerar o sticker. Tente novamente.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !emojimix ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleEmojiMix(sock, msg, jid, caption, getPrefix, stickerCount) {
  const P     = getPrefix(jid);
  const args  = caption.replace(/^[!.,\/]*emojimix\s*/i, '').trim();
  const parts = args.split('+').map(s => s.trim()).filter(Boolean);

  if (parts.length < 2) {
    await sock.sendMessage(jid, {
      text: `⚠️ Use: *${P}emojimix 😀+😎*`,
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const cp1 = parts[0].codePointAt(0)?.toString(16);
  const cp2 = parts[1].codePointAt(0)?.toString(16);

  if (!cp1 || !cp2) {
    await sock.sendMessage(jid, { text: '⚠️ Envie emojis válidos!' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return;
  }

  // A Emoji Kitchen tem datas de lançamento diferentes — tenta as principais
  const dates = ['20201001', '20211115', '20220406', '20220815', '20230301'];

  // Combinações possíveis: ordem normal e invertida, pasta baseada no primeiro emoji
  const combos = [
    { folder: cp1, pair: `u${cp1}_u${cp2}` },
    { folder: cp2, pair: `u${cp2}_u${cp1}` },
  ];

  let buf = null;

  outer:
  for (const date of dates) {
    for (const combo of combos) {
      try {
        const url = `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/u${combo.folder}/${combo.pair}.png`;
        buf = await fetchBuffer(url);
        if (buf && buf.length > 100) break outer;
      } catch {
        // tenta próxima combinação/data
      }
    }
  }

  if (!buf || buf.length <= 100) {
    await sock.sendMessage(jid, {
      text: '❌ Não foi possível misturar esses emojis. Tente outra combinação!',
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return;
  }

  try {
    const sticker   = await convertImageToSticker(buf);
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (senderJid) registrarSticker(senderJid, jid, stickerCount);
    await sock.sendMessage(jid, { sticker });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (err) {
    console.error('[emojimix] Erro ao converter sticker:', err.message);
    await sock.sendMessage(jid, { text: '❌ Erro ao gerar o sticker.' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !emoji ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleEmoji(sock, msg, jid, caption, getPrefix, stickerCount) {
  const P    = getPrefix(jid);
  const args = caption.replace(/^[!.,\/]*emoji\s*/i, '').trim();

  if (!args) {
    await sock.sendMessage(jid, {
      text: `⚠️ Use: *${P}emoji 😀* ou *${P}emoji 😀/apple*`,
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const [emojiPart, provider = 'twitter'] = args.split('/').map(s => s.trim());

  // ── Extrai TODOS os code points do emoji (suporta ZWJ, variação, tom de pele, bandeiras)
  const codePoints = [...emojiPart]
    .map(ch => ch.codePointAt(0))
    .filter(Boolean)
    // remove o seletor de variação (FE0F), que normalmente não entra no nome do arquivo
    .filter(cp => cp !== 0xFE0F)
    .map(cp => cp.toString(16));

  if (codePoints.length === 0) {
    await sock.sendMessage(jid, { text: '⚠️ Emoji inválido!' }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    return;
  }

  const cpHyphen   = codePoints.join('-');  // ex: twemoji multi-codepoint
  const cpUnderscore = codePoints.join('_'); // ex: noto/google multi-codepoint
  const cpSingle   = codePoints[0];          // primeiro code point (fallback / apple)

  // URLs por provedor (com fallback para twitter)
  const urls = {
    apple:   `https://em-content.zobj.net/source/apple/354/${cpSingle}.png`,
    twitter: `https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/72x72/${cpHyphen}.png`,
    google:  `https://fonts.gstatic.com/s/e/notoemoji/latest/${cpUnderscore}/emoji.svg`,
  };
  const url = urls[provider] || urls.twitter;

  try {
    const buf = await fetchBuffer(url);

    if (!buf || buf.length < 100) throw new Error('Imagem inválida ou vazia');

    const sticker   = await convertImageToSticker(buf);
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (senderJid) registrarSticker(senderJid, jid, stickerCount);
    await sock.sendMessage(jid, { sticker });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (err) {
    console.error('[emoji] Erro:', err.message);
    await sock.sendMessage(jid, {
      text: `❌ Não encontrei esse emoji${provider !== 'twitter' ? ` no provedor *${provider}*` : ''}. Tente outro!`,
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── BUSCA DE FIGURINHAS (Tenor) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function buscarFigurinha(sock, msg, jid, query, qtd, stickerCount) {
  const limit     = Math.min(Math.max(parseInt(qtd) || 1, 1), 10);
  const senderJid = msg.key.participant || msg.key.remoteJid;

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  try {
    const key  = process.env.GIPHY_KEY;
    if (!key) throw new Error('GIPHY_KEY não configurada no .env');

    const url  = `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query)}&api_key=${key}&limit=${limit}&rating=pg-13&lang=pt`;
    const buf  = await fetchBuffer(url);

    let data;
    try {
      data = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error('Resposta inválida da API do GIPHY');
    }

    if (data.meta?.status !== 200) {
      throw new Error(`GIPHY API error: ${data.meta?.msg || JSON.stringify(data.meta)}`);
    }

    const results = data.data || [];
    if (!results.length) throw new Error('sem resultados');

    let sent = 0;
    for (const item of results) {
      // Prefere mp4 (melhor qualidade/tamanho); fallback para gif
      const gifUrl =
        item.images?.original?.mp4 ||
        item.images?.downsized?.mp4 ||
        item.images?.original?.url ||
        item.images?.downsized?.url;

      if (!gifUrl) {
        console.warn('[figurinha] Item sem URL de mídia, pulando.');
        continue;
      }

      let gifBuf;
      try {
        gifBuf = await fetchBuffer(gifUrl);
      } catch (err) {
        console.warn('[figurinha] Falha ao baixar gif:', err.message);
        continue;
      }

      let sticker;
      try {
        const ext = detectExt(gifBuf);
        sticker   = await videoToStickerBuffer(gifBuf, ext === 'mp4' ? 'mp4' : 'gif');
        if (!sticker || sticker.length < 100) {
          sticker = await convertVideoToSticker(gifBuf);
        }
      } catch (err) {
        console.warn('[figurinha] Falha ao converter sticker:', err.message);
        continue;
      }

      if (!sticker || sticker.length < 100) {
        console.warn('[figurinha] Sticker gerado inválido, pulando.');
        continue;
      }

      try {
        await sock.sendMessage(jid, { sticker });
        if (senderJid) registrarSticker(senderJid, jid, stickerCount);
        sent++;
        if (limit > 1) await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        console.warn('[figurinha] Falha ao enviar sticker:', err.message);
      }
    }

    if (sent === 0) throw new Error('nenhum gif convertido com sucesso');

    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (err) {
    console.error('[figurinha] buscarFigurinha:', err.message);
    await sock.sendMessage(jid, {
      text: `❌ Não encontrei figurinhas de *${query}*. Tente outro tema!`,
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
  }
}

// ─── Categorias predefinidas ──────────────────────────────────

async function handleFigCategoria(sock, msg, jid, caption, cmd, query, stickerCount) {
  const rawQtd = caption.replace(new RegExp(`^[!.,\\/]*${cmd}\\s*`, 'i'), '').trim();
  const qtd    = rawQtd || '1';
  await buscarFigurinha(sock, msg, jid, query, qtd, stickerCount);
}

// ─── Pesquisa livre ───────────────────────────────────────────

async function handlePesquisaFig(sock, msg, jid, caption, getPrefix, stickerCount) {
  const P     = getPrefix(jid);
  const query = caption.replace(/^[!.,\/]*pesquisafig\s*/i, '').trim();

  if (!query) {
    await sock.sendMessage(jid, {
      text: `⚠️ Digite o que buscar!\nEx: *${P}pesquisafig cachorro fofo*`,
    }, { quoted: msg });
    return;
  }

  await buscarFigurinha(sock, msg, jid, query, 1, stickerCount);
}

// ═══════════════════════════════════════════════════════════════
// ─── !menufig ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleMenuFig(sock, msg, jid, getPrefix) {
  const P = getPrefix(jid);

  const menu =
`╔══════════════════════╗
     🎭 MENU FIGURINHAS
╚══════════════════════╝

🖼️ *CRIAR*
  ▸ ${P}s — imagem/vídeo → sticker
  ▸ ${P}f — alias do ${P}s
  ▸ ${P}attp — texto animado
  ▸ ${P}attp2 — texto animado v2
  ▸ ${P}attp3 — texto animado colorido
  ▸ ${P}brat _(texto)_
  ▸ ${P}figtexto _(texto)_
  ▸ ${P}qc _(texto)_
  ▸ ${P}qc2 _(texto)_
  ▸ ${P}emojimix _(😀+😎)_
  ▸ ${P}emoji _(😀)_

🔄 *CONVERTER*
  ▸ ${P}desfig — sticker → imagem/vídeo
  ▸ ${P}toimg — alias do ${P}desfig
  ▸ ${P}togif — sticker → GIF

🔊 *ÁUDIO*
  ▸ ${P}estourar — amplificar áudio de uma mídia

🔎 *PACOTES & BUSCA*
  ▸ ${P}fig <tema> — buscar figurinhas por categoria
  ▸ ${P}figemoji • ${P}figroblox • ${P}figmeme
  ▸ ${P}figcoreana • ${P}figraiva
  ▸ ${P}figengracada • ${P}figdesenho
  ▸ ${P}pesquisafig _(tema)_

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
  console.log('🎭 Menu figurinhas enviado');
}

// ═══════════════════════════════════════════════════════════════
// ─── EXPORTS ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

module.exports = {
  handleSticker,
  processMedia,
  handleDesfig,
  handleToImg,
  handleToGif,
  handleEstourar,
  handleBrat,
  handleFigtexto,
  handleAttp,
  handleQc,
  handleEmojiMix,
  handleEmoji,
  handleFigCategoria,
  handlePesquisaFig,
  handleMenuFig,
  setLogger,
  videoToStickerBuffer,
};