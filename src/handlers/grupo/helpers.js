'use strict';

const { normalizarJid } = require('../../utils/jid');
const LidMapping = require('../../models/LidMapping');
const { getAlternateSenderJids } = require('../../utils/identity');
const { isOwnerIdentity } = require('../extras/_shared');

// ═══════════════════════════════════════════════════════════════
// ─── ESTADO GLOBAL COMPARTILHADO (em memória) ──────────────────
// ═══════════════════════════════════════════════════════════════

/** @type {Map<string, { ativo: boolean, mensagem: string }>} */
const bemVindoGroups = new Map();

function setBemVindo(jid, mensagem) {
  if (!mensagem || !mensagem.trim()) {
    bemVindoGroups.delete(jid);
  } else {
    bemVindoGroups.set(jid, { ativo: true, mensagem: mensagem.trim() });
  }
}

/**
 * Map<grupoJid, Set<userJid>> — isolado por grupo para evitar
 * que mutes de um grupo vazem para outro.
 * @type {Map<string, Set<string>>}
 */
const mutedUsers = new Map();

// ═══════════════════════════════════════════════════════════════
// ─── CACHE DE METADATA DE GRUPO ────────────────────────────────
// ═══════════════════════════════════════════════════════════════
// Evita rate-limit do WhatsApp em grupos movimentados. TTL de 5 minutos;
// invalidado automaticamente por tempo.

if (!global._groupMetadataCache) global._groupMetadataCache = new Map();
const GROUP_METADATA_TTL_MS = 5 * 60 * 1000;

async function getGroupMetadataCached(sock, groupJid, forceRefresh = false) {
  if (!groupJid || typeof groupJid !== 'string') return null;

  const agora = Date.now();
  const cached = global._groupMetadataCache.get(groupJid);

  if (!forceRefresh && cached && (agora - cached.fetchedAt) < GROUP_METADATA_TTL_MS) {
    return cached.meta;
  }

  try {
    const meta = await sock.groupMetadata(groupJid);
    if (meta) {
      global._groupMetadataCache.set(groupJid, { meta, fetchedAt: agora });
    }
    return meta;
  } catch (err) {
    console.error(`[getGroupMetadataCached] Erro ao buscar metadata para ${groupJid}:`, err.message);
    if (cached) return cached.meta; // Fallback para cache antigo se a rede falhar
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── IDENTIDADE / PERMISSÕES ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Normaliza um JID removendo sufixos de dispositivo e domínio.
 * Exemplos:
 *   "5511912345678:3@s.whatsapp.net" → "5511912345678"
 *   "5511912345678@s.whatsapp.net"   → "5511912345678"
 */
function normalizeJidBase(jid) {
  if (!jid || typeof jid !== 'string') return '';
  return jid.split(':')[0].split('@')[0].toLowerCase();
}

async function isAdmin(sock, groupJid, userJid, alternateJids = []) {
  if (!groupJid) return false;
  const aliases = Array.isArray(alternateJids) ? alternateJids.filter(Boolean) : [alternateJids].filter(Boolean);
  const candidates = [userJid, ...aliases].filter(Boolean);

  // ADM+ recebe acesso global antes de consultar metadados ou cargo do grupo.
  // Isso também evita falhas por rate-limit do WhatsApp quando o número já foi identificado.
  if (await isOwnerIdentity(userJid, aliases)) return true;
  if (!candidates.length) return false;

  try {
    const meta = await getGroupMetadataCached(sock, groupJid);
    if (!meta?.participants) return false;

    const userBases = new Set(candidates.map(normalizeJidBase).filter(Boolean));

    let part = meta.participants.find(p => {
      if (!p) return false;
      const pIdBase  = normalizeJidBase(p.id);
      const pLidBase = p.lid ? normalizeJidBase(p.lid) : '';
      return userBases.has(pIdBase) || userBases.has(pLidBase);
    });

    // A metadata pode conter o par PN/LID mesmo quando LidMapping ainda não foi salvo.
    if (part && await isOwnerIdentity(part.id, part.lid)) return true;

    // Fallback para mensagens/metadata que tragam apenas uma das formas do JID.
    if (!part) {
      for (const candidate of candidates) {
        const normalized = normalizarJid(candidate) || candidate;
        const mapping = await LidMapping.findOne({
          $or: [{ pn: normalized }, { lid: normalized }],
        }).lean().catch(() => null);
        if (!mapping) continue;

        const alternate = normalizarJid(mapping.pn) === normalized ? mapping.lid : mapping.pn;
        const altBase = alternate ? normalizeJidBase(alternate) : '';
        if (altBase) {
          part = meta.participants.find(p => p && (
            normalizeJidBase(p.id) === altBase || normalizeJidBase(p.lid) === altBase
          ));
        }
        if (part) break;
      }
    }

    if (part && await isOwnerIdentity(part.id, part.lid)) return true;
    return part?.admin === 'admin' || part?.admin === 'superadmin';
  } catch (err) {
    console.error('[isAdmin] Erro ao verificar permissão de admin:', err.message);
    return false;
  }
}

/**
 * Obtém o criador / dono do grupo (superadmin).
 */
async function getGroupOwner(sock, groupJid) {
  try {
    const meta = await getGroupMetadataCached(sock, groupJid);
    if (!meta) return null;

    if (meta.owner) return meta.owner;
    const superadmin = meta.participants?.find(p => p.admin === 'superadmin');
    return superadmin ? superadmin.id : null;
  } catch {
    return null;
  }
}

function isBotJid(jid, botJid) {
  if (!botJid || !jid) return false;
  return normalizeJidBase(jid) === normalizeJidBase(botJid);
}

/**
 * Resolve o JID do alvo a partir de menção direta ou reply.
 * Prioridade: menção (@tag) → reply (participant do quoted).
 * Tenta resolver @lid para @s.whatsapp.net quando possível.
 */
async function resolveTargetJid(sock, msg, content, jid) {
  const ctx               = content?.extendedTextMessage?.contextInfo;
  const mentionedJid      = ctx?.mentionedJid || [];
  const quotedParticipant = ctx?.participant;

  // Sem menção → tenta reply
  if (mentionedJid.length === 0) {
    if (!quotedParticipant) return null;
    return normalizarJid(quotedParticipant) || quotedParticipant;
  }

  let rawJid = mentionedJid[0];
  const targetBase = normalizeJidBase(rawJid);

  // Resolve @lid → @s.whatsapp.net quando o grupo fornece o mapeamento
  if (rawJid.endsWith('@lid') && jid.endsWith('@g.us')) {
    try {
      const meta = await getGroupMetadataCached(sock, jid);
      const part = meta?.participants?.find(p => {
        if (!p) return false;
        return normalizeJidBase(p.id) === targetBase || (p.lid && normalizeJidBase(p.lid) === targetBase);
      });
      if (part?.id && !part.id.endsWith('@lid')) rawJid = part.id;
    } catch (err) {
      console.error('[resolveTargetJid] Erro ao resolver @lid:', err.message);
    }
  }

  return normalizarJid(rawJid) || rawJid;
}

function somenteGrupo(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

/**
 * Checa se o remetente é admin do grupo.
 * Se não for, envia aviso e retorna false.
 */
async function checkAdmin(sock, msg, jid, cmd = 'este comando') {
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const alternateJids = getAlternateSenderJids(msg);
  if (!await isAdmin(sock, jid, senderJid, alternateJids)) {
    await sock.sendMessage(
      jid,
      { text: `❌ Apenas admins podem usar *!${cmd}*!` },
      { quoted: msg }
    );
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// ─── HELPERS DE MUTE (isolados por grupo) ─────────────────────
// ═══════════════════════════════════════════════════════════════

function isMuted(groupJid, userJid) {
  const base = normalizeJidBase(userJid);
  const set = mutedUsers.get(groupJid);
  if (!set) return false;
  for (const item of set) {
    if (normalizeJidBase(item) === base) return true;
  }
  return false;
}

function muteUser(groupJid, userJid) {
  if (!mutedUsers.has(groupJid)) mutedUsers.set(groupJid, new Set());
  mutedUsers.get(groupJid).add(userJid);
}

function unmuteUser(groupJid, userJid) {
  const s = mutedUsers.get(groupJid);
  if (!s) return false;
  const base = normalizeJidBase(userJid);
  let removed = false;
  for (const item of Array.from(s)) {
    if (normalizeJidBase(item) === base) {
      s.delete(item);
      removed = true;
    }
  }
  if (s.size === 0) mutedUsers.delete(groupJid);
  return removed;
}

function mutedCount(groupJid) {
  return mutedUsers.get(groupJid)?.size ?? 0;
}

function clearMuted(groupJid) {
  mutedUsers.delete(groupJid);
}

function getMutedSet(groupJid) {
  return new Set(mutedUsers.get(groupJid) ?? []);
}

module.exports = {
  bemVindoGroups,
  setBemVindo,

  getGroupMetadataCached,
  isAdmin,
  getGroupOwner,
  normalizeJidBase,
  isBotJid,
  resolveTargetJid,
  somenteGrupo,
  checkAdmin,

  isMuted,
  muteUser,
  unmuteUser,
  mutedCount,
  clearMuted,
  getMutedSet,
};
