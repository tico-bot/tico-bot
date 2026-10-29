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
};
