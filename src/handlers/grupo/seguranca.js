'use strict';

const GrupoConfig = require('../../models/GrupoConfig');
const LidMapping = require('../../models/LidMapping');
const { normalizarJid } = require('../../utils/jid');
const {
  somenteGrupo,
  checkAdmin,
  isAdmin,
  normalizeJidBase,
  resolveTargetJid,
  getGroupMetadataCached,
  getGroupOwner,
} = require('./helpers');
const { normalizarDominio } = require('../../utils/links');
const { getAlternateSenderJids } = require('../../utils/identity');
const { isOwnerIdentity } = require('../extras/_shared');

function obterTexto(msg, content) {
  return content?.conversation || content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption || content?.videoMessage?.caption || '';
}

function argumentosDoComando(texto, comando) {
  const prefixo = new RegExp(`^[!.,/#]${comando}\\s*`, 'i');
  return texto.replace(prefixo, '').trim();
}

function normalizarBaseJid(jid) {
  return normalizeJidBase(jid || '');
}

function encontrarParticipante(meta, jid) {
  const base = normalizarBaseJid(jid);
  if (!base) return null;
  return meta?.participants?.find(p => p && (
    normalizarBaseJid(p.id) === base || normalizarBaseJid(p.lid) === base
  )) || null;
}

async function encontrarParticipanteDoGrupo(meta, jid) {
  const encontrado = encontrarParticipante(meta, jid);
  if (encontrado) return encontrado;
  const mapping = await LidMapping.findOne({ $or: [{ pn: jid }, { lid: jid }] }).lean().catch(() => null);
  if (!mapping) return null;
  const alternateJid = normalizarJid(mapping.pn) === normalizarJid(jid) ? mapping.lid : mapping.pn;
  return alternateJid ? encontrarParticipante(meta, alternateJid) : null;
}

function idsDoParticipante(participante, fallback) {
  return [...new Set([participante?.id, participante?.lid, fallback].filter(Boolean))];
}

function temPermissaoSalva(lista, participante, fallback) {
  const bases = new Set(idsDoParticipante(participante, fallback).map(normalizarBaseJid).filter(Boolean));
  return (Array.isArray(lista) ? lista : []).some(id => bases.has(normalizarBaseJid(id)));
}

function invalidarCacheConfig(jid) {
  try { require('../../router').invalidateGrupoConfigCache(jid); } catch { /* router ainda pode estar carregando */ }
}

async function confirmarDonoDoGrupo(sock, jid, msg) {
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderAlternateJids = getAlternateSenderJids(msg);
  const globalOwner = await isOwnerIdentity(senderJid, senderAlternateJids);
  const meta = await getGroupMetadataCached(sock, jid, true).catch(() => null);
  const sender = await encontrarParticipanteDoGrupo(meta, senderJid);
  const owner = await getGroupOwner(sock, jid).catch(() => null);
  const isOwner = globalOwner || sender?.admin === 'superadmin' || (
    owner && normalizarBaseJid(owner) === normalizarBaseJid(senderJid)
  );
  if (!isOwner) {
    await sock.sendMessage(jid, {
      text: '🔒 Apenas o dono do grupo pode conceder ou remover a permissão especial de promoção/rebaixamento.',
    }, { quoted: msg });
    return null;
  }
  return meta;
}

async function handlePermLink(sock, msg, content, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'permlink')) return;

  const texto = obterTexto(msg, content);
  const dominio = normalizarDominio(argumentosDoComando(texto, 'permlink'));
  if (!dominio) {
    await sock.sendMessage(jid, {
      text: '⚠️ Informe um domínio válido. Exemplo: *!permlink youtube.com*',
    }, { quoted: msg });
    return;
  }

  const atual = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  const lista = Array.isArray(atual?.linksPermitidos) ? atual.linksPermitidos : [];
  if (lista.some(item => normalizarDominio(item) === dominio)) {
    await sock.sendMessage(jid, { text: `ℹ️ *${dominio}* já está na lista branca.` }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $addToSet: { linksPermitidos: dominio } },
    { upsert: true, new: true },
  );
  invalidarCacheConfig(jid);
  await sock.sendMessage(jid, {
    text: `✅ *${dominio}* foi adicionado à lista branca.\n_O anti-link continuará bloqueando outros domínios quando estiver ativado._`,
  }, { quoted: msg });
}

async function handleRemovePermLink(sock, msg, content, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'rmpermlink')) return;

  const texto = obterTexto(msg, content);
  const dominio = normalizarDominio(argumentosDoComando(texto, 'rmpermlink'));
  if (!dominio) {
    await sock.sendMessage(jid, {
      text: '⚠️ Informe um domínio válido. Exemplo: *!rmpermlink youtube.com*',
    }, { quoted: msg });
    return;
  }

  const atual = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  const lista = Array.isArray(atual?.linksPermitidos) ? atual.linksPermitidos : [];
  const filtrada = lista.filter(item => normalizarDominio(item) !== dominio);
  if (filtrada.length === lista.length) {
    await sock.sendMessage(jid, { text: `ℹ️ *${dominio}* não está na lista branca.` }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { linksPermitidos: filtrada } },
    { upsert: true, new: true },
  );
  invalidarCacheConfig(jid);
  await sock.sendMessage(jid, { text: `✅ *${dominio}* foi removido da lista branca.` }, { quoted: msg });
}

async function handleListLinkBranco(sock, msg, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'listlinkbranco')) return;

  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  const lista = [...new Set((cfg?.linksPermitidos || []).map(normalizarDominio).filter(Boolean))].sort();
  const texto = lista.length
    ? `⚪ *LISTA BRANCA DE LINKS* ⚪\n\n${lista.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n_Total: ${lista.length} domínio(s)_`
    : '⚪ A lista branca está vazia.\n\nUse *!permlink youtube.com* para adicionar um domínio.';
  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

async function handlePermAdm(sock, msg, content, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'permadm')) return;

  const meta = await confirmarDonoDoGrupo(sock, jid, msg);
  if (!meta) return;
  const alvo = await resolveTargetJid(sock, msg, content, jid);
  if (!alvo) {
    await sock.sendMessage(jid, { text: '⚠️ Marque um administrador. Exemplo: *!permadm @usuario*' }, { quoted: msg });
    return;
  }

  const participante = await encontrarParticipanteDoGrupo(meta, alvo);
  if (!participante || !participante.admin) {
    await sock.sendMessage(jid, { text: '⚠️ A permissão especial só pode ser dada a alguém que já seja administrador do grupo.' }, { quoted: msg });
    return;
  }
  if (participante.admin === 'superadmin') {
    await sock.sendMessage(jid, { text: '👑 O dono do grupo já tem essa permissão automaticamente.' }, { quoted: msg });
    return;
  }

  const ids = idsDoParticipante(participante, alvo);
  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  if (temPermissaoSalva(cfg?.admsPermissao, participante, alvo)) {
    await sock.sendMessage(jid, { text: `✅ *${ids[0].split('@')[0]}* já tem permissão especial.` }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $addToSet: { admsPermissao: { $each: ids } } },
    { upsert: true, new: true },
  );
  invalidarCacheConfig(jid);
  await sock.sendMessage(jid, {
    text: `👑 Permissão especial concedida a *@${normalizarBaseJid(ids[0])}*. Agora pode promover membros e rebaixar administradores.`,
    mentions: [participante.id || alvo],
  }, { quoted: msg });
}

async function handleRemovePermAdm(sock, msg, content, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'rmpermadm')) return;

  const meta = await confirmarDonoDoGrupo(sock, jid, msg);
  if (!meta) return;
  const alvo = await resolveTargetJid(sock, msg, content, jid);
  if (!alvo) {
    await sock.sendMessage(jid, { text: '⚠️ Marque o administrador. Exemplo: *!rmpermadm @usuario*' }, { quoted: msg });
    return;
  }

  const participante = await encontrarParticipanteDoGrupo(meta, alvo);
  if (participante?.admin === 'superadmin') {
    await sock.sendMessage(jid, { text: '👑 O dono do grupo tem permissão automática, que não pode ser removida por este comando.' }, { quoted: msg });
    return;
  }

  const idsAlvo = new Set(idsDoParticipante(participante, alvo).map(normalizarBaseJid).filter(Boolean));
  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  const lista = Array.isArray(cfg?.admsPermissao) ? cfg.admsPermissao : [];
  const filtrada = lista.filter(id => !idsAlvo.has(normalizarBaseJid(id)));
  if (filtrada.length === lista.length) {
    await sock.sendMessage(jid, { text: 'ℹ️ Esse administrador não tem permissão especial registrada.' }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { admsPermissao: filtrada } },
    { upsert: true, new: true },
  );
  invalidarCacheConfig(jid);
  await sock.sendMessage(jid, {
    text: `✅ Permissão especial removida de *@${normalizarBaseJid(idsAlvo.values().next().value || alvo)}*.`,
    mentions: [participante?.id || alvo],
  }, { quoted: msg });
}

async function handleAdmsPerm(sock, msg, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'admsperm')) return;

  const meta = await getGroupMetadataCached(sock, jid, true).catch(() => null);
  if (!meta?.participants) {
    await sock.sendMessage(jid, { text: '❌ Não consegui consultar os administradores do grupo.' }, { quoted: msg });
    return;
  }
  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  const lista = Array.isArray(cfg?.admsPermissao) ? cfg.admsPermissao : [];
  const autorizados = meta.participants.filter(p => p?.admin && (
    p.admin === 'superadmin' || temPermissaoSalva(lista, p, p.id)
  ));

  if (!autorizados.length) {
    await sock.sendMessage(jid, { text: '👑 Nenhum administrador com permissão especial foi configurado. O dono do grupo recebe essa permissão automaticamente.' }, { quoted: msg });
    return;
  }
  const linhas = autorizados.map((p, i) => {
    const tipo = p.admin === 'superadmin' ? 'Dono do grupo — permissão automática' : 'Permissão especial';
    return `${i + 1}. @${normalizarBaseJid(p.id)} — ${tipo}`;
  });
  await sock.sendMessage(jid, {
    text: `👑 *ADMINS COM PERMISSÃO PARA PROMOVER/REBAIXAR*\n\n${linhas.join('\n')}\n\n_Total: ${autorizados.length}_`,
    mentions: autorizados.map(p => p.id).filter(Boolean),
  }, { quoted: msg });
}

module.exports = {
  handlePermLink,
  handleRemovePermLink,
  handleListLinkBranco,
  handlePermAdm,
  handleRemovePermAdm,
  handleAdmsPerm,
};
