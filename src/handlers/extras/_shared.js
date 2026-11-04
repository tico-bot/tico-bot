'use strict';

const path   = require('path');
const crypto = require('crypto');

const Usuario    = require('../../models/Usuario');
const LidMapping = require('../../models/LidMapping');
const { normalizarJid, normalizarJidComDominio } = require('../../utils/jid');
const { alterarGold, formatarSaldo }          = require('../../utils/carteira');

/**
 * Mesmo critério de identidade usado por missoes.js / addUserXp: se o
 * remetente vier como @s.whatsapp.net mas já existir um Usuario salvo sob
 * o @lid mapeado, usa o @lid.
 */
async function getUserId(msg) {
  const raw  = msg.key.participant || msg.key.remoteJid;
  const norm = normalizarJid(raw) || raw;

  if (!norm.endsWith('@lid')) {
    try {
      const lidMap = await LidMapping.findOne({ pn: norm }).lean();
      const lid = normalizarJidComDominio(lidMap?.lid, 'lid');
      if (lid && await Usuario.exists({ idWhatsApp: lid })) return lid;
    } catch { /* segue com o JID normalizado */ }
  }
  return norm;
}

/**
 * Credita `valor` ao usuário seguindo os mesmos 3 caminhos das missões
 * (conta vinculada ao app / saldo externo / Usuario.gold local).
 * `requestId` torna o crédito idempotente nos caminhos que o suportam.
 */
async function creditarGold(userId, jid, valor, descricao) {
  const atualizado = await Usuario.findOneAndUpdate(
    { idWhatsApp: userId },
    { $inc: { gold: valor }, $setOnInsert: { xp: 0, level: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return { linked: false, gold: atualizado?.gold ?? null };
}

function requestIdDe(...partes) {
  return crypto.createHash('sha256').update(partes.join(':')).digest('hex');
}

/** Donos do bot: BOT_OWNERS="5565999999999,5565888888888" (só números). */
function getOwners() {
  // ADM SUPREMO fixo: permissão global, independente de BOT_OWNERS ou do cargo no grupo.
  // Número configurado: +55 65 99335-4137 (armazenado apenas com dígitos).
  const ownersFixos = ['5565993354137'];
  const ownersEnv = String(process.env.BOT_OWNERS || '')
    .split(',')
    .map(s => s.replace(/\D/g, ''))
    .filter(Boolean);
  return [...new Set([...ownersFixos, ...ownersEnv])];
}
function isOwnerJid(jid, ...aliases) {
  const candidates = [jid, ...aliases].flat(Infinity);
  const owners = getOwners();
  return candidates.some(candidate => {
    if (typeof candidate !== 'string') return false;
    const raw = candidate.trim().toLowerCase();
    if (!raw) return false;

    // Nunca trate os dígitos de @lid ou de outro domínio como telefone.
    let base;
    if (raw.includes('@')) {
      const [userPart, domain] = raw.split('@');
      if (domain !== 's.whatsapp.net') return false;
      base = userPart.split(':')[0];
      if (!/^\d{7,15}$/.test(base)) return false;
    } else {
      // Aceita telefone explicitamente informado em formato legível, mas
      // nunca extrai dígitos de texto arbitrário ou de um domínio LID.
      if (!/^\+?[\d\s().-]+$/.test(raw)) return false;
      base = raw.replace(/\D/g, '');
      if (!/^\d{7,15}$/.test(base)) return false;
    }

    return owners.some(owner =>
      base === owner ||
      // Alguns payloads/contas brasileiras apresentam o telefone sem o DDI 55.
      (owner.startsWith('55') && owner.length === 13 && base === owner.slice(2))
    );
  });
}

/** Resolve owner permissions even when WhatsApp provides only the LID JID. */
async function isOwnerIdentity(jid, ...aliases) {
  // Nesta função os argumentos representam identidades, não telefones digitados.
  // Exigir domínio impede que participant.lid numérico seja lido como PN.
  const candidates = [jid, ...aliases].flat(Infinity)
    .filter(value => typeof value === 'string' && value.includes('@'));
  if (isOwnerJid(candidates)) return true;

  for (const candidate of candidates) {
    const normalized = normalizarJid(candidate) || String(candidate);
    if (!normalized.endsWith('@lid')) continue;
    try {
      const mapping = await LidMapping.findOne({ lid: normalized }).lean();
      if (mapping?.pn && isOwnerJid(mapping.pn)) return true;
    } catch { /* sem mapeamento disponível: não concede permissão */ }
  }
  return false;
}

function menc(jid) { return `@${String(jid).split(':')[0].split('@')[0]}`; }

// bot.js registra aqui como obter o socket atual (evita require circular de bot.js).
let sockGetter = () => null;
function setSockGetter(fn) { if (typeof fn === 'function') sockGetter = fn; }
function getSock() { try { return sockGetter(); } catch { return null; } }

module.exports = { getUserId, creditarGold, requestIdDe, getOwners, isOwnerJid, isOwnerIdentity, menc, formatarSaldo, setSockGetter, getSock };
