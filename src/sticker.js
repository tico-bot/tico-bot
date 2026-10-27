'use strict';

const sharp          = require('sharp');
const path           = require('path');
const fs             = require('fs');
const { execFile }   = require('child_process');
const { randomUUID } = require('crypto');
const os             = require('os');

// ═══════════════════════════════════════════════════════════════
// ─── CONSTANTS ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const STICKER_SIZE   = 512;
const VIDEO_SIZE     = 384;
const VIDEO_FPS      = 8;
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
const WEBP_QUALITY   = 85;

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: texto → SVG ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Escapa caracteres especiais de XML para uso seguro em SVG.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Quebra palavras em linhas respeitando um limite de caracteres por linha.
 * @param {string[]} words
 * @param {number} maxChars
 * @returns {string[]}
 */
function splitLines(words, maxChars) {
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // palavra maior que a linha: aceita mesmo assim para não travar
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/**
 * Gera um SVG 512×512 com o texto centralizado, ajustando o font-size
 * automaticamente para caber na área disponível.
 * @param {string} text
 * @param {string} bg    – cor de fundo CSS válida
 * @param {string} color – cor do texto CSS válida
 * @returns {string}     – markup SVG completo
 */
function makeTextSVG(text, bg, color) {
  const SIZE       = STICKER_SIZE;
  const PADDING    = 32;
  const AVAIL      = SIZE - PADDING;
  const CHAR_WIDTH = 0.60; // proporção aproximada largura/altura para Arial bold

  const words = String(text).trim().split(/\s+/);

  for (let fontSize = 120; fontSize >= 10; fontSize -= 2) {
    const maxChars = Math.floor(AVAIL / (fontSize * CHAR_WIDTH));
    if (maxChars < 1) continue;

    const lines      = splitLines(words, maxChars);
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;

    if (totalHeight > AVAIL) continue;
    // Verifica se alguma linha excede a largura disponível
    if (lines.some(l => l.length * fontSize * CHAR_WIDTH > AVAIL)) continue;

    const startY  = Math.round((SIZE - totalHeight) / 2) + fontSize;
    const textEls = lines
      .map((line, i) => {
        const y = Math.round(startY + i * lineHeight);
        return `<text x="${SIZE / 2}" y="${y}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="${color}">${escapeXml(line)}</text>`;
      })
      .join('');

    return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg"><rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${textEls}</svg>`;
  }

  // Fallback: tamanho mínimo, texto truncado
  const safe = escapeXml(text.slice(0, 60));
  return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg"><rect width="${SIZE}" height="${SIZE}" fill="${bg}"/><text x="${SIZE / 2}" y="${SIZE / 2}" font-size="10" text-anchor="middle" fill="${color}">${safe}</text></svg>`;
}

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: detecção de WebP animado ────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta se um buffer é um WebP animado verificando a assinatura
 * binária do chunk ANIM (presente apenas em WebP com animação).
 *
 * Estrutura resumida de um arquivo WebP:
 *   Bytes 0-3  → "RIFF"
 *   Bytes 4-7  → tamanho do arquivo (little-endian)
 *   Bytes 8-11 → "WEBP"
 *   A partir do byte 12 vêm chunks FourCC de 4 bytes.
 *   O chunk "ANIM" só existe em WebP animados (VP8X + ANIM + ANMFs).
 *
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isAnimatedWebp(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  // Verifica assinatura RIFF....WEBP
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  // Procura pelo chunk ANIM dentro dos primeiros 64 KB (está sempre no início)
  const searchLimit = Math.min(buf.length - 4, 65536);
  for (let i = 12; i < searchLimit; i++) {
    if (buf.toString('ascii', i, i + 4) === 'ANIM') return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// ─── HELPER: buffer → WebP 512×512 ───────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Converte qualquer buffer de imagem estática em WebP 512×512 preenchendo
 * o quadro completamente (sem bordas pretas, sem distorção visível).
 *
 * ⚠️  NÃO usar com WebP animado — o sharp lê apenas o primeiro frame.
 *     Use `roubarSticker` que detecta o tipo antes de chamar esta função.
 *
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function toStickerWebp(buffer) {
  return sharp(buffer)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: 'fill',
      withoutEnlargement: false,
    })
    .webp({ quality: WEBP_QUALITY, lossless: false })
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════
// ─── convertImageToSticker ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Converte um buffer de imagem (jpg, png, gif estático, webp…)
 * em sticker WebP 512×512.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function convertImageToSticker(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError('convertImageToSticker: buffer inválido ou vazio.');
  }
  if (!isSupportedRasterImage(buffer)) {
    throw new TypeError('convertImageToSticker: formato de imagem não permitido.');
  }

  // Normaliza para PNG antes de redimensionar — evita problemas com
  // metadados EXIF de orientação e canal alpha inesperado.
  const normalized = await sharp(buffer, { limitInputPixels: 16_000_000 })
    .rotate()          // corrige orientação EXIF automaticamente
    .toFormat('png')
    .toBuffer();

  return toStickerWebp(normalized);
}

function isSupportedRasterImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const isPng = buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif = buffer.length >= 6
    && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6));
  const isWebp = buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
  return isPng || isJpeg || isGif || isWebp;
}

// ═══════════════════════════════════════════════════════════════
// ─── convertVideoToSticker ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Converte um buffer de vídeo em sticker WebP animado 384×384.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function convertVideoToSticker(buffer, durationHint = 0) {
  return _convertVideoViaFrames(buffer, durationHint);
}

/**
 * Extrai frames do vídeo com ffmpeg e monta um WebP animado.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function _convertVideoViaFrames(buffer, durationHint = 0) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError('convertVideoToSticker: buffer inválido ou vazio.');
  }

  const tmpId     = randomUUID();
  const tmpDir    = os.tmpdir();
  const inPath    = path.join(tmpDir, `${tmpId}_in.mp4`);
  const framesDir = path.join(tmpDir, `${tmpId}_frames`);
  const outPath   = path.join(tmpDir, `${tmpId}_out.webp`);

  const ffmpegBin = resolveFfmpegBin();

  /**
   * Executa o ffmpeg com os argumentos fornecidos e retorna uma Promise.
   * @param {string[]} args
   * @param {number}   [timeoutMs=60000]
   * @returns {Promise<void>}
   */
  function runFfmpeg(args, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      execFile(ffmpegBin, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`ffmpeg falhou: ${stderr?.slice(-400) ?? err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  // ─── Escrita do arquivo de entrada ───────────────────────────
  fs.writeFileSync(inPath, buffer);
  fs.mkdirSync(framesDir, { recursive: true });

  try {
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
    const playbackFactor = duration > VIDEO_STICKER_MAX_SECONDS
      ? VIDEO_STICKER_MAX_SECONDS / duration
      : 1;
    const videoFilter = [
      ...(playbackFactor < 1 ? [`setpts=${playbackFactor.toFixed(8)}*PTS`] : []),
      `fps=${VIDEO_FPS}`,
      `scale=${VIDEO_SIZE}:${VIDEO_SIZE}`,
    ].join(',');

    // Acelera o vídeo quando necessário, mantendo todo o conteúdo em até 9 segundos.
    await runFfmpeg([
      '-y', '-i', inPath,
      '-vf', videoFilter,
      '-frames:v', String(VIDEO_MAX_FRAMES),
      '-f', 'image2',
      path.join(framesDir, 'f_%04d.png'),
    ]);

    const frameFiles = fs
      .readdirSync(framesDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .slice(0, VIDEO_MAX_FRAMES);

    if (frameFiles.length === 0) {
      throw new Error('Nenhum frame extraído do vídeo.');
    }

    // ─── Montagem do WebP animado ─────────────────────────────
    await runFfmpeg([
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

    if (!fs.existsSync(outPath)) {
      throw new Error('Arquivo WebP de saída não foi gerado.');
    }

    const result = fs.readFileSync(outPath);
    const sizeKb = (result.length / 1024).toFixed(0);
    console.log(
      `✅ Sticker WebP: ${sizeKb}KB ` +
      `(duração original:${duration ? duration.toFixed(2) + 's' : 'desconhecida'}, ` +
      `aceleração:${playbackFactor < 1 ? (1 / playbackFactor).toFixed(2) + 'x' : 'normal'}, fps:${VIDEO_FPS}, quality:${VIDEO_QUALITY}, ` +
      `frames:${frameFiles.length}, size:${VIDEO_SIZE}×${VIDEO_SIZE})`
    );
    return result;

  } finally {
    // ─── Limpeza garantida de arquivos temporários ────────────
    for (const p of [inPath, outPath]) {
      try { fs.unlinkSync(p); } catch { /* ignora */ }
    }
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignora */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── convertBratSticker ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Gera um sticker estilo "brat" — fundo verde-limão, texto branco em bold.
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
async function convertBratSticker(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('convertBratSticker: texto inválido.');
  }

  return sharp(Buffer.from(makeTextSVG(text.trim(), '#8ACE00', 'white')))
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: 'fill' })
    .webp({ quality: 80 })
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════
// ─── convertTextoSticker ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Gera um sticker de texto simples — fundo branco, texto preto em bold.
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
async function convertTextoSticker(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('convertTextoSticker: texto inválido.');
  }

  return sharp(Buffer.from(makeTextSVG(text.trim(), 'white', 'black')))
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: 'fill' })
    .webp({ quality: 80 })
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════
// ─── roubarSticker ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Re-processa um sticker existente devolvendo-o no formato WebP correto.
 *
 * - WebP **animado** (figurinha de vídeo): devolvido intacto, sem nenhum
 *   processamento pelo sharp — que só leria o primeiro frame e destruiria
 *   a animação.
 * - WebP **estático** ou qualquer outra imagem: redimensionado para
 *   512×512 via `toStickerWebp`.
 *
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function roubarSticker(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError('roubarSticker: buffer inválido ou vazio.');
  }

  if (isAnimatedWebp(buffer)) {
    // Figurinha de vídeo: devolve o WebP animado original sem alterações.
    return buffer;
  }

  // Figurinha estática: normaliza para 512×512.
  return toStickerWebp(buffer);
}

// ═══════════════════════════════════════════════════════════════
// ─── EXPORTS ──────────────────────────────────────────════════
// ═══════════════════════════════════════════════════════════════

module.exports = {
  convertImageToSticker,
  isSupportedRasterImage,
  convertVideoToSticker,
  convertBratSticker,
  convertTextoSticker,
  roubarSticker,
};