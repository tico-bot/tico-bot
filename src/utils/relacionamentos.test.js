'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chaveRelacionamento,
  normalizarRegistro,
  paraEstadoEmMemoria,
  hidratarRelacionamentos,
  podeConverterNamoroEmCasamento,
} = require('./relacionamentos');

const grupoA = '120363000000000001@g.us';
const grupoB = '120363000000000002@g.us';
const jidA = '11111111111@s.whatsapp.net';
const jidB = '22222222222@s.whatsapp.net';
const desde = new Date('2026-01-01T12:00:00.000Z');

function usuario(idWhatsApp, casadoCom, extra = {}) {
  return {
    idWhatsApp,
    nome: idWhatsApp,
    casadoCom,
    casadoTipo: 'namoro',
    casadoDesde: desde,
    casadoGrupo: grupoA,
    ...extra,
  };
}

function criarModelsFake(usuariosLegados = [], registrosExistentes = []) {
  const registros = new Map(registrosExistentes.map(registro => [registro.chave, { ...registro }]));
  const Usuario = {
    find() {
      return { lean: async () => usuariosLegados };
    },
  };
  const Relacionamento = {
    createIndexes: async () => {},
    async updateOne(filtro, update, options) {
      const existente = registros.get(filtro.chave);
      if (!existente && options?.upsert) {
        registros.set(filtro.chave, { ...update.$setOnInsert });
        return { upsertedCount: 1 };
      }
      return { upsertedCount: 0 };
    },
    find() {
      return { lean: async () => [...registros.values()] };
    },
  };
  return { Usuario, Relacionamento, registros };
}

test('normaliza o par e mantém nomes associados ao participante correto', () => {
  const registro = normalizarRegistro({
    idGrupo: grupoA,
    jidA: jidB,
    jidB: jidA,
    tipo: 'casamento',
    desde,
    nomeA: 'Pessoa B',
    nomeB: 'Pessoa A',
  });

  assert.ok(registro);
  assert.equal(registro.chave, chaveRelacionamento(grupoA, jidA, jidB));
  assert.deepEqual(registro.participantes, [jidA, jidB]);
  assert.equal(registro.nomeA, 'Pessoa A');
  assert.equal(registro.nomeB, 'Pessoa B');
  assert.equal(registro.tipo, 'casamento');
});

test('recusa registros sem grupo, com tipo inválido ou participantes repetidos', () => {
  assert.equal(normalizarRegistro({ jidA, jidB, tipo: 'namoro', desde }), null);
  assert.equal(normalizarRegistro({ idGrupo: grupoA, jidA, jidB, tipo: 'noivado', desde }), null);
  assert.equal(normalizarRegistro({ idGrupo: grupoA, jidA, jidB: jidA, tipo: 'namoro', desde }), null);
  assert.equal(paraEstadoEmMemoria({ idGrupo: grupoA, jidA, jidB, tipo: 'namoro', desde: 'data inválida' }), null);
});

test('migra pares legados recíprocos e restaura o Map após simular reinicialização', async () => {
  const legados = [
    usuario(jidA, jidB, { xpCasal: 27, nome: 'Alice' }),
    usuario(jidB, jidA, { xpCasal: 32, nome: 'Bruno' }),
    usuario('33333333333@s.whatsapp.net', '44444444444@s.whatsapp.net'),
    usuario('44444444444@s.whatsapp.net', '55555555555@s.whatsapp.net'),
  ];
  const { Usuario, Relacionamento, registros } = criarModelsFake(legados);
  const mapa = new Map([['registro-antigo', { tipo: 'casamento' }]]);
  const xpMap = new Map([['xp-antigo', 999]]);

  const resultado = await hidratarRelacionamentos({
    Usuario,
    Relacionamento,
    relacionamentos: mapa,
    xpCasais: xpMap,
    log: () => {},
  });

  assert.equal(resultado.total, 1);
  assert.equal(resultado.migracao.importados, 1);
  assert.equal(mapa.size, 1);
  const [key, rel] = [...mapa.entries()][0];
  assert.equal(key, chaveRelacionamento(grupoA, jidA, jidB));
  assert.equal(rel.tipo, 'namoro');
  assert.equal(rel.desde, desde.getTime());
  assert.equal(rel.nomeA, 'Alice');
  assert.equal(rel.nomeB, 'Bruno');
  assert.equal(rel.xpCasal, 32);
  assert.equal(xpMap.get(key), 32);
  assert.equal(xpMap.has('xp-antigo'), false);
  assert.equal(registros.size, 1);

  // Simula um processo novo: o mapa vazio é reconstruído do Mongo, sem data.json.
  const mapaNovo = new Map();
  const segundaCarga = await hidratarRelacionamentos({
    Usuario: { find: () => ({ lean: async () => [] }) },
    Relacionamento,
    relacionamentos: mapaNovo,
    xpCasais: new Map(),
    log: () => {},
  });
  assert.equal(segundaCarga.total, 1);
  assert.deepEqual([...mapaNovo.entries()], [...mapa.entries()]);
});

test('mantém o mesmo participante em grupos diferentes sem misturar os casais', async () => {
  const segundoPar = normalizarRegistro({
    idGrupo: grupoB,
    jidA,
    jidB: '33333333333@s.whatsapp.net',
    tipo: 'casamento',
    desde,
  });
  const primeiroPar = normalizarRegistro({
    idGrupo: grupoA,
    jidA,
    jidB,
    tipo: 'namoro',
    desde,
  });
  const { Usuario, Relacionamento } = criarModelsFake([], [primeiroPar, segundoPar]);
  const mapa = new Map();

  const resultado = await hidratarRelacionamentos({
    Usuario,
    Relacionamento,
    relacionamentos: mapa,
    log: () => {},
  });

  assert.equal(resultado.total, 2);
  assert.equal(mapa.size, 2);
  assert.ok(mapa.has(chaveRelacionamento(grupoA, jidA, jidB)));
  assert.ok(mapa.has(chaveRelacionamento(grupoB, jidA, '33333333333@s.whatsapp.net')));
});

test('permite converter o mesmo namoro em casamento somente após três dias', () => {
  const chave = chaveRelacionamento(grupoA, jidA, jidB);
  const desdeMs = desde.getTime();
  const rel = { tipo: 'namoro', desde: desdeMs };
  const relA = { key: chave };
  const relB = { key: chave };

  assert.equal(podeConverterNamoroEmCasamento({
    tipoPedido: 'casamento', chave, relacionamento: rel, relA, relB,
    agora: desdeMs + 3 * 24 * 60 * 60 * 1000,
  }), true);

  assert.equal(podeConverterNamoroEmCasamento({
    tipoPedido: 'casamento', chave, relacionamento: rel, relA, relB,
    agora: desdeMs + 3 * 24 * 60 * 60 * 1000 - 1,
  }), false);

  assert.equal(podeConverterNamoroEmCasamento({
    tipoPedido: 'casamento', chave, relacionamento: rel, relA,
    relB: { key: chaveRelacionamento(grupoA, jidA, '33333333333@s.whatsapp.net') },
    agora: desdeMs + 4 * 24 * 60 * 60 * 1000,
  }), false);

  assert.equal(podeConverterNamoroEmCasamento({
    tipoPedido: 'casamento', chave,
    relacionamento: { ...rel, tipo: 'casamento' }, relA, relB,
    agora: desdeMs + 4 * 24 * 60 * 60 * 1000,
  }), false);
});
