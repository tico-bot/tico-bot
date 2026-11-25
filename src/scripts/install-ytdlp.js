/**
 * Prepara yt-dlp e o provedor de PO Token do YouTube para Linux/Render.
 * O runtime é instalado em .yt-dlp-runtime (ignorado pelo Git).
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const YTDLP_VERSION = '2026.11.23';

if (process.platform === 'win32') {
  // O executável Windows é distribuído separadamente do runtime PO Token do Render.
  // Baixa a mesma versão fixada para Linux e valida o checksum publicado pelo yt-dlp.
  const projectRoot = path.resolve(__dirname, '..', '..');
  const targetPath = path.join(projectRoot, 'yt-dlp.exe');
  const baseUrl = 'https://github.com/yt-dlp/yt-dlp/releases/download/' + YTDLP_VERSION;

  async function installWindowsYtDlp() {
    console.log('⬇️ Actualizando yt-dlp para Windows: ' + YTDLP_VERSION + '...');

    const fetchOptions = { signal: AbortSignal.timeout(180000) };
    const [checksumsResponse, binaryResponse] = await Promise.all([
      fetch(baseUrl + '/SHA2-256SUMS', fetchOptions),
      fetch(baseUrl + '/yt-dlp.exe', fetchOptions),
    ]);

    if (!checksumsResponse.ok) {
      throw new Error('Falha ao obter SHA2-256SUMS: HTTP ' + checksumsResponse.status);
    }
    if (!binaryResponse.ok) {
      throw new Error('Falha ao obter yt-dlp.exe: HTTP ' + binaryResponse.status);
    }

    const checksums = await checksumsResponse.text();
    const checksumLine = checksums.split(/\r?\n/).find(line => /\s+\*?yt-dlp\.exe\s*$/.test(line));
    const expectedHash = checksumLine?.trim().split(/\s+/)[0]?.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) {
      throw new Error('O manifesto oficial não contém o SHA-256 esperado para yt-dlp.exe.');
    }

    const binary = Buffer.from(await binaryResponse.arrayBuffer());
    if (binary.length < 1024 * 1024) {
      throw new Error('O executável baixado parece incompleto.');
    }

    const actualHash = crypto.createHash('sha256').update(binary).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error('SHA-256 do yt-dlp.exe não corresponde ao manifesto oficial.');
    }

    const tempPath = targetPath + '.download-' + process.pid;
    const backupPath = targetPath + '.previous';
    fs.writeFileSync(tempPath, binary);

    let movedOldBinary = false;
    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(backupPath, { force: true });
        fs.renameSync(targetPath, backupPath);
        movedOldBinary = true;
      }

      fs.renameSync(tempPath, targetPath);
      const installedVersion = execFileSync(targetPath, ['--version'], {
        encoding: 'utf8',
        timeout: 15000,
      }).trim();

      if (installedVersion !== YTDLP_VERSION) {
        throw new Error('Versão instalada inesperada: ' + installedVersion);
      }

      fs.rmSync(backupPath, { force: true });
    } catch (error) {
      fs.rmSync(targetPath, { force: true });
      if (movedOldBinary && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, targetPath);
      }
      throw error;
    } finally {
      fs.rmSync(tempPath, { force: true });
    }

    console.log('✅ yt-dlp Windows instalado: ' + YTDLP_VERSION);
    console.log('✅ SHA-256 validado: ' + actualHash);
    console.log('✅ Runtime PO Token do Render não é necessário no Windows.');
  }

  installWindowsYtDlp().catch(error => {
    console.error('❌ Falha ao actualizar yt-dlp no Windows:', error.message);
    process.exitCode = 1;
  });
} else {
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOT = path.join(PROJECT_ROOT, '.yt-dlp-runtime');
const PYTHON_ROOT = path.join(RUNTIME_ROOT, 'python');
const BIN_ROOT = path.join(RUNTIME_ROOT, 'bin');
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
}
