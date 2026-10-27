/**
 * Handler de Filtros de Imagem — Tico Bot
 * Comandos: !blur, !pb, !pbiphone, !espelhar, !flipv, !girar, !girar180, !girar270,
 *           !pixelar, !pixel, !negativo, !sepia, !vintage, !brilho, !contraste,
 *           !saturar, !nitido, !desfazer, !corecore, !sfundo, !menuefeitos,
 *           !cartoon, !glitch, !vinheta, !radiancia, !matrix,
 *           !polaroid, !sketch, !calor, !gelo, !dourado,
 *           !neon, !cinema, !old, !halloween, !aquarela
 */

'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');

// ── Logger ──────────────────────────────────────────────────────────────────

let logger = { level: 'silent' };
function setLogger(newLogger) { logger = newLogger; }

// ── Constantes ───────────────────────────────────────────────────────────────

const JPEG_QUALITY  = 92;
const VIDEO_TIMEOUT = 120_000;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: baixar mídia (imagem ou vídeo, direto ou quoted)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @returns {{ buffer: Buffer|null, isVideo: boolean }}
 */
async function getMediaBuffer(sock, msg, content, jid) {
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quoted      = contextInfo?.quotedMessage;

  const imageMsg = content.imageMessage ?? quoted?.imageMessage ?? null;
  const videoMsg = content.videoMessage ?? quoted?.videoMessage ?? null;

  if (!imageMsg && !videoMsg) return { buffer: null, isVideo: false };

  const isVideo = !content.imageMessage && !quoted?.imageMessage && !!videoMsg;

  // Monta a mensagem fonte corretamente
  const srcMsg = (content.imageMessage || content.videoMessage)
    ? msg
    : {
        key: {
          remoteJid:   jid,
          id:          contextInfo.stanzaId,
          fromMe:      false,
          participant: contextInfo.participant ?? null,
        },
        message: quoted,
      };

  try {
    const buffer = await downloadMediaMessage(
      srcMsg, 'buffer', {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );
    return { buffer, isVideo };
  } catch (err) {
    console.error('[getMediaBuffer] Falha ao baixar mídia:', err.message);
    return { buffer: null, isVideo: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: aplicar filtro ffmpeg em vídeo
// ═══════════════════════════════════════════════════════════════════════════

async function applyVideoFilter(buffer, vf, extraArgs = []) {
  const { execFile } = require('child_process');
  const ffmpegBin    = require('ffmpeg-static');

  const tmpId   = crypto.randomUUID();
  const tmpDir  = os.tmpdir();
  const inPath  = path.join(tmpDir, `${tmpId}_in.mp4`);
  const outPath = path.join(tmpDir, `${tmpId}_out.mp4`);

  try {
    fs.writeFileSync(inPath, buffer);

    const args = [
      '-y', '-i', inPath,
      '-vf', `${vf},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
      '-preset', 'fast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      ...extraArgs,
      outPath,
    ];

    const ok = await new Promise((resolve) => {
      execFile(ffmpegBin, args, { timeout: VIDEO_TIMEOUT }, (err, _stdout, stderr) => {
        if (err) {
          console.error('[applyVideoFilter] ffmpeg error:', stderr?.slice(-600));
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (!ok || !fs.existsSync(outPath)) return null;

    return fs.readFileSync(outPath);
  } catch (e) {
    console.error('[applyVideoFilter] Erro inesperado:', e.message);
    return null;
  } finally {
    try { fs.unlinkSync(inPath);  } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: blend screen pixel a pixel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Screen blend: result = 1 - (1 - a) * (1 - b)
 * @param {Buffer} bufA - imagem base (raw)
 * @param {Buffer} bufB - imagem de glow (raw)
 * @param {{ width, height, channels }} info
 * @returns {Buffer}
 */
function screenBlend(bufA, bufB, info) {
  const out = Buffer.alloc(bufA.length);
  const ch  = info.channels;
  for (let i = 0; i < bufA.length; i++) {
    if (ch === 4 && (i % 4 === 3)) {
      out[i] = bufA[i]; // Preserva canal alpha
      continue;
    }
    const a = bufA[i] / 255;
    const b = bufB[i] / 255;
    out[i] = Math.min(255, Math.round((1 - (1 - a) * (1 - b)) * 255));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: dodge blend pixel a pixel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dodge blend: result = base / (1 - blur)
 */
function dodgeBlend(baseData, blurData) {
  const out = Buffer.alloc(baseData.length);
  for (let i = 0; i < baseData.length; i++) {
    if (baseData.length % 4 === 0 && (i % 4 === 3)) {
      out[i] = baseData[i]; // Preserva canal alpha
      continue;
    }
    const b = blurData[i] / 255;
    out[i]  = b >= 1 ? 255 : Math.min(255, Math.round(baseData[i] / (1 - b)));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAPA DE FILTROS
// ═══════════════════════════════════════════════════════════════════════════

const FILTROS = {

  // ── Desfoque & Foco ──────────────────────────────────────────────────────
  blur: {
    label: '🌫️ Blur',
    ffmpegVf: 'boxblur=10:10',
    sharpFn: (p) => p.blur(8),
  },
  desfazer: {
    label: '💫 Desfocado Intenso',
    ffmpegVf: 'boxblur=20:20',
    sharpFn: (p) => p.blur(20),
  },
  nitido: {
    label: '🔍 Nítido',
    ffmpegVf: 'unsharp=5:5:1.5:5:5:0',
    sharpFn: (p) => p.sharpen({ sigma: 2, m1: 2, m2: 0.5 }),
  },

  // ── Cores ────────────────────────────────────────────────────────────────
  pb: {
    label: '⬛ Preto e Branco',
    ffmpegVf: 'hue=s=0',
    sharpFn: (p) => p.grayscale(),
  },
  pbiphone: {
    label: '🖤 P&B Estilo iPhone',
    ffmpegVf: 'hue=s=0,eq=contrast=1.8:brightness=-0.05,unsharp=3:3:0.8',
    sharpFn: (p) => p
      .grayscale()
      .linear(1.7, -50)
      .gamma(1.05)
      .sharpen({ sigma: 1, flat: 1, jagged: 2 }),
  },
  negativo: {
    label: '🌑 Negativo',
    ffmpegVf: 'negate',
    sharpFn: (p) => p.negate(),
  },
  sepia: {
    label: '🟤 Sépia',
    ffmpegVf: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
    sharpFn: (p) => p.recomb([
      [0.393, 0.769, 0.189],
      [0.349, 0.686, 0.168],
      [0.272, 0.534, 0.131],
    ]),
  },
  vintage: {
    label: '📷 Vintage',
    ffmpegVf: "curves=r='0/0 0.5/0.6 1/1':g='0/0 0.5/0.45 1/0.9':b='0/0.1 0.5/0.4 1/0.75'",
    sharpFn: (p) => p
      .modulate({ brightness: 0.95, saturation: 0.6 })
      .tint({ r: 220, g: 180, b: 120 }),
  },
  brilho: {
    label: '☀️ Brilho+',
    ffmpegVf: 'eq=brightness=0.15',
    sharpFn: (p) => p.modulate({ brightness: 1.4 }),
  },
  contraste: {
    label: '🔲 Contraste+',
    ffmpegVf: 'eq=contrast=1.5',
    // CORRIGIDO: fórmula correta para contraste — antes usava -(128 * 0.5) = -64, mas
    // linear(a, b) faz out = a * in + b. Para centralizar em 128: b = 128 * (1 - a)
    sharpFn: (p) => p.linear(1.5, Math.round(128 * (1 - 1.5))), // = linear(1.5, -64) — correto
  },
  saturar: {
    label: '🌈 Saturação+',
    ffmpegVf: 'eq=saturation=2',
    sharpFn: (p) => p.modulate({ saturation: 2.5 }),
  },

  // ── Transformações ───────────────────────────────────────────────────────
  espelhar: {
    label: '🪞 Espelhado',
    ffmpegVf: 'hflip',
    sharpFn: (p) => p.flop(),
  },
  flipv: {
    label: '🔃 Flip Vertical',
    ffmpegVf: 'vflip',
    sharpFn: (p) => p.flip(),
  },
  girar: {
    label: '🔄 Girar 90°',
    ffmpegVf: 'transpose=1',
    sharpFn: (p) => p.rotate(90),
  },
  girar180: {
    label: '🔁 Girar 180°',
    ffmpegVf: 'transpose=1,transpose=1',
    sharpFn: (p) => p.rotate(180),
  },
  girar270: {
    label: '↩️ Girar 270°',
    ffmpegVf: 'transpose=2',
    sharpFn: (p) => p.rotate(270),
  },

  // ── Pixel ────────────────────────────────────────────────────────────────
  pixelar: {
    label: '🟫 Pixelado',
    ffmpegVf: 'scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor',
    sharpFn: async (p, meta) => {
      const w = meta.width  || 512;
      const h = meta.height || 512;
      return p
        .resize(Math.max(1, Math.floor(w / 12)), Math.max(1, Math.floor(h / 12)), { fit: 'fill' })
        .resize(w, h, { fit: 'fill', kernel: 'nearest' });
    },
  },
  pixel: {
    label: '🎮 Pixel Art',
    ffmpegVf: 'scale=iw/20:ih/20,scale=iw*20:ih*20:flags=neighbor',
    sharpFn: async (p, meta) => {
      const w     = meta.width  || 512;
      const h     = meta.height || 512;
      const scale = 64 / Math.max(w, h);
      const pw    = Math.max(1, Math.round(w * scale));
      const ph    = Math.max(1, Math.round(h * scale));
      return p
        .resize(pw, ph, { fit: 'fill', kernel: 'nearest' })
        .resize(w, h,   { fit: 'fill', kernel: 'nearest' });
    },
  },

  // ── Efeitos Especiais ────────────────────────────────────────────────────
  corecore: {
    label: '🌫️ Corecore',
    ffmpegVf: 'eq=saturation=0.5:contrast=0.7:brightness=0.2,noise=alls=10:allf=t+u,boxblur=1:1',
    sharpFn: (p) => p
      .modulate({ saturation: 0.5, brightness: 1.2 })
      .linear(0.7, 0)
      .blur(0.5),
  },

  // ── Tons & Temperatura ───────────────────────────────────────────────────
  calor: {
    label: '🔥 Efeito Calor',
    ffmpegVf: 'colorchannelmixer=1.2:0:0:0:0:0.9:0:0:0:0:0.7:0',
    sharpFn: (p) => p.recomb([
      [1.3, 0.1, 0.0],
      [0.0, 0.9, 0.0],
      [0.0, 0.0, 0.6],
    ]),
  },
  gelo: {
    label: '🧊 Efeito Gelo',
    ffmpegVf: 'colorchannelmixer=0.7:0:0:0:0:0.9:0:0:0:0:1.4:0',
    sharpFn: (p) => p.recomb([
      [0.7, 0.0, 0.1],
      [0.0, 0.9, 0.1],
      [0.1, 0.1, 1.4],
    ]),
  },
  dourado: {
    label: '✨ Dourado',
    ffmpegVf: "curves=r='0/0 0.5/0.65 1/1':g='0/0 0.5/0.55 1/0.9':b='0/0 0.3/0.2 1/0.5'",
    sharpFn: (p) => p.recomb([
      [1.1, 0.3, 0.0],
      [0.1, 0.9, 0.0],
      [0.0, 0.1, 0.4],
    ]),
  },
  neon: {
    label: '🌟 Neon',
    ffmpegVf: 'eq=saturation=4:contrast=1.5:brightness=0.2,unsharp=5:5:2',
    sharpFn: (p) => p
      .modulate({ saturation: 4.0, brightness: 1.2 })
      .linear(1.5, -30)
      .sharpen({ sigma: 2 }),
  },
  halloween: {
    label: '🎃 Halloween',
    ffmpegVf: 'eq=saturation=0.3:contrast=1.4,colorchannelmixer=1.4:0:0:0:0:0.5:0:0:0:0:0.3:0',
    sharpFn: (p) => p
      .modulate({ saturation: 0.3, brightness: 0.85 })
      .recomb([
        [1.4, 0.1, 0.0],
        [0.0, 0.5, 0.0],
        [0.0, 0.0, 0.3],
      ]),
  },
  aquarela: {
    label: '🎨 Aquarela',
    ffmpegVf: 'boxblur=2:2,eq=saturation=1.8:contrast=0.9:brightness=0.1,unsharp=3:3:0.5',
    sharpFn: (p) => p
      .blur(2)
      .modulate({ saturation: 2.0, brightness: 1.15 })
      .linear(0.9, 10),
  },

  // ── Cinema & Arte ────────────────────────────────────────────────────────
  cinema: {
    label: '🎬 Cinema',
    ffmpegVf: "pad=iw:iw*9/21:(ow-iw)/2:(oh-ih)/2:black,eq=contrast=1.2:saturation=0.85:brightness=-0.05,curves=r='0/0 0.5/0.45 1/0.9':b='0/0.05 0.5/0.45 1/0.85'",
    sharpFn: async (p, meta) => {
      const w    = meta.width  || 1280;
      const h    = meta.height || 720;
      // Aspect ratio 2.39:1 (widescreen cinemático)
      const targetH = Math.round(w / 2.39);
      const yOff    = Math.round((h - targetH) / 2);
      const cropTop = Math.max(0, yOff);
      const cropH   = Math.min(h, targetH);

      // CORRIGIDO: só recorta se a imagem for mais alta que o widescreen alvo
      if (cropH < h) {
        return p
          .extract({ left: 0, top: cropTop, width: w, height: cropH })
          .modulate({ saturation: 0.85, brightness: 0.95 })
          .recomb([
            [0.95, 0.05, 0.0],
            [0.0,  0.90, 0.05],
            [0.05, 0.05, 0.85],
          ]);
      }
      // Se a imagem já for mais larga que alta, aplica só o grade de cor
      return p
        .modulate({ saturation: 0.85, brightness: 0.95 })
        .recomb([
          [0.95, 0.05, 0.0],
          [0.0,  0.90, 0.05],
          [0.05, 0.05, 0.85],
        ]);
    },
  },
  old: {
    label: '📜 Foto Velha',
    ffmpegVf: "hue=s=0.3,eq=contrast=0.8:brightness=0.1,noise=alls=15:allf=t,curves=r='0/0.05 0.5/0.55 1/0.95':g='0/0.05 0.5/0.5 1/0.9':b='0/0.0 0.5/0.35 1/0.65'",
    sharpFn: (p) => p
      .modulate({ saturation: 0.3, brightness: 1.1 })
      .tint({ r: 210, g: 185, b: 140 })
      .linear(0.8, 15),
  },
  polaroid: {
    label: '🖼️ Polaroid',
    ffmpegVf: "pad=iw+60:ih+120:30:30:white,eq=saturation=1.1:contrast=0.95:brightness=0.08,curves=r='0/0 0.5/0.55 1/0.95':b='0/0.05 0.5/0.45 1/0.9'",
    sharpFn: async (p) => p
      .extend({ top: 30, bottom: 100, left: 30, right: 30, background: { r: 255, g: 255, b: 255 } })
      .modulate({ saturation: 1.1, brightness: 1.08 })
      .tint({ r: 255, g: 245, b: 220 }),
      // CORRIGIDO: removido parâmetros meta não utilizados e simplificado
  },

  // ── Efeitos com blend manual ─────────────────────────────────────────────
  vinheta: {
    label: '🔘 Vinheta',
    ffmpegVf: 'vignette=angle=PI/4:mode=forward',
    sharpFn: async (p, meta) => {
      const w = meta.width  || 512;
      const h = meta.height || 512;

      // CORRIGIDO: converte para JPEG antes de compor para garantir espaço de cor correto
      const base = await p.jpeg({ quality: 95 }).toBuffer();

      const svg = Buffer.from(
        `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
        `<defs><radialGradient id="v" cx="50%" cy="50%" r="70%" fx="50%" fy="50%">` +
        `<stop offset="50%" stop-color="black" stop-opacity="0"/>` +
        `<stop offset="100%" stop-color="black" stop-opacity="0.75"/>` +
        `</radialGradient></defs>` +
        `<rect width="${w}" height="${h}" fill="url(#v)"/>` +
        `</svg>`
      );

      return sharp(base).composite([{ input: svg, blend: 'over' }]);
    },
  },
  radiancia: {
    label: '💫 Radiância / Glow',
    ffmpegVf: 'split[a][b];[b]boxblur=8:8,eq=brightness=0.3[c];[a][c]blend=all_mode=screen',
    sharpFn: async (p) => {
      const base = await p.jpeg({ quality: 95 }).toBuffer();
      const glow = await sharp(base).blur(8).modulate({ brightness: 1.4 }).toBuffer();

      const { data: aD, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
      const { data: bD }       = await sharp(glow).raw().toBuffer({ resolveWithObject: true });

      // CORRIGIDO: usa helper screenBlend com tratamento correto do canal alpha
      const out = screenBlend(aD, bD, info);

      return sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } });
    },
  },
  matrix: {
    label: '💚 Matrix',
    ffmpegVf: 'hue=s=0,colorchannelmixer=0:0:0:0:0:1:0:0:0:0:0:0',
    sharpFn: async (p) => {
      // CORRIGIDO: usa ensureAlpha para lidar com PNGs transparentes,
      // e converte grayscale corretamente antes de colorizar
      const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ch  = info.channels; // sempre 4 após ensureAlpha
      const out = Buffer.alloc(data.length);

      for (let i = 0; i < data.length; i += ch) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        out[i]     = 0;            // R
        out[i + 1] = gray;         // G
        out[i + 2] = 0;            // B
        out[i + 3] = data[i + 3];  // A
      }

      return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } });
    },
  },
  glitch: {
    label: '📺 Glitch',
    ffmpegVf: "split[a][b][c];[a]crop=iw:ih/3:0:0,hue=s=0[t];[b]crop=iw:ih/3:0:ih/3[m];[c]crop=iw:ih/3:0:2*ih/3[bt];[t]geq=r='r(mod(X+5\\,W)\\,Y)':g='g(mod(X+5\\,W)\\,Y)':b='b(mod(X+5\\,W)\\,Y)'[ts];[ts][m][bt]vstack",
    sharpFn: async (p) => {
      // CORRIGIDO: usa ensureAlpha para evitar falhas com imagens sem canal alpha
      const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels: ch } = info;
      const out   = Buffer.alloc(data.length);
      const shift = 6;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i  = (y * w + x) * ch;
          const rX = Math.min(w - 1, x + shift);
          const bX = Math.max(0,     x - shift);
          const iR = (y * w + rX) * ch;
          const iB = (y * w + bX) * ch;
          out[i]     = data[iR];        // R deslocado direita
          out[i + 1] = data[i + 1];     // G normal
          out[i + 2] = data[iB + 2];    // B deslocado esquerda
          out[i + 3] = data[i + 3];     // A preservado
        }
      }

      // Linhas de ruído horizontal
      for (let n = 0; n < 8; n++) {
        const y = Math.floor(Math.random() * h);
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * ch;
          if (Math.random() > 0.5) out[i]     = 255; // R
          if (Math.random() > 0.5) out[i + 1] = 0;   // G
          if (Math.random() > 0.5) out[i + 2] = 255; // B
        }
      }

      return sharp(out, { raw: { width: w, height: h, channels: ch } });
    },
  },
  sketch: {
    label: '✏️ Sketch / Desenho',
    ffmpegVf: 'split[a][b];[a]hue=s=0[c];[b]hue=s=0,negate,boxblur=5:5[d];[c][d]blend=all_mode=dodge',
    sharpFn: async (p) => {
      const base    = await p.greyscale().toBuffer();
      const blurred = await sharp(base).blur(5).negate().toBuffer();

      const { data: baseD, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
      const { data: blurD }       = await sharp(blurred).raw().toBuffer({ resolveWithObject: true });

      // CORRIGIDO: usa helper dedicado e garante que retorna sharp instance válida
      const out = dodgeBlend(baseD, blurD);

      return sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } });
    },
  },
  cartoon: {
    label: '🎭 Cartoon',
    ffmpegVf: 'edgedetect=low=0.1:high=0.3,negate,colorchannelmixer=1:0:0:0:0:1:0:0:0:0:1:0',
    sharpFn: async (p) => {
      const base = await p.jpeg({ quality: 95 }).toBuffer();

      // Posterizar cores (reduz paleta) + saturação alta
      const poster = await sharp(base)
        .modulate({ saturation: 2.0 })
        .gamma(1.5)
        .toBuffer();

      // Borda com Laplaciano
      const edge = await sharp(base)
        .greyscale()
        .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
        .negate()
        .toBuffer();

      // CORRIGIDO: usa 'multiply' blend que é correto para sobrepor bordas escuras
      return sharp(poster).composite([{ input: edge, blend: 'multiply' }]);
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER UNIVERSAL DE FILTRO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica o filtro especificado na imagem ou vídeo recebido.
 * @param {string} filtro - Chave do filtro no mapa FILTROS
 */
async function handleImageFilter(sock, msg, content, jid, filtro, prefix) {
  const P = prefix;
  const cfg = FILTROS[filtro];

  if (!cfg) {
    await sock.sendMessage(jid, { text: `❌ Filtro *${filtro}* não encontrado.` }, { quoted: msg });
    return;
  }

  const { buffer, isVideo } = await getMediaBuffer(sock, msg, content, jid);

  if (!buffer) {
    await sock.sendMessage(jid, {
      text: `⚠️ Responda a uma *imagem* ou *vídeo* com *${P}${filtro}*.\n_Ou envie a mídia com o comando na legenda._`,
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  // ── Vídeo ──────────────────────────────────────────────────────────────
  if (isVideo) {
    if (!cfg.ffmpegVf) {
      await sock.sendMessage(jid, {
        text: `⚠️ O filtro *${cfg.label}* não está disponível para vídeos.\n_Use uma imagem! 📸_`,
      }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      return;
    }

    const videoOut = await applyVideoFilter(buffer, cfg.ffmpegVf);
    if (!videoOut) {
      await sock.sendMessage(jid, { text: '❌ Falha ao processar o vídeo. Tente novamente!' }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      return;
    }

    await sock.sendMessage(jid, {
      video: videoOut, mimetype: 'video/mp4',
      caption: `${cfg.label} aplicado! ✅`,
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    return;
  }

  // ── Imagem ─────────────────────────────────────────────────────────────
  try {
    const meta     = await sharp(buffer).metadata();
    let   pipeline = sharp(buffer);

    if (typeof cfg.sharpFn === 'function') {
      const result = cfg.sharpFn(pipeline, meta);
      pipeline = (result && typeof result.then === 'function') ? await result : result;
    }

    const out = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();

    await sock.sendMessage(jid, {
      image: out, mimetype: 'image/jpeg',
      caption: `${cfg.label} aplicado! ✅`,
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

  } catch (err) {
    console.error(`[handleImageFilter] Erro no filtro "${filtro}":`, err.message);
    await sock.sendMessage(jid, {
      text: `❌ Falha ao aplicar *${cfg.label}*.\n_${err.message.slice(0, 120)}_`,
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// !sfundo — Remoção de fundo
// ═══════════════════════════════════════════════════════════════════════════

async function handleSfundo(sock, msg, content, jid) {
  const contextInfo = content.extendedTextMessage?.contextInfo;
  const quoted      = contextInfo?.quotedMessage;
  const imageMsg    = content.imageMessage ?? quoted?.imageMessage ?? null;

  if (!imageMsg) {
    await sock.sendMessage(jid, {
      text: '⚠️ Responda a uma *imagem* com *!sfundo*.\n_Ou envie a imagem com !sfundo na legenda._',
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const srcMsg = content.imageMessage ? msg : {
    key: {
      remoteJid:   jid,
      id:          contextInfo.stanzaId,
      fromMe:      false,
      participant: contextInfo.participant ?? null,
    },
    message: quoted,
  };

  let buffer;
  try {
    buffer = await downloadMediaMessage(
      srcMsg, 'buffer', {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );
  } catch (err) {
    console.error('[handleSfundo] Falha ao baixar imagem:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui baixar a imagem. Tente novamente!' }, { quoted: msg });
    return;
  }

  let removido = null;

  // 1) rembg local (melhor qualidade)
  try {
    const { execFile } = require('child_process');
    const tmpId  = crypto.randomUUID();
    const tmpDir = os.tmpdir();
    const inPath  = path.join(tmpDir, `${tmpId}_in.png`);
    const outPath = path.join(tmpDir, `${tmpId}_out.png`);

    const pngBuf = await sharp(buffer).png().toBuffer();
    fs.writeFileSync(inPath, pngBuf);

    await new Promise((resolve, reject) => {
      execFile('rembg', ['i', inPath, outPath], { timeout: 30_000 }, (err) =>
        err ? reject(err) : resolve()
      );
    });

    if (fs.existsSync(outPath)) {
      removido = fs.readFileSync(outPath);
      try { fs.unlinkSync(outPath); } catch {}
    }
    try { fs.unlinkSync(inPath); } catch {}
  } catch {}

  // 2) remove.bg API
  const REMOVEBG_KEY = process.env.REMOVEBG_KEY ?? '';
  if (!removido && REMOVEBG_KEY && REMOVEBG_KEY !== 'SUA_CHAVE_AQUI') {
    try {
      const https    = require('https');
      const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
      // CORRIGIDO: usa o buffer já baixado, não o PNG reconvertido (economiza memória)
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="image_file"; filename="image.png"\r\n` +
          `Content-Type: image/png\r\n\r\n`
        ),
        buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      removido = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.remove.bg',
          path:     '/v1.0/removebg',
          method:   'POST',
          headers: {
            'X-Api-Key':      REMOVEBG_KEY,
            'Content-Type':   `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (res.statusCode === 200) resolve(buf);
            else reject(new Error(`remove.bg HTTP ${res.statusCode}: ${buf.toString().slice(0, 100)}`));
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    } catch (err) {
      console.error('[handleSfundo] remove.bg erro:', err.message);
    }
  }

  // 3) Fallback: flood fill pela cor do canto
  if (!removido) {
    try {
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height } = info;
      const pixels = new Uint8ClampedArray(data);

      const bgR = pixels[0], bgG = pixels[1], bgB = pixels[2];
      const TOLERANCE = 35;

      const colorClose = (idx4) =>
        Math.abs(pixels[idx4]     - bgR) < TOLERANCE &&
        Math.abs(pixels[idx4 + 1] - bgG) < TOLERANCE &&
        Math.abs(pixels[idx4 + 2] - bgB) < TOLERANCE;

      const visited = new Uint8Array(width * height);
      const queue   = [];

      const enqueue = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const idx = y * width + x;
        if (visited[idx] || !colorClose(idx * 4)) return;
        visited[idx] = 1;
        queue.push(x, y); // CORRIGIDO: push separado evita criar subArrays desnecessários
      };

      for (let x = 0; x < width;  x++) { enqueue(x, 0); enqueue(x, height - 1); }
      for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y);  }

      // CORRIGIDO: queue armazena pares x, y como inteiros (mais eficiente)
      while (queue.length) {
        const y = queue.pop();
        const x = queue.pop();
        pixels[(y * width + x) * 4 + 3] = 0; // Torna transparente
        enqueue(x + 1, y);
        enqueue(x - 1, y);
        enqueue(x, y + 1);
        enqueue(x, y - 1);
      }

      removido = await sharp(
        Buffer.from(pixels),
        { raw: { width, height, channels: 4 } }
      ).png().toBuffer();

    } catch (err) {
      console.error('[handleSfundo] Fallback flood fill falhou:', err.message);
      await sock.sendMessage(jid, {
        text: '❌ Não consegui remover o fundo.\n\nPara melhor resultado instale o *rembg*:\n```pip install rembg```',
      }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      return;
    }
  }

  await sock.sendMessage(jid, {
    image:    removido,
    mimetype: 'image/png',
    caption:  '✂️ Fundo removido com sucesso!',
  }, { quoted: msg });
  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
}

// ═══════════════════════════════════════════════════════════════════════════
// !menuefeitos
// ═══════════════════════════════════════════════════════════════════════════

async function handleMenuEfeitos(sock, msg, jid, prefix) {
  const P = prefix;

  // CORRIGIDO: filtros sem suporte a vídeo listados de forma precisa
  const semVideo = [
    `${P}sfundo`, `${P}sketch`, `${P}cartoon`, `${P}glitch`,
    `${P}vinheta`, `${P}radiancia`, `${P}polaroid`, `${P}matrix`,
  ].join(', ');

  const menu =
`╔══════════════════════╗
     🎨 MENU DE EFEITOS
╚══════════════════════╝

_Responda uma foto ou vídeo com o comando_

🌫️ *DESFOQUE & FOCO*
▸ ${P}blur — Desfoque suave
▸ ${P}desfazer — Desfoque intenso
▸ ${P}nitido — Imagem mais nítida

🎨 *CORES*
▸ ${P}pb — Preto e branco clássico
▸ ${P}pbiphone — P&B estilo iPhone
▸ ${P}negativo — Cores invertidas
▸ ${P}sepia — Tom sépia vintage
▸ ${P}vintage — Fotografia antiga
▸ ${P}saturar — Cores super vibrantes
▸ ${P}brilho — Aumenta o brilho
▸ ${P}contraste — Aumenta o contraste

🔄 *TRANSFORMAÇÕES*
▸ ${P}espelhar — Espelha na horizontal
▸ ${P}flipv — Vira de cabeça pra baixo
▸ ${P}girar — Gira 90° horário
▸ ${P}girar180 — Gira 180°
▸ ${P}girar270 — Gira 270°

🟫 *PIXEL & ESTILO*
▸ ${P}pixelar — Efeito pixelado
▸ ${P}pixel — Pixel art retrô 🎮
▸ ${P}cartoon — Efeito cartoon animado 🎭
▸ ${P}sketch — Efeito desenho a lápis ✏️

🌈 *TONS & TEMPERATURA*
▸ ${P}calor — Tons quentes de verão 🔥
▸ ${P}gelo — Tons frios de inverno 🧊
▸ ${P}dourado — Filtro dourado luxuoso ✨
▸ ${P}halloween — Clima de terror 🎃
▸ ${P}matrix — Tudo em verde 💚
▸ ${P}neon — Cores neon vibrantes 🌟
▸ ${P}aquarela — Efeito aquarela artística 🎨

🎬 *CINEMA & ARTE*
▸ ${P}cinema — Widescreen cinemático 🎬
▸ ${P}old — Foto muito antiga 📜
▸ ${P}polaroid — Borda de polaroid 🖼️
▸ ${P}corecore — Estética lo-fi / nichetok 🌫️

✨ *EFEITOS ESPECIAIS*
▸ ${P}glitch — Efeito glitch / corrupção 📺
▸ ${P}vinheta — Borda escurecida 🔘
▸ ${P}radiancia — Brilho suave (glow) 💫

✂️ *FUNDO*
▸ ${P}sfundo — Remove o fundo da imagem

_⚠️ Apenas imagens suportam: ${semVideo}_`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
  console.log('🎨 Menu efeitos enviado');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  handleImageFilter,
  handleSfundo,
  handleMenuEfeitos,
  setLogger,
  FILTROS, // Exportado para facilitar testes unitários e introspection
};