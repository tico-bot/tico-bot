/**
 * Prepara yt-dlp e o provedor de PO Token do YouTube para Linux/Render.
 * O runtime é instalado em .yt-dlp-runtime (ignorado pelo Git).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') {
  console.log('Windows detectado — pulando instalação do runtime PO Token do Render.');
  process.exit(0);
}

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOT = path.join(PROJECT_ROOT, '.yt-dlp-runtime');
const PYTHON_ROOT = path.join(RUNTIME_ROOT, 'python');
const BIN_ROOT = path.join(RUNTIME_ROOT, 'bin');
const YTDLP_VERSION = '2026.10.26';
const PROVIDER_ROOT = path.join(RUNTIME_ROOT, 'bgutil-ytdlp-pot-provider');
const SERVER_ROOT = path.join(PROVIDER_ROOT, 'server');
const PROVIDER_VERSION = '2.0.2';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    timeout: options.timeout || 300000,
    stdio: 'inherit',
    env: process.env,
  });
}

console.log('⬆️ Preparando o provedor PO Token do YouTube...');
console.log('⬇️ Instalando provedor PO Token bgutil ' + PROVIDER_VERSION + '...');
fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true });
fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
fs.mkdirSync(PYTHON_ROOT, { recursive: true });
fs.mkdirSync(BIN_ROOT, { recursive: true });

// yt-dlp e o plugin ficam no mesmo diretório Python isolado para garantir
// que o carregador de plugins encontre a integração no runtime do Render.
run('python3', [
  '-m', 'pip', 'install',
  '--disable-pip-version-check',
  '--no-warn-script-location',
  '--target', PYTHON_ROOT,
  'yt-dlp==' + YTDLP_VERSION,
  'bgutil-ytdlp-pot-provider==' + PROVIDER_VERSION,
]);

const wrapperPath = path.join(BIN_ROOT, 'yt-dlp');
fs.writeFileSync(wrapperPath, [
  '#!/bin/sh',
  'ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)',
  'export PYTHONPATH="$ROOT_DIR/python${PYTHONPATH:+:$PYTHONPATH}"',
  'exec python3 -m yt_dlp "$@"',
  '',
].join('\n'), { mode: 0o755 });
fs.chmodSync(wrapperPath, 0o755);

// O modo script evita manter um serviço HTTP adicional no Render. O Node 22+
// do serviço gera os tokens sob demanda e conserva o cache no diretório HOME.
run('git', [
  'clone', '--depth', '1', '--single-branch', '--branch', PROVIDER_VERSION,
  'https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git', PROVIDER_ROOT,
]);
run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: SERVER_ROOT });
run('npx', ['tsc', '--pretty', 'false'], { cwd: SERVER_ROOT });
run('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund'], { cwd: SERVER_ROOT });

const pluginFile = path.join(PYTHON_ROOT, 'yt_dlp_plugins', 'extractor', 'getpot_bgutil_script.py');
const providerScript = path.join(SERVER_ROOT, 'build', 'generate_once.js');
if (!fs.existsSync(pluginFile) || !fs.existsSync(providerScript)) {
  throw new Error('O provedor PO Token foi instalado incompletamente.');
}

const nodeVersion = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim();
const majorVersion = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
if (!Number.isFinite(majorVersion) || majorVersion < 22) {
  throw new Error('O provedor bgutil requer Node.js 22 ou superior; encontrado: ' + nodeVersion);
}

const ytdlpVersion = execFileSync(wrapperPath, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
if (ytdlpVersion !== YTDLP_VERSION) {
  throw new Error('Versão inesperada do yt-dlp: ' + ytdlpVersion);
}

execFileSync('python3', ['-c',
  'import sys; sys.path.insert(0, ' + JSON.stringify(PYTHON_ROOT) + '); import yt_dlp_plugins.extractor.getpot_bgutil_script'
], { encoding: 'utf8', timeout: 15000 });

const providerVersion = execFileSync('node', [providerScript, '--version'], {
  cwd: SERVER_ROOT,
  encoding: 'utf8',
  timeout: 15000,
}).trim();
if (providerVersion !== PROVIDER_VERSION) {
  throw new Error('Versão inesperada do provedor PO Token: ' + providerVersion);
}

console.log('✅ yt-dlp instalado: ' + ytdlpVersion);
console.log('✅ Plugin PO Token carregado pelo Python isolado.');
console.log('✅ PO Token instalado: bgutil ' + providerVersion);
console.log('✅ Node.js disponível para yt-dlp: ' + nodeVersion);
console.log('✅ Runtime do YouTube pronto em ' + RUNTIME_ROOT);
