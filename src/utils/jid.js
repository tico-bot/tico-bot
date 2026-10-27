'use strict';

/**
 * Separa um JID em { userPart, domain }, já removendo o sufixo de
 * dispositivo (ex: ":12") do userPart. Helper interno compartilhado por
 * normalizarJid() e extrairNumero() para que as duas funções nunca possam
 * divergir sobre "como" um JID é dividido — só sobre "o que fazer" com
 * cada parte.
 *
 * @param {*} rawJid - valor a validar/dividir; qualquer coisa que não seja
 *   uma string não vazia é tratada como inválida.
 * @returns {{ userPart: string, domain: string } | null}
 */
function splitJid(rawJid) {
  if (typeof rawJid !== 'string') return null;

  const jid = rawJid.trim();
  if (!jid) return null;

  const [userPartRaw, domain] = jid.split('@');
  if (!domain || !userPartRaw) return null;

  const userPart = userPartRaw.split(':')[0]; // remove sufixo de dispositivo (:12)
  if (!userPart) return null;

  return { userPart, domain };
}

/**
 * Normaliza um JID de remetente para uso como identidade (idWhatsApp).
 * Regras:
 * - Sempre lowercase.
 * - Remove sufixo de dispositivo (ex: "5511999:12@s.whatsapp.net" → "5511999@s.whatsapp.net").
 * - NUNCA troca o domínio (@s.whatsapp.net / @lid) por outro.
 *   Um "@lid" continua "@lid" — não existe conversão segura de @lid
 *   para número de telefone sem o mapeamento oficial do WhatsApp.
 *
 * Entradas inválidas (não-string, vazias, sem "@", ou só espaços) retornam
 * null em vez de lançar exceção — chamadores devem tratar null como
 * "remetente não identificável" e abortar a operação, nunca assumir que
 * o retorno é sempre uma string.
 *
 * @param {*} rawJid
 * @returns {string|null}
 */
function normalizarJid(rawJid) {
  const parsed = splitJid(typeof rawJid === 'string' ? rawJid.toLowerCase() : rawJid);
  if (!parsed) return null;

  return `${parsed.userPart}@${parsed.domain}`;
}

/**
 * Extrai apenas os dígitos do JID — usado para exibir "@numero" em
 * mentions. Funciona tanto para @s.whatsapp.net quanto @lid.
 *
 * ⚠️ Não usar com JIDs de grupo (@g.us). O formato de grupo é
 * "digitos-digitos@g.us" (dois números separados por hífen); remover
 * tudo que não é dígito funde os dois números num só, produzindo uma
 * menção incorreta em silêncio. Esta função assume um JID de usuário
 * individual (@s.whatsapp.net ou @lid).
 *
 * @param {*} jid
 * @returns {string} string de dígitos, ou '' se a entrada for inválida
 *   ou for identificável como JID de grupo (contém '-' na parte do usuário).
 */
function extrairNumero(jid) {
  const parsed = splitJid(jid);
  if (!parsed) return '';

  if (parsed.userPart.includes('-')) return ''; // provável JID de grupo — não extrair

  return parsed.userPart.replace(/\D/g, '');
}

module.exports = { normalizarJid, extrairNumero };