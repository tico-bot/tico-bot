/**
 * Instala o gallery-dl num runtime Python isolado do projeto.
 * Usado pelo /tiktok para extrair carrosséis de fotos.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOT = path.join(PROJECT_ROOT, '.yt-dlp-runtime', 'gallery-dl-python');
const GALLERY_DL_VERSION = '1.32.21';

const pythonCandidates = process.platform === 'win32'
  ? [
      { command: process.env.PYTHON || 'py', args: process.env.PYTHON ? [] : ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ]
  : [
      { command: process.env.PYTHON || 'python3', args: [] },
      { command: 'python', args: [] },
    ];

function runPython(candidate, args, options = {}) {
  return execFileSync(candidate.command, [...candidate.args, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    timeout: options.timeout || 300000,
    env: process.env,
  });
}

let python = null;
for (const candidate of pythonCandidates) {
  try {
    runPython(candidate, ['--version'], { timeout: 10000 });
    python = candidate;
    break;
  } catch {}
}

if (!python) {
  throw new Error('Python 3 não encontrado. Instale Python 3 para habilitar fotos no /tiktok.');
}

fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true });
fs.mkdirSync(RUNTIME_ROOT, { recursive: true });

console.log('⬇️ Instalando gallery-dl ' + GALLERY_DL_VERSION + ' para os posts de fotos do TikTok...');
runPython(python, [
  '-m', 'pip', 'install',
  '--disable-pip-version-check',
  '--no-warn-script-location',
  '--target', RUNTIME_ROOT,
  'gallery-dl==' + GALLERY_DL_VERSION,
], { stdio: 'inherit', timeout: 300000 });

const version = runPython(python, [
  '-c',
  'import sys; sys.path.insert(0, ' + JSON.stringify(RUNTIME_ROOT) + '); import gallery_dl; print(gallery_dl.version.__version__)',
], { timeout: 15000 }).trim();

if (version !== GALLERY_DL_VERSION) {
  throw new Error('Versão inesperada do gallery-dl: ' + (version || 'desconhecida'));
}

fs.writeFileSync(
  path.join(path.dirname(RUNTIME_ROOT), 'gallery-dl-python.json'),
  JSON.stringify({ command: python.command, prefixArgs: python.args }, null, 2) + '\n',
  'utf8'
);

console.log('✅ gallery-dl instalado e validado: ' + version);