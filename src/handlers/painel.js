'use strict';

const crypto        = require('crypto');
const Usuario       = require('../models/Usuario');
const AuthToken     = require('../models/AuthToken');
const { normalizarJid, normalizarJidUsuario, extrairNumero } = require('../utils/jid');
const { getAlternateSenderJids, resolvePhoneAndJid, resolveDisplayName } = require('../utils/identity');
const { getPublicApiUrl } = require('../utils/publicApiTunnel');

const BASE_SITE_URL = 'https://tico-bot.github.io/tico-bot-site';

async function handleMeuPainel(sock, msg, jid) {
  try {
    const remetente = msg.key.participant || msg.key.remoteJid;
    const senderJid = normalizarJidUsuario(remetente);
    if (!senderJid) return;

    const aliases = getAlternateSenderJids(msg);
    const senderInfo = await resolvePhoneAndJid(senderJid, sock);
    const pnJid = aliases.map(value => normalizarJidUsuario(value))
      .find(value => value?.endsWith('@s.whatsapp.net'))
      || senderInfo.pnJid
      || (senderJid.endsWith('@s.whatsapp.net') ? senderJid : null);
    const rawNum = pnJid ? extrairNumero(pnJid) : '';
    const nome = await resolveDisplayName(senderJid, sock, {}, {
      candidateJids: aliases,
      preferredName: msg.pushName,
      fallback: 'usuário',
    });

    // O site é estático; quando o bot roda localmente, publica a API por um túnel HTTPS
    // temporário para que o link funcione também no telemóvel de quem o abriu.
    const apiUrl = await getPublicApiUrl();

    // Gera token único de acesso automático (válido por 30min)
    const tokenStr  = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await AuthToken.create({
      telefone:   rawNum || 'N/D',
      idWhatsApp: senderJid,
      token:      tokenStr,
      expiresAt,
    });

    const magicUrl = new URL(`${BASE_SITE_URL}/perfil.html`);
    magicUrl.searchParams.set('token', tokenStr);
    magicUrl.searchParams.set('api', apiUrl);

    await sock.sendMessage(jid, {
      text:
        `🌐 *PAINEL DO SITE — LOGIN AUTOMÁTICO*\n\n` +
        `Olá *${nome}*!\n` +
        `Clique no link abaixo para entrar no site com seu **login reconhecido automaticamente**:\n\n` +
        `👉 ${magicUrl}\n\n` +
        `⏰ *Link de acesso rápido válido por 30 minutos.*\n` +
        `🔌 _O Tico precisa permanecer ligado no computador que está a executar o bot._`,
    }, { quoted: msg });

  } catch (err) {
    console.error('[painel] Erro ao processar !meupainel:', err);
    const falhaTunel = err?.code === 'ENOENT'
      || /cloudflared|túnel HTTPS|túnel.*conectar/i.test(String(err?.message || ''));
    await sock.sendMessage(jid, {
      text: falhaTunel
        ? '❌ Não consegui criar a ligação segura com o site. Verifique se o cloudflared está instalado e se o computador tem acesso à internet; depois tente /meupainel novamente.'
        : '❌ Erro ao gerar link do painel. Tente novamente em instantes.',
    }, { quoted: msg }).catch(() => {});
  }
}

module.exports = { handleMeuPainel };