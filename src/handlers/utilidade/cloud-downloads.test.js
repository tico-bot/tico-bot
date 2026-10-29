'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { _helpers, handleMediafire, handleGoogleDrive } = require('./cloud-downloads');

const {
  isAllowedProviderUrl,
  extractGoogleDownloadSpec,
  extractMediafireDownloadUrl,
  parseGoogleConfirmationForm,
  sanitizeFilename,
  filenameFromDisposition,
  isHtmlBuffer,
  guessMimeType,
  firstUrlFromCaption,
  MAX_FILE_SIZE,
  formatFileSize,
  formatDownloadCaption,
} = _helpers;

const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz123456';

test('aceita apenas HTTPS do MediaFire e rejeita domínios parecidos', () => {
  assert.equal(isAllowedProviderUrl('https://www.mediafire.com/file/abc/file.zip', 'mediafire'), true);
  assert.equal(isAllowedProviderUrl('https://download123.mediafire.com/file.zip', 'mediafire'), true);
  assert.equal(isAllowedProviderUrl('https://mfi.re/abc', 'mediafire'), true);
  assert.equal(isAllowedProviderUrl('http://www.mediafire.com/file/abc', 'mediafire'), false);
  assert.equal(isAllowedProviderUrl('https://mediafire.com.evil.example/file.zip', 'mediafire'), false);
  assert.equal(isAllowedProviderUrl('https://example.com/file.zip', 'mediafire'), false);
  assert.equal(isAllowedProviderUrl('https://www.mediafire.com:8443/file/abc', 'mediafire'), false);
});

test('aceita links do Google Drive e domínios de conteúdo esperados, não imitações', () => {
  assert.equal(isAllowedProviderUrl(`https://drive.google.com/file/d/${DRIVE_ID}/view`, 'google'), true);
  assert.equal(isAllowedProviderUrl('https://docs.google.com/document/d/abcdefghij1234567890/edit', 'google'), true);
  assert.equal(isAllowedProviderUrl('https://drive.usercontent.google.com/download?id=abc', 'google'), true);
  assert.equal(isAllowedProviderUrl('https://drive.google.com.evil.example/file/d/abc', 'google'), false);
  assert.equal(isAllowedProviderUrl('http://drive.google.com/file/d/abc', 'google'), false);
  assert.equal(isAllowedProviderUrl('https://drive.google.com:8443/file/d/abc', 'google'), false);
  assert.equal(isAllowedProviderUrl('https://example.com/file/d/abc', 'google'), false);
});

test('identifica arquivo do Google Drive por /file/d, /open?id e /uc?id', () => {
  const file = extractGoogleDownloadSpec(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`);
  assert.match(file.url, new RegExp(`drive\\.usercontent\\.google\\.com/download\\?id=${DRIVE_ID}`));
  assert.match(file.url, /confirm=t/);
  assert.equal(file.workspaceKind, null);
  const keyedFile = extractGoogleDownloadSpec(`https://drive.google.com/file/d/${DRIVE_ID}/view?resourcekey=key-123`);
  assert.match(keyedFile.url, /resourcekey=key-123/);
  assert.equal(extractGoogleDownloadSpec(`https://drive.google.com/open?id=${DRIVE_ID}`).fallbackName, `arquivo-google-drive-${DRIVE_ID.slice(0, 8)}.bin`);
  assert.match(extractGoogleDownloadSpec(`https://drive.google.com/uc?export=download&id=${DRIVE_ID}`).url, /drive\.usercontent\.google\.com\/download/);
});

test('exporta Documentos, Planilhas e Apresentações Google em formatos Office', () => {
  const doc = extractGoogleDownloadSpec('https://docs.google.com/document/d/abcdefghij1234567890/edit');
  const sheet = extractGoogleDownloadSpec('https://docs.google.com/spreadsheets/u/0/d/abcdefghij1234567890/edit');
  const slides = extractGoogleDownloadSpec('https://docs.google.com/presentation/d/abcdefghij1234567890/edit');
  assert.match(doc.url, /export\?format=docx$/);
  assert.match(extractGoogleDownloadSpec('https://docs.google.com/document/d/abcdefghij1234567890/edit?resourcekey=res-key').url, /resourcekey=res-key/);
  assert.equal(doc.fallbackName, 'documento-google.docx');
  assert.equal(doc.workspaceKind, 'document');
  assert.match(sheet.url, /export\?format=xlsx$/);
  assert.equal(sheet.fallbackName, 'planilha-google.xlsx');
  assert.equal(sheet.workspaceKind, 'spreadsheets');
  assert.match(slides.url, /export\?format=pptx$/);
  assert.equal(slides.fallbackName, 'apresentacao-google.pptx');
  assert.equal(slides.workspaceKind, 'presentation');
});

test('rejeita links do Google que não identificam um arquivo individual', () => {
  assert.throws(() => extractGoogleDownloadSpec('https://drive.google.com/drive/folders/abcdefghij1234567890'), /não consegui identificar o arquivo/i);
  assert.throws(() => extractGoogleDownloadSpec('https://example.com/file/d/abcdefghij1234567890'), /Google Drive/);
});

test('processa a confirmação de segurança do Google Drive somente para o arquivo solicitado', () => {
  const html = '<!doctype html><html><body><form id="download-form" action="https://drive.usercontent.google.com/download">' +
    '<input type="hidden" name="id" value="' + DRIVE_ID + '">' +
    '<input type="hidden" name="export" value="download">' +
    '<input type="hidden" name="confirm" value="t">' +
    '<input type="hidden" name="uuid" value="dead-beef">' +
    '</form></body></html>';
  const parsed = parseGoogleConfirmationForm(html, 'https://drive.google.com/uc?export=download', DRIVE_ID);
  assert.ok(parsed);
  assert.equal(parsed.actionUrl.href, 'https://drive.usercontent.google.com/download');
  assert.deepEqual({ ...parsed.params }, { id: DRIVE_ID, export: 'download', confirm: 't', uuid: 'dead-beef' });
  assert.equal(parseGoogleConfirmationForm(html, 'https://drive.google.com/uc?export=download', 'differentFileId12345'), null);
});

test('ignora formulário de confirmação com action não permitido', () => {
  const html = '<form action="https://evil.example/download"><input name="id" value="' + DRIVE_ID + '"><input name="confirm" value="t"></form>';
  assert.equal(parseGoogleConfirmationForm(html, 'https://drive.google.com/uc', DRIVE_ID), null);
});

test('localiza o botão de download do MediaFire independentemente da ordem dos atributos', () => {
  const html = '<html><a href="https://download123.mediafire.com/a/file.zip?key=1&amp;other=2" class="btn" id="downloadButton">Download</a></html>';
  assert.equal(
    extractMediafireDownloadUrl(html, 'https://www.mediafire.com/file/abc/file.zip'),
    'https://download123.mediafire.com/a/file.zip?key=1&other=2'
  );
});

test('ignora no HTML links de download fora dos domínios do MediaFire', () => {
  const html = '<a id="downloadButton" href="https://evil.example/steal">Download</a>';
  assert.equal(extractMediafireDownloadUrl(html, 'https://www.mediafire.com/file/abc/file.zip'), null);
});

test('sanitiza nomes de arquivos sem permitir diretórios ou caracteres de controle', () => {
  assert.equal(sanitizeFilename('../../arquivo.zip'), '.._.._arquivo.zip');
  assert.equal(sanitizeFilename('pasta\\arquivo?.apk'), 'pasta_arquivo_.apk');
  assert.equal(sanitizeFilename('\u0000\n'), 'arquivo.bin');
});

test('lê filename normal e filename* UTF-8 de Content-Disposition', () => {
  assert.equal(filenameFromDisposition('attachment; filename="pacote.zip"'), 'pacote.zip');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''Relat%C3%B3rio%20Final.pdf"), 'Relatório Final.pdf');
  assert.equal(filenameFromDisposition('inline'), '');
});

test('detecta HTML de erro em vez de tratar a página como arquivo', () => {
  assert.equal(isHtmlBuffer(Buffer.from('<!doctype html><html><body>Access denied</body></html>'), 'application/octet-stream'), true);
  assert.equal(isHtmlBuffer(Buffer.from('PK\u0003\u0004binary'), 'application/zip'), false);
  assert.equal(isHtmlBuffer(Buffer.from('arquivo'), 'text/html'), true);
});

test('determina MIME pelo nome quando o servidor só informa octet-stream', () => {
  assert.equal(guessMimeType('documento.docx', 'application/octet-stream'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(guessMimeType('imagem.png', 'image/png'), 'image/png');
  assert.equal(guessMimeType('arquivo.unknown', 'application/octet-stream'), 'application/octet-stream');
});

test('extrai URL HTTPS do texto do comando sem capturar texto posterior', () => {
  assert.equal(firstUrlFromCaption('!mediafire https://www.mediafire.com/file/abc/file.zip', 'mediafire'), 'https://www.mediafire.com/file/abc/file.zip');
  assert.equal(firstUrlFromCaption('!googledriver <https://drive.google.com/file/d/abc123456789/view>', 'googledriver'), 'https://drive.google.com/file/d/abc123456789/view');
  assert.equal(firstUrlFromCaption('!mediafire', 'mediafire'), '');
  assert.equal(firstUrlFromCaption('!mediafire www.mediafire.com/file/abc', 'mediafire'), '');
});

test('mostra instruções com o prefixo do usuário quando o link está ausente', async () => {
  const messages = [];
  const sock = { sendMessage: async (_jid, payload) => messages.push(payload) };
  await handleMediafire(sock, { key: { remoteJid: 'group@g.us' } }, 'group@g.us', '#mediafire');
  await handleGoogleDrive(sock, { key: { remoteJid: 'group@g.us' } }, 'group@g.us', '#googledriver');
  assert.match(messages[0].text, /#mediafire https:\/\/www\.mediafire\.com/);
  assert.match(messages[1].text, /#googledriver https:\/\/drive\.google\.com/);
});

test('handlers recusam URLs inválidas antes de iniciar qualquer requisição', async () => {
  const messages = [];
  const sock = { sendMessage: async (_jid, payload) => messages.push(payload) };
  await handleMediafire(sock, { key: { remoteJid: 'group@g.us' } }, 'group@g.us', '!mediafire https://evil.example/file.zip');
  await handleGoogleDrive(sock, { key: { remoteJid: 'group@g.us' } }, 'group@g.us', '!googledriver https://example.com/file/d/abcdefghij1234567890');
  assert.match(messages[0].text, /MediaFire/);
  assert.match(messages[1].text, /Google Drive/);
});

test('limite de arquivo é 64 MiB', () => {
  assert.equal(MAX_FILE_SIZE, 64 * 1024 * 1024);
});


test('formata tamanhos de arquivo em unidades legíveis', () => {
  assert.equal(formatFileSize(500), '500 bytes');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), '2.00 GB');
});

test('caption do download mostra nome, tipo, MIME, tamanho, provedor e link original', () => {
  const caption = formatDownloadCaption({
    fileName: 'relatorio.pdf',
    mimetype: 'application/pdf',
    size: 2 * 1024 * 1024,
  }, 'google', 'https://drive.google.com/file/d/abcdefghij1234567890/view');
  assert.ok(caption.includes('📄 *Nome:* relatorio.pdf'));
  assert.ok(caption.includes('🗂️ *Tipo de arquivo:* PDF'));
  assert.ok(caption.includes('🧾 *MIME:* application/pdf'));
  assert.ok(caption.includes('💾 *Tamanho:* 2.00 MB'));
  assert.ok(caption.includes('☁️ *Origem:* Google Drive'));
  assert.ok(caption.includes('https://drive.google.com/file/d/'));
});
