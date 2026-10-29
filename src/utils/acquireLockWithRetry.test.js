'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { acquireLockWithRetry } = require('./acquireLockWithRetry');

test('continua tentando além de seis tentativas até obter o lock', async () => {
  let attempts = 0;
  let waits = 0;

  const acquired = await acquireLockWithRetry({
    acquireLock: async () => ++attempts >= 8,
    wait: async () => { waits++; },
    log: () => {},
    logError: () => {},
  });

  assert.equal(acquired, true);
  assert.equal(attempts, 8);
  assert.equal(waits, 7);
});

test('continua tentando após erro temporário ao consultar o lock', async () => {
  let attempts = 0;
  let errors = 0;

  const acquired = await acquireLockWithRetry({
    acquireLock: async () => {
      attempts++;
      if (attempts === 1) throw new Error('Mongo temporariamente indisponível');
      return true;
    },
    wait: async () => {},
    log: () => {},
    logError: () => { errors++; },
  });

  assert.equal(acquired, true);
  assert.equal(attempts, 2);
  assert.equal(errors, 1);
});
