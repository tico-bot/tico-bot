'use strict';

const { ITENS_LOJA } = require('../config/economia');
const { VARAS_PESCA, ISCAS, CATALOGO_PESCA } = require('../handlers/diversao/pesca');
const { ITENS_ROUBO, ITENS_ROUBO_BANCO, ITENS_SEGURANCA } = require('../handlers/diversao/roubo');
const { ACESSORIOS_CASAL } = require('../handlers/diversao/acessoriosCasal');

const LOJA_AREAS = Object.freeze({
  'loja-comida': 'comida',
  'loja-petcomida': 'petcomida',
  'loja-petbrinquedo': 'petbrinquedo',
  'loja-petcuidado': 'petcuidado',
  'loja-petacessorio': 'petacessorio',
  'loja-especial': 'especial',
  'loja-pet': 'pet',
  'loja-casal': 'casal',
  'loja-estilo': 'estilo',
  'loja-tec': 'tec',
});

const AREA_CATALOGOS = Object.freeze({
  'pesca-varas': VARAS_PESCA,
  'pesca-iscas': ISCAS,
  'pesca-achados': CATALOGO_PESCA,
  'roubo-ferramentas': ITENS_ROUBO,
  'roubo-banco': ITENS_ROUBO_BANCO,
  seguranca: ITENS_SEGURANCA,
  'casal-equipaveis': ACESSORIOS_CASAL,
});

const AREA_CAMPOS_GRUPO = Object.freeze({
  'pesca-varas': 'itensPesca',
  'pesca-iscas': 'itensPesca',
  'pesca-achados': 'itensPesca',
  'roubo-ferramentas': 'itensRoubo',
  'roubo-banco': 'itensRouboBanco',
  seguranca: 'itensSec',
});

const CAMPO_CATALOGOS = Object.freeze({
  itensPets: ITENS_LOJA,
  itensPesca: { ...VARAS_PESCA, ...ISCAS, ...CATALOGO_PESCA },
  itensRoubo: ITENS_ROUBO,
  itensRouboBanco: ITENS_ROUBO_BANCO,
  itensSec: ITENS_SEGURANCA,
});

function slugPersonalizado(nome) {
  return String(nome || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function resolverDestinoInventarioAdmin(area, item, nomePersonalizado = '') {
  const areaId = String(area || '').trim();
  const chave = String(item || '').trim();

  if (areaId === '__personalizado__') {
    const nome = String(nomePersonalizado || item || '').trim().slice(0, 100);
    const key = slugPersonalizado(nome);
    if (!nome || !key) return null;
    return { area: areaId, key, nome, escopo: 'global', campo: 'inventory' };
  }

  if (!chave || !/^[\p{L}\p{N}_-]{1,100}$/u.test(chave)) return null;

  if (Object.prototype.hasOwnProperty.call(LOJA_AREAS, areaId)) {
    const definicao = ITENS_LOJA[chave];
    if (!definicao || definicao.categoria !== LOJA_AREAS[areaId]) return null;
    const porGrupo = String(definicao.categoria).startsWith('pet');
    return {
      area: areaId,
      key: chave,
      nome: definicao.nome || chave,
      escopo: porGrupo ? 'grupo' : 'global',
      campo: porGrupo ? 'itensPets' : 'inventory',
    };
  }

  const catalogo = AREA_CATALOGOS[areaId];
  if (!catalogo || !Object.prototype.hasOwnProperty.call(catalogo, chave)) return null;
  const campo = AREA_CAMPOS_GRUPO[areaId] || 'inventory';
  return {
    area: areaId,
    key: chave,
    nome: catalogo[chave]?.nome || chave,
    escopo: campo === 'inventory' ? 'global' : 'grupo',
    campo,
  };
}

function entradasInventario(valor) {
  if (valor instanceof Map) return [...valor.entries()];
  if (Array.isArray(valor)) {
    return valor.map((item, index) => {
      if (typeof item === 'string') return [item, 1];
      if (!item || typeof item !== 'object') return [String(index), 0];
      const key = item.key || item.itemKey || item.id || item.nome || item.item || String(index);
      return [String(key), item.quantidade ?? item.qty ?? item.quantidadeAtual ?? 1];
    });
  }
  if (valor && typeof valor === 'object') return Object.entries(valor);
  return [];
}

function areaGlobalDaChave(key) {
  if (Object.prototype.hasOwnProperty.call(ACESSORIOS_CASAL, key)) return 'casal-equipaveis';
  const item = ITENS_LOJA[key];
  if (!item) return '__personalizado__';
  const categoria = item.categoria;
  return Object.entries(LOJA_AREAS).find(([, valor]) => valor === categoria)?.[0] || '__personalizado__';
}

function nomeGlobalDaChave(key) {
  return ACESSORIOS_CASAL[key]?.nome || ITENS_LOJA[key]?.nome || key;
}

function adicionarLinhas(lista, valor, { escopo, area, campo, catalogo, nomeResolver } = {}) {
  for (const [rawKey, rawQuantidade] of entradasInventario(valor)) {
    const key = String(rawKey || '').trim();
    const quantidade = Number(rawQuantidade);
    if (!key || !Number.isFinite(quantidade) || quantidade <= 0) continue;
    lista.push({
      key,
      nome: nomeResolver ? nomeResolver(key) : (catalogo?.[key]?.nome || key),
      quantidade: Math.floor(quantidade),
      area: typeof area === 'function' ? area(key) : area,
      escopo,
      campo,
    });
  }
}

function listarInventarioAdmin(usuario = null, carteira = null, { incluirGlobal = true } = {}) {
  const itens = [];
  if (incluirGlobal && usuario) {
    adicionarLinhas(itens, usuario.inventory, {
      escopo: 'global',
      campo: 'inventory',
      area: areaGlobalDaChave,
      nomeResolver: nomeGlobalDaChave,
    });
  }

  if (carteira) {
    for (const [campo, area] of [
      ['itensPets', key => {
        const categoria = ITENS_LOJA[key]?.categoria;
        return Object.entries(LOJA_AREAS).find(([, valor]) => valor === categoria)?.[0] || 'loja-pet';
      }],
      ['itensPesca', key => Object.prototype.hasOwnProperty.call(VARAS_PESCA, key)
        ? 'pesca-varas'
        : Object.prototype.hasOwnProperty.call(ISCAS, key) ? 'pesca-iscas' : 'pesca-achados'],
      ['itensRoubo', 'roubo-ferramentas'],
      ['itensRouboBanco', 'roubo-banco'],
      ['itensSec', 'seguranca'],
    ]) {
      adicionarLinhas(itens, carteira[campo], {
        escopo: 'grupo', campo, area,
        catalogo: CAMPO_CATALOGOS[campo],
      });
    }

    // Compatibilidade de leitura e remoção para itens que versões antigas do
    // painel guardaram no campo genérico CarteiraGrupo.inventario.
    adicionarLinhas(itens, carteira.inventario, {
      escopo: 'grupo', campo: 'inventario', area: '__legado__',
    });
  }

  return itens;
}

module.exports = {
  LOJA_AREAS,
  resolverDestinoInventarioAdmin,
  listarInventarioAdmin,
  slugPersonalizado,
};
