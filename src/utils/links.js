'use strict';

const URL_LIKE_REGEX = /(?<![@\w.-])(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>()]*)?/gi;
const VALID_DOMAIN_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Normaliza um domínio para armazenamento, removendo esquema, www e caminhos. */
function normalizarDominio(valor) {
  if (typeof valor !== 'string') return null;
  let host = valor.trim().toLowerCase();
  if (!host) return null;

  host = host.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
  host = host.split(/[/?#\s]/, 1)[0];
  host = host.replace(/^www\./i, '').replace(/:\d+$/, '').replace(/\.$/, '');

  if (!VALID_DOMAIN_REGEX.test(host)) return null;
  return host;
}

/** Extrai domínios de URLs ou de endereços sem https:// (ex.: youtube.com). */
function extrairDominiosDeLinks(texto) {
  if (typeof texto !== 'string' || !texto) return [];
  const encontrados = new Set();
  for (const match of texto.matchAll(URL_LIKE_REGEX)) {
    const dominio = normalizarDominio(match[0].replace(/[.,!?;:]+$/, ''));
    if (dominio) encontrados.add(dominio);
  }
  return [...encontrados];
}


/**
 * Identifica anúncios de migração falsa de grupo: texto que diz que o grupo
 * atual será apagado/trocado e direciona membros para convites externos.
 * A regra é intencionalmente específica para evitar bloquear links comuns.
 */
function isGroupMigrationSpam(texto) {
  if (typeof texto !== 'string' || !texto) return false;

  const links = [...texto.matchAll(URL_LIKE_REGEX)].map(match => match[0]);
  if (links.length === 0) return false;

  const temConviteOuCanal = links.some(link => {
    const dominio = normalizarDominio(link);
    return dominio === 'chat.whatsapp.com' ||
      (dominio === 'whatsapp.com' && /\/channel\//i.test(link)) ||
      dominio === 't.me' ||
      dominio === 'telegram.me';
  });
  if (!temConviteOuCanal) return false;

  const normalizado = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const anunciaMigracao = [
    /\b(?:trocando|mudando|migrando|transferindo)\s+de\s+grupo\b/,
    /\b(?:esse|este|o)\s+grupo\s+(?:sera|vai\s+ser)\s+(?:apagado|excluido|deletado|encerrado)\b/,
    /\bentrem?\s+(?:no|para\s+o)\s+novo\s+grupo\b/,
    /\b(?:grupo\s+atual|grupo\s+antigo)\s+(?:sera|vai\s+ser)\s+(?:apagado|excluido|deletado|encerrado)\b/,
  ].some(pattern => pattern.test(normalizado));

  return anunciaMigracao;
}


/**
 * Detecta mensagens nativas de pagamento do WhatsApp, inclusive quando
 * chegam encapsuladas em mensagens temporárias ou de visualização única.
 */
function isPaymentMessageContent(content) {
  const paymentFields = [
    'sendPaymentMessage',
    'requestPaymentMessage',
    'declinePaymentRequestMessage',
    'cancelPaymentRequestMessage',
    'paymentInviteMessage',
    'invoiceMessage',
    'paymentMessage',
  ];

  let current = content;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    if (paymentFields.some(field => current[field] != null)) return true;

    current =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.documentWithCaptionMessage?.message ||
      current.deviceSentMessage?.message ||
      null;
  }

  return false;
}

/** Permite o domínio exato e seus subdomínios (youtube.com inclui m.youtube.com). */
function dominioEstaPermitido(dominio, listaPermitida = []) {
  const host = normalizarDominio(dominio);
  if (!host || !Array.isArray(listaPermitida)) return false;
  return listaPermitida.some(item => {
    const permitido = normalizarDominio(item);
    return permitido && (host === permitido || host.endsWith(`.${permitido}`));
  });
}

/** A mensagem só passa se todos os domínios nela estiverem na lista branca. */
function todosLinksPermitidos(texto, listaPermitida = []) {
  const dominios = extrairDominiosDeLinks(texto);
  return dominios.length > 0 && dominios.every(dominio => dominioEstaPermitido(dominio, listaPermitida));
}

module.exports = {
  normalizarDominio,
  extrairDominiosDeLinks,
  dominioEstaPermitido,
  todosLinksPermitidos,
  isGroupMigrationSpam,
  isPaymentMessageContent,
};
