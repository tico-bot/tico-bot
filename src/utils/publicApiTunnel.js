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

function normalisePublicApiUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith(TUNNEL_DOMAIN)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname !== '' && pathname !== '/api') return null;
    return `${parsed.origin}/api`;
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
      startPromise = null;
      reject(error);
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
    child.once('error', error => finish(error));
    child.once('exit', (code, signal) => {
      if (!settled) {
        finish(new Error(`cloudflared encerrou antes de conectar (código ${code ?? signal ?? 'desconhecido'}).`));
      } else if (tunnelProcess === child) {
        tunnelProcess = null;
        tunnelUrl = null;
        startPromise = null;
      }
    });

    timer = setTimeout(() => {
      finish(new Error('Tempo esgotado ao criar o túnel HTTPS do painel.'));
    }, timeoutMs);
    timer.unref?.();
  }).catch(error => {
    startPromise = null;
    throw error;
  });

  return startPromise;
}

async function getPublicApiUrl() {
  const configured = normalisePublicApiUrl(process.env.PUBLIC_API_URL);
  if (configured) return configured;

  const url = await startQuickTunnel();
  return `${url}/api`;
}

process.once('exit', stopPublicApiTunnel);

module.exports = {
  extractQuickTunnelUrl,
  normalisePublicApiUrl,
  startQuickTunnel,
  getPublicApiUrl,
  stopPublicApiTunnel,
};
