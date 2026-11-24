'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '.venv', '.yt-dlp-runtime',
  'session', 'backups', 'backup_antes_migracao', 'dist', 'coverage',
]);
const TEXT_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.json', '.yaml', '.yml',
  '.md', '.txt', '.sh', '.ps1', '.py', '.ts', '.html', '.css',
]);
const FORBIDDEN_MARKERS = [
  '[' + 'executed on device:',
  '[' + 'Reading ',
  'Process started with PID',
  'Initial output:',
  'Check log: C:\\Users\\',
];

const jsonFailures = [];
const syntaxFailures = [];
const markerFindings = [];
let scannedFiles = 0;
let scannedJson = 0;
let scannedJavaScript = 0;

function walk(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    jsonFailures.push({ file: path.relative(ROOT, directory), error: error.message });
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const file = path.join(directory, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    scannedFiles++;
    const relative = path.relative(ROOT, file);

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (error) {
      jsonFailures.push({ file: relative, error: error.message });
      continue;
    }

    if (file !== __filename) {
      const marker = FORBIDDEN_MARKERS.find(value => content.includes(value));
      if (marker) markerFindings.push({ file: relative, marker });
    }

    if (extension === '.json') {
      scannedJson++;
      try { JSON.parse(content); }
      catch (error) { jsonFailures.push({ file: relative, error: error.message }); }
    }

    if (['.js', '.cjs', '.mjs'].includes(extension)) {
      scannedJavaScript++;
      const check = spawnSync(process.execPath, ['--check', file], {
        cwd: ROOT, encoding: 'utf8', timeout: 15000, windowsHide: true,
      });
      if (check.error || check.status !== 0) {
        syntaxFailures.push({
          file: relative,
          error: (check.stderr || check.error?.message || 'node --check falhou').trim().slice(0, 1200),
        });
      }
    }
  }
}

walk(ROOT);
const summary = { scannedFiles, scannedJson, scannedJavaScript, jsonFailures, syntaxFailures, markerFindings };
console.log(JSON.stringify(summary, null, 2));
if (jsonFailures.length || syntaxFailures.length || markerFindings.length) {
  console.error('Integridade do repositório inválida.');
  process.exitCode = 1;
} else {
  console.log('Integridade do repositório validada.');
}
