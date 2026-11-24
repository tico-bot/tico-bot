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

const installers = [
  { file: 'install-ytdlp.js', label: 'yt-dlp' },
  { file: 'install-tiktok-gallery-dl.js', label: 'gallery-dl (fotos do TikTok)' },
];

for (const installer of installers) {
  const installerPath = path.join(__dirname, installer.file);
  const result = spawnSync(process.execPath, [installerPath], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error('[postinstall] Falha ao iniciar instalador de ' + installer.label + ':', result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    console.error('[postinstall] Instalador de ' + installer.label + ' interrompido pelo sinal:', result.signal);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error('[postinstall] Instalação de ' + installer.label + ' falhou com código:', result.status);
    process.exit(Number.isInteger(result.status) ? result.status : 1);
  }
}

console.log('[postinstall] ✅ Runtime de downloads preparado no Render.');