'use strict';

const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const PinnedMessage = require('../../models/PinnedMessage');

// ── helpers ──────────────────────────────────────────────────
function getNumeroPuro(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

function parseDuration(arg) {
  if (!arg) return 604800; // 7 dias padrão
  const clean = String(arg).toLowerCase().trim();

  if (['24h', '24', '1d', '1'].includes(clean)) return 86400; // 24 Horas
  if (['30d', '30', '1m'].includes(clean))      return 2592000; // 30 Dias
  if (['7d', '7'].includes(clean))              return 604800; // 7 Dias

  return 604800;
}

function duracaoLabel(s) {
  if (s === 86400)   return '24 Horas';
  if (s === 2592000) return '30 Dias';
  return '7 Dias';
}

// ── !fixar ───────────────────────────────────────────────────
async function handleFixar(sock, msg, jid) {
  const chatJid   = jidNormalizedUser(jid);
  const senderJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);

  const ctx        = msg.message?.extendedTextMessage?.contextInfo;
  const quotedMsg  = ctx?.quotedMessage;
  const quotedSign = ctx?.stanzaId;
  const quotedPart = ctx?.participant;

  if (!quotedMsg || !quotedSign) {
    return sock.sendMessage(chatJid, {
      text:
        `📌 *COMO FIXAR MENSAGENS:*\n\n` +
        `Responda à mensagem que deseja fixar e use:\n` +
        `• *!fixar 24h* — Fixa por 24 Horas\n` +
        `• *!fixar 7d* — Fixa por 7 Dias (padrão)\n` +
        `• *!fixar 30d* — Fixa por 30 Dias\n\n` +
        `_Requer que o bot seja administrador do grupo._`,
    }, { quoted: msg });
  }

  const msgText =
    quotedMsg.conversation              ||
    quotedMsg.extendedTextMessage?.text ||
    quotedMsg.imageMessage?.caption     ||
    quotedMsg.videoMessage?.caption     ||
    '[_Mensagem de Mídia_]';

  const fullText =
    msg.message?.extendedTextMessage?.text ||
    msg.message?.conversation              ||
    '';
  const args     = fullText.trim().split(/\s+/);
  const duration = parseDuration(args[1]);

  const isFromMe = quotedPart
    ? jidNormalizedUser(quotedPart) === jidNormalizedUser(sock.user?.id ?? '')
    : false;

  const targetKey = {
    remoteJid: chatJid,
    fromMe:    isFromMe,
    id:        quotedSign,
  };

  if (!isFromMe && chatJid.endsWith('@g.us') && quotedPart) {
    targetKey.participant = quotedPart;
  }

  try {
    await sock.sendMessage(chatJid, {
      pin: {
        key:      targetKey,
        type:     1, // PIN
        duration,
      },
    });

    await PinnedMessage.findOneAndUpdate(
      { chatJid },
      {
        text:      msgText,
        messageId: quotedSign,
        orig:      quotedPart ? jidNormalizedUser(quotedPart) : null,
        fixadoPor: senderJid,
        fixadoEm:  new Date(),
      },
      { upsert: true, new: true }
    );

    return sock.sendMessage(chatJid, {
      text: `📌 *Mensagem fixada com sucesso!*\n⏱️ Duração: *${duracaoLabel(duration)}*.`,
    }, { quoted: msg });

  } catch (err) {
    console.error('[handleFixar] Erro:', err);
    return sock.sendMessage(chatJid, {
      text: '❌ Não foi possível fixar. Verifique se o bot é *administrador* do grupo.',
    }, { quoted: msg });
  }
}

// ── !pinned ──────────────────────────────────────────────────
async function handlePinned(sock, msg, jid) {
  const chatJid = jidNormalizedUser(jid);

  try {
    const pm = await PinnedMessage.findOne({ chatJid }).lean();

    if (!pm) {
      return sock.sendMessage(chatJid, {
        text: 'ℹ️ Nenhuma mensagem fixada registrada neste chat.\n\n_Use *!fixar* respondendo a uma mensagem._',
      }, { quoted: msg });
    }

    const quando   = new Date(pm.fixadoEm).toLocaleString('pt-BR');
    const tagOrig  = pm.orig      ? `@${getNumeroPuro(pm.orig)}`      : 'desconhecido';
    const tagFixou = pm.fixadoPor ? `@${getNumeroPuro(pm.fixadoPor)}` : 'desconhecido';
    const mentions = [pm.orig, pm.fixadoPor].filter(Boolean);

    return sock.sendMessage(chatJid, {
      text:
        `📌 *MENSAGEM FIXADA NO GRUPO*\n\n`  +
        `👤 *Autor:* ${tagOrig}\n`     +
        `📌 *Fixada por:* ${tagFixou}\n` +
        `📅 *Data:* ${quando}\n\n`    +
        `📝 *Conteúdo:*\n${pm.text}`,
      mentions,
    }, { quoted: msg });

  } catch (err) {
    console.error('[handlePinned] Erro:', err);
    return sock.sendMessage(chatJid, {
      text: '⚠️ Erro ao buscar mensagem fixada. Tente novamente.',
    }, { quoted: msg });
  }
}

// ── !desfixar ────────────────────────────────────────────────
async function handleDesfixar(sock, msg, jid) {
  const chatJid = jidNormalizedUser(jid);

  const ctx        = msg.message?.extendedTextMessage?.contextInfo;
  const quotedSign = ctx?.stanzaId;
  const quotedPart = ctx?.participant;

  let pm;
  try {
    pm = await PinnedMessage.findOne({ chatJid }).lean();
  } catch (err) {
    console.error('[handleDesfixar] Erro ao buscar no banco:', err);
  }

  // 1. Caso o usuário responda diretamente à mensagem que deseja desfixar
  if (quotedSign) {
    const isFromMe = quotedPart
      ? jidNormalizedUser(quotedPart) === jidNormalizedUser(sock.user?.id ?? '')
      : false;

    const unpinKey = {
      remoteJid: chatJid,
      fromMe:    isFromMe,
      id:        quotedSign,
    };
    if (!isFromMe && chatJid.endsWith('@g.us') && quotedPart) {
      unpinKey.participant = quotedPart;
    }

    try {
      await sock.sendMessage(chatJid, {
        pin: { key: unpinKey, type: 2 /* UNPIN */ },
      });
    } catch (err) {
      console.error('[handleDesfixar] Erro ao desfixar mensagem respondida:', err.message);
      return sock.sendMessage(chatJid, {
        text: '❌ Não consegui desfixar a mensagem. O *Tico Bot precisa ser administrador do grupo* para gerenciar mensagens fixadas.',
      }, { quoted: msg });
    }

    if (pm?.messageId === quotedSign) {
      await PinnedMessage.deleteOne({ chatJid });
    }

    return sock.sendMessage(chatJid, {
      text: '✅ Mensagem desfixada com sucesso!',
    }, { quoted: msg });
  }

  // 2. Caso desfixe o registro ativo guardado no banco
  try {
    if (pm?.messageId) {
      const isFromMe = pm.orig
        ? jidNormalizedUser(pm.orig) === jidNormalizedUser(sock.user?.id ?? '')
        : false;

      const unpinKey = {
        remoteJid: chatJid,
        fromMe:    isFromMe,
        id:        pm.messageId,
      };

      if (!isFromMe && chatJid.endsWith('@g.us') && pm.orig) {
        unpinKey.participant = pm.orig;
      }

      await sock.sendMessage(chatJid, {
        pin: {
          key:  unpinKey,
          type: 2, // UNPIN
        },
      });
    }
  } catch (err) {
    console.error('[handleDesfixar] Erro ao desfixar no WA:', err);
    return sock.sendMessage(chatJid, {
      text: '❌ Não consegui desfixar a mensagem. O *Tico Bot precisa ser administrador do grupo* para gerenciar mensagens fixadas.',
    }, { quoted: msg });
  }

  await PinnedMessage.deleteOne({ chatJid });

  return sock.sendMessage(chatJid, {
    text: pm
      ? '✅ Mensagem desfixada com sucesso!'
      : 'ℹ️ Não havia mensagem fixada registrada neste chat.',
  }, { quoted: msg });
}

// ── !fixarinfo ───────────────────────────────────────────────
async function handleFixarInfo(sock, msg, jid) {
  const chatJid = jidNormalizedUser(jid);

  const menu =
    `📌 *SISTEMA DE MENSAGENS FIXADAS* 📌\n\n` +
    `Como utilizar os comandos de fixação:\n\n` +
    `• *!fixar [24h|7d|30d]* — Fixa a mensagem respondida pelo tempo desejado.\n` +
    `• *!desfixar* — Desfixa a mensagem fixada atual (ou a mensagem respondida).\n` +
    `• *!pinned* — Exibe a mensagem fixada e seus detalhes no grupo.\n\n` +
    `💡 *Dica:* O bot precisa ser Administrador para poder fixar mensagens!`;

  return sock.sendMessage(chatJid, { text: menu }, { quoted: msg });
}

module.exports = {
  handleFixar,
  handlePinned,
  handleDesfixar,
  handleFixarInfo,
};