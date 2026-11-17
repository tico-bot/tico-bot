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
    let mensagemErro = '❌ Erro ao gerar link do painel. Tente novamente em instantes.';
    if (err?.code === 'CLOUDFLARED_NOT_FOUND') {
      mensagemErro = '❌ O cloudflared não foi encontrado neste computador. Instale-o ou configure CLOUDFLARED_PATH e tente /meupainel novamente.';
    } else if (['CLOUDFLARED_START_FAILED', 'CLOUDFLARED_EXIT', 'TUNNEL_TIMEOUT'].includes(err?.code)) {
      mensagemErro = '❌ Não consegui estabelecer o túnel seguro do painel. Verifique a conexão com a internet e os logs do Tico; depois tente novamente.';
    } else if (err?.code === 'PUBLIC_API_URL_MISSING') {
      mensagemErro = '❌ O Render não forneceu a URL pública da API do Tico. Verifique se o serviço está configurado como Web Service e tente novamente.';
    }

    await sock.sendMessage(jid, { text: mensagemErro }, { quoted: msg }).catch(() => {});
  }
}

module.exports = { handleMeuPainel };