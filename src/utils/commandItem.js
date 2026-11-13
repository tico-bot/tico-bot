'use strict';

/**
 * Normaliza nomes introduzidos em comandos.
 * Espaços, underscores, hífenes, emojis e acentos são ignorados para comparar
 * nomes, mas as chaves originais dos itens nunca são alteradas no inventário.
 */
function normalizarNomeComando(valor = '') {
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve uma chave técnica a partir da chave, do nome apresentado ou de uma
 * variante com espaços/underscores e acentos diferentes.
 * Em caso de colisão, falha de forma segura em vez de escolher o item errado.
 */
function resolverChaveCatalogo(valor = '', catalogo = {}) {
  const procurado = normalizarNomeComando(valor);
  if (!procurado || !catalogo || typeof catalogo !== 'object') return null;

  if (Object.prototype.hasOwnProperty.call(catalogo, String(valor).trim())) {
    return String(valor).trim();
  }

  const entradas = Object.entries(catalogo);
  const correspondencias = entradas
    .filter(([chave, item]) =>
      normalizarNomeComando(chave) === procurado ||
      (item?.nome && normalizarNomeComando(item.nome) === procurado)
    )
    .map(([chave]) => chave);
  const unicas = [...new Set(correspondencias)];
  return unicas.length === 1 ? unicas[0] : null;
}

/** Retira o nome do comando sem consumir o restante do argumento. */
function extrairArgumentosComando(texto = '', comando) {
  const nome = String(comando || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!nome) return String(texto || '').trim();
  return String(texto || '')
    .replace(new RegExp(`^[!.,/#]?${nome}\\s*`, 'i'), '')
    .trim();
}

module.exports = {
  normalizarNomeComando,
  resolverChaveCatalogo,
  extrairArgumentosComando,
};
