'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ITENS_ROUBO,
  ITENS_ROUBO_BANCO,
  ITENS_SEGURANCA,
  resolverChaveFerramenta,
  selecionarFerramentaRoubo,
  selecionarFerramentaBanco,
  sortearFala,
  FALAS_VARIADAS,
  handleMenuRoubo,
  handleMenuSec,
} = require('./roubo');

const catalogoRoubo = { ...ITENS_ROUBO, ...ITENS_ROUBO_BANCO };
const jid = 'roubo-keys-test@g.us';
const msg = { key: { remoteJid: jid } };

function codigosUnicos(catalogo, contexto) {
  const pares = Object.entries(catalogo);
  const codigos = pares.map(([, item]) => item.codigo);

  assert.ok(pares.length > 0, `${contexto}: catálogo vazio`);
  assert.ok(codigos.every(codigo => /^[a-z0-9]+$/.test(codigo)), `${contexto}: cada código deve ser uma única palavra`);
  assert.equal(new Set(codigos).size, codigos.length, `${contexto}: códigos repetidos`);

  for (const [chave, item] of pares) {
    assert.equal(resolverChaveFerramenta(item.codigo, catalogo), chave, `${contexto}: ${item.nome}`);
  }
}

test('todas as ferramentas de roubo, banco e segurança têm uma única chave curta', () => {
  codigosUnicos(catalogoRoubo, 'roubo/banco');
  codigosUnicos(ITENS_SEGURANCA, 'segurança');
});

test('os nomes antigos continuam a ser aceites para não quebrar comandos dos jogadores', () => {
  assert.equal(resolverChaveFerramenta('Kit de Arrombamento', ITENS_ROUBO), 'lockpick');
  assert.equal(resolverChaveFerramenta('Maçarico para Cofre', catalogoRoubo), 'macarico_cofre');
  assert.equal(resolverChaveFerramenta('Cofre Forte', ITENS_SEGURANCA), 'cofre');
});

test('/roubarbanco rejeita ferramentas comuns mesmo quando estão equipadas e no inventário', () => {
  const ferramenta = selecionarFerramentaBanco({
    equiparoubo: 'dinamite',
    itensRoubo: { dinamite: 5 },
    itensRouboBanco: { macarico_cofre: 3 },
  });

  assert.equal(ferramenta, null);
});

test('/roubarbanco reconhece exclusivamente uma ferramenta bancária equipada', () => {
  const ferramenta = selecionarFerramentaBanco({
    equiparoubo: 'dinamite',
    itensRoubo: { dinamite: 5 },
    equiparouboBanco: 'macarico_cofre',
    itensRouboBanco: { macarico_cofre: 3 },
  });

  assert.equal(ferramenta.slug, 'macarico_cofre');
  assert.equal(ferramenta.item, ITENS_ROUBO_BANCO.macarico_cofre);
  assert.equal(ferramenta.inventario, 'itensRouboBanco');
});

test('/roubar também reconhece ferramentas equipadas do catálogo bancário', () => {
  const ferramenta = selecionarFerramentaRoubo({
    equiparouboBanco: 'macarico_cofre',
    itensRouboBanco: new Map([['macarico_cofre', 2]]),
  });

  assert.equal(ferramenta.slug, 'macarico_cofre');
  assert.equal(ferramenta.inventario, 'itensRouboBanco');
  assert.equal(ferramenta.campoEquipado, 'equiparouboBanco');
  assert.equal(ferramenta.catalogo[ferramenta.slug], ITENS_ROUBO_BANCO.macarico_cofre);
});

test('/roubar mantém a ferramenta comum seleccionada sem perder a ferramenta bancária', () => {
  const ferramenta = selecionarFerramentaRoubo({
    equiparoubo: 'dinamite',
    itensRoubo: { dinamite: 1 },
    equiparouboBanco: 'furadeira',
    itensRouboBanco: { furadeira: 2 },
  });

  assert.equal(ferramenta.slug, 'dinamite');
  assert.equal(ferramenta.inventario, 'itensRoubo');
});

test('/roubar usa a ferramenta comum quando ela é a única equipada e disponível', () => {
  const ferramenta = selecionarFerramentaRoubo({
    equiparoubo: 'dinamite',
    itensRoubo: { dinamite: 1 },
  });

  assert.equal(ferramenta.slug, 'dinamite');
  assert.equal(ferramenta.inventario, 'itensRoubo');
  assert.equal(ferramenta.campoEquipado, 'equiparoubo');
});

test('/roubar ignora slot antigo sem estoque e seleciona a ferramenta bancária disponível', () => {
  const ferramenta = selecionarFerramentaRoubo({
    equiparoubo: 'dinamite',
    itensRoubo: { dinamite: 0 },
    equiparouboBanco: 'furadeira',
    itensRouboBanco: { furadeira: 1 },
  });

  assert.equal(ferramenta.slug, 'furadeira');
  assert.equal(ferramenta.inventario, 'itensRouboBanco');
});

test('todas as situações cobertas têm pelo menos três falas alternativas', () => {
  for (const [grupo, variantes] of Object.entries(FALAS_VARIADAS)) {
    assert.ok(variantes.length >= 3, `${grupo} precisa de três ou mais falas`);
    assert.ok(variantes.every(fala => typeof fala === 'function'), `${grupo} deve usar funções de mensagem`);
  }
});

test('o sorteio de falas varia as respostas e preserva os dados do item', () => {
  const itemInfo = ITENS_ROUBO_BANCO.macarico_cofre;
  const falas = [0, 0.5, 0.999].map(valor =>
    sortearFala('roubarBancoSemEstoque', { itemInfo }, () => valor)
  );

  assert.equal(new Set(falas).size, 3);
  assert.ok(falas.every(fala => fala.includes(itemInfo.nome)));
  assert.ok(falas.every(fala => fala.includes(itemInfo.codigo)));
});

test('a mesma categoria não repete uma fala em mensagens consecutivas', () => {
  const dados = { itemInfo: ITENS_ROUBO.dinamite };
  const primeira = sortearFala('roubarSemEstoque', dados, () => 0);
  const segunda = sortearFala('roubarSemEstoque', dados, () => 0);

  assert.notEqual(segunda, primeira);
});

test('/menuroubar mostra somente uma chave curta para comprar e equipar cada ferramenta', async () => {
  let texto = '';
  const sock = { sendMessage: async (_jid, payload) => { texto = payload.text; } };
  await handleMenuRoubo(sock, msg, jid, () => '!');

  for (const item of Object.values(catalogoRoubo)) {
    assert.ok(texto.includes(`Chave: *${item.codigo}*`), `chave não exibida: ${item.codigo}`);
    assert.ok(texto.includes(`!buyroubo ${item.codigo}`), `compra não exibida: ${item.codigo}`);
    assert.ok(texto.includes(`!equiparroubo ${item.codigo}`), `equipamento não exibido: ${item.codigo}`);
  }
  assert.doesNotMatch(texto, /buyroubo (Maçarico para Cofre|Furadeira Industrial|Clonador de Cartões)/i);
});

test('/menusec mostra somente uma chave curta para comprar e equipar cada defesa', async () => {
  let texto = '';
  const sock = { sendMessage: async (_jid, payload) => { texto = payload.text; } };
  await handleMenuSec(sock, msg, jid, () => '!');

  for (const item of Object.values(ITENS_SEGURANCA)) {
    assert.ok(texto.includes(`Chave: *${item.codigo}*`), `chave não exibida: ${item.codigo}`);
    assert.ok(texto.includes(`!buysec ${item.codigo}`), `compra não exibida: ${item.codigo}`);
    assert.ok(texto.includes(`!equiparsec ${item.codigo}`), `equipamento não exibido: ${item.codigo}`);
  }
  assert.doesNotMatch(texto, /buysec (Cofre Forte|Sistema de Alarme|Câmera de Vigilância)/i);
});
