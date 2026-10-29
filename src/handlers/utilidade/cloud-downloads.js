'use strict';

const axios = require('axios');
const path = require('node:path');
const { _validateExternalUrl } = require('./downloads');

const MAX_FILE_SIZE = 64 * 1024 * 1024;
const MAX_PAGE_SIZE = 5 * 1024 * 1024;
const MAX_REDIRECTS = 6;
const MAX_CONCURRENT_DOWNLOADS = 2;
const DOWNLOAD_COOLDOWN_MS = 10_000;
const activeSenders = new Set();
const lastDownloadAt = new Map();
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const GOOGLE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
  'drive.googleusercontent.com',
]);

const MIME_BY_EXT = {
  '.7z': 'application/x-7z-compressed',
  '.apk': 'application/vnd.android.package-archive',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rar': 'application/vnd.rar',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xhtml': 'application/xhtml+xml',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

class DownloadError extends Error {
  constructor(message, code = 'DOWNLOAD_ERROR') {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

function isAllowedProviderUrl(input, provider) {
  let url;
  try { url = new URL(input); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (provider === 'mediafire') {
    return host === 'mediafire.com' || host.endsWith('.mediafire.com') ||
      host === 'mfi.re' || host.endsWith('.mfi.re');
  }
  if (provider === 'google') {
    return GOOGLE_HOSTS.has(host) || host.endsWith('.googleusercontent.com');
  }
  return false;
}

function assertProviderUrl(input, provider) {
  let url;
  try { url = new URL(input); } catch {
    throw new DownloadError('Esse link não é válido. Envie um link HTTPS completo.');
  }
  if (!isAllowedProviderUrl(url.href, provider)) {
    throw new DownloadError(provider === 'mediafire'
      ? 'Use um link HTTPS do MediaFire.'
      : 'Use um link HTTPS do Google Drive ou Google Workspace.');
  }
  return url;
}

function firstUrlFromCaption(caption, commandName) {
  const text = String(caption || '').trim();
  const commandMatch = text.match(/^\S+/);
  if (!commandMatch) return '';
  const command = commandMatch[0];
  const prefix = command.replace(new RegExp(`${commandName}$`, 'i'), '');
  if (!prefix || prefix === command) return '';
  const remaining = text.slice(command.length).trim();
  const match = remaining.match(/https:\/\/[^\s<>]+/i);
  return match ? match[0].replace(/[),.!?;\]]+$/, '') : '';
}

function decodeNumericEntity(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '';
  return String.fromCodePoint(value);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&#x3d;/gi, '=')
    .replace(/&#(\d+);/g, (_, code) => decodeNumericEntity(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeNumericEntity(parseInt(code, 16)));
}

function getHtmlAttribute(tag, attribute) {
  const safeName = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\s)${safeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(regex);
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function extractMediafireDownloadUrl(html, pageUrl) {
  const anchors = String(html || '').match(/<a\b[^>]*>/gi) || [];
  const choices = [];
  for (const tag of anchors) {
    const href = getHtmlAttribute(tag, 'href');
    if (!href) continue;
    const id = getHtmlAttribute(tag, 'id').toLowerCase();
    const classes = getHtmlAttribute(tag, 'class').toLowerCase();
    let absolute;
    try { absolute = new URL(href, pageUrl).href; } catch { continue; }
    if (!isAllowedProviderUrl(absolute, 'mediafire')) continue;
    if (id === 'downloadbutton') return absolute;
    if (/download_link|download-button/.test(classes)) choices.push(absolute);
    else if (/^https:\/\/download[^/]*\.mediafire\.com\//i.test(absolute)) choices.push(absolute);
  }
  return choices[0] || null;
}

function extractGoogleDownloadSpec(input) {
  const source = assertProviderUrl(input, 'google');
  const pathName = source.pathname;
  const workspaceMatch = pathName.match(/\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/i);
  if (workspaceMatch) {
    const kind = workspaceMatch[1].toLowerCase();
    const id = workspaceMatch[2];
    const specs = {
      document: { format: 'docx', baseName: 'documento-google', mimeType: MIME_BY_EXT['.docx'] },
      spreadsheets: { format: 'xlsx', baseName: 'planilha-google', mimeType: MIME_BY_EXT['.xlsx'] },
      presentation: { format: 'pptx', baseName: 'apresentacao-google', mimeType: MIME_BY_EXT['.pptx'] },
    };
    const spec = specs[kind];
    const exportUrl = new URL(`https://docs.google.com/${kind}/d/${id}/export`);
    exportUrl.searchParams.set('format', spec.format);
    const resourceKey = source.searchParams.get('resourcekey');
    if (resourceKey) exportUrl.searchParams.set('resourcekey', resourceKey);
    return {
      url: exportUrl.href,
      fileId: id,
      fallbackName: `${spec.baseName}.${spec.format}`,
      expectedMimeType: spec.mimeType,
      workspaceKind: kind,
    };
  }

  const fileMatch = pathName.match(/\/(?:file\/d|uc\/d)\/([A-Za-z0-9_-]+)/i);
  const id = fileMatch?.[1] || source.searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
    throw new DownloadError('Não consegui identificar o arquivo. Envie o link de um arquivo, não de uma pasta, atalho ou página de pesquisa.');
  }
  const downloadUrl = new URL('https://drive.usercontent.google.com/download');
  downloadUrl.searchParams.set('id', id);
  downloadUrl.searchParams.set('export', 'download');
  downloadUrl.searchParams.set('authuser', '0');
  downloadUrl.searchParams.set('confirm', 't');
  const resourceKey = source.searchParams.get('resourcekey');
  if (resourceKey) downloadUrl.searchParams.set('resourcekey', resourceKey);
  return {
    url: downloadUrl.href,
    fileId: id,
    fallbackName: `arquivo-google-drive-${id.slice(0, 8)}.bin`,
    expectedMimeType: 'application/octet-stream',
    workspaceKind: null,
  };
}

function sanitizeFilename(value, fallback = 'arquivo.bin') {
  let name = String(value || '').replace(/[\\/]/g, '_').replace(/[\0-\x1f\x7f]/g, '').replace(/^\.+$/, '').trim();
  name = name.replace(/\s+/g, ' ').replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (!name || name === '.' || name === '..') name = fallback;
  return name;
}

function filenameFromDisposition(header) {
  const value = String(header || '');
  const utf8 = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8) {
    try { return sanitizeFilename(decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''))); } catch {}
  }
  const plain = value.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
  return plain ? sanitizeFilename(plain[1] ?? plain[2] ?? plain[3]) : '';
}

function filenameFromMediafirePage(html) {
  const title = decodeHtml(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s*[-|]\s*MediaFire\s*$/i, '')
    .replace(/^Download\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitizeFilename(title, 'arquivo-mediafire.bin');
}

function isHtmlBuffer(buffer, contentType = '') {
  if (/text\/html|application\/xhtml\+xml/i.test(String(contentType))) return true;
  const sample = Buffer.isBuffer(buffer) ? buffer.subarray(0, 512).toString('utf8') : String(buffer || '').slice(0, 512);
  return /^\s*(?:<!doctype\s+html|<html\b|<head\b|<form\b)/i.test(sample);
}

function guessMimeType(filename, responseContentType, expectedMimeType) {
  const supplied = String(responseContentType || '').split(';')[0].trim().toLowerCase();
  if (supplied && supplied !== 'application/octet-stream' && supplied !== 'binary/octet-stream' && supplied !== 'text/html') return supplied;
  const byExt = MIME_BY_EXT[path.extname(filename).toLowerCase()];
  return byExt || expectedMimeType || 'application/octet-stream';
}

function ensureExtension(filename, fallbackName) {
  const fallbackExt = path.extname(fallbackName || '');
  if (fallbackExt && !path.extname(filename)) return `${filename}${fallbackExt}`;
  return filename;
}

async function openFollowingRedirects(inputUrl, provider, options = {}) {
  let current = assertProviderUrl(inputUrl, provider);
  const cookies = new Map(Object.entries(options.cookies || {}));
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Revalidar domínio e DNS em todas as etapas impede redirecionamentos para redes privadas.
    assertProviderUrl(current.href, provider);
    const validated = await _validateExternalUrl(current.href);
    const cookieHeader = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await axios.get(current.href, {
      responseType: 'stream',
      maxRedirects: 0,
      timeout: 25_000,
      maxContentLength: MAX_FILE_SIZE,
      maxBodyLength: 1024 * 1024,
      proxy: false,
      lookup: validated.lookup,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      validateStatus: () => true,
    });
    for (const cookie of (Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [])) {
      const pair = String(cookie).split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      response.data?.destroy();
      if (!location) throw new DownloadError('O serviço retornou um redirecionamento sem destino.');
      if (redirects === MAX_REDIRECTS) throw new DownloadError('O link possui redirecionamentos demais.');
      try { current = new URL(location, current); } catch { throw new DownloadError('O serviço retornou um redirecionamento inválido.'); }
      assertProviderUrl(current.href, provider);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      response.data?.destroy();
      if (response.status === 403 || response.status === 401) {
        throw new DownloadError('O arquivo não está público ou o serviço não permitiu o download. Confira as permissões do link.');
      }
      if (response.status === 404) throw new DownloadError('O arquivo não foi encontrado. Confira se o link ainda está válido.');
      if (response.status === 429) throw new DownloadError('O serviço limitou os downloads neste momento. Tente novamente mais tarde.');
      throw new DownloadError(`O serviço recusou o download (HTTP ${response.status}).`);
    }
    return { response, finalUrl: current.href, cookies: Object.fromEntries(cookies) };
  }
  throw new DownloadError('Não foi possível resolver o link de download.');
}

async function readStreamLimited(stream, maxBytes, tooLargeMessage) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        stream.destroy();
        throw new DownloadError(tooLargeMessage, 'TOO_LARGE');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError('A conexão foi interrompida durante o download. Tente novamente.');
  }
  return Buffer.concat(chunks, total);
}

async function downloadResponse(opened, fallbackName, expectedMimeType, maxBytes = MAX_FILE_SIZE, options = {}) {
  const { response } = opened;
  const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const contentLength = Number(response.headers['content-length']);
  const dispositionName = filenameFromDisposition(response.headers['content-disposition']);
  const likelyHtmlFile = /\.(?:html?|xhtml)$/i.test(dispositionName || fallbackName);
  const isPageContentType = /text\/html|application\/xhtml\+xml/i.test(contentType);
  const actualMaxBytes = isPageContentType && !likelyHtmlFile ? Math.min(maxBytes, MAX_PAGE_SIZE) : maxBytes;
  if (Number.isFinite(contentLength) && contentLength > actualMaxBytes) {
    response.data?.destroy();
    const limitMb = Math.floor(actualMaxBytes / 1024 / 1024);
    throw new DownloadError(`O arquivo/página excede o limite de ${limitMb} MB.`, 'TOO_LARGE');
  }

  const buffer = await readStreamLimited(response.data, actualMaxBytes,
    `O arquivo/página excede o limite de ${Math.floor(actualMaxBytes / 1024 / 1024)} MB.`);
  if (!buffer.length) throw new DownloadError('O serviço retornou um arquivo vazio.');
  const looksHtml = isHtmlBuffer(buffer, contentType);
  if (looksHtml && !likelyHtmlFile && options.allowHtml) {
    return { interstitialHtml: buffer.toString('utf8'), contentType, responseHeaders: response.headers, rawBuffer: buffer };
  }
  if (looksHtml && !likelyHtmlFile) {
    throw new DownloadError('O serviço retornou uma página de acesso/erro em vez do arquivo. Ele pode ser privado, exigir confirmação ou estar indisponível.');
  }

  let filename = dispositionName || sanitizeFilename(fallbackName, 'arquivo.bin');
  filename = ensureExtension(filename, fallbackName);
  return {
    buffer,
    fileName: sanitizeFilename(filename, 'arquivo.bin'),
    mimetype: guessMimeType(filename, contentType, expectedMimeType),
    size: buffer.length,
  };
}

async function requestMediafire(link) {
  const initial = assertProviderUrl(link, 'mediafire');
  const opened = await openFollowingRedirects(initial.href, 'mediafire');
  const contentType = String(opened.response.headers['content-type'] || '').toLowerCase();
  const contentLength = Number(opened.response.headers['content-length']);
  const dispositionName = filenameFromDisposition(opened.response.headers['content-disposition']);
  const likelyHtmlFile = /\.(?:html?|xhtml)$/i.test(dispositionName);
  if ((!/text\/html|application\/xhtml\+xml/.test(contentType) || likelyHtmlFile) && (contentType || contentLength > 0 || dispositionName)) {
    return downloadResponse(opened, 'arquivo-mediafire.bin');
  }

  const htmlBuffer = await readStreamLimited(opened.response.data, MAX_PAGE_SIZE,
    'A página do MediaFire ultrapassou o limite de tamanho permitido.');
  if (!isHtmlBuffer(htmlBuffer, contentType)) {
    return {
      buffer: htmlBuffer,
      fileName: 'arquivo-mediafire.bin',
      mimetype: guessMimeType('arquivo-mediafire.bin', contentType),
      size: htmlBuffer.length,
    };
  }

  const html = htmlBuffer.toString('utf8');
  const downloadUrl = extractMediafireDownloadUrl(html, opened.finalUrl);
  if (!downloadUrl) {
    throw new DownloadError('Não consegui localizar o arquivo na página do MediaFire. Confira se o link é de um arquivo público e não de uma pasta.');
  }
  const fallbackName = filenameFromMediafirePage(html);
  const fileOpened = await openFollowingRedirects(downloadUrl, 'mediafire');
  return downloadResponse(fileOpened, fallbackName);
}

function parseGoogleConfirmationForm(html, finalUrl, expectedFileId) {
  const forms = String(html || '').match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const permittedFields = new Set(['id', 'export', 'confirm', 'uuid', 'authuser', 'resourcekey']);
  for (const form of forms) {
    const openingTag = form.match(/<form\b[^>]*>/i)?.[0] || '';
    const action = getHtmlAttribute(openingTag, 'action');
    let actionUrl;
    try { actionUrl = new URL(action || finalUrl, finalUrl); } catch { continue; }
    if (!isAllowedProviderUrl(actionUrl.href, 'google')) continue;

    const params = {};
    const inputs = form.match(/<input\b[^>]*>/gi) || [];
    for (const input of inputs) {
      const name = getHtmlAttribute(input, 'name').toLowerCase();
      const value = getHtmlAttribute(input, 'value');
      if (permittedFields.has(name) && value) params[name] = value;
    }
    if (params.id !== expectedFileId || !params.confirm) continue;
    if (params.export && params.export !== 'download') continue;
    params.export = 'download';
    return { actionUrl, params };
  }
  return null;
}

async function requestGoogleDrive(link) {
  const spec = extractGoogleDownloadSpec(link);
  let opened = await openFollowingRedirects(spec.url, 'google');
  let result = await downloadResponse(opened, spec.fallbackName, spec.expectedMimeType, MAX_FILE_SIZE, { allowHtml: true });

  // Google Drive may return a virus-scan confirmation form instead of the file.
  // Parse only the expected Drive form, verify its file ID, and retry once.
  if (result.interstitialHtml) {
    const form = parseGoogleConfirmationForm(result.interstitialHtml, opened.finalUrl, spec.fileId);
    if (!form) {
      throw new DownloadError('O Google Drive não entregou o arquivo. Ele pode ser privado, exigir login ou ter o download bloqueado pelo proprietário.');
    }
    for (const [name, value] of Object.entries(form.params)) {
      form.actionUrl.searchParams.set(name, value);
    }
    opened = await openFollowingRedirects(form.actionUrl.href, 'google', { cookies: opened.cookies });
    result = await downloadResponse(opened, spec.fallbackName, spec.expectedMimeType);
  }

  if (spec.workspaceKind) {
    result.fileName = ensureExtension(result.fileName, spec.fallbackName);
    result.mimetype = spec.expectedMimeType;
  } else if (!filenameFromDisposition(opened.response.headers['content-disposition']) && result.fileName.endsWith('.bin')) {
    const extensionByMime = {
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/json': '.json',
      'application/vnd.android.package-archive': '.apk',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/zip': '.zip',
      'application/x-7z-compressed': '.7z',
      'application/vnd.rar': '.rar',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/mpeg': '.mp3',
    };
    const inferred = extensionByMime[result.mimetype];
    if (inferred) result.fileName = result.fileName.slice(0, -4) + inferred;
  }
  return result;
}

function senderKey(msg, jid) {
  return String(msg?.key?.participant || msg?.key?.remoteJid || jid || 'unknown');
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return 'Tamanho desconhecido';
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDownloadCaption(result, provider, sourceUrl) {
  const providerName = provider === 'mediafire' ? 'MediaFire' : 'Google Drive';
  const extension = path.extname(result.fileName || '').replace(/^\\./, '').toUpperCase();
  const type = extension || result.mimetype || 'desconhecido';
  const size = Number(result.size);
  const sizeText = Number.isFinite(size)
    ? `${formatFileSize(size)} (${(size / 1024 / 1024).toFixed(2)} MB)`
    : 'Tamanho desconhecido';
  return [
    '📥 *Download concluído*',
    `📄 *Nome:* ${result.fileName}`,
    `🗂️ *Tipo de arquivo:* ${type}`,
    `🧾 *MIME:* ${result.mimetype || 'não informado'}`,
    `💾 *Tamanho:* ${sizeText}`,
    `☁️ *Origem:* ${providerName}`,
    `🔗 *Link original:* ${sourceUrl}`,
  ].join('\\n').slice(0, 1024);
}

function usageText(provider, commandToken) {
  const command = commandToken || (provider === 'mediafire' ? '!mediafire' : '!googledriver');
  return provider === 'mediafire'
    ? `📥 *Como usar:* ${command} https://www.mediafire.com/file/...\nEnvie o link de um arquivo público, não de uma pasta.`
    : `📥 *Como usar:* ${command} https://drive.google.com/file/d/.../view\nO arquivo precisa estar compartilhado para qualquer pessoa com o link.`;
}

async function handleCloudDownload(sock, msg, jid, caption, provider, commandName) {
  const link = firstUrlFromCaption(caption, commandName);
  if (!link) {
    const commandToken = String(caption || '').trim().split(/\s+/)[0] || '';
    await sock.sendMessage(jid, { text: usageText(provider, commandToken) }, { quoted: msg });
    return;
  }
  try { assertProviderUrl(link, provider); } catch (error) {
    await sock.sendMessage(jid, { text: `⚠️ ${error.message}` }, { quoted: msg });
    return;
  }

  const sender = senderKey(msg, jid);
  if (activeSenders.has(sender)) {
    await sock.sendMessage(jid, { text: '⏳ Você já tem um download em andamento. Aguarde ele terminar.' }, { quoted: msg });
    return;
  }
  const now = Date.now();
  const nextAllowedAt = (lastDownloadAt.get(sender) || 0) + DOWNLOAD_COOLDOWN_MS;
  if (nextAllowedAt > now) {
    const seconds = Math.ceil((nextAllowedAt - now) / 1000);
    await sock.sendMessage(jid, { text: `⏳ Aguarde ${seconds}s antes de iniciar outro download.` }, { quoted: msg });
    return;
  }
  if (activeSenders.size >= MAX_CONCURRENT_DOWNLOADS) {
    await sock.sendMessage(jid, { text: '⏳ O bot está processando outros downloads. Tente novamente em instantes.' }, { quoted: msg });
    return;
  }

  lastDownloadAt.set(sender, now);
  if (lastDownloadAt.size > 1000) {
    for (const [key, ts] of lastDownloadAt) {
      if (now - ts > DOWNLOAD_COOLDOWN_MS * 6) lastDownloadAt.delete(key);
    }
  }
  activeSenders.add(sender);
  try {
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
    const result = provider === 'mediafire'
      ? await requestMediafire(link)
      : await requestGoogleDrive(link);
    const captionText = formatDownloadCaption(result, provider, link);
    await sock.sendMessage(jid, {
      document: result.buffer,
      mimetype: result.mimetype,
      fileName: result.fileName,
      caption: captionText,
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});
  } catch (error) {
    const message = error instanceof DownloadError
      ? error.message
      : 'Não consegui baixar esse arquivo agora. Confira se o link é público e tente novamente.';
    console.warn(`[cloud-downloads/${provider}]`, error?.message || error);
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ ${message}` }, { quoted: msg }).catch(() => {});
  } finally {
    activeSenders.delete(sender);
  }
}

async function handleMediafire(sock, msg, jid, caption) {
  return handleCloudDownload(sock, msg, jid, caption, 'mediafire', 'mediafire');
}

async function handleGoogleDrive(sock, msg, jid, caption) {
  return handleCloudDownload(sock, msg, jid, caption, 'google', 'googledriver');
}

module.exports = {
  handleMediafire,
  handleGoogleDrive,
  _helpers: {
    isAllowedProviderUrl,
    extractGoogleDownloadSpec,
    extractMediafireDownloadUrl,
    parseGoogleConfirmationForm,
    sanitizeFilename,
    filenameFromDisposition,
    isHtmlBuffer,
    guessMimeType,
    firstUrlFromCaption,
    MAX_FILE_SIZE,
    formatFileSize,
    formatDownloadCaption,
  },
};
