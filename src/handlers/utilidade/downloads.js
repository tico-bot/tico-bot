const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dns = require('node:dns').promises;
const net = require('node:net');
const sharp = require('sharp');
const { fetchBuffer } = require(path.join(__dirname, '..', '..', 'fetchurl'));
const { convertVideoToSticker } = require(path.join(__dirname, '..', '..', 'sticker'));

const blockedNetworks = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([address, prefix]) => blockedNetworks.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8],
].forEach(([address, prefix]) => blockedNetworks.addSubnet(address, prefix, 'ipv6'));

let _cachedYtDlpPath = null;
let _cachedFfmpegPath = null;
let _logger = console;

function setLogger(loggerInstance) {
  if (loggerInstance && typeof loggerInstance.info === 'function') {
    _logger = loggerInstance;
  }
}

// warn/error deste módulo NUNCA passam pelo logger injetado (que pode
// estar em modo 'silent', como o pino em bot.js). São falhas reais de
// download (yt-dlp/ffmpeg) — se forem silenciadas, o sintoma vira "o bot
// diz que não encontrou" sem nenhuma pista de por quê. info() continua
// respeitando o logger injetado, para não voltar a poluir o console
// com o volume normal de logs de progresso.
const log = {
  info:  (...a) => _logger.info ? _logger.info(...a) : console.log(...a),
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPublicAddress(address, family) {
  const normalized = address.split('%')[0];
  if (family === 6 && normalized.toLowerCase().startsWith('::ffff:')) {
    return isPublicAddress(normalized.slice(7), 4);
  }
  return !blockedNetworks.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}

async function resolvePublicAddress(hostname) {
  // WHATWG URL pode manter colchetes no hostname IPv6 (ex.: [::1]), mas
  // net.isIP/dns.lookup esperam o endereço sem colchetes.
  const normalizedHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const family = net.isIP(normalizedHost);
  const addresses = family
    ? [{ address: normalizedHost, family }]
    : await dns.lookup(normalizedHost, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address: resolved, family: resolvedFamily }) =>
    !isPublicAddress(resolved, resolvedFamily))) {
    throw new Error('O link aponta para um endereço de rede não permitido.');
  }
  return addresses[0];
}

async function validateExternalUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('O link informado não é válido.');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Use um link HTTPS público e sem credenciais.');
  }
  const resolved = await resolvePublicAddress(url.hostname);
  return {
    url,
    lookup: (_hostname, options, callback) => {
      if (options?.all) {
        callback(null, [{ address: resolved.address, family: resolved.family }]);
      } else {
        callback(null, resolved.address, resolved.family);
      }
    },
  };
}

async function expandirUrl(urlInicial) {
  let current = urlInicial;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const validated = await validateExternalUrl(current);
    const response = await axios.get(validated.url.href, {
      maxRedirects: 0,
      timeout: 10_000,
      responseType: 'stream',
      maxContentLength: 1,
      headers: {
        Range: 'bytes=0-0',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      lookup: validated.lookup,
      validateStatus: () => true,
    });
    response.data?.destroy();
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects === 5) throw new Error('O link contém redirecionamentos demais.');
      current = new URL(location, validated.url).href;
      continue;
    }
    return validated.url.href;
  }
  throw new Error('Não foi possível validar o destino do link.');
}

async function prepararLinkDownload(link) {
  return expandirUrl(link);
}

async function aceitarLinkDownload(sock, msg, jid, link) {
  try {
    return await prepararLinkDownload(link);
  } catch (error) {
    log.warn('Link de download recusado:', error.message);
    await sock.sendMessage(jid, {
      text: `⚠️ ${error.message || 'Não foi possível validar o destino desse link.'}`,
    }, { quoted: msg });
    return null;
  }
}

function getFfmpegPath() {
  if (_cachedFfmpegPath && fs.existsSync(_cachedFfmpegPath)) return _cachedFfmpegPath;

  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) { _cachedFfmpegPath = p; return p; }
  } catch {}

  const candidates = process.platform === 'win32'
    ? ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']
    : ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];

  for (const c of candidates) {
    if (fs.existsSync(c)) { _cachedFfmpegPath = c; return c; }
  }
  return 'ffmpeg';
}

function getFfprobePath() {
  try {
    const s = require('ffprobe-static');
    if (s?.path && fs.existsSync(s.path)) return s.path;
  } catch {}
  const candidates = process.platform === 'win32'
    ? [path.resolve(__dirname, '../node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe')]
    : ['/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return 'ffprobe';
}

function getYtDlpArgs() {
  const args = [];
  const ffmpegPath = getFfmpegPath();
  if (ffmpegPath && ffmpegPath !== 'ffmpeg') args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    const nodeExe = execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0].trim();
    if (nodeExe) args.push('--js-runtimes', `node:${nodeExe}`);
  } catch {}
  return args;
}

// Auto-download do binário yt-dlp no Linux/Render se não encontrado
async function ensureYtDlpBinary() {
  const tmpPath = '/tmp/yt-dlp';
  if (fs.existsSync(tmpPath)) {
    try {
      const { execSync } = require('child_process');
      execSync(`${tmpPath} --version`, { timeout: 5000 });
      return tmpPath;
    } catch {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  log.info('yt-dlp não encontrado — baixando binário do GitHub...');
  try {
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmpPath);
      require('https').get(
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
        (res) => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        }
      ).on('error', (err) => { try { fs.unlinkSync(tmpPath); } catch {} reject(err); });
    });
    fs.chmodSync(tmpPath, 0o755);
    log.info('✅ yt-dlp baixado em', tmpPath);
    return tmpPath;
  } catch (e) {
    log.warn('Não foi possível baixar yt-dlp:', e.message);
    return null;
  }
}

async function getYtDlpPath() {
  // Valida cache com --version para evitar binário corrompido
  if (_cachedYtDlpPath) {
    try {
      const { execSync } = require('child_process');
      execSync(`"${_cachedYtDlpPath}" --version`, { timeout: 5000 });
      return _cachedYtDlpPath;
    } catch {
      _cachedYtDlpPath = null;
    }
  }

  // Raiz do projeto — este arquivo mora em src/handlers/utilidade/, então
  // são 3 níveis acima até a raiz (D:\Project\Whatsapp ou equivalente em
  // produção). O antigo '../yt-dlp.exe' subia só 1 nível e nunca alcançava
  // esse local, era a causa do "não encontrei a música" mesmo com o
  // binário funcionando manualmente.
  const projectRoot = path.resolve(__dirname, '..', '..', '..');

  // 1) which / where
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
    const p = execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0].trim();
    if (p) { _cachedYtDlpPath = p; return p; }
  } catch {}

  // 2) Caminhos candidatos por plataforma
  const candidates = process.platform === 'win32' ? [
    // Raiz do projeto primeiro — é onde o binário standalone normalmente
    // fica (o mesmo que "npm start" já usa como cwd), então também tenta
    // via process.cwd() como reforço, caso o projeto seja movido depois.
    path.join(projectRoot, 'yt-dlp.exe'),
    path.join(process.cwd(), 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'Scripts', 'yt-dlp.exe'),
    'C:\\Python312\\Scripts\\yt-dlp.exe',
  ] : [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/home/user/.venv/bin/yt-dlp',
    '/opt/render/.venv/bin/yt-dlp',
    path.join(projectRoot, 'yt-dlp'),
    '/tmp/yt-dlp',
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const { execSync } = require('child_process');
        execSync(`"${c}" --version`, { timeout: 5000 });
        _cachedYtDlpPath = c;
        return c;
      }
    } catch {}
  }

  // 3) Busca com `find` no Linux
  if (process.platform !== 'win32') {
    try {
      const { execSync } = require('child_process');
      const found = execSync('find /usr /opt /home /tmp -name "yt-dlp" -type f 2>/dev/null | head -1', { timeout: 5000 })
        .toString().trim();
      if (found) {
        execSync(`"${found}" --version`, { timeout: 5000 });
        _cachedYtDlpPath = found;
        return found;
      }
    } catch {}
  }

  // 4) python -m yt_dlp como fallback no Linux
  if (process.platform !== 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync('python3 -m yt_dlp --version', { timeout: 5000 });
      const wrapper = '/tmp/yt-dlp-wrapper.sh';
      fs.writeFileSync(wrapper, '#!/bin/sh\nexec python3 -m yt_dlp "$@"\n');
      fs.chmodSync(wrapper, 0o755);
      _cachedYtDlpPath = wrapper;
      return wrapper;
    } catch {}
  }

  // 5) Auto-download .exe no Windows
  if (process.platform === 'win32') {
    const dlPath = path.join(projectRoot, 'yt-dlp.exe');
    if (!fs.existsSync(dlPath)) {
      log.info('yt-dlp não encontrado. Baixando automaticamente...');
      try {
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(dlPath);
          require('https').get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', (res) => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
          }).on('error', (err) => { try { fs.unlinkSync(dlPath); } catch {} reject(err); });
        });
        log.info('✅ yt-dlp.exe baixado em', dlPath);
      } catch (e) {
        log.warn('Não foi possível baixar yt-dlp.exe:', e.message);
      }
    }
    if (fs.existsSync(dlPath)) { _cachedYtDlpPath = dlPath; return dlPath; }
  }

  // 6) Auto-download binário Linux (Render)
  if (process.platform !== 'win32') {
    const downloaded = await ensureYtDlpBinary();
    if (downloaded) { _cachedYtDlpPath = downloaded; return downloaded; }
  }

  return 'yt-dlp';
}

function ytDlp(ytdlp, args, timeout = 120000) {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(ytdlp, args, { timeout, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        log.warn('yt-dlp err:', stderr?.slice(-400) || err.message);
        resolve({ ok: false, stdout: '', stderr: stderr || '' });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: '' });
      }
    });
  });
}

function ffmpeg(bin, args, timeout = 120000) {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 1024 * 1024 * 50 }, (err, _stdout, stderr) => {
      if (err) {
        log.warn('ffmpeg err:', stderr?.slice(-400) || err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// Lê metadados via yt-dlp (não bloqueia o fluxo principal)
async function fetchMeta(ytdlp, link, extraArgs = []) {
  const args = [...getYtDlpArgs(), '--no-playlist', '--skip-download', '--print-json', '-o', 'dummy', ...extraArgs, link];
  const { ok, stdout } = await ytDlp(ytdlp, args, 15000);
  if (!ok || !stdout) return null;
  try { return JSON.parse(stdout.trim()); } catch { return null; }
}

function formatMeta(meta) {
  if (!meta) return '';
  const parts = [];
  if (meta.title)      parts.push(`📌 *Título:* ${meta.title}`);
  if (meta.uploader || meta.channel) parts.push(`👤 *Canal:* ${meta.uploader || meta.channel}`);
  if (meta.duration)   parts.push(`⏱️ *Duração:* ${Math.floor(meta.duration/60)}:${String(meta.duration%60).padStart(2,'0')}`);
  if (meta.view_count) parts.push(`👁️ *Views:* ${Number(meta.view_count).toLocaleString('pt-BR')}`);
  return parts.length ? parts.join('\n') + '\n\n' : '';
}

const SIZE_LIMIT = 64 * 1024 * 1024;

// tmpPath/safeDel ficam definidos uma única vez, mais abaixo no arquivo
// (perto de limparTmpAntigos), usando a subpasta dedicada piroquinhas-tmp/.

// ─── Caption builder genérico ────────────────────────────────────────────────
function detectarPlataforma(sourceLink = '') {
  if (/tiktok/i.test(sourceLink))                  return '🎵 TikTok';
  if (/instagram/i.test(sourceLink))               return '📸 Instagram';
  if (/youtube\.com|youtu\.be/i.test(sourceLink))  return '▶️ YouTube';
  if (/twitter\.com|x\.com/i.test(sourceLink))     return '🐦 Twitter/X';
  if (/pinterest|pin\.it/i.test(sourceLink))       return '📌 Pinterest';
  if (/facebook|fb\.com/i.test(sourceLink))        return '📘 Facebook';
  if (/soundcloud/i.test(sourceLink))              return '🔊 SoundCloud';
  if (/spotify/i.test(sourceLink))                 return '🎧 Spotify';
  return '🌐 Web';
}

function buildCaption(meta, { fileSizeBytes, sourceLink, header, extraLines = [], fallbackTitulo } = {}) {
  const titulo     = meta?.title || fallbackTitulo || meta?.description?.slice(0, 100) || '—';
  const autor      = meta?.uploader || meta?.channel || meta?.artist || meta?.creator || meta?.uploader_id || null;
  const album      = meta?.album || null;
  const durSec     = meta?.duration || 0;
  const durStr     = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : null;
  const views      = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
  const likes      = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
  const comments   = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
  const shares     = meta?.repost_count  ? Number(meta.repost_count).toLocaleString('pt-BR')  : null;
  const width      = meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null;
  const fps        = meta?.fps           ? `${meta.fps} fps`                                  : null;
  const fileSize   = fileSizeBytes       ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`   : null;
  const tags       = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
  const uploadDate = meta?.upload_date
    ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
    : null;
  const videoUrl = meta?.webpage_url || sourceLink || null;
  const platform = detectarPlataforma(sourceLink);

  let txt = `━━━ [ ${header || platform} ] ━━━\n\n`;
  for (const linha of extraLines) txt += `${linha}\n`;
  txt += `📌 *Título:* ${titulo}\n`;
  if (autor)      txt += `👤 *Canal/Autor:* ${autor}\n`;
  if (album)      txt += `💿 *Álbum:* ${album}\n`;
  if (durStr)     txt += `⏱️ *Duração:* ${durStr}\n`;
  if (uploadDate) txt += `📅 *Postado em:* ${uploadDate}\n`;
  if (width)      txt += `🎞️ *Resolução:* ${width}\n`;
  if (fps)        txt += `⚡ *FPS:* ${fps}\n`;
  if (fileSize)   txt += `💾 *Tamanho:* ${fileSize}\n`;
  if (views || likes || comments || shares) txt += `\n`;
  if (views)    txt += `👁️ *Views:* ${views}\n`;
  if (likes)    txt += `❤️ *Curtidas:* ${likes}\n`;
  if (comments) txt += `💬 *Comentários:* ${comments}\n`;
  if (shares)   txt += `🔁 *Compartilhamentos:* ${shares}\n`;
  if (tags)     txt += `\n🏷️ *Tags:* ${tags}\n`;
  if (videoUrl) txt += `\n🔗 ${videoUrl}`;
  return txt;
}

const buildVideoCaption  = (meta, fileSizeBytes, sourceLink) =>
  buildCaption(meta, { fileSizeBytes, sourceLink });

const buildRecCaption    = (meta, fileSizeBytes, sourceLink) =>
  buildCaption(meta, { fileSizeBytes, sourceLink, extraLines: ['✂️ *Recorte:* primeiros 10 segundos', ''] });

const buildTiktokCaption = (meta, fileSizeBytes, sourceLink) =>
  buildCaption(meta, { fileSizeBytes, sourceLink, header: '🎵 *TikTok* 🎵' });

const buildAudioCaption  = (meta, fileSizeBytes, sourceLink) =>
  buildCaption(meta, { fileSizeBytes, sourceLink, extraLines: ['🎚️ *Qualidade:* MP3 192kbps'] });

const buildMp4Caption    = (meta, pending, fileSizeBytes) =>
  buildCaption(meta, {
    fileSizeBytes,
    sourceLink: meta?.webpage_url,
    header: '▶️ *YouTube*',
    fallbackTitulo: pending?.titulo || pending?.nome,
  });

const buildPinterestCaption = (meta, fileSizeBytes, sourceLink) =>
  buildCaption(meta, { fileSizeBytes, sourceLink, header: '📌 *Pinterest*' });

// ─── Handlers ─────────────────────────────────────────────────────────────────

// !save
async function handleSave(sock, msg, jid, caption) {
  let link = caption.replace(/^[!.,\/]*save\s*/i, '').trim();
  if (!link || !link.startsWith('http')) {
    return sock.sendMessage(jid, { text: '⚠️ Envie um link válido. Exemplo: *!save https://...*' }, { quoted: msg });
  }

  link = await aceitarLinkDownload(sock, msg, jid, link);
  if (!link) return;

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const ytdlp = await getYtDlpPath();
  const ffmpegBin = getFfmpegPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const outTemplate = tmpPath(id, '_raw.%(ext)s');

  // Metadados em background
  const metaPromise = fetchMeta(ytdlp, link);

  const baseArgs = [...getYtDlpArgs(), '--no-playlist', '--max-filesize', '200m'];
  if (/pinterest|pin\.it/i.test(link)) {
    baseArgs.push(
      '--referer', 'https://www.pinterest.com',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );
  }
  baseArgs.push('-o', outTemplate, link);

  const { ok: dlOk } = await ytDlp(ytdlp, baseArgs, 120000);
  if (!dlOk) {
    return sock.sendMessage(jid, { text: '❌ Não consegui baixar o conteúdo.' }, { quoted: msg });
  }

  const base = outTemplate.replace('.%(ext)s', '');
  const exts = ['.mp4','.mkv','.webm','.mov','.mp3','.m4a','.jpg','.jpeg','.png','.gif','.webp','.opus','.ogg','.pdf','.zip','.txt'];
  let filePath = exts.map(e => base + e).find(p => fs.existsSync(p)) || null;

  if (!filePath) {
    return sock.sendMessage(jid, { text: '❌ Arquivo baixado não encontrado.' }, { quoted: msg });
  }

  let buffer = fs.readFileSync(filePath);
  if (buffer.length < 1000) {
    safeDel(filePath);
    return sock.sendMessage(jid, { text: '❌ Conteúdo baixado está vazio.' }, { quoted: msg });
  }
  safeDel(filePath);

  let lower = filePath.toLowerCase();
  let name = path.basename(filePath);

  // Converte vídeo para MP4 compatível
  const videoExt = lower.match(/\.(mp4|mov|webm|mkv)$/);
  if (videoExt) {
    const inPath = tmpPath(id, `_in${videoExt[0]}`);
    const outPath = tmpPath(id, '_out.mp4');
    fs.writeFileSync(inPath, buffer);
    const ok = await ffmpeg(ffmpegBin, [
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-r', '30',
      '-profile:v', 'baseline', '-level', '3.0',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath
    ]);
    safeDel(inPath);
    if (ok && fs.existsSync(outPath)) {
      const conv = fs.readFileSync(outPath);
      if (conv.length > 1000) { buffer = conv; lower = outPath.toLowerCase(); name = name.replace(videoExt[0], '.mp4'); }
      safeDel(outPath);
    }
  }

  const meta = await metaPromise;

  // Caption detalhada para vídeos
  const buildVideoCaption = (meta, fileSizeBytes, sourceLink) => {
    const titulo     = meta?.title || meta?.description?.slice(0, 100) || null;
    const autor      = meta?.uploader || meta?.channel || meta?.creator || null;
    const durSec     = meta?.duration || 0;
    const durStr     = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : null;
    const views      = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
    const likes      = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
    const comments   = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
    const shares     = meta?.repost_count  ? Number(meta.repost_count).toLocaleString('pt-BR')  : null;
    const width      = meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null;
    const fps        = meta?.fps           ? `${meta.fps} fps`                                  : null;
    const fileSize   = fileSizeBytes       ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`  : null;
    const tags       = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
    const uploadDate = meta?.upload_date
      ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
      : null;

    const platform =
      /tiktok/i.test(sourceLink)           ? '🎵 TikTok'    :
      /instagram/i.test(sourceLink)        ? '📸 Instagram'  :
      /youtube\.com|youtu\.be/i.test(sourceLink) ? '▶️ YouTube'  :
      /twitter\.com|x\.com/i.test(sourceLink)    ? '🐦 Twitter/X' :
      /pinterest|pin\.it/i.test(sourceLink)      ? '📌 Pinterest' :
      /facebook|fb\.com/i.test(sourceLink)       ? '📘 Facebook'  :
      '🌐 Web';

    let txt = `━━━ [ ${platform} ] ━━━\n\n`;
    if (titulo)     txt += `📌 *Título:* ${titulo}\n`;
    if (autor)      txt += `👤 *Canal/Autor:* ${autor}\n`;
    if (durStr)     txt += `⏱️ *Duração:* ${durStr}\n`;
    if (uploadDate) txt += `📅 *Postado em:* ${uploadDate}\n`;
    if (width)      txt += `🎞️ *Resolução:* ${width}\n`;
    if (fps)        txt += `⚡ *FPS:* ${fps}\n`;
    if (fileSize)   txt += `💾 *Tamanho:* ${fileSize}\n`;
    if (views || likes || comments || shares) txt += `\n`;
    if (views)    txt += `👁️ *Views:* ${views}\n`;
    if (likes)    txt += `❤️ *Curtidas:* ${likes}\n`;
    if (comments) txt += `💬 *Comentários:* ${comments}\n`;
    if (shares)   txt += `🔁 *Compartilhamentos:* ${shares}\n`;
    if (tags)     txt += `\n🏷️ *Tags:* ${tags}\n`;
    txt += `\n🔗 ${sourceLink}`;
    return txt;
  };

  const infoText = formatMeta(meta);
  const isVideo = lower.match(/\.(mp4|mov|webm|mkv)$/);
  // Antes, quando isVideo era verdadeiro, o texto extra passado pra cap()
  // era sempre descartado — o usuário nunca via avisos como "enviado como
  // documento por ser grande demais". Agora esse aviso vem primeiro, e a
  // legenda de metadados continua logo abaixo.
  const cap = (txt) => {
    if (isVideo) {
      const metadados = buildVideoCaption(meta, buffer.length, link);
      return txt ? `${txt}\n\n${metadados}` : metadados;
    }
    return infoText ? infoText + txt : txt;
  };

  if (buffer.length > SIZE_LIMIT) {
    await sock.sendMessage(jid, { document: buffer, mimetype: 'application/octet-stream', fileName: name, caption: cap('📄 Arquivo muito grande — enviado como documento.') }, { quoted: msg });
  } else if (lower.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
    await sock.sendMessage(jid, { image: buffer, caption: cap('🖼️ Aqui está a imagem') }, { quoted: msg });
  } else if (lower.match(/\.(mp4|mov)$/)) {
    try {
      await sock.sendMessage(jid, { video: buffer, mimetype: 'video/mp4', caption: cap('🎬 Aqui está o vídeo') }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, { document: buffer, mimetype: 'application/octet-stream', fileName: name, caption: cap('📄 Vídeo enviado como documento.') }, { quoted: msg });
    }
  } else if (lower.match(/\.(webm|mkv)$/)) {
    await sock.sendMessage(jid, { document: buffer, mimetype: 'application/octet-stream', fileName: name, caption: cap('📄 Vídeo enviado como documento.') }, { quoted: msg });
  } else if (lower.match(/\.(mp3|m4a|opus|ogg)$/)) {
    if (infoText) await sock.sendMessage(jid, { text: infoText }, { quoted: msg });
    await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
  } else {
    await sock.sendMessage(jid, { document: buffer, mimetype: 'application/octet-stream', fileName: name, caption: cap('📄 Aqui está o arquivo') }, { quoted: msg });
  }

  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
}

// ──────────────────────────────────────────────────────────────────────────────

// !pinterest
async function handlePinterest(sock, msg, jid, caption) {
  let link = caption.replace(/^[!.,\/]*pinterest2?\s*/i, '').trim();
  if (!link || !link.startsWith('http')) {
    return sock.sendMessage(jid, { text: '⚠️ Envie um link válido do Pinterest. Exemplo: *!pinterest https://pin.it/...*' }, { quoted: msg });
  }

  link = await aceitarLinkDownload(sock, msg, jid, link);
  if (!link) return;

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const ytdlp = await getYtDlpPath();
  const ffmpegBin = getFfmpegPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const outTemplate = tmpPath(id, '_raw.%(ext)s');

  const metaPromise = fetchMeta(ytdlp, link);

  const dlArgs = [
    ...getYtDlpArgs(), '--no-playlist', '--max-filesize', '200m',
    '--referer', 'https://www.pinterest.com',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '-o', outTemplate, link,
  ];

  const { ok: dlOk } = await ytDlp(ytdlp, dlArgs, 120000);
  if (!dlOk) {
    return sock.sendMessage(jid, { text: '❌ Não consegui baixar esse Pin. Verifique se o link é válido.' }, { quoted: msg });
  }

  const base = outTemplate.replace('.%(ext)s', '');
  const exts = ['.mp4', '.mkv', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const filePath = exts.map(e => base + e).find(p => fs.existsSync(p)) || null;

  if (!filePath) {
    return sock.sendMessage(jid, { text: '❌ Arquivo do Pin não encontrado.' }, { quoted: msg });
  }

  let buffer = fs.readFileSync(filePath);
  if (buffer.length < 1000) {
    safeDel(filePath);
    return sock.sendMessage(jid, { text: '❌ Conteúdo do Pin está vazio.' }, { quoted: msg });
  }
  safeDel(filePath);

  let lower = filePath.toLowerCase();
  const isVideo = lower.match(/\.(mp4|mov|webm|mkv)$/);

  if (isVideo) {
    const inPath  = tmpPath(id, `_in${isVideo[0]}`);
    const outPath = tmpPath(id, '_out.mp4');
    fs.writeFileSync(inPath, buffer);
    const ok = await ffmpeg(ffmpegBin, [
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-r', '30',
      '-profile:v', 'baseline', '-level', '3.0',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath,
    ]);
    safeDel(inPath);
    if (ok && fs.existsSync(outPath)) {
      const conv = fs.readFileSync(outPath);
      if (conv.length > 1000) { buffer = conv; lower = outPath.toLowerCase(); }
      safeDel(outPath);
    }
  }

  const meta = await metaPromise;
  const finalCaption = buildPinterestCaption(meta, buffer.length, link);

  if (buffer.length > SIZE_LIMIT) {
    await sock.sendMessage(jid, {
      document: buffer, mimetype: 'application/octet-stream',
      fileName: path.basename(filePath), caption: finalCaption,
    }, { quoted: msg });
  } else if (lower.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
    await sock.sendMessage(jid, { image: buffer, caption: finalCaption }, { quoted: msg });
  } else {
    try {
      await sock.sendMessage(jid, { video: buffer, mimetype: 'video/mp4', caption: finalCaption }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, {
        document: buffer, mimetype: 'application/octet-stream',
        fileName: path.basename(filePath), caption: finalCaption,
      }, { quoted: msg });
    }
  }

  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
}

// ──────────────────────────────────────────────────────────────────────────────

// !saverec
async function handleSaveRec(sock, msg, jid, caption) {
  let link = caption.replace(/^[!.,\/]*saverec\s*/i, '').trim();
  if (!link || !link.startsWith('http')) {
    return sock.sendMessage(jid, { text: '⚠️ Envie um link válido. Exemplo: *!saverec https://...*' }, { quoted: msg });
  }
  link = await aceitarLinkDownload(sock, msg, jid, link);
  if (!link) return;

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const ytdlp = await getYtDlpPath();
  const ffmpegBin = getFfmpegPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const outTemplate = tmpPath(id, '_raw.%(ext)s');

  // Metadados em background
  const metaPromise = fetchMeta(ytdlp, link);

  const dlArgs = [...getYtDlpArgs(), '--no-playlist', '--max-filesize', '200m', '-o', outTemplate, link];
  if (/pinterest|pin\.it/i.test(link)) {
    dlArgs.push('--referer', 'https://www.pinterest.com', '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  }

  const { ok: dlOk } = await ytDlp(ytdlp, dlArgs, 120000);
  if (!dlOk) return sock.sendMessage(jid, { text: '❌ Não consegui baixar o conteúdo.' }, { quoted: msg });

  const base = outTemplate.replace('.%(ext)s', '');
  let filePath = ['.mp4','.mkv','.webm','.mov'].map(e => base + e).find(p => fs.existsSync(p)) || null;
  if (!filePath) return sock.sendMessage(jid, { text: '❌ Arquivo de vídeo não encontrado.' }, { quoted: msg });

  const recPath = tmpPath(id, '_rec.mp4');
  const ok = await ffmpeg(ffmpegBin, [
    '-y', '-i', filePath,
    '-t', '10', '-vf', 'scale=512:-2:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
    '-c:a', 'aac', '-b:a', '128k', recPath
  ]);
  safeDel(filePath);

  const usePath = (ok && fs.existsSync(recPath)) ? recPath : null;
  if (!usePath) return sock.sendMessage(jid, { text: '❌ Falha ao processar o vídeo.' }, { quoted: msg });

  const buffer = fs.readFileSync(usePath);
  safeDel(usePath);

  const meta = await metaPromise;

  const buildRecCaption = (meta, fileSizeBytes, sourceLink) => {
    const titulo     = meta?.title || meta?.description?.slice(0, 100) || null;
    const autor      = meta?.uploader || meta?.channel || meta?.creator || null;
    const durSec     = meta?.duration || 0;
    const durStr     = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : null;
    const views      = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
    const likes      = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
    const comments   = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
    const shares     = meta?.repost_count  ? Number(meta.repost_count).toLocaleString('pt-BR')  : null;
    const width      = meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null;
    const fps        = meta?.fps           ? `${meta.fps} fps`                                  : null;
    const fileSize   = fileSizeBytes       ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`  : null;
    const tags       = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
    const uploadDate = meta?.upload_date
      ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
      : null;

    const platform =
      /tiktok/i.test(sourceLink)                ? '🎵 TikTok'    :
      /instagram/i.test(sourceLink)             ? '📸 Instagram'  :
      /youtube\.com|youtu\.be/i.test(sourceLink)? '▶️ YouTube'   :
      /twitter\.com|x\.com/i.test(sourceLink)   ? '🐦 Twitter/X' :
      /pinterest|pin\.it/i.test(sourceLink)     ? '📌 Pinterest'  :
      /facebook|fb\.com/i.test(sourceLink)      ? '📘 Facebook'   :
      '🌐 Web';

    let txt = `━━━ [ ${platform} ] ━━━\n\n`;
    txt += `✂️ *Recorte:* primeiros 10 segundos\n\n`;
    if (titulo)     txt += `📌 *Título:* ${titulo}\n`;
    if (autor)      txt += `👤 *Canal/Autor:* ${autor}\n`;
    if (durStr)     txt += `⏱️ *Duração original:* ${durStr}\n`;
    if (uploadDate) txt += `📅 *Postado em:* ${uploadDate}\n`;
    if (width)      txt += `🎞️ *Resolução:* ${width}\n`;
    if (fps)        txt += `⚡ *FPS:* ${fps}\n`;
    if (fileSize)   txt += `💾 *Tamanho:* ${fileSize}\n`;
    if (views || likes || comments || shares) txt += `\n`;
    if (views)    txt += `👁️ *Views:* ${views}\n`;
    if (likes)    txt += `❤️ *Curtidas:* ${likes}\n`;
    if (comments) txt += `💬 *Comentários:* ${comments}\n`;
    if (shares)   txt += `🔁 *Compartilhamentos:* ${shares}\n`;
    if (tags)     txt += `\n🏷️ *Tags:* ${tags}\n`;
    txt += `\n🔗 ${sourceLink}`;
    return txt;
  };

  const finalCaption = buildRecCaption(meta, buffer.length, link);
  const name = path.basename(usePath);

  if (buffer.length > SIZE_LIMIT) {
    await sock.sendMessage(jid, { document: buffer, mimetype: 'application/octet-stream', fileName: name, caption: finalCaption }, { quoted: msg });
  } else {
    await sock.sendMessage(jid, { video: buffer, mimetype: 'video/mp4', caption: finalCaption }, { quoted: msg });
  }

  try {
    const stickerBuffer = await convertVideoToSticker(buffer);
    await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
  } catch (e) { log.warn('sticker err:', e.message); }

  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
}

// ──────────────────────────────────────────────────────────────────────────────

// !tiktok
async function handleTiktok(sock, msg, jid, caption, getPrefix) {
  const P = getPrefix(jid);
  let link = caption.replace(/^[!.,\/]*tiktok2?\s*/i, '').trim();
  if (!link || !link.startsWith('http')) {
    return sock.sendMessage(jid, { text: `⚠️ Envie o link do vídeo.\nExemplo: *${P}tiktok https://vm.tiktok.com/xxx*` }, { quoted: msg });
  }

  link = await aceitarLinkDownload(sock, msg, jid, link);
  if (!link) return;

  const ytdlp = await getYtDlpPath();
  const ffmpegBin = getFfmpegPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();

  const tiktokCookiesEnv = process.env.TIKTOK_COOKIES?.trim();
  let cookieFilePath = null;
  let cookieTempFile = null;

  if (tiktokCookiesEnv) {
    log.info(`✅ TIKTOK_COOKIES encontrado (${tiktokCookiesEnv.length} bytes)`);
    cookieTempFile = tmpPath(id, '_tiktok_cookies.txt');
    try { fs.writeFileSync(cookieTempFile, tiktokCookiesEnv, 'utf8'); cookieFilePath = cookieTempFile; } catch (e) { log.warn('Erro ao gravar cookie:', e.message); }
  } else {
    const local = path.join(__dirname, '../../tiktok_cookies.txt');
    if (fs.existsSync(local)) { cookieFilePath = local; log.info('✅ Usando cookies locais'); }
    else log.warn('⚠️ Sem cookies TikTok — pode falhar');
  }

  const cleanupCookie = () => { if (cookieTempFile) safeDel(cookieTempFile); };
  const metaExtraArgs = cookieFilePath ? ['--cookies', cookieFilePath] : [];
  const metaPromise = fetchMeta(ytdlp, link, metaExtraArgs);

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
  log.info(`🎵 tiktok: baixando ${link}`);

  const rawPath = tmpPath(id, '_raw.mp4');
  const outPath = tmpPath(id, '_out.mp4');

  const dlArgs = [
    ...getYtDlpArgs(),
    '--no-playlist',
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    '--referer', 'https://www.tiktok.com/',
  ];
  if (cookieFilePath) { dlArgs.push('--cookies', cookieFilePath); log.info('🍪 Usando cookies'); }
  dlArgs.push('-o', rawPath, link);

  const { ok: dlOk, stderr: dlStderr } = await ytDlp(ytdlp, dlArgs, 60000);
  if (!dlOk) {
    cleanupCookie();
    const isPhoto = /photo/i.test(dlStderr);
    return sock.sendMessage(jid, {
      text: isPhoto
        ? '⚠️ Esse link é um *post de foto* do TikTok, não um vídeo!'
        : '❌ Não consegui baixar o vídeo.\nVerifique se o link é válido.'
    }, { quoted: msg });
  }

  if (!fs.existsSync(rawPath)) {
    cleanupCookie();
    return sock.sendMessage(jid, { text: '❌ Não consegui baixar o vídeo.' }, { quoted: msg });
  }

  const encOk = await ffmpeg(ffmpegBin, [
    '-y', '-i', rawPath,
    '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
    '-preset', 'fast', '-crf', '28',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', outPath
  ]);

  safeDel(rawPath);

  if (!encOk || !fs.existsSync(outPath)) {
    cleanupCookie();
    return sock.sendMessage(jid, { text: '❌ Falha ao processar o vídeo.' }, { quoted: msg });
  }

  const videoBuffer = fs.readFileSync(outPath);
  safeDel(outPath);

  if (videoBuffer.length > SIZE_LIMIT) {
    cleanupCookie();
    return sock.sendMessage(jid, { text: '❌ Vídeo muito grande (máx 64MB).' }, { quoted: msg });
  }

  const meta = await metaPromise;

  const buildTiktokCaption = (meta, fileSizeBytes) => {
    const titulo   = meta?.title || meta?.description?.slice(0, 100) || '—';
    const autor    = meta?.uploader || meta?.creator || meta?.uploader_id || '—';
    const durSec   = meta?.duration || 0;
    const durStr   = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : '—';
    const views    = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
    const likes    = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
    const comments = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
    const shares   = meta?.repost_count  ? Number(meta.repost_count).toLocaleString('pt-BR')  : null;
    const tags     = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ')  : null;
    const width    = meta?.width         ? `${meta.width}x${meta.height}`                      : null;
    const fps      = meta?.fps           ? `${meta.fps} fps`                                   : null;
    const fileSize = fileSizeBytes       ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`   : null;
    const uploadDate = meta?.upload_date
      ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
      : null;

    let txt = `━━━ [ 🎵 *TikTok* 🎵 ] ━━━\n\n`;
    txt += `📌 *Título:* ${titulo}\n`;
    txt += `👤 *Criador:* @${autor}\n`;
    txt += `⏱️ *Duração:* ${durStr}\n`;
    if (uploadDate) txt += `📅 *Postado em:* ${uploadDate}\n`;
    if (width)      txt += `🎞️ *Resolução:* ${width}\n`;
    if (fps)        txt += `⚡ *FPS:* ${fps}\n`;
    if (fileSize)   txt += `💾 *Tamanho:* ${fileSize}\n`;
    txt += `\n`;
    if (views)    txt += `👁️ *Views:* ${views}\n`;
    if (likes)    txt += `❤️ *Curtidas:* ${likes}\n`;
    if (comments) txt += `💬 *Comentários:* ${comments}\n`;
    if (shares)   txt += `🔁 *Compartilhamentos:* ${shares}\n`;
    if (tags)     txt += `\n🏷️ *Tags:* ${tags}\n`;
    txt += `\n🔗 ${link}`;
    return txt;
  };

  const finalCaption = buildTiktokCaption(meta, videoBuffer.length);

  await sock.sendMessage(jid, { video: videoBuffer, mimetype: 'video/mp4', caption: finalCaption }, { quoted: msg });
  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  cleanupCookie();
}
// ──────────────────────────────────────────────────────────────────────────────

// !audio
async function handleAudioDownload(sock, msg, jid, caption) {
  let link = caption.replace(/^[!.,\/]*audio\s*/i, '').trim();
  if (!link || !link.startsWith('http')) {
    return sock.sendMessage(jid, { text: '⚠️ Envie o link do vídeo.\nExemplo: *!audio https://youtu.be/xxx*' }, { quoted: msg });
  }
  link = await aceitarLinkDownload(sock, msg, jid, link);
  if (!link) return;

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const ytdlp = await getYtDlpPath();
  const ffmpegBin = getFfmpegPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const rawTemplate = tmpPath(id, '_raw.%(ext)s');
  const outPath = tmpPath(id, '_out.mp3');

  // Metadados em background
  const metaPromise = fetchMeta(ytdlp, link);

  const dlArgs = [...getYtDlpArgs(), '--no-playlist', '-x', '--audio-format', 'best', '--audio-quality', '0', '--max-filesize', '100m', '-o', rawTemplate, link];
  const { ok: dlOk } = await ytDlp(ytdlp, dlArgs, 90000);
  if (!dlOk) return sock.sendMessage(jid, { text: '❌ Não consegui baixar o áudio.' }, { quoted: msg });

  const base = rawTemplate.replace('.%(ext)s', '');
  const rawPath = ['.mp3','.m4a','.opus','.ogg','.webm','.aac','.flac','.wav'].map(e => base + e).find(p => fs.existsSync(p)) || null;
  if (!rawPath) return sock.sendMessage(jid, { text: '❌ Arquivo de áudio não encontrado.' }, { quoted: msg });

  const encOk = await ffmpeg(ffmpegBin, [
    '-y', '-i', rawPath,
    '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2', outPath
  ]);
  safeDel(rawPath);

  if (!encOk || !fs.existsSync(outPath)) return sock.sendMessage(jid, { text: '❌ Falha ao processar o áudio.' }, { quoted: msg });

  const audioBuffer = fs.readFileSync(outPath);
  safeDel(outPath);

  if (audioBuffer.length > SIZE_LIMIT) return sock.sendMessage(jid, { text: '❌ Áudio muito grande (máx 64MB).' }, { quoted: msg });

  const meta = await metaPromise;

  const buildAudioCaption = (meta, fileSizeBytes, sourceLink) => {
    const titulo     = meta?.title || null;
    const autor      = meta?.uploader || meta?.channel || meta?.artist || meta?.creator || null;
    const album      = meta?.album || null;
    const durSec     = meta?.duration || 0;
    const durStr     = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : null;
    const views      = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
    const likes      = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
    const fileSize   = fileSizeBytes       ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`  : null;
    const tags       = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
    const uploadDate = meta?.upload_date
      ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
      : null;

    const platform =
      /youtube\.com|youtu\.be/i.test(sourceLink) ? '▶️ YouTube'   :
      /soundcloud/i.test(sourceLink)             ? '🔊 SoundCloud' :
      /spotify/i.test(sourceLink)                ? '🎧 Spotify'    :
      /tiktok/i.test(sourceLink)                 ? '🎵 TikTok'     :
      /instagram/i.test(sourceLink)              ? '📸 Instagram'   :
      /twitter\.com|x\.com/i.test(sourceLink)    ? '🐦 Twitter/X'  :
      '🌐 Web';

    let txt = `━━━ [ ${platform} ] ━━━\n\n`;
    if (titulo)     txt += `🎵 *Título:* ${titulo}\n`;
    if (autor)      txt += `👤 *Artista/Canal:* ${autor}\n`;
    if (album)      txt += `💿 *Álbum:* ${album}\n`;
    if (durStr)     txt += `⏱️ *Duração:* ${durStr}\n`;
    if (uploadDate) txt += `📅 *Postado em:* ${uploadDate}\n`;
    txt += `🎚️ *Qualidade:* MP3 192kbps\n`;
    if (fileSize)   txt += `💾 *Tamanho:* ${fileSize}\n`;
    if (views || likes) txt += `\n`;
    if (views)      txt += `👁️ *Views:* ${views}\n`;
    if (likes)      txt += `❤️ *Curtidas:* ${likes}\n`;
    if (tags)       txt += `\n🏷️ *Tags:* ${tags}\n`;
    txt += `\n🔗 ${sourceLink}`;
    return txt;
  };

  const infoCaption = buildAudioCaption(meta, audioBuffer.length, link);
  await sock.sendMessage(jid, { text: infoCaption }, { quoted: msg });
  await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  log.info('✅ Áudio MP3 enviado!');
}

// ──────────────────────────────────────────────────────────────────────────────

// !som (também atendido pelo alias !play, roteado aqui pelo router.js)
async function handleSom(sock, msg, jid, caption, getPrefix, pendingMusic) {
  const P = getPrefix(jid);
  // A regex precisa remover tanto "som" quanto "play", já que o router.js
  // manda os dois comandos pra esse mesmo handler. Antes só "som" era
  // reconhecido, então "!play nome da musica" caía aqui sem o prefixo ser
  // removido — "nome" virava "!play nome da musica" (comando incluso),
  // e era isso que ia parar na busca do yt-dlp.
  const nome = caption.replace(/^[!.,\/]*(som|play)\s*/i, '').trim();
  if (!nome) {
    return sock.sendMessage(jid, { text: `⚠️ Digite o nome da música.\nExemplo: *${P}som Ela Deixou um Bilhete* ou *${P}play Ela Deixou um Bilhete*` }, { quoted: msg });
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const ytdlp = await getYtDlpPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const outTemplate = tmpPath(id, '.%(ext)s');
  const query = `ytsearch1:${nome} official audio`;

  // ── Cookies do YouTube (evita "Sign in to confirm you're not a bot") ──
  console.log('YOUTUBE_COOKIES:', process.env.YOUTUBE_COOKIES ? `OK (${process.env.YOUTUBE_COOKIES.length} bytes)` : 'VAZIO');
  const youtubeCookiesEnv = process.env.YOUTUBE_COOKIES?.trim();
  let cookieFilePath = null;
  let cookieTempFile = null;
  if (youtubeCookiesEnv) {
    log.info(`✅ YOUTUBE_COOKIES encontrado (${youtubeCookiesEnv.length} bytes)`);
    cookieTempFile = tmpPath(id, '_youtube_cookies.txt');
    try {
      fs.writeFileSync(cookieTempFile, youtubeCookiesEnv, 'utf8');
      cookieFilePath = cookieTempFile;
    } catch (e) {
      log.warn('Erro ao gravar cookie do YouTube:', e.message);
    }
  } else {
    const local = path.join(__dirname, '../../youtube_cookies.txt');
    if (fs.existsSync(local)) {
      cookieFilePath = local;
      log.info('✅ Usando cookies locais do YouTube');
    } else {
      log.warn('⚠️ Sem cookies do YouTube — pode falhar com "Sign in to confirm"');
    }
  }
  const cleanupCookie = () => { if (cookieTempFile) safeDel(cookieTempFile); };
  const cookieArgs = cookieFilePath ? ['--cookies', cookieFilePath] : [];

  // Metadados em background
  const metaPromise = fetchMeta(ytdlp, query, ['--match-filter', '!is_live', ...cookieArgs]);

  const dlArgs = [
    ...getYtDlpArgs(), '--no-playlist', '-x', '--audio-format', 'mp3',
    '--audio-quality', '0', '--match-filter', '!is_live',
    '--max-filesize', '50m', ...cookieArgs, '-o', outTemplate, query
  ];
  const { ok } = await ytDlp(ytdlp, dlArgs, 90000);
  if (!ok) {
    cleanupCookie();
    return sock.sendMessage(jid, { text: `❌ Não encontrei a música *"${nome}"*.` }, { quoted: msg });
  }

  const base = outTemplate.replace('.%(ext)s', '');
  const finalPath = ['.mp3','.m4a','.opus','.ogg','.webm'].map(e => base + e).find(p => fs.existsSync(p)) || null;
  if (!finalPath) {
    cleanupCookie();
    return sock.sendMessage(jid, { text: `❌ Não encontrei a música *"${nome}"*.` }, { quoted: msg });
  }

  const audioBuffer = fs.readFileSync(finalPath);
  safeDel(finalPath);
  cleanupCookie();
  if (audioBuffer.length > SIZE_LIMIT) return sock.sendMessage(jid, { text: '❌ Arquivo muito grande (máx 64MB).' }, { quoted: msg });

  const meta = await metaPromise;

  // Thumbnail como card
  let cardBuffer = null;
  const thumbUrl = meta?.thumbnail || (meta?.thumbnails?.length ? meta.thumbnails[meta.thumbnails.length - 1]?.url : null);
  if (thumbUrl) {
    try {
      const thumbBuffer = await fetchBuffer(thumbUrl);
      const base64 = (await sharp(thumbBuffer).resize(800, 450, { fit: 'cover', position: 'centre' }).jpeg({ quality: 85 }).toBuffer()).toString('base64');
      const baseImage = Buffer.from(base64, 'base64');
      const overlay = Buffer.from(`<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="50%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity="0.82"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/></svg>`);
      cardBuffer = await sharp(baseImage).composite([{ input: overlay, blend: 'over' }]).jpeg({ quality: 88 }).toBuffer();
    } catch {}
  }
  if (!cardBuffer) {
    try {
      const svg = Buffer.from(`<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="450" fill="#0f3460"/></svg>`);
      cardBuffer = await sharp(svg).jpeg({ quality: 90 }).toBuffer();
    } catch {}
  }

  const titulo      = meta?.title || nome;
  const autor       = meta?.uploader || meta?.channel || meta?.artist || null;
  const album       = meta?.album || null;
  const durSec      = meta?.duration || 0;
  const durStr      = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : '—';
  const views       = meta?.view_count  ? Number(meta.view_count).toLocaleString('pt-BR')  : null;
  const likes       = meta?.like_count  ? Number(meta.like_count).toLocaleString('pt-BR')  : null;
  const comments    = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
  const fileSize    = `${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB`;
  const tags        = meta?.tags?.length ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
  const uploadDate  = meta?.upload_date
    ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
    : null;
  const videoUrl    = meta?.webpage_url || meta?.url || null;

  const senderJid = msg.key.participant || msg.key.remoteJid;
  pendingMusic.set(senderJid, { audioBuffer, titulo, meta, nome });
  setTimeout(() => pendingMusic.delete(senderJid), 10 * 60 * 1000);

  let texto = `━━━ [ 🎧 *Tico* 🎧 ] ━━━\n\n`;
  texto += `🔎 *Pesquisa:* _${nome}_\n\n`;
  texto += `🎵 *Título:* _${titulo}_\n`;
  if (autor)      texto += `👤 *Artista/Canal:* _${autor}_\n`;
  if (album)      texto += `💿 *Álbum:* _${album}_\n`;
  texto += `⏱️ *Duração:* ${durStr}\n`;
  if (uploadDate) texto += `📅 *Postado em:* ${uploadDate}\n`;
  texto += `🎚️ *Qualidade:* MP3 192kbps\n`;
  texto += `💾 *Tamanho:* ${fileSize}\n`;
  if (views || likes || comments) texto += `\n`;
  if (views)    texto += `👁️ *Views:* ${views}\n`;
  if (likes)    texto += `❤️ *Curtidas:* ${likes}\n`;
  if (comments) texto += `💬 *Comentários:* ${comments}\n`;
  if (tags)     texto += `\n🏷️ *Tags:* ${tags}\n`;
  if (videoUrl) texto += `\n🔗 ${videoUrl}\n`;
  texto += `\n━━━ [ 📱 *MAIS OPÇÕES* 📱 ] ━━━\n`;
  texto += `🎬 *${P}playmp4* - _Baixa como vídeo_\n`;
  texto += `📄 *${P}playdoc* - _Baixa como documento_`;

  if (cardBuffer) {
    await sock.sendMessage(jid, { image: cardBuffer, caption: texto }, { quoted: msg });
  } else {
    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
  }

  await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  log.info(`✅ Música "${titulo}" enviada!`);
}
// ──────────────────────────────────────────────────────────────────────────────

// !playmp4
async function handlePlayMp4(sock, msg, jid, getPrefix, pendingMusic) {
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const pending = pendingMusic.get(senderJid);
  const P = getPrefix(jid);
  if (!pending) return sock.sendMessage(jid, { text: `⚠️ Nenhuma música recente. Use *${P}som <música>* primeiro.` }, { quoted: msg });

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const ytdlp = await getYtDlpPath();
  const ffmpegBin = getFfmpegPath();
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const rawPath = tmpPath(id, '_raw.mp4');
  const outPath = tmpPath(id, '_out.mp4');
  let target = pending.meta?.webpage_url || `ytsearch1:${pending.nome} official video`;
  if (target.startsWith('http')) {
    target = await aceitarLinkDownload(sock, msg, jid, target);
    if (!target) return;
  }

  const dlArgs = [...getYtDlpArgs(), '--no-playlist', '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--max-filesize', '120m', '-o', rawPath, target];
  const { ok: dlOk } = await ytDlp(ytdlp, dlArgs, 180000);

  if (!dlOk || !fs.existsSync(rawPath)) return sock.sendMessage(jid, { text: '❌ Não consegui baixar o vídeo.' }, { quoted: msg });

  const encOk = await ffmpeg(ffmpegBin, [
    '-y', '-i', rawPath,
    '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
    '-preset', 'fast', '-crf', '28',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-max_muxing_queue_size', '1024', outPath
  ]);

  safeDel(rawPath);
  if (!encOk || !fs.existsSync(outPath)) return sock.sendMessage(jid, { text: '❌ Falha ao processar o vídeo.' }, { quoted: msg });

  const videoBuffer = fs.readFileSync(outPath);
  safeDel(outPath);

  if (videoBuffer.length > SIZE_LIMIT) return sock.sendMessage(jid, { text: '❌ Vídeo muito grande (máx 64MB).' }, { quoted: msg });

  const meta = pending.meta;

  const titulo      = meta?.title || pending.titulo || pending.nome;
  const autor       = meta?.uploader || meta?.channel || meta?.artist || null;
  const album       = meta?.album || null;
  const durSec      = meta?.duration || 0;
  const durStr      = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : null;
  const views       = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
  const likes       = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
  const comments    = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
  const width       = meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null;
  const fps         = meta?.fps           ? `${meta.fps} fps`                                  : null;
  const fileSize    = `${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`;
  const tags        = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
  const uploadDate  = meta?.upload_date
    ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
    : null;
  const videoUrl    = meta?.webpage_url || null;

  let finalCaption = `━━━ [ ▶️ *YouTube* ] ━━━\n\n`;
  finalCaption += `🎵 *Título:* ${titulo}\n`;
  if (autor)      finalCaption += `👤 *Artista/Canal:* ${autor}\n`;
  if (album)      finalCaption += `💿 *Álbum:* ${album}\n`;
  if (durStr)     finalCaption += `⏱️ *Duração:* ${durStr}\n`;
  if (uploadDate) finalCaption += `📅 *Postado em:* ${uploadDate}\n`;
  if (width)      finalCaption += `🎞️ *Resolução:* ${width}\n`;
  if (fps)        finalCaption += `⚡ *FPS:* ${fps}\n`;
  finalCaption += `💾 *Tamanho:* ${fileSize}\n`;
  if (views || likes || comments) finalCaption += `\n`;
  if (views)    finalCaption += `👁️ *Views:* ${views}\n`;
  if (likes)    finalCaption += `❤️ *Curtidas:* ${likes}\n`;
  if (comments) finalCaption += `💬 *Comentários:* ${comments}\n`;
  if (tags)     finalCaption += `\n🏷️ *Tags:* ${tags}\n`;
  if (videoUrl) finalCaption += `\n🔗 ${videoUrl}`;

  await sock.sendMessage(jid, { video: videoBuffer, mimetype: 'video/mp4', caption: finalCaption }, { quoted: msg });
  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
}

// ──────────────────────────────────────────────────────────────────────────────

// !playdoc
async function handlePlayDoc(sock, msg, jid, getPrefix, pendingMusic) {
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const pending = pendingMusic.get(senderJid);
  const P = getPrefix(jid);
  if (!pending) return sock.sendMessage(jid, { text: `⚠️ Nenhuma música recente. Use *${P}som <música>* primeiro.` }, { quoted: msg });

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

  const meta = pending.meta;

  const titulo      = meta?.title || pending.titulo || pending.nome;
  const autor       = meta?.uploader || meta?.channel || meta?.artist || null;
  const album       = meta?.album || null;
  const durSec      = meta?.duration || 0;
  const durStr      = durSec ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}` : null;
  const views       = meta?.view_count    ? Number(meta.view_count).toLocaleString('pt-BR')    : null;
  const likes       = meta?.like_count    ? Number(meta.like_count).toLocaleString('pt-BR')    : null;
  const comments    = meta?.comment_count ? Number(meta.comment_count).toLocaleString('pt-BR') : null;
  const fileSize    = `${(pending.audioBuffer.length / 1024 / 1024).toFixed(1)} MB`;
  const tags        = meta?.tags?.length  ? meta.tags.slice(0, 5).map(t => `#${t}`).join(' ') : null;
  const uploadDate  = meta?.upload_date
    ? `${meta.upload_date.slice(6,8)}/${meta.upload_date.slice(4,6)}/${meta.upload_date.slice(0,4)}`
    : null;
  const videoUrl    = meta?.webpage_url || null;

  let docCaption = `━━━ [ 🎵 *Música* ] ━━━\n\n`;
  docCaption += `🎵 *Título:* ${titulo}\n`;
  if (autor)      docCaption += `👤 *Artista/Canal:* ${autor}\n`;
  if (album)      docCaption += `💿 *Álbum:* ${album}\n`;
  if (durStr)     docCaption += `⏱️ *Duração:* ${durStr}\n`;
  if (uploadDate) docCaption += `📅 *Postado em:* ${uploadDate}\n`;
  docCaption += `🎚️ *Qualidade:* MP3 192kbps\n`;
  docCaption += `💾 *Tamanho:* ${fileSize}\n`;
  if (views || likes || comments) docCaption += `\n`;
  if (views)    docCaption += `👁️ *Views:* ${views}\n`;
  if (likes)    docCaption += `❤️ *Curtidas:* ${likes}\n`;
  if (comments) docCaption += `💬 *Comentários:* ${comments}\n`;
  if (tags)     docCaption += `\n🏷️ *Tags:* ${tags}\n`;
  if (videoUrl) docCaption += `\n🔗 ${videoUrl}`;

  const safeName = titulo.replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').slice(0, 60);

  await sock.sendMessage(jid, {
    document: pending.audioBuffer,
    mimetype: 'audio/mpeg',
    fileName: `${safeName}.mp3`,
    caption: docCaption
  }, { quoted: msg });

  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
}

function tmpPath(id, suffix) {
  const dir = path.join(require('os').tmpdir(), 'piroquinhas-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}${suffix}`);
}

function safeDel(...paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }
}

// ─── Limpeza de arquivos temporários órfãos ────────────────────────────────────
function limparTmpAntigos(maxIdadeMs = 10 * 60 * 1000) {
  try {
    const dir = path.join(require('os').tmpdir(), 'piroquinhas-tmp');
    if (!fs.existsSync(dir)) return;

    const agora = Date.now();
    let removidos = 0;

    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile() && (agora - stat.mtimeMs) > maxIdadeMs) {
          fs.unlinkSync(fp);
          removidos++;
        }
      } catch {}
    }

    if (removidos > 0) log.info(`🧹 Limpeza tmp: ${removidos} arquivo(s) removido(s).`);
  } catch (e) {
    log.error('[limparTmpAntigos] Erro:', e.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

// ─── Wrapper de segurança ───────────────────────────────────────────────────
// Garante que QUALQUER erro não tratado dentro de um handler de download:
//  1) não deixe a reação ⏳ travada pro usuário pra sempre;
//  2) avise o usuário em vez de falhar em silêncio;
//  3) seja logado de forma consistente.
function safeHandler(fn) {
  const wrapped = async function (...args) {
    const [sock, msg, jid] = args;
    try {
      return await fn(...args);
    } catch (err) {
      log.error(`❌ Erro em ${fn.name || 'handler de download'}: ${err.message}`);
      try {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
        await sock.sendMessage(
          jid,
          { text: '❌ Ocorreu um erro ao processar seu pedido. Tente novamente em instantes.' },
          { quoted: msg }
        );
      } catch (notifyErr) {
        log.error('❌ Falha até ao notificar erro ao usuário:', notifyErr.message);
      }
    }
  };
  Object.defineProperty(wrapped, 'name', { value: fn.name });
  return wrapped;
}

module.exports = {
  setLogger,
  handleSave:          safeHandler(handleSave),
  handleSaveRec:       safeHandler(handleSaveRec),
  handleTiktok:        safeHandler(handleTiktok),
  handleAudioDownload: safeHandler(handleAudioDownload),
  handleSom:           safeHandler(handleSom),
  handlePlayMp4:       safeHandler(handlePlayMp4),
  handlePlayDoc:       safeHandler(handlePlayDoc),
  handlePinterest:     safeHandler(handlePinterest),
  getYtDlpPath,
  getYtDlpArgs,
  getFfmpegPath,
  getFfprobePath,
  limparTmpAntigos,
  _isPublicAddress: isPublicAddress,
  _validateExternalUrl: validateExternalUrl,
};