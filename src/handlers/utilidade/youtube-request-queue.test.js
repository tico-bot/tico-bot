'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createYoutubeRequestQueue } = require('./youtube-request-queue');

test('serializa downloads e mantém intervalo mínimo após cada tarefa', async () => {
  let clock = 0;
  const waits = [];
  const queue = createYoutubeRequestQueue({
    minIntervalMs: 8000,
    now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; },
  });

  const task = duration => queue(async () => {
    const startedAt = clock;
    clock += duration;
    return { ok: true, startedAt };
  });

  const [first, second] = await Promise.all([task(1000), task(500)]);
  assert.equal(first.startedAt, 0);
  assert.equal(second.startedAt, 9000);
  assert.deepEqual(waits, [8000]);
});

test('aplica cooldown de 60 segundos após HTTP 429', async () => {
  let clock = 0;
  const waits = [];
  const queue = createYoutubeRequestQueue({
    minIntervalMs: 8000,
    rateLimitCooldownMs: 60000,
    now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; },
  });

  await queue(async () => ({ ok: false, stderr: 'WARNING: HTTP Error 429: Too Many Requests' }));
  const next = await queue(async () => ({ ok: true, startedAt: clock }));

  assert.equal(next.startedAt, 60000);
  assert.deepEqual(waits, [60000]);
});

test('uma tarefa rejeitada não interrompe as próximas da fila', async () => {
  let clock = 0;
  const queue = createYoutubeRequestQueue({
    minIntervalMs: 0,
    now: () => clock,
    sleep: async ms => { clock += ms; },
  });

  await assert.rejects(queue(async () => { throw new Error('falha de teste'); }), /falha de teste/);
  const result = await queue(async () => ({ ok: true }));
  assert.equal(result.ok, true);
});
