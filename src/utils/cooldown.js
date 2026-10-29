'use strict';

/**
 * Limite de comandos por usuário (em memória).
 *
 *  - Geral: no máximo GERAL_MAX comandos a cada GERAL_JANELA_MS.
 *  - Pesados (downloads, IA de mídia, criação de figurinha, alteradores de
 *    áudio/vídeo): no máximo 1 a cada PESADO_INTERVALO_MS.
 *
 * Retorna { ok: true } ou { ok: false, avisar, esperarMs }.
 * `avisar` só é true na primeira recusa de cada janela, para o bot não
 * responder spam com mais spam.
 */

const GERAL_MAX          = 8;
const GERAL_JANELA_MS    = 10_000;
const PESADO_INTERVALO_MS = 8_000;
const AVISO_INTERVALO_MS = 30_000;

// Comandos (sem prefixo) considerados pesados.
const PESADOS = new Set([
  'tiktok', 'save', 'saverec', 'audio', 'som', 'play', 'playmp4', 'playdoc', 'pinterest', 'pinterest2', 'letramúsica', 'letramusica', 'letramsc',
  'brat', 'figtexto', 'attp', 'attp2', 'attp3', 'qc', 'qc2', 'emojimix', 'toimg', 'togif', 'desfig', 'estourar',
  'pesquisafig', 'fig', 'figemoji', 'figroblox', 'figmeme', 'figcoreana', 'figraiva', 'figengracada', 'figdesenho',
  'videolento', 'videorapido', 'videocontrario', 'reversevideo', 'audiolento', 'audiorapido',
  'grave', 'esquilo', 'bass', 'vozmenino', 'vozgrossa', 'vozmulher', 'audioreverse', 'vozrobo',
  'vozalien', 'vozvelho', 'vozcrianca', 'vozdemonio', 'eco', 'caverna', 'telefone', 'radio',
  'megafone', 'underwater', 'videosemaudio', 'normalizaraudio', 'limparaudio',
  'audiovolume', 'reverb', 'nightcore', 'graveprofundo',
]);

const historico = new Map(); // user -> number[] (timestamps)
const ultimoPesado = new Map(); // user -> timestamp
const ultimoAviso  = new Map(); // user -> timestamp

function checar(userKey, cmdNome) {
  const agora = Date.now();

  // ── Janela geral ──
  const lista = (historico.get(userKey) || []).filter(t => agora - t < GERAL_JANELA_MS);
  if (lista.length >= GERAL_MAX) {
    historico.set(userKey, lista);
    return recusar(userKey, agora, GERAL_JANELA_MS - (agora - lista[0]));
  }

  // ── Pesados ──
  if (PESADOS.has(cmdNome)) {
    const ult = ultimoPesado.get(userKey) || 0;
    if (agora - ult < PESADO_INTERVALO_MS) {
      return recusar(userKey, agora, PESADO_INTERVALO_MS - (agora - ult));
    }
    ultimoPesado.set(userKey, agora);
  }

  lista.push(agora);
  historico.set(userKey, lista);
  return { ok: true };
}

function recusar(userKey, agora, esperarMs) {
  const ult = ultimoAviso.get(userKey) || 0;
  const avisar = agora - ult >= AVISO_INTERVALO_MS;
  if (avisar) ultimoAviso.set(userKey, agora);
  return { ok: false, avisar, esperarMs };
}

// Limpeza periódica para o Map não crescer indefinidamente.
const limpeza = setInterval(() => {
  const agora = Date.now();
  for (const [k, lista] of historico) {
    const viva = lista.filter(t => agora - t < GERAL_JANELA_MS);
    if (viva.length) historico.set(k, viva); else historico.delete(k);
  }
  for (const [k, t] of ultimoPesado) if (agora - t > PESADO_INTERVALO_MS * 4) ultimoPesado.delete(k);
  for (const [k, t] of ultimoAviso)  if (agora - t > AVISO_INTERVALO_MS * 4) ultimoAviso.delete(k);
}, 60_000);
limpeza.unref?.();

module.exports = { checar, PESADOS };
