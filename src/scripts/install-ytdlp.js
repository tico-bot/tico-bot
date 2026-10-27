/**
 * src/scripts/install-ytdlp.js
 * Instala yt-dlp via pip no Linux (Render).
 * No Windows é ignorado.
 */
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

if (process.platform === 'win32') {
  console.log('Windows detectado — pulando instalação do yt-dlp.');
  process.exit(0);
}

function run(cmd) {
  return execSync(cmd, { timeout: 60000, stdio: 'inherit' });
}

// Sempre atualiza: o extractor do Pinterest muda com frequência e uma versão
// antiga pode falhar com "No video formats found" mesmo para Pins com vídeo.
console.log('⬆️  Instalando/atualizando yt-dlp via pip...');
try {
  run('pip install -q --upgrade yt-dlp');
  const ver = execSync('yt-dlp --version', { timeout: 5000 }).toString().trim();
  console.log('✅ yt-dlp', ver, 'instalado com sucesso!');
} catch (e) {
  console.error('❌ Falha ao instalar yt-dlp via pip:', e.message);
  // Tenta pip3
  try {
    run('pip3 install -q --upgrade yt-dlp');
    const ver = execSync('yt-dlp --version', { timeout: 5000 }).toString().trim();
    console.log('✅ yt-dlp', ver, 'instalado via pip3!');
  } catch (e2) {
    console.error('❌ Falha também com pip3:', e2.message);
    process.exit(1);
  }
}