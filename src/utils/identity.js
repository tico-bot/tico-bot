'use strict';

const { normalizarJid, extrairNumero } = require('./jid');
const LidMapping    = require('../models/LidMapping');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const Usuario       = require('../models/Usuario');

// ─── Identidade do usuário ──────────────────────────────────────────────────
//
// Este módulo centraliza a resolução de "quem enviou a mensagem" para um
// JID normalizado e estável, usado como chave em Usuario / CarteiraGrupo.

/**
 * Formata qualquer número de telefone (nacional ou internacional) em formato legível.
 * Suporta Brasil, EUA, Portugal, Angola, Moçambique, Espanha, Argentina, UK, etc.,
 * com fallback inteligente para qualquer código DDI do mundo.
 *
 * @param {string} numero - Dígitos puros ou string formatada
 * @returns {string}
 */
function formatarTelefone(numero) {
  if (!numero || typeof numero !== 'string' || numero === 'N/D') return 'N/D';
  const clean = numero.replace(/\D/g, '');
  if (!clean || clean.length < 7) return 'N/D';

  // 🇧🇷 Brasil (+55)
  if (clean.startsWith('55')) {
    if (clean.length === 13) {
      return `+55 ${clean.slice(2, 4)} ${clean.slice(4, 9)}-${clean.slice(9)}`;
    }
    if (clean.length === 12) {
      return `+55 ${clean.slice(2, 4)} ${clean.slice(4, 8)}-${clean.slice(8)}`;
    }
  }

  // 🇺🇸/🇨🇦 EUA e Canadá (+1)
  if (clean.startsWith('1') && clean.length === 11) {
    return `+1 ${clean.slice(1, 4)} ${clean.slice(4, 7)}-${clean.slice(7)}`;
  }

  // 🇵🇹 Portugal (+351)
  if (clean.startsWith('351') && clean.length === 12) {
    return `+351 ${clean.slice(3, 6)} ${clean.slice(6, 9)} ${clean.slice(9)}`;
  }

  // 🇦🇴 Angola (+244)
  if (clean.startsWith('244') && clean.length === 12) {
    return `+244 ${clean.slice(3, 6)} ${clean.slice(6, 9)} ${clean.slice(9)}`;
  }

  // 🇲🇿 Moçambique (+258)
  if (clean.startsWith('258') && clean.length === 12) {
    return `+258 ${clean.slice(3, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
  }

  // 🇪🇸 Espanha (+34)
  if (clean.startsWith('34') && clean.length === 11) {
    return `+34 ${clean.slice(2, 5)} ${clean.slice(5, 7)} ${clean.slice(7, 9)} ${clean.slice(9)}`;
  }

  // 🇦🇷 Argentina (+54)
  if (clean.startsWith('54') && (clean.length === 12 || clean.length === 13)) {
    if (clean.length === 13 && clean.startsWith('549')) {
      return `+54 9 ${clean.slice(3, 5)} ${clean.slice(5, 9)}-${clean.slice(9)}`;
    }
    return `+54 ${clean.slice(2, 4)} ${clean.slice(4, 8)}-${clean.slice(8)}`;
  }

  // 🇬🇧 Reino Unido (+44)
  if (clean.startsWith('44') && clean.length === 12) {
    return `+44 ${clean.slice(2, 6)} ${clean.slice(6)}`;
  }

  // 🌍 Fallback Internacional Genérico (identifica DDI de 1, 2 ou 3 dígitos)
  let ddiLen = 2;
  if (['1', '7'].includes(clean.slice(0, 1))) {
    ddiLen = 1;
  } else if (['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98'].includes(clean.slice(0, 2))) {
    ddiLen = 2;
  } else {
    ddiLen = 3;
  }

  const ddi  = clean.slice(0, ddiLen);
  const rest = clean.slice(ddiLen);

  if (rest.length > 6) {
    const half = Math.floor(rest.length / 2);
    return `+${ddi} ${rest.slice(0, half)} ${rest.slice(half)}`;
  }

  return `+${ddi} ${rest}`;
}

/**
 * Extrai o JID "cru" de quem enviou a mensagem.
 * Em grupos: msg.key.participant. Em PV: msg.key.remoteJid.
 *
 * @param {object} msg - objeto de mensagem do Baileys
 * @returns {string|null}
 */
function getSenderJid(msg) {
  return msg?.key?.participant || msg?.key?.remoteJid || null;
}

/**
 * Normaliza um JID para o formato usado como identidade nos models
 * (Usuario.idWhatsApp, CarteiraGrupo.idWhatsApp).
 *
 * @param {string} jidRaw
 * @returns {string|null}
 */
function resolveGlobalId(jidRaw) {
  if (!jidRaw || typeof jidRaw !== 'string') return null;

  if (jidRaw.endsWith('@lid')) {
    return normalizarJid(jidRaw);
  }

  const numero = extrairNumero(jidRaw);
  return numero ? `${numero}@s.whatsapp.net` : null;
}

/**
 * Atalho para pegar o remetente da mensagem já normalizado.
 *
 * @param {object} msg
 * @returns {string|null}
 */
function resolveUserFromMsg(msg) {
  return resolveGlobalId(getSenderJid(msg));
}

/**
 * Resolve qual JID usar como chave de CarteiraGrupo para um usuário.
 *
 * @param {string} idWhatsApp - JID cru ou já normalizado do usuário.
 * @param {string} idGrupo    - JID do grupo (chave composta da carteira).
 * @returns {Promise<string>}
 */
async function resolveJidComLid(idWhatsApp, idGrupo) {
  const idNorm = resolveGlobalId(idWhatsApp);
  if (!idNorm) return idWhatsApp;

  if (!idNorm.endsWith('@lid')) {
    const lidMap = await LidMapping.findOne({ pn: idNorm }).lean();
    if (lidMap?.lid) {
      const carteiraLid = await CarteiraGrupo.findOne({ idWhatsApp: lidMap.lid, idGrupo }).lean();
      if (carteiraLid) return lidMap.lid;
    }
  }

  return idNorm;
}

/**
 * Resolve um JID (seja @lid, @s.whatsapp.net, ou número puro) para:
 * - JID normalizado principal
 * - JID de telefone (@s.whatsapp.net)
 * - JID de LID (@lid) se houver
 * - Número de telefone limpo (dígitos) ou 'N/D'
 * - Telefone formatado (+55 11 99999-9999)
 *
 * @param {string} alvoJid
 * @param {object} [sock] - Instância do Baileys
 * @returns {Promise<{ resolvedJid: string, pnJid: string|null, lidJid: string|null, number: string, formattedNumber: string }>}
 */
async function resolvePhoneAndJid(alvoJid, sock) {
  if (!alvoJid || typeof alvoJid !== 'string') {
    return { resolvedJid: '', pnJid: null, lidJid: null, number: 'N/D', formattedNumber: 'N/D' };
  }

  const normInput = normalizarJid(alvoJid);
  let resolvedJid = normInput;
  let pnJid       = normInput.endsWith('@s.whatsapp.net') ? normInput : null;
  let lidJid      = normInput.endsWith('@lid') ? normInput : null;
  let number      = extrairNumero(normInput);

  if (!normInput.includes('@') && number) {
    pnJid = `${number}@s.whatsapp.net`;
    resolvedJid = pnJid;
  }

  // 1. Se for @lid, tentar resolver PN via LidMapping ou Usuario
  if (normInput.endsWith('@lid')) {
    lidJid = normInput;
    try {
      const lidMap = await LidMapping.findOne({ lid: normInput }).lean();
      if (lidMap?.pn) {
        const pnNorm = normalizarJid(lidMap.pn);
        pnJid = pnNorm.endsWith('@s.whatsapp.net') ? pnNorm : `${extrairNumero(pnNorm)}@s.whatsapp.net`;
        resolvedJid = pnJid;
        number = extrairNumero(pnJid);
      }
    } catch {}

    if (!pnJid) {
      try {
        const user = await Usuario.findOne({
          $or: [{ idWhatsApp: normInput }, { lid: normInput }]
        }).lean();

        if (user?.telefone) {
          number = extrairNumero(user.telefone);
          pnJid = `${number}@s.whatsapp.net`;
          resolvedJid = pnJid;
        } else if (user?.idWhatsApp && user.idWhatsApp.endsWith('@s.whatsapp.net')) {
          pnJid = user.idWhatsApp;
          resolvedJid = pnJid;
          number = extrairNumero(pnJid);
        }
      } catch {}
    }

    if (resolvedJid.endsWith('@lid')) {
      number = 'N/D';
    }
  }

  // 2. Se for @s.whatsapp.net, buscar se há LID associado em LidMapping
  if (pnJid && !lidJid) {
    try {
      const lidMap = await LidMapping.findOne({ pn: pnJid }).lean();
      if (lidMap?.lid) {
        lidJid = normalizarJid(lidMap.lid);
      }
    } catch {}
  }

  const formattedNumber = formatarTelefone(number);

  return {
    resolvedJid,
    pnJid,
    lidJid,
    number,
    formattedNumber,
  };
}

/**
 * Busca todas as informações de identidade de um usuário: JID, LID, Telefone, Nome e dados do Mongo.
 *
 * @param {string} alvoJid
 * @param {object} [sock]
 * @param {object} [contactNames]
 * @returns {Promise<{ jid: string, resolvedJid: string, pnJid: string|null, lidJid: string|null, number: string, formattedNumber: string, nome: string, userData: object|null }>}
 */
async function resolveUsuarioInfo(alvoJid, sock, contactNames = {}) {
  const phoneRes = await resolvePhoneAndJid(alvoJid, sock);
  const { resolvedJid, pnJid, lidJid, number, formattedNumber } = phoneRes;

  const queryConditions = [];
  if (alvoJid) queryConditions.push({ idWhatsApp: normalizarJid(alvoJid) });
  if (resolvedJid) queryConditions.push({ idWhatsApp: resolvedJid });
  if (pnJid) queryConditions.push({ idWhatsApp: pnJid });
  if (lidJid) queryConditions.push({ idWhatsApp: lidJid });
  if (number && number !== 'N/D') queryConditions.push({ telefone: number });

  let userData = null;
  if (queryConditions.length > 0) {
    try {
      userData = await Usuario.findOne({ $or: queryConditions }).lean();
    } catch {}
  }

  let finalNumber = number;
  let finalFormatted = formattedNumber;
  if ((!finalNumber || finalNumber === 'N/D') && userData?.telefone) {
    finalNumber = extrairNumero(userData.telefone);
    finalFormatted = formatarTelefone(finalNumber);
  }

  let nome =
    contactNames?.[alvoJid] ||
    contactNames?.[resolvedJid] ||
    (pnJid ? contactNames?.[pnJid] : null) ||
    (lidJid ? contactNames?.[lidJid] : null) ||
    userData?.nome;

  if (!nome || nome === finalNumber) {
    if (finalNumber && finalNumber !== 'N/D') {
      nome = finalFormatted !== 'N/D' ? finalFormatted : `+${finalNumber}`;
    } else {
      nome = 'Usuário';
    }
  }

  return {
    jid: normalizarJid(alvoJid),
    resolvedJid,
    pnJid,
    lidJid,
    number: finalNumber,
    formattedNumber: finalFormatted,
    nome,
    userData,
  };
}

/**
 * Registra/atualiza automaticamente o LidMapping e os dados básicos do Usuario (telefone, nome)
 * a partir de mensagens recebidas do Baileys.
 *
 * @param {object} msg - Objeto da mensagem Baileys
 * @param {string} [pushName] - Nome do remetente obtido do Baileys
 */
async function registrarLidEMapping(msg, pushName) {
  if (!msg || !msg.key) return;

  const senderJid = msg.key.participant || msg.key.remoteJid;
  if (!senderJid) return;

  const senderNorm = normalizarJid(senderJid);
  const keyObj = msg.key || {};

  const altJid = keyObj.participantPn || keyObj.remoteJidPn || keyObj.participantAlt || keyObj.remoteJidAlt || msg.participantPn || msg.participantAlt;
  const altNorm = altJid ? normalizarJid(altJid) : null;

  let lid = senderNorm.endsWith('@lid') ? senderNorm : (altNorm?.endsWith('@lid') ? altNorm : null);
  let pn  = senderNorm.endsWith('@s.whatsapp.net') ? senderNorm : (altNorm?.endsWith('@s.whatsapp.net') ? altNorm : null);

  if (lid && pn) {
    try {
      await LidMapping.updateOne(
        { lid },
        { $set: { pn } },
        { upsert: true }
      );
    } catch {}
  }

  const phoneDigits = pn ? extrairNumero(pn) : (senderNorm.endsWith('@s.whatsapp.net') ? extrairNumero(senderNorm) : null);
  if (phoneDigits || pushName) {
    try {
      const updates = {};
      if (phoneDigits) updates.telefone = phoneDigits;
      if (pushName && pushName !== 'Usuário') updates.nome = pushName;

      if (Object.keys(updates).length > 0) {
        await Usuario.updateOne(
          { idWhatsApp: senderNorm },
          { $set: updates, $setOnInsert: { idWhatsApp: senderNorm } },
          { upsert: true }
        );
        if (pn && pn !== senderNorm) {
          await Usuario.updateOne(
            { idWhatsApp: pn },
            { $set: updates, $setOnInsert: { idWhatsApp: pn } },
            { upsert: true }
          );
        }
      }
    } catch {}
  }
}

module.exports = {
  getSenderJid,
  resolveGlobalId,
  resolveUserFromMsg,
  resolveJidComLid,
  resolvePhoneAndJid,
  resolveUsuarioInfo,
  registrarLidEMapping,
  formatarTelefone,
  normalizarJid,
  extrairNumero,
};