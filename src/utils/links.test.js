'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarDominio,
  extrairDominiosDeLinks,
  dominioEstaPermitido,
  todosLinksPermitidos,
} = require('./links');

test('normaliza domínio e remove esquema, www e caminho', () => {
  assert.equal(normalizarDominio('https://www.YouTube.com/watch?v=123'), 'youtube.com');
  assert.equal(normalizarDominio('youtube.com'), 'youtube.com');
  assert.equal(normalizarDominio('não é um domínio'), null);
});

test('extrai links com e sem protocolo sem confundir e-mail com URL', () => {
  assert.deepEqual(
    extrairDominiosDeLinks('Veja https://www.youtube.com/watch?v=1 e example.com, mas não envie para pessoa@example.com'),
    ['youtube.com', 'example.com'],
  );
});

test('domínio autorizado permite subdomínios, mas não domínios parecidos', () => {
  assert.equal(dominioEstaPermitido('m.youtube.com', ['youtube.com']), true);
  assert.equal(dominioEstaPermitido('youtube.com.evil.test', ['youtube.com']), false);
});

test('uma mensagem com link permitido e outro bloqueado não passa', () => {
  assert.equal(todosLinksPermitidos('youtube.com e https://evil.test/x', ['youtube.com']), false);
  assert.equal(todosLinksPermitidos('youtube.com e m.youtube.com', ['youtube.com']), true);
  assert.equal(todosLinksPermitidos('sem link aqui', ['youtube.com']), false);
});
