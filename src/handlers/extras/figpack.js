'use strict';

const pino = require('pino');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const StickerPack = require('../../models/StickerPack');
const { isAdmin } = require('../grupo/helpers');

const MAX_POR_GRUPO = 30;
const MAX_BYTES     = 1024 * 1024; // 1 MB por figurinha
const silencioso    = pino({ level: 'silent' });

function nomeValido(txt) {
  const n = String(txt || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,20}$/.test(n) ? n : null;
}

function getFigurinhaCitada(content, jid) {
  const ctx    = content?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  const stk    = quoted?.stickerMessage
              || quoted?.ephemeralMessage?.message?.stickerMessage
              || quoted?.viewOnceMessage?.message?.stickerMessage;
  if (!stk || !ctx?.stanzaId) return null;
  return {
    key: { remoteJid: jid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant },
    message: { stickerMessage: stk },
  };
}

async function soGrupo(sock, msg, jid) {
  if (jid.endsWith('@g.us')) return true;
  await sock.sendMessage(jid, { text: '❌ Os pacotes de figurinhas funcionam apenas em grupos.' }, { quoted: msg });
  return false;
}

// !figsalvar <nome>  (respondendo a uma figurinha) — só admins
async function handleFigSalvar(sock, msg, content, jid, senderJid, args, P) {
  if (!await soGrupo(sock, msg, jid)) return;

  if (!await isAdmin(sock, jid, senderJid)) {
    await sock.sendMessage(jid, { text: '❌ Apenas admins podem salvar figurinhas no pacote do grupo.' }, { quoted: msg });
    return;
  }

  const nome = nomeValido(args.split(/\s+/)[0]);
  if (!nome) {
    await sock.sendMessage(jid, {
      text: `⚠️ Responda a uma figurinha com *${P}figsalvar <nome>*\n_Nome: letras, números, _ ou -, até 20 caracteres._`,
    }, { quoted: msg });
    return;
  }

  const citada = getFigurinhaCitada(content, jid);
  if (!citada) {
    await sock.sendMessage(jid, { text: '⚠️ Você precisa *responder a uma figurinha* com este comando.' }, { quoted: msg });
    return;
  }

  const existe = await StickerPack.exists({ idGrupo: jid, nome });
  if (!existe && await StickerPack.countDocuments({ idGrupo: jid }) >= MAX_POR_GRUPO) {
    await sock.sendMessage(jid, { text: `⚠️ O pacote do grupo já tem *${MAX_POR_GRUPO}* figurinhas. Remova alguma com *${P}figremover <nome>*.` }, { quoted: msg });
    return;
  }

  let buffer;
  try {
    buffer = await downloadMediaMessage(citada, 'buffer', {}, { logger: silencioso, reuploadRequest: sock.updateMediaMessage });
  } catch (e) {
    console.error('[figsalvar] download falhou:', e?.message || e);
    await sock.sendMessage(jid, { text: '❌ Não consegui baixar essa figurinha. Tente enviá-la de novo.' }, { quoted: msg });
    return;
  }
  if (!buffer?.length || buffer.length > MAX_BYTES) {
    await sock.sendMessage(jid, { text: '⚠️ Essa figurinha é grande demais (máx. 1 MB).' }, { quoted: msg });
    return;
  }

  await StickerPack.findOneAndUpdate(
    { idGrupo: jid, nome },
    { $set: { webp: buffer, criadoPor: senderJid } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await sock.sendMessage(jid, { text: `✅ Figurinha *${nome}* ${existe ? 'atualizada' : 'salva'} no pacote do grupo!\nUse *${P}figenviar ${nome}*.` }, { quoted: msg });
}

// !figlista
async function handleFigLista(sock, msg, jid, P) {
  if (!await soGrupo(sock, msg, jid)) return;
  const itens = await StickerPack.find({ idGrupo: jid }).select('nome').sort({ nome: 1 }).lean();
  if (!itens.length) {
    await sock.sendMessage(jid, { text: `📭 O grupo ainda não tem figurinhas salvas.\nAdmins: responda a uma figurinha com *${P}figsalvar <nome>*.` }, { quoted: msg });
    return;
  }
  await sock.sendMessage(jid, {
    text:
      `🎴 *PACOTE DE FIGURINHAS DO GRUPO* (${itens.length}/${MAX_POR_GRUPO})\n\n` +
      itens.map(i => `• ${i.nome}`).join('\n') +
      `\n\nEnvie com *${P}figenviar <nome>*`,
  }, { quoted: msg });
}

// !figenviar <nome>
async function handleFigEnviar(sock, msg, jid, args, P) {
  if (!await soGrupo(sock, msg, jid)) return;
  const nome = nomeValido(args.split(/\s+/)[0]);
  if (!nome) {
    await sock.sendMessage(jid, { text: `⚠️ Use *${P}figenviar <nome>*. Veja os nomes com *${P}figlista*.` }, { quoted: msg });
    return;
  }
  const item = await StickerPack.findOne({ idGrupo: jid, nome }).lean();
  if (!item) {
    await sock.sendMessage(jid, { text: `❌ Não existe a figurinha *${nome}*. Veja *${P}figlista*.` }, { quoted: msg });
    return;
  }
  // .buffer: o driver devolve Binary quando usamos lean()
  const buf = Buffer.isBuffer(item.webp) ? item.webp : Buffer.from(item.webp.buffer || item.webp);
  await sock.sendMessage(jid, { sticker: buf }, { quoted: msg });
}

// !figremover <nome> — só admins
async function handleFigRemover(sock, msg, jid, senderJid, args, P) {
  if (!await soGrupo(sock, msg, jid)) return;
  if (!await isAdmin(sock, jid, senderJid)) {
    await sock.sendMessage(jid, { text: '❌ Apenas admins podem remover figurinhas do pacote.' }, { quoted: msg });
    return;
  }
  const nome = nomeValido(args.split(/\s+/)[0]);
  if (!nome) {
    await sock.sendMessage(jid, { text: `⚠️ Use *${P}figremover <nome>*.` }, { quoted: msg });
    return;
  }
  const res = await StickerPack.deleteOne({ idGrupo: jid, nome });
  await sock.sendMessage(jid, {
    text: res.deletedCount ? `🗑️ Figurinha *${nome}* removida.` : `❌ Não existe a figurinha *${nome}*.`,
  }, { quoted: msg });
}

module.exports = { handleFigSalvar, handleFigLista, handleFigEnviar, handleFigRemover };
