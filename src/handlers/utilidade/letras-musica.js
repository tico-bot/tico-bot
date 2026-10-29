'use strict';

const API_BASE = 'https://lrclib.net/api/search';
const LYRICS_OVH_BASE = 'https://api.lyrics.ovh';
const MAX_EXCERPT_CHARS = 90;
const REQUEST_TIMEOUT_MS = 9000;
const USER_AGENT = 'Tico-Bot/1.0 (+https://github.com/Claralopez222/WhatsappBot2)';

function lyricsSearchUrl(query) {
  return `https://genius.com/search?q=${encodeURIComponent(`${query} lyrics`)}`;
}

function cleanLyricsText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function makeShortExcerpt(record) {
  if (!record || record.instrumental) return '';
  const lyrics = cleanLyricsText(record.plainLyrics || record.syncedLyrics || '');
  if (!lyrics) return '';
  const chars = Array.from(lyrics);
  if (chars.length <= MAX_EXCERPT_CHARS) return lyrics;
  return `${chars.slice(0, MAX_EXCERPT_CHARS - 1).join('').trimEnd()}…`;
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    const error = new Error('O serviço está limitando as consultas. Tente novamente em alguns minutos.');
    error.code = 'LYRICS_RATE_LIMITED';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`O serviço de letras respondeu com HTTP ${response.status}.`);
    error.code = 'LYRICS_API_ERROR';
    throw error;
  }
  return response.json();
}

async function searchLyricsOvh(query, fetchImpl) {
  const suggestionUrl = `${LYRICS_OVH_BASE}/suggest/${encodeURIComponent(query)}`;
  const suggestions = await requestJson(suggestionUrl, fetchImpl);
  const tracks = Array.isArray(suggestions?.data) ? suggestions.data : [];
  const candidate = tracks.find((track) =>
    typeof track?.title === 'string' && typeof track?.artist?.name === 'string');
  if (!candidate) return null;

  const trackName = candidate.title.trim();
  const artistName = candidate.artist.name.trim();
  const albumName = typeof candidate.album?.title === 'string' ? candidate.album.title.trim() : '';
  if (!trackName || !artistName) return null;

  const lyricsUrl = `${LYRICS_OVH_BASE}/v1/${encodeURIComponent(artistName)}/${encodeURIComponent(trackName)}`;
  const lyricsData = await requestJson(lyricsUrl, fetchImpl);
  if (typeof lyricsData?.lyrics !== 'string' || !lyricsData.lyrics.trim()) return null;

  return {
    trackName,
    artistName,
    albumName,
    plainLyrics: lyricsData.lyrics,
    instrumental: false,
    source: 'Lyrics.ovh',
  };
}

async function searchLyrics(query, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch não está disponível neste ambiente.');
  const url = `${API_BASE}?q=${encodeURIComponent(query)}`;
  let primaryError = null;

  try {
    const data = await requestJson(url, fetchImpl);
    if (!Array.isArray(data)) throw new Error('A resposta do serviço LRCLIB é inválida.');
    const record = data.find((item) => item && (item.plainLyrics || item.syncedLyrics || item.instrumental)) || data[0] || null;
    if (record) return { ...record, source: 'LRCLIB' };
  } catch (error) {
    // Respeita o rate limit do provedor; não tenta contorná-lo com outra API.
    if (error.code === 'LYRICS_RATE_LIMITED') throw error;
    primaryError = error;
  }

  // Segundo provedor para cobrir indisponibilidade ou ausência no LRCLIB.
  try {
    const fallback = await searchLyricsOvh(query, fetchImpl);
    if (fallback) return fallback;
  } catch (error) {
    if (error.code === 'LYRICS_RATE_LIMITED') throw error;
    if (!primaryError) primaryError = error;
  }

  if (primaryError) throw primaryError;
  return null;
}

async function handleLetraMusica(sock, msg, jid, caption) {
  const parts = String(caption || '').trim().split(/\s+/);
  const query = parts.slice(1).join(' ').trim();
  const command = parts[0] || '/letramúsica';

  if (!query) {
    await sock.sendMessage(jid, {
      text: `🎵 Informe o nome da música e, se souber, o artista.\nEx.: ${command} Evidências Chitãozinho e Xororó`,
    }, { quoted: msg });
    return false;
  }

  try {
    const result = await searchLyrics(query);
    if (!result) {
      await sock.sendMessage(jid, {
        text: `🔎 Não encontrei uma letra para *${query}*.\n\nTente informar também o nome do artista.\n🔗 Pesquisar: ${lyricsSearchUrl(query)}`,
      }, { quoted: msg });
      return false;
    }

    const trackName = String(result.trackName || result.name || query).trim();
    const artistName = String(result.artistName || 'Artista não informado').trim();
    const albumName = typeof result.albumName === 'string' ? result.albumName.trim() : '';
    const excerpt = makeShortExcerpt(result);
    const titleAndArtist = `${artistName} ${trackName}`;
    const lines = [
      '🎵 *LETRA DE MÚSICA*',
      '',
      `🎶 *${trackName}*`,
      `👤 ${artistName}`,
    ];
    if (albumName) lines.push(`💿 ${albumName}`);
    if (excerpt) {
      lines.push('', '*Prévia curta:*', excerpt);
    } else if (result.instrumental) {
      lines.push('', '🎼 Esta faixa está marcada como instrumental.');
    } else {
      lines.push('', 'Não há uma prévia disponível para esta faixa.');
    }
    lines.push('', `🔗 *Ver mais:* ${lyricsSearchUrl(titleAndArtist)}`, `_Fonte de prévia: ${result.source || 'LRCLIB'}._`);

    await sock.sendMessage(jid, { text: lines.join('\n') }, { quoted: msg });
    return true;
  } catch (error) {
    console.error('[letramúsica] Falha ao pesquisar letra:', error.message);
    const message = error.code === 'LYRICS_RATE_LIMITED'
      ? '⚠️ O serviço está recebendo muitas consultas. Tente novamente em alguns minutos.'
      : `⚠️ Não consegui consultar a prévia agora. Você pode pesquisar a letra aqui: ${lyricsSearchUrl(query)}`;
    await sock.sendMessage(jid, { text: message }, { quoted: msg });
    return false;
  }
}

module.exports = {
  API_BASE,
  LYRICS_OVH_BASE,
  MAX_EXCERPT_CHARS,
  cleanLyricsText,
  makeShortExcerpt,
  lyricsSearchUrl,
  searchLyrics,
  handleLetraMusica,
};
