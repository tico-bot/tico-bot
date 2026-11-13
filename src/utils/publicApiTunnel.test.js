'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  extractQuickTunnelUrl,
  normalisePublicApiUrl,
  startQuickTunnel,
  stopPublicApiTunnel,
} = require('./publicApiTunnel');

test('extrai o endereço HTTPS do quick tunnel dos logs do cloudflared', () => {
  assert.equal(
    extractQuickTunnelUrl('INF tunnel ready: https://bright-rivers.trycloudflare.com'),
    'https://bright-rivers.trycloudflare.com'
  );
  assert.equal(extractQuickTunnelUrl('sem endereço público'), null);
});

test('normaliza somente endereços HTTPS válidos do Cloudflare Tunnel', () => {
  assert.equal(
    normalisePublicApiUrl('https://bright-rivers.trycloudflare.com'),
    'https://bright-rivers.trycloudflare.com/api'
  );
  assert.equal(
    normalisePublicApiUrl('https://bright-rivers.trycloudflare.com/api/'),
    'https://bright-rivers.trycloudflare.com/api'
  );
  assert.equal(normalisePublicApiUrl('http://bright-rivers.trycloudflare.com'), null);
  assert.equal(normalisePublicApiUrl('https://example.com'), null);
  assert.equal(normalisePublicApiUrl('https://bright-rivers.trycloudflare.com/admin'), null);
});

test('aguarda o registo da ligação, devolve o túnel e reutiliza o processo ativo', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  let spawnCalls = 0;

  try {
    const pending = startQuickTunnel({
      command: 'cloudflared-test',
      port: 3456,
      timeoutMs: 1_000,
      spawnImpl: (command, args) => {
        spawnCalls += 1;
        assert.equal(command, 'cloudflared-test');
        assert.deepEqual(args.slice(0, 2), ['tunnel', '--url']);
        assert.equal(args[2], 'http://127.0.0.1:3456');
        return child;
      },
    });

    child.stderr.write('Your quick Tunnel has been created: https://private-bird.trycloudflare.com\n');
    await new Promise(resolve => setImmediate(resolve));
    let resolvido = false;
    pending.then(() => { resolvido = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolvido, false, 'não pode divulgar o endereço antes de conectar');

    child.stderr.write('Registered tunnel connection connIndex=0\n');
    assert.equal(await pending, 'https://private-bird.trycloudflare.com');
    assert.equal(await startQuickTunnel(), 'https://private-bird.trycloudflare.com');
    assert.equal(spawnCalls, 1);
  } finally {
    stopPublicApiTunnel();
  }
});
