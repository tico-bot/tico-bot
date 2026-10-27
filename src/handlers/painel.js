'use strict';

const crypto        = require('crypto');
const Usuario       = require('../models/Usuario');
const AuthToken     = require('../models/AuthToken');
const { normalizarJid } = require('../utils/jid');

const BASE_SITE_URL = 'https://piroquinhasbot.github.io/painel-piroquinhas-bot';

async function handleMeuPainel(sock, msg, jid) {
  try {
    const remetente = msg.key.participant || msg.key.remoteJid;
    const senderJid = normalizarJid(remetente);
    if (!senderJid) return;

    const rawNum = senderJid.split(':')[0].split('@')[0];

    // Gera token único de acesso automático (válido por 30min)
    const tokenStr  = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await AuthToken.create({
      telefone:   rawNum,
      idWhatsApp: senderJid,
      token:      tokenStr,
      expiresAt,
    });

    const magicUrl = `${BASE_SITE_URL}/perfil.html?token=${tokenStr}`;

    await sock.sendMessage(jid, {
      text:
        `🌐 *PAINEL DO SITE — LOGIN AUTOMÁTICO*\n\n` +
        `Olá *@${rawNum}*!\n` +
        `Clique no link abaixo para entrar no site com seu **login reconhecido automaticamente**:\n\n` +
        `👉 ${magicUrl}\n\n` +
        `⏰ *Link de acesso rápido válido por 30 minutos.*`,
      mentions: [senderJid],
    }, { quoted: msg });

  } catch (err) {
    console.error('[painel] Erro ao processar !meupainel:', err);
    await sock.sendMessage(jid, {
      text: '❌ Erro ao gerar link do painel. Tente novamente em instantes.',
    }, { quoted: msg }).catch(() => {});
  }
}

module.exports = { handleMeuPainel };