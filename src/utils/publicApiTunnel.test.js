'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  extractQuickTunnelUrl,
  normaliseConfiguredApiUrl,
  normalisePublicApiUrl,
  normaliseRenderExternalUrl,
  startQuickTunnel,
  getPublicApiUrl,
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

test('aceita uma URL HTTPS pública configurada para a API', () => {
  assert.equal(
    normaliseConfiguredApiUrl('https://api.exemplo.com'),
    'https://api.exemplo.com/api'
  );
  assert.equal(
    normaliseConfiguredApiUrl('https://api.exemplo.com/api/'),
    'https://api.exemplo.com/api'
  );
  assert.equal(normaliseConfiguredApiUrl('http://api.exemplo.com'), null);
  assert.equal(normaliseConfiguredApiUrl('https://user:pass@api.exemplo.com'), null);
  assert.equal(normaliseConfiguredApiUrl('https://api.exemplo.com/admin'), null);
});

test('normaliza somente URLs públicas do domínio onrender.com como URL automática do Render', () => {
  assert.equal(
    normaliseRenderExternalUrl('https://tico-bot.onrender.com'),
    'https://tico-bot.onrender.com/api'
  );
  assert.equal(
    normaliseRenderExternalUrl('https://tico-bot.onrender.com/api/'),
    'https://tico-bot.onrender.com/api'
  );
  assert.equal(normaliseRenderExternalUrl('https://example.com'), null);
  assert.equal(normaliseRenderExternalUrl('http://tico-bot.onrender.com'), null);
});

test('no Render, usa RENDER_EXTERNAL_URL sem iniciar cloudflared', async () => {
  const previous = {
    render: process.env.RENDER,
    externalUrl: process.env.RENDER_EXTERNAL_URL,
    externalHostname: process.env.RENDER_EXTERNAL_HOSTNAME,
    publicApiUrl: process.env.PUBLIC_API_URL,
  };

  try {
    process.env.RENDER = 'true';
    process.env.RENDER_EXTERNAL_URL = 'https://tico-bot.onrender.com';
    delete process.env.RENDER_EXTERNAL_HOSTNAME;
    delete process.env.PUBLIC_API_URL;

    assert.equal(await getPublicApiUrl(), 'https://tico-bot.onrender.com/api');
  } finally {
    if (previous.render === undefined) delete process.env.RENDER;
    else process.env.RENDER = previous.render;
    if (previous.externalUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previous.externalUrl;
    if (previous.externalHostname === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME;
    else process.env.RENDER_EXTERNAL_HOSTNAME = previous.externalHostname;
    if (previous.publicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previous.publicApiUrl;
  }
});

test('no Render, aceita RENDER_EXTERNAL_HOSTNAME como fallback', async () => {
  const previous = {
    render: process.env.RENDER,
    externalUrl: process.env.RENDER_EXTERNAL_URL,
    externalHostname: process.env.RENDER_EXTERNAL_HOSTNAME,
    publicApiUrl: process.env.PUBLIC_API_URL,
  };

  try {
    process.env.RENDER = 'true';
    delete process.env.RENDER_EXTERNAL_URL;
    process.env.RENDER_EXTERNAL_HOSTNAME = 'tico-bot.onrender.com';
    delete process.env.PUBLIC_API_URL;

    assert.equal(await getPublicApiUrl(), 'https://tico-bot.onrender.com/api');
  } finally {
    if (previous.render === undefined) delete process.env.RENDER;
    else process.env.RENDER = previous.render;
    if (previous.externalUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previous.externalUrl;
    if (previous.externalHostname === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME;
    else process.env.RENDER_EXTERNAL_HOSTNAME = previous.externalHostname;
    if (previous.publicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previous.publicApiUrl;
  }
});

test('no Render sem URL pública, devolve erro de configuração sem tentar cloudflared', async () => {
  const previous = {
    render: process.env.RENDER,
    externalUrl: process.env.RENDER_EXTERNAL_URL,
    externalHostname: process.env.RENDER_EXTERNAL_HOSTNAME,
    publicApiUrl: process.env.PUBLIC_API_URL,
  };

  try {
    process.env.RENDER = 'true';
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.RENDER_EXTERNAL_HOSTNAME;
    delete process.env.PUBLIC_API_URL;

    await assert.rejects(getPublicApiUrl(), error => error.code === 'PUBLIC_API_URL_MISSING');
  } finally {
    if (previous.render === undefined) delete process.env.RENDER;
    else process.env.RENDER = previous.render;
    if (previous.externalUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previous.externalUrl;
    if (previous.externalHostname === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME;
    else process.env.RENDER_EXTERNAL_HOSTNAME = previous.externalHostname;
    if (previous.publicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previous.publicApiUrl;
  }
});

test('classifica cloudflared ausente com código próprio, sem confundir com erros do banco', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };

  try {
    const pending = startQuickTunnel({
      command: 'cloudflared-inexistente',
      timeoutMs: 1_000,
      spawnImpl: () => child,
    });
    const spawnError = Object.assign(new Error('spawn cloudflared-inexistente ENOENT'), { code: 'ENOENT' });
    child.emit('error', spawnError);

    await assert.rejects(pending, error => error.code === 'CLOUDFLARED_NOT_FOUND');
  } finally {
    stopPublicApiTunnel();
  }
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
