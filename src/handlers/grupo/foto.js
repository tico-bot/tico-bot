'use strict';

const sharp = require('sharp');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const {
  somenteGrupo,
  checkAdmin,
  getGroupMetadataCached,
  normalizeJidBase,
} = require('./helpers');
const { getAlternateSenderJids } = require('../../utils/identity');
const { isOwnerIdentity } = require('../extras/_shared');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const SILENT_LOGGER = { level: 'silent' };

function unwrapMessage(message) {
  let current = message;
  // Trata mensagens efémeras e de visualização única sem perder o conteúdo interno.
  for (let i = 0; i < 5 && current; i++) {
    const nested = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}

function getImageSource(msg, content, jid) {
  const current = unwrapMessage(content || msg.message);
  if (current?.imageMessage) {
    return { image: current.imageMessage, message: { ...msg, message: current } };
  }

  const context = current?.extendedTextMessage?.contextInfo
    || current?.imageMessage?.contextInfo
    || current?.buttonsResponseMessage?.contextInfo;
  const quoted = unwrapMessage(context?.quotedMessage);
  if (!quoted?.imageMessage) return null;

  return {
    image: quoted.imageMessage,
    message: {
      key: {
        remoteJid: jid,
        id: context.stanzaId,
        fromMe: false,
        participant: context.participant || null,
      },
      message: quoted,
    },
  };
}

async function handleFotoGrupo(sock, msg, content, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, {
      text: '⚠️ O comando de foto só funciona dentro de um grupo.',
    }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'fotogp')) return;

  let metadata;
  try {
    metadata = await getGroupMetadataCached(sock, jid, true);
  } catch (error) {
    console.error('[handleFotoGrupo] Não consegui buscar os administradores:', error.message);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui verificar as permissões do grupo. Tente novamente.',
    }, { quoted: msg });
    return;
  }

  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderAlternateJids = getAlternateSenderJids(msg);
  const senderBases = new Set([senderJid, ...senderAlternateJids].map(normalizeJidBase).filter(Boolean));
  const globalOwner = await isOwnerIdentity(senderJid, senderAlternateJids);
  const senderParticipant = metadata?.participants?.find(p => p && (
    senderBases.has(normalizeJidBase(p.id)) || senderBases.has(normalizeJidBase(p.lid))
  ));
  if (!senderParticipant?.admin && !globalOwner) {
    await sock.sendMessage(jid, {
      text: '❌ Apenas administradores do próprio grupo podem alterar a foto.',
    }, { quoted: msg });
    return;
  }

  const botJid = sock.user?.id || sock.user?.jid;
  const botBase = normalizeJidBase(botJid);
  const botParticipant = metadata?.participants?.find(p => p && (
    normalizeJidBase(p.id) === botBase || normalizeJidBase(p.lid) === botBase
  ));
  if (!botParticipant?.admin) {
    await sock.sendMessage(jid, {
      text: '⚠️ Preciso ser administrador do grupo para alterar a foto. Promova o Tico Bot e tente novamente.',
    }, { quoted: msg });
    return;
  }

  const source = getImageSource(msg, content, jid);
  if (!source) {
    await sock.sendMessage(jid, {
      text: '🖼️ Para mudar a foto do grupo, envie uma imagem e responda a ela com *!fotogp* ou *!setfotogp*. Também posso receber uma imagem com o comando na legenda.',
    }, { quoted: msg });
    return;
  }

  const reportedSize = Number(source.image.fileLength || 0);
  if (reportedSize > MAX_IMAGE_BYTES) {
    await sock.sendMessage(jid, {
      text: '⚠️ A imagem é muito grande. O limite é 20 MB.',
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
  try {
    const buffer = await downloadMediaMessage(
      source.message,
      'buffer',
      {},
      { logger: SILENT_LOGGER, reuploadRequest: sock.updateMediaMessage },
    );

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('A imagem baixada está vazia.');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      await sock.sendMessage(jid, { text: '⚠️ A imagem é muito grande. O limite é 20 MB.' }, { quoted: msg });
      return;
    }

    const metadataImagem = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    if (!metadataImagem.width || !metadataImagem.height || metadataImagem.width * metadataImagem.height > MAX_IMAGE_PIXELS) {
      throw new Error('Dimensões da imagem inválidas ou demasiado grandes.');
    }

    const foto = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize(640, 640, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    await sock.updateProfilePicture(jid, foto);
    await sock.sendMessage(jid, {
      text: '✅ A foto do grupo foi atualizada com sucesso! 🖼️',
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});
  } catch (error) {
    console.error('[handleFotoGrupo] Erro ao atualizar a foto do grupo:', error.message);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui alterar a foto. Confirme se a imagem está válida e se o Tico Bot continua como administrador.',
    }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
  }
}

module.exports = { handleFotoGrupo, unwrapMessage, getImageSource };
