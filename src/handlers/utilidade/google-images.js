'use strict';

const axios = require('axios');
const sharp = require('sharp');
const net = require('node:net');

const SERPAPI_URL = 'https://serpapi.com/search.json';
const MAX_RESULTS = 1;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_QUERY_LENGTH = 180;

function buildGoogleImagesUrl(query) {
  const termo = String(query || '').trim();
  if (!termo) return null;
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('udm', '2');
  url.searchParams.set('q', termo);
  url.searchParams.set('hl', 'pt-BR');
  return url.toString();
}

function isSafeImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
    if (net.isIP(hostname)) return false;
    if (!hostname.includes('.') || hostname.includes('..')) return false;
    return true;
  } catch {
    return false;
  }
}

function extractImageResults(payload, limit = MAX_RESULTS) {
  const source = Array.isArray(payload?.images_results) ? payload.images_results : [];
  const seen = new Set();
  const results = [];
  for (const item of source) {
    const imageUrl = [item?.original, item?.thumbnail]
      .find(url => typeof url === 'string' && isSafeImageUrl(url));
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    results.push({
      imageUrl,
      title: String(item?.title || 'Imagem encontrada').replace(/\s+/g, ' ').trim().slice(0, 100),
      sourceUrl: isSafeImageUrl(item?.link) ? item.link : null,
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchGoogleImages(query, apiKey = process.env.SERPAPI_KEY) {
  if (!apiKey) {
    const error = new Error('SERPAPI_KEY ausente');
    error.code = 'MISSING_SERPAPI_KEY';
    throw error;
  }
  const response = await axios.get(SERPAPI_URL, {
    params: { engine: 'google_images', q: query, api_key: apiKey, hl: 'pt-BR', gl: 'br' },
    timeout: 15000,
    maxContentLength: 2 * 1024 * 1024,
  });
  if (response.data?.error) {
    const error = new Error('SerpApi recusou a pesquisa');
    error.code = 'SERPAPI_ERROR';
    throw error;
  }
  return extractImageResults(response.data);
}

async function downloadImage(imageUrl) {
  if (!isSafeImageUrl(imageUrl)) throw new Error('URL de imagem não permitida');

  // Reutiliza o validador de downloads do projeto, que resolve DNS, bloqueia
  // redes privadas e fixa o IP validado para evitar SSRF/rebinding de DNS.
  const { _validateExternalUrl } = require('./downloads');
  let currentUrl = imageUrl;
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const validated = await _validateExternalUrl(currentUrl);
    response = await axios.get(validated.url.href, {
      responseType: 'arraybuffer',
      timeout: 12000,
      maxContentLength: MAX_IMAGE_BYTES,
      maxBodyLength: MAX_IMAGE_BYTES,
      maxRedirects: 0,
      validateStatus: () => true,
      lookup: validated.lookup,
      headers: { 'User-Agent': 'Tico-Bot/1.0 (+image search)' },
    });

    const location = response.headers?.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects === 3) throw new Error('A imagem contém redirecionamentos demais');
      currentUrl = new URL(location, validated.url).href;
      if (!isSafeImageUrl(currentUrl)) throw new Error('Redirecionamento de imagem não permitido');
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Servidor de imagem respondeu com HTTP ${response.status}`);
    }
    break;
  }

  const contentType = String(response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
    throw new Error('O resultado não é uma imagem rasterizada');
  }
  return sharp(Buffer.from(response.data), { limitInputPixels: 25_000_000 })
    .rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatImageCaption(item, index, total, query, details = {}) {
  const title = item.title || `Imagem ${index + 1}`;
  let sourceHost = '';
  try {
    if (item.sourceUrl) {
      const hostname = new URL(item.sourceUrl).hostname;
      sourceHost = hostname.toLowerCase().startsWith('www.') ? hostname.slice(4) : hostname;
    }
  } catch {}
  const source = item.sourceUrl ? `\\n🌐 *Site:* ${sourceHost || 'fonte externa'}\\n🔗 *Fonte:* ${item.sourceUrl}` : '';
  const dimensions = details.width && details.height
    ? `\\n📐 *Dimensões:* ${details.width} × ${details.height} px`
    : '';
  const format = details.format ? `\\n🧾 *Formato:* ${String(details.format).toUpperCase()}` : '';
  const size = Number.isFinite(details.size) ? `\\n💾 *Tamanho enviado:* ${formatBytes(details.size)}` : '';
  return `🖼️ *${title}*\\n🔎 *Pesquisa:* ${query}\\n📷 *Resultado:* ${index + 1}/${total}${dimensions}${format}${size}${source}`.slice(0, 1024);
}

async function reagirAoComando(sock, jid, msg, emoji) {
  if (!msg?.key) return;
  try {
    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
  } catch {
    // A reação é um feedback visual; uma falha de reação não bloqueia o comando.
  }
}

async function handleGoogleImageSearch(sock, msg, jid, query, dependencies = {}) {
  await reagirAoComando(sock, jid, msg, '⏳');
  const termo = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!termo) {
    await sock.sendMessage(jid, {
      text: '🖼️ Digite o que deseja pesquisar no Google Imagens.\n\nExemplo: *!gimage gatinhos fofos*',
    }, { quoted: msg });
    await reagirAoComando(sock, jid, msg, '❌');
    return;
  }

  const search = dependencies.search || searchGoogleImages;
  const fetchImage = dependencies.downloadImage || downloadImage;
  let resultados;
  try {
    resultados = await search(termo, dependencies.apiKey);
  } catch (error) {
    const text = error?.code === 'MISSING_SERPAPI_KEY'
      ? '⚙️ O comando *!gimage* ainda não está configurado. Adicione a variável *SERPAPI_KEY* nas variáveis de ambiente do serviço no Render.'
      : '❌ Não consegui pesquisar imagens agora. Verifique a chave/quota da SerpApi e tente novamente.';
    await sock.sendMessage(jid, { text }, { quoted: msg });
    await reagirAoComando(sock, jid, msg, '❌');
    return;
  }

  // O comando deve devolver apenas uma imagem, mesmo que o provedor retorne mais.
  const item = Array.isArray(resultados) ? resultados.slice(0, 1)[0] : null;
  if (!item) {
    await sock.sendMessage(jid, {
      text: `🔎 Não encontrei imagens utilizáveis para *${termo}*. Tente outro termo.\n\nPesquisa no navegador: ${buildGoogleImagesUrl(termo)}`,
    }, { quoted: msg, linkPreview: true });
    await reagirAoComando(sock, jid, msg, '❌');
    return;
  }

  try {
    const buffer = await fetchImage(item.imageUrl);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Imagem vazia ou acima do limite permitido');
    }
    let imageDetails = { size: buffer.length, format: 'jpeg' };
    try {
      const metadata = await sharp(buffer).metadata();
      imageDetails = {
        size: buffer.length,
        format: metadata.format || 'jpeg',
        width: metadata.width,
        height: metadata.height,
      };
    } catch {
      // Detalhes adicionais não devem impedir o envio de uma imagem válida.
    }
    await sock.sendMessage(jid, {
      image: buffer,
      mimetype: 'image/jpeg',
      caption: formatImageCaption(item, 1, 1, termo, imageDetails),
    }, { quoted: msg });
    await reagirAoComando(sock, jid, msg, '✅');
  } catch {
    await sock.sendMessage(jid, {
      text: `⚠️ Encontrei um resultado, mas não consegui enviar a imagem. Abra a pesquisa no navegador: ${buildGoogleImagesUrl(termo)}`,
    }, { quoted: msg, linkPreview: true });
    await reagirAoComando(sock, jid, msg, '❌');
  }
}

module.exports = {
  buildGoogleImagesUrl,
  extractImageResults,
  isSafeImageUrl,
  searchGoogleImages,
  downloadImage,
  formatImageCaption,
  handleGoogleImageSearch,
};
