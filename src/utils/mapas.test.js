'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapParaObjeto, somarMap } = require('./mapas');

test('mapParaObjeto normalizes JavaScript Maps and plain objects', () => {
  assert.deepEqual(mapParaObjeto(new Map([['2026-10-28', 15], ['2026-10-27', 4]])), {
    '2026-10-28': 15,
    '2026-10-27': 4,
  });
  assert.deepEqual(mapParaObjeto({ frame_aurora: 1, moeda: 3 }), {
    frame_aurora: 1,
    moeda: 3,
  });
});

test('mapParaObjeto handles nullish values, iterable arrays and toObject wrappers', () => {
  assert.deepEqual(mapParaObjeto(null), {});
  assert.deepEqual(mapParaObjeto(undefined), {});
  assert.deepEqual(mapParaObjeto(['a', 'b']), { '0': 'a', '1': 'b' });
  assert.deepEqual(mapParaObjeto({ toObject: () => ({ warnings: 2 }) }), { warnings: 2 });
});

test('somarMap totals numeric map values and ignores invalid values', () => {
  assert.equal(somarMap(new Map([['grupo1', 2], ['grupo2', '3'], ['grupo3', 'x'], ['grupo4', null]])), 5);
  assert.equal(somarMap({ grupo1: 1, grupo2: 4 }), 5);
  assert.equal(somarMap(null), 0);
});
