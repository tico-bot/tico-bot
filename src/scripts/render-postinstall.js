/**
 * Executa a preparação do yt-dlp apenas durante o build do Render.
 * O npm executa postinstall também em ambientes locais; nesses casos não
 * instalamos dependências Python ou clonamos o provedor PO Token.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.env.RENDER !== 'true') {
  console.log('[postinstall] Fora do Render — pulando instalação do runtime yt-dlp.');
  process.exit(0);
}

if (process.platform === 'win32') {
  console.log('[postinstall] Windows detectado — pulando runtime PO Token do Render.');
  process.exit(0);
}

const installer = path.join(__dirname, 'install-ytdlp.js');
const result = spawnSync(process.execPath, [installer], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[postinstall] Falha ao iniciar instalador do yt-dlp:', result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error('[postinstall] Instalador interrompido pelo sinal:', result.signal);
  process.exit(1);
}

process.exit(Number.isInteger(result.status) ? result.status : 1);
