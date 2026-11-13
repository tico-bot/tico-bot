'use strict';

const path = require('path');
const { ITENS_LOJA } = require(path.join(__dirname, '..', '..', '..', 'config', 'economia'));
const { normalizarNomeComando, resolverChaveCatalogo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'commandItem'));
const { getCarteira, formatarSaldo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));

// Normaliza chave de item removendo acentos, espaços e caracteres especiais
function normalizarChaveItem(str = '') {
  return normalizarNomeComando(str);
}

// Tabela de busca de nomes amigáveis -> chave técnica
const LOOKUP_ITENS_LOJA = {};
for (const [key, item] of Object.entries(ITENS_LOJA || {})) {
  LOOKUP_ITENS_LOJA[key] = key;
  if (item?.nome) {
    LOOKUP_ITENS_LOJA[normalizarChaveItem(item.nome)] = key;
  }
}

function resolverItemKey(digitado = '') {
  return resolverChaveCatalogo(digitado, ITENS_LOJA);
}

async function getSaldoGrupo(userId, idGrupo) {
  const carteira = await getCarteira(userId, idGrupo);
  return carteira?.gold ?? 0;
}

async function getCarteiraGrupo(userId, idGrupo) {
  return getCarteira(userId, idGrupo);
}

module.exports = {
  normalizarChaveItem,
  LOOKUP_ITENS_LOJA,
  resolverItemKey,
  getSaldoGrupo,
  getCarteiraGrupo,
  formatarSaldo,
};