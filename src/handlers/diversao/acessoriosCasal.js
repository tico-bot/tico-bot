'use strict';

const path = require('path');
const Usuario = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const { resolveUsuarioInfo } = require(path.join(__dirname, '..', '..', 'utils', 'identity'));

// Itens de casal que podem ser EQUIPADOS (cada um é seu próprio "slot")
const ACESSORIOS_CASAL = {
  anel:          { nome: 'Anel',           emoji: '💍' },
  colar:         { nome: 'Colar Casal',    emoji: '📿' },
  pulseira:      { nome: 'Pulseira Casal', emoji: '💫' },
  camisetacasal: { nome: 'Camiseta Casal', emoji: '👕' },
  gorro:         { nome: 'Gorro Casal',    emoji: '🧢' },
  chinelo:       { nome: 'Chinelo de Casal', emoji: '🩴' },
};

/**
 * Verifica se o usuário possui o item no inventário (Mixed) ou em casalItens (Array).
 */
function verificarPossuiItem(userData, itemKey) {
  if (!userData) return false;

  // 1. Verifica no inventory (objeto ou Map)
  const qtdInventory = userData.inventory?.get?.(itemKey) ?? userData.inventory?.[itemKey] ?? 0;
  if (qtdInventory > 0) return true;

  // 2. Verifica em casalItens (Array de itens de casal)
  if (Array.isArray(userData.casalItens)) {
    const emCasalItens = userData.casalItens.some(
      (it) => it && (it.itemKey === itemKey || it.itemKey?.toLowerCase() === itemKey.toLowerCase())
    );
    if (emCasalItens) return true;
  }

  return false;
}

/**
 * Equipa ou desequipa um acessório de casal.
 * Retorna `true` se o comando foi tratado (item válido), ou `false`
 * se o itemKey não corresponde a nenhum acessório.
 */
async function handleEquiparAcessorio(sock, msg, jid, senderJid, itemKey) {
  const item = ACESSORIOS_CASAL[itemKey];
  if (!item) return false; // não é um acessório de casal, ignora

  try {
    const { resolvedJid, userData: userLean } = await resolveUsuarioInfo(senderJid, sock);
    const targetJid = userLean?.idWhatsApp || resolvedJid || senderJid;

    // ── Verifica se o usuário possui o item no inventário / casalItens ──
    const possui = verificarPossuiItem(userLean, itemKey);
    if (!possui) {
      await sock.sendMessage(jid, {
        text:
          `❌ Você não possui *${item.nome}* ${item.emoji} no seu inventário!\n\n` +
          `Compre na *!lojacasal* para poder equipar.`,
      }, { quoted: msg });
      return true;
    }

    // ── Alterna o estado de equipado ──
    const equipadoAtual = userLean?.acessoriosCasal?.get?.(itemKey) ?? userLean?.acessoriosCasal?.[itemKey] ?? false;
    const novoEstado = !equipadoAtual;

    await Usuario.findOneAndUpdate(
      { idWhatsApp: targetJid },
      { $set: { [`acessoriosCasal.${itemKey}`]: novoEstado } },
      { upsert: true }
    );

    const acaoTexto = novoEstado ? 'equipou' : 'desequipou';
    await sock.sendMessage(jid, {
      text:
        `${item.emoji} Você ${acaoTexto} *${item.nome}*!\n\n` +
        `Use *!perfil* para ver seus acessórios equipados.`,
    }, { quoted: msg });
    return true;

  } catch (e) {
    console.error('[handleEquiparAcessorio] Erro:', e.message);
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao equipar/desequipar acessório. Tente novamente.',
    }, { quoted: msg });
    return true;
  }
}

module.exports = { ACESSORIOS_CASAL, handleEquiparAcessorio };