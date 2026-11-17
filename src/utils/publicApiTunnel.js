'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TUNNEL_DOMAIN = '.trycloudflare.com';
const START_TIMEOUT_MS = 30_000;

let tunnelProcess = null;
let tunnelUrl = null;
let startPromise = null;

function resolveCloudflaredCommand() {
  if (process.env.CLOUDFLARED_PATH?.trim()) return process.env.CLOUDFLARED_PATH.trim();
  const localBinary = path.join(os.homedir(), '.local', 'bin', 'cloudflared');
  return fs.existsSync(localBinary) ? localBinary : 'cloudflared';
}

function extractQuickTunnelUrl(output = '') {
  const matches = String(output).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi);
  return matches?.[matches.length - 1] || null;
}

function normaliseConfiguredApiUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname !== '' && pathname !== '/api') return null;
    return `${parsed.origin}/api`;
  } catch {
    return null;
  }
}

function normalisePublicApiUrl(value) {
  const normalised = normaliseConfiguredApiUrl(value);
  if (!normalised) return null;
  try {
    const hostname = new URL(normalised).hostname;
    return hostname.endsWith(TUNNEL_DOMAIN) ? normalised : null;
  } catch {
    return null;
  }
}

function normaliseRenderExternalUrl(value) {
  const normalised = normaliseConfiguredApiUrl(value);
  if (!normalised) return null;
  try {
    const hostname = new URL(normalised).hostname;
    return hostname === 'onrender.com' || hostname.endsWith('.onrender.com')
      ? normalised
      : null;
  } catch {
    return null;
  }
}

function stopPublicApiTunnel() {
  const child = tunnelProcess;
  tunnelProcess = null;
  tunnelUrl = null;
  startPromise = null;

  if (child && !child.killed) {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function startQuickTunnel({
  spawnImpl = spawn,
  command = resolveCloudflaredCommand(),
  port = process.env.PORT || 3000,
  timeoutMs = START_TIMEOUT_MS,
} = {}) {
  if (tunnelUrl && tunnelProcess && !tunnelProcess.killed) {
    return Promise.resolve(tunnelUrl);
  }
  if (startPromise) return startPromise;

  startPromise = new Promise((resolve, reject) => {
    let output = '';
    let publishedUrl = null;
    let registered = false;
    let settled = false;
    let timer = null;

    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        const child = tunnelProcess;
        tunnelProcess = null;
        tunnelUrl = null;
        if (child && !child.killed) {
          try { child.kill('SIGTERM'); } catch {}
        }
        startPromise = null;
        reject(error);
        return;
      }
      tunnelUrl = url;
      resolve(url);
    };

    let child;
    try {
      child = spawnImpl(command, [
        'tunnel',
        '--url', `http://127.0.0.1:${port}`,
        '--no-autoupdate',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      tunnelProcess = child;
    } catch (error) {
      const failure = new Error(`Não foi possível iniciar o cloudflared: ${error.message}`, { cause: error });
      failure.code = error.code === 'ENOENT' ? 'CLOUDFLARED_NOT_FOUND' : 'CLOUDFLARED_START_FAILED';
      startPromise = null;
      reject(failure);
      return;
    }

    const onOutput = chunk => {
      output = (output + String(chunk)).slice(-20_000);
      publishedUrl = extractQuickTunnelUrl(output) || publishedUrl;
      registered = registered || /Registered tunnel connection/i.test(output);
      if (publishedUrl && registered) finish(null, publishedUrl);
    };

    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);
    child.once('error', error => {
      const failure = new Error(`Não foi possível executar o cloudflared: ${error.message}`, { cause: error });
      failure.code = error.code === 'ENOENT' ? 'CLOUDFLARED_NOT_FOUND' : 'CLOUDFLARED_START_FAILED';
      finish(failure);
    });
    child.once('exit', (code, signal) => {
      if (!settled) {
        const failure = new Error(`cloudflared encerrou antes de conectar (código ${code ?? signal ?? 'desconhecido'}).`);
        failure.code = 'CLOUDFLARED_EXIT';
        finish(failure);
      } else if (tunnelProcess === child) {
        tunnelProcess = null;
        tunnelUrl = null;
        startPromise = null;
      }
    });

    timer = setTimeout(() => {
      const failure = new Error('Tempo esgotado ao aguardar o cloudflared estabelecer a ligação.');
      failure.code = 'TUNNEL_TIMEOUT';
      finish(failure);
    }, timeoutMs);
    timer.unref?.();
  }).catch(error => {
    startPromise = null;
    throw error;
  });

  return startPromise;
}

async function getPublicApiUrl() {
  // URL explícita pode ser de um domínio próprio, de um Quick Tunnel ou de outro
  // endpoint HTTPS público configurado pelo administrador.
  const configured = normaliseConfiguredApiUrl(process.env.PUBLIC_API_URL);
  if (configured) return configured;

  // Serviços Web do Render já recebem HTTPS público pelo proxy da plataforma.
  // Não iniciar cloudflared no Render: o próprio serviço atende /api.
  if (String(process.env.RENDER || '').toLowerCase() === 'true') {
    const renderUrl = normaliseRenderExternalUrl(process.env.RENDER_EXTERNAL_URL)
      || normaliseRenderExternalUrl(
        process.env.RENDER_EXTERNAL_HOSTNAME
          ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
          : ''
      );
    if (renderUrl) return renderUrl;

    const error = new Error('O Render foi detectado, mas não informou uma URL pública válida para a API do Tico.');
    error.code = 'PUBLIC_API_URL_MISSING';
    throw error;
  }

  const url = await startQuickTunnel();
  return `${url}/api`;
}

process.once('exit', stopPublicApiTunnel);

module.exports = {
  extractQuickTunnelUrl,
  normaliseConfiguredApiUrl,
  normalisePublicApiUrl,
  normaliseRenderExternalUrl,
  startQuickTunnel,
  getPublicApiUrl,
  stopPublicApiTunnel,
};
