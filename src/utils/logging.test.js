'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatErrorDetails, logError } = require('./logging');

test('formatErrorDetails preserva stack completa para diagnóstico', () => {
  const error = new Error('falha simulada');
  assert.equal(formatErrorDetails(error), error.stack);
  assert.match(formatErrorDetails(error), /falha simulada/);
});

test('formatErrorDetails cobre valores sem stack nem message', () => {
  assert.equal(formatErrorDetails(null), 'null');
  assert.equal(formatErrorDetails('falha'), '"falha"');
  assert.equal(formatErrorDetails({ code: 'E_TEST' }), '{"code":"E_TEST"}');
});

test('logError envia uma linha com escopo e contexto identificáveis', () => {
  const original = console.error;
  let captured;
  console.error = (...args) => { captured = args; };
  try {
    const error = new Error('falha teste');
    logError('PixDoar', error, 'na etapa de transferência');
    assert.equal(captured.length, 1);
    assert.match(captured[0], /^\[PixDoar\] na etapa de transferência:/);
    assert.match(captured[0], /falha teste/);
  } finally {
    console.error = original;
  }
});
