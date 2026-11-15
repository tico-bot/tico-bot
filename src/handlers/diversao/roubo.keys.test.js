'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ITENS_ROUBO,
  ITENS_ROUBO_BANCO,
  ITENS_SEGURANCA,
  resolverChaveFerramenta,
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
