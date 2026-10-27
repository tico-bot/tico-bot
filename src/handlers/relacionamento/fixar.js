'use strict';

const { jidNormalizedUser, proto } = require('@whiskeysockets/baileys');

/**
 * !fixar (Comando Novo/Aprimorado)
 * Deve ser usado respondendo a uma mensagem que deseja fixar no topo do WhatsApp.
 * Exemplo de uso: Responder a uma mensagem com "!fixar" ou "!fixar 24h" ou "!fixar 30"
 */
async function handleFixar(sock, msg, jid, pinnedMessages) {
  const chatJid = jidNormalizedUser(jid);
  const senderJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
  
  // Verifica se o usuário está respondendo a alguma mensagem
  const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedSign = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

  if (!quotedMsg || !quotedSign) {
    await sock.sendMessage(chatJid, {
      text: '⚠️ Você precisa *responder/marcar* a mensagem que deseja fixar no topo do WhatsApp!',
    }, { quoted: msg });
    return;
  }

  // Extrai o texto da mensagem marcada de forma segura
  const msgText = quotedMsg.conversation || 
                  quotedMsg.extendedTextMessage?.text || 
                  quotedMsg.imageMessage?.caption || 
                  quotedMsg.videoMessage?.caption || 
                  '[_Mensagem de Mídia/Outro Tipo_]';

  // Define o tempo de fixação padrão do WhatsApp (em segundos). Padrão: 604800 (7 dias)
  // Opções aceitas pelo WhatsApp: 86400 (24h), 604800 (7 dias), 2592000 (30 dias)
  const args = msg.message?.extendedTextMessage?.text?.split(' ') || [];
  let durationInSeconds = 604800; // 7 dias padrão
  
  if (args[1] === '24h' || args[1] === '1') durationInSeconds = 86400;
  if (args[1] === '30') durationInSeconds = 2592000;

  try {
    const quotedParticipantNorm = quotedParticipant ? jidNormalizedUser(quotedParticipant) : chatJid;

    // PROTOCOLO REAL DO WHATSAPP PARA FIXAR UMA MENSAGEM NO CHAT
    await sock.sendMessage(chatJid, {
      pin: {
        key: {
          remoteJid: chatJid,
          fromMe: quotedParticipantNorm === jidNormalizedUser(sock.user?.id),
          id: quotedSign,
          participant: quotedParticipantNorm
        },
        type: proto.Message.PinExtension.Type.PIN,
        duration: durationInSeconds
      }
    });

    // Salva na memória do bot para consultas do comando !pinned posterior
    pinnedMessages.set(chatJid, {
      text: msgText,
      time: Date.now(),
      by: `@${senderJid.split('@')[0]}`,
      byJid: senderJid,
      orig: quotedParticipantNorm,
      messageId: quotedSign
    });

    await sock.sendMessage(chatJid, {
      text: `📌 Mensagem fixada com sucesso *no topo do WhatsApp*!\n⏱️ Duração: ${durationInSeconds === 86400 ? '24 Horas' : durationInSeconds === 2592000 ? '30 Dias' : '7 Dias'}.`,
      mentions: [senderJid]
    }, { quoted: msg });

  } catch (err) {
    console.error('⚠️ Erro ao fixar mensagem no WhatsApp:', err);
    await sock.sendMessage(chatJid, {
      text: '❌ Não foi possível fixar no aplicativo. Certifique-se de que o Bot possui privilégios de Administrador no grupo.',
    }, { quoted: msg });
  }
}

/**
 * !pinned ou !mensagemfixada
 * Mostra os detalhes e o texto da mensagem fixada na memória do bot.
 */
async function handlePinned(sock, msg, jid, pinnedMessages) {
  const chatJid = jidNormalizedUser(jid);
  const pm = pinnedMessages.get(chatJid);

  if (!pm) {
    await sock.sendMessage(chatJid, {
      text: 'ℹ️ Não há nenhum registro interno de mensagem fixada neste chat.',
    }, { quoted: msg });
    return;
  }

  const when = new Date(pm.time).toLocaleString('pt-BR');
  const tagFixador = pm.by;
  const jidOrigem = jidNormalizedUser(pm.orig);
  const tagOrigem = `@${jidOrigem.split('@')[0]}`;

  const header = `📌 *Mensagem de:* ${tagOrigem}\n👤 *Fixada por:* ${tagFixador}\n📅 *Data:* ${when}`;

  const mentions = [jidOrigem];

  const jidFixadorCompleto = pm.byJid?.toLowerCase()
    || (pm.by.replace('@', '') + '@s.whatsapp.net');
  mentions.push(jidFixadorCompleto);

  await sock.sendMessage(chatJid, { 
    text: `${header}\n\n📝 *Conteúdo:*\n${pm.text}`,
    mentions: mentions
  }, { quoted: msg });
}

/**
 * !desfixar
 * Remove a mensagem do topo do WhatsApp real e limpa o banco/memória.
 */
async function handleDesfixar(sock, msg, jid, pinnedMessages) {
  const chatJid = jidNormalizedUser(jid);
  const pm = pinnedMessages.get(chatJid);

  try {
    if (pm && pm.messageId) {
      await sock.sendMessage(chatJid, {
        pin: {
          key: {
            remoteJid: chatJid,
            id: pm.messageId,
            participant: pm.orig
          },
          type: proto.Message.PinExtension.Type.UNPIN
        }
      });
    }

    if (pinnedMessages.has(chatJid)) {
      pinnedMessages.delete(chatJid);
      await sock.sendMessage(chatJid, { text: '✅ Mensagem desfixada do topo do WhatsApp com sucesso!' }, { quoted: msg });
    } else {
      await sock.sendMessage(chatJid, { text: 'ℹ️ Não há mensagens registradas para desfixar.' }, { quoted: msg });
    }

  } catch (err) {
    console.error('⚠️ Erro ao desfixar mensagem no WhatsApp:', err);
    pinnedMessages.delete(chatJid);
    await sock.sendMessage(chatJid, { text: '✅ Registro limpo localmente. Se a mensagem persistir no topo, o bot pode estar sem Admin.' }, { quoted: msg });
  }
}

module.exports = {
  handleFixar,
  handlePinned,
  handleDesfixar,
};
