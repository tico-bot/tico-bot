'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGroupCounterKey,
  incrementGroupCounter,
  countGroupCounter,
  listGroupCounters,
} = require('./group-activity');

const groupA = '120363000000000001@g.us';
const groupB = '120363000000000002@g.us';
const pn = '5511999999999@s.whatsapp.net';
const lid = '1234567890@lid';
const normalize = value => String(value || '').split(':')[0].toLowerCase();

test('creates keys only for a group and user identity', () => {
  assert.equal(createGroupCounterKey(groupA, pn), `${groupA}|${pn}`);
  assert.equal(createGroupCounterKey('5511999999999@s.whatsapp.net', pn), null);
  assert.equal(createGroupCounterKey(groupA, ''), null);
});

test('activity counters stay separated between groups', () => {
  const counts = new Map();
  incrementGroupCounter(counts, groupA, pn);
  incrementGroupCounter(counts, groupA, pn);
  incrementGroupCounter(counts, groupB, pn);
  assert.equal(countGroupCounter(counts, groupA, new Set([pn]), normalize), 2);
  assert.equal(countGroupCounter(counts, groupB, new Set([pn]), normalize), 1);
});

test('counts known PN/LID aliases only inside the requested group', () => {
  const counts = new Map([
    [`${groupA}|${pn}`, 3],
    [`${groupA}|${lid}`, 2],
    [`${groupB}|${pn}`, 99],
  ]);
  assert.equal(countGroupCounter(counts, groupA, new Set([pn, lid]), normalize), 5);
  assert.deepEqual(listGroupCounters(counts, groupA, normalize), [[pn, 3], [lid, 2]]);
});
