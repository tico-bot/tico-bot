'use strict';

const { normalizarJid, normalizarJidUsuario, normalizarJidComDominio, extrairNumero } = require('./jid');
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
 * Retorna os JIDs alternativos que o WhatsApp informa para o mesmo remetente.
 * Isso permite conferir permissões quando participant/remoteJid vem como @lid,
 * mas a mensagem também carrega a identidade telefônica @s.whatsapp.net.
 */
function getAlternateSenderJids(msg) {
  const key = msg?.key || {};
  // Baileys v2 expõe pares adicionais senderPn/senderLid e participantLid.
  // Em grupos, algumas mensagens trazem o PN somente em senderPn, não em participantPn.
  const candidates = [
    { value: key.participantPn, domain: 's.whatsapp.net' },
    { value: key.senderPn, domain: 's.whatsapp.net' },
    { value: key.remoteJidPn, domain: 's.whatsapp.net' },
    { value: key.senderLid, domain: 'lid' },
    { value: key.participantLid, domain: 'lid' },
    { value: msg?.participantPn, domain: 's.whatsapp.net' },
    { value: msg?.senderPn, domain: 's.whatsapp.net' },
    { value: msg?.senderLid, domain: 'lid' },
    { value: msg?.participantLid, domain: 'lid' },
    // Campos Alt não especificam o domínio: só aceitamos quando já vêm como JID completo.
    { value: key.participantAlt },
    { value: key.remoteJidAlt },
    { value: msg?.participantAlt },
  ];

  return [...new Set(candidates.map(({ value, domain }) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    if (domain) return normalizarJidComDominio(raw, domain);
    return raw.includes('@') ? normalizarJidUsuario(raw) : null;
  }).filter(Boolean))];
}

/**
 * Normaliza um JID para o formato usado como identidade nos models
 * (Usuario.idWhatsApp, CarteiraGrupo.idWhatsApp).
 *
 * @param {string} jidRaw
 * @returns {string|null}
 */
/**
 * Extrai JIDs PN/LID de um participante do Baileys respeitando a semântica
 * de cada campo. `id` já vem com domínio; `jid`/`pn` são PN e `lid` é LID.
 */
function getParticipantJids(participant) {
  if (typeof participant === 'string') {
    return participant.includes('@') ? [normalizarJidUsuario(participant)].filter(Boolean) : [];
  }
  if (!participant || typeof participant !== 'object') return [];
  const values = [
    normalizarJidUsuario(typeof participant.id === 'string' && participant.id.includes('@') ? participant.id : null),
    normalizarJidComDominio(participant.jid, 's.whatsapp.net'),
    normalizarJidComDominio(participant.pn, 's.whatsapp.net'),
    normalizarJidComDominio(participant.phoneNumber, 's.whatsapp.net'),
    normalizarJidComDominio(participant.lid, 'lid'),
  ].filter(Boolean);
  return [...new Set(values)];
}

function resolveGlobalId(jidRaw) {
  if (!jidRaw || typeof jidRaw !== 'string') return null;
  const jid = normalizarJidUsuario(jidRaw.trim());
  if (!jid) return null;
  if (jid.endsWith('@lid')) return jid;
  const numero = extrairNumero(jid);
  return numero.length >= 7 && numero.length <= 15 ? jid : null;
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
  if (!idNorm) return null;

  if (!idNorm.endsWith('@lid')) {
    const lidMap = await LidMapping.findOne({ pn: idNorm }).lean();
    if (lidMap?.lid) {
      const lidValidado = normalizarJidComDominio(lidMap.lid, 'lid');
      if (!lidValidado?.endsWith('@lid')) return idNorm;
      const carteiraLid = await CarteiraGrupo.findOne({ idWhatsApp: lidValidado, idGrupo }).lean();
      if (carteiraLid) return lidValidado;
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

  const valorInput = alvoJid.trim();
  const jidValidado = normalizarJidUsuario(valorInput);
  const normInput = jidValidado && (
    jidValidado.endsWith('@lid') ||
    (jidValidado.endsWith('@s.whatsapp.net') && extrairNumero(jidValidado).length >= 7 && extrairNumero(jidValidado).length <= 15)
  ) ? jidValidado : null;
  if (!normInput) {
    return { resolvedJid: '', pnJid: null, lidJid: null, number: 'N/D', formattedNumber: 'N/D' };
  }
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
      const pnNorm = normalizarJidComDominio(lidMap?.pn, 's.whatsapp.net');
      if (pnNorm?.endsWith('@s.whatsapp.net') && extrairNumero(pnNorm)) {
        pnJid = pnNorm;
        resolvedJid = pnJid;
        number = extrairNumero(pnJid);
      }
    } catch {}

    if (!pnJid) {
      try {
        const user = await Usuario.findOne({
          $or: [{ idWhatsApp: normInput }, { lid: normInput }]
        }).lean();

        const pnUsuario = normalizarJidComDominio(user?.idWhatsApp, 's.whatsapp.net');
        if (pnUsuario?.endsWith('@s.whatsapp.net')) {
          pnJid = pnUsuario;
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
      const lidValidado = normalizarJidComDominio(lidMap?.lid, 'lid');
      if (lidValidado?.endsWith('@lid')) lidJid = lidValidado;
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
  const alvoNormalizado = normalizarJidUsuario(alvoJid);
  if (alvoNormalizado) queryConditions.push({ idWhatsApp: alvoNormalizado });
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
  if ((!finalNumber || finalNumber === 'N/D') && userData?.telefone && !(normalizarJidUsuario(alvoJid)?.endsWith('@lid') && extrairNumero(`${String(userData.telefone)}@s.whatsapp.net`) === extrairNumero(alvoJid))) {
    finalNumber = String(userData.telefone).replace(/\D/g, '');
    if (finalNumber.length < 8 || finalNumber.length > 15) finalNumber = 'N/D';
    finalFormatted = formatarTelefone(finalNumber);
  }

  const idsParaNome = [alvoJid, resolvedJid, pnJid, lidJid].filter(Boolean);
  const nome = [
    contactNames?.[alvoJid],
    contactNames?.[resolvedJid],
    pnJid ? contactNames?.[pnJid] : null,
    lidJid ? contactNames?.[lidJid] : null,
    userData?.displayName,
    userData?.nome,
    userData?.username,
    userData?.pushName,
  ].map(valor => validarNomeExibicao(valor, idsParaNome)).find(Boolean) || 'Usuário';

  return {
    jid: normalizarJidUsuario(alvoJid),
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
 * Compara duas identidades considerando aliases PN/LID do WhatsApp e do Mongo.
 * Os números de um LID nunca são tratados como se fossem um telefone PN.
 */
async function sameWhatsAppIdentity(jidA, jidB, sock, aliasesA = [], aliasesB = []) {
  const normalizarJidCompleto = valor => {
    if (typeof valor !== 'string' || !valor.trim() || !valor.includes('@')) return null;
    return normalizarJidUsuario(valor.trim());
  };
  const normalizarIdentidade = (principal, aliases, info) => [
    normalizarJidUsuario(principal),
    ...(Array.isArray(aliases) ? aliases : [aliases]).map(normalizarJidCompleto),
    normalizarJidCompleto(info?.resolvedJid),
    normalizarJidCompleto(info?.pnJid),
    normalizarJidCompleto(info?.lidJid),
  ].filter(Boolean);

  const [infoA, infoB] = await Promise.all([
    resolvePhoneAndJid(jidA, sock).catch(() => null),
    resolvePhoneAndJid(jidB, sock).catch(() => null),
  ]);
  const idsA = new Set(normalizarIdentidade(jidA, aliasesA, infoA));
  const idsB = normalizarIdentidade(jidB, aliasesB, infoB);
  return idsB.some(id => idsA.has(id));
}

/**
 * Retorna o nome utilizável de um contacto, sem deixar identificadores
 * numéricos/JIDs passarem como se fossem nomes.
 */
function validarNomeExibicao(valor, jids = []) {
  if (typeof valor !== 'string') return null;
  const nome = valor.trim().replace(/[\r\n]+/g, ' ');
  if (!nome || nome.length > 80) return null;
  if (jids.some(jid => nome.toLowerCase() === String(jid).toLowerCase())) return null;
  if (/^@?\+?[\d\s().-]+$/.test(nome)) return null;
  if (/^\d+@(s\.whatsapp\.net|lid)$/i.test(nome)) return null;
  return nome;
}

function obterNomeDoCache(contactNames, jid) {
  if (contactNames instanceof Map) return contactNames.get(jid);
  return contactNames && typeof contactNames === 'object' ? contactNames[jid] : null;
}

/**
 * Resolve o nome de exibição de um contacto usando a identidade PN/LID,
 * o cache de contactos do Baileys e o perfil persistido no MongoDB.
 *
 * @param {string} alvoJid
 * @param {object} [sock]
 * @param {object|Map} [contactNames]
 * @param {{ fallback?: string, preferredName?: string, candidateJids?: string[] }} [options]
 * @returns {Promise<string>}
 */
async function resolveDisplayName(alvoJid, sock, contactNames = {}, options = {}) {
  const input = typeof alvoJid === 'string' ? normalizarJidUsuario(alvoJid.trim()) || '' : '';
  const idsIniciais = [...new Set([
    input,
    ...(Array.isArray(options.candidateJids) ? options.candidateJids.filter(value => typeof value === 'string' && value.includes('@')) : []),
  ].map(valor => normalizarJidUsuario(valor)).filter(Boolean))];

  // Não consulta o Mongo quando o cache já contém o nome exacto ou quando
  // o chamador fornece um pushName/notify válido.
  for (const id of idsIniciais) {
    const nome = validarNomeExibicao(obterNomeDoCache(contactNames, id), idsIniciais);
    if (nome) return nome;
  }
  const nomePreferido = validarNomeExibicao(options.preferredName, idsIniciais);
  if (nomePreferido) return nomePreferido;

  // Baileys pode ter um nome resolvido em seu próprio cache de contactos,
  // mesmo quando contactNames ainda não recebeu contacts.upsert/update.
  if (typeof sock?.getName === 'function' && input) {
    try {
      const nomeSocket = validarNomeExibicao(sock.getName(input), idsIniciais);
      if (nomeSocket) return nomeSocket;
    } catch {}
  }

  let info = null;
  if (input) {
    try {
      info = await resolveUsuarioInfo(input, sock, contactNames);
    } catch {}
  }

  const ids = [...new Set([
    ...idsIniciais,
    info?.resolvedJid,
    info?.pnJid,
    info?.lidJid,
  ].map(valor => normalizarJidUsuario(valor)).filter(Boolean))];

  for (const id of ids) {
    const nome = validarNomeExibicao(obterNomeDoCache(contactNames, id), ids);
    if (nome) return nome;
  }

  // O PN equivalente pode ter nome no cache interno do Baileys mesmo quando
  // a mensagem original chegou identificada apenas pelo LID.
  if (typeof sock?.getName === 'function') {
    for (const id of ids) {
      if (id === input) continue;
      try {
        const nomeSocket = validarNomeExibicao(sock.getName(id), ids);
        if (nomeSocket) return nomeSocket;
      } catch {}
    }
  }

  const perfil = info?.userData;
  for (const campo of ['displayName', 'nome', 'username', 'pushName', 'notify', 'name', 'verifiedName']) {
    const nome = validarNomeExibicao(perfil?.[campo], ids);
    if (nome) return nome;
  }

  const nomeResolvido = validarNomeExibicao(info?.nome, ids);
  if (nomeResolvido && nomeResolvido.toLowerCase() !== 'usuário') return nomeResolvido;

  // Resolver nomes nunca deve expor o identificador como fallback. Menções
  // devem ser montadas separadamente pelo chamador, com o JID correspondente.
  const fallback = options.fallback !== undefined ? options.fallback : 'Usuário';
  return validarNomeExibicao(fallback, ids) || 'Usuário';
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

  const senderNorm = normalizarJidUsuario(senderJid);
  if (!senderNorm) return;
  const alternateNorms = getAlternateSenderJids(msg)
    .map(value => normalizarJidUsuario(value))
    .filter(Boolean);

  let lid = senderNorm.endsWith('@lid')
    ? senderNorm
    : (alternateNorms.find(value => value.endsWith('@lid')) || null);
  let pn = senderNorm.endsWith('@s.whatsapp.net')
    ? senderNorm
    : (alternateNorms.find(value => value.endsWith('@s.whatsapp.net')) || null);

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
      const nomePush = validarNomeExibicao(pushName, [senderNorm, ...alternateNorms]);
      if (nomePush && nomePush !== 'Usuário') updates.nome = nomePush;

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
  getAlternateSenderJids,
  getParticipantJids,
  resolveGlobalId,
  resolveUserFromMsg,
  resolveJidComLid,
  resolvePhoneAndJid,
  resolveUsuarioInfo,
  resolveDisplayName,
  sameWhatsAppIdentity,
  validarNomeExibicao,
  registrarLidEMapping,
  formatarTelefone,
  normalizarJid,
  extrairNumero,
};