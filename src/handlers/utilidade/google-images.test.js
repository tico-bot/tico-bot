'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGoogleImagesUrl,
  extractImageResults,
  isSafeImageUrl,
  handleGoogleImageSearch,
} = require('./google-images');

test('buildGoogleImagesUrl cria uma busca de imagens no Google com o termo codificado', () => {
  const result = new URL(buildGoogleImagesUrl('gatinhos fofos & gatos'));
  assert.equal(result.origin, 'https://www.google.com');
  assert.equal(result.pathname, '/search');
  assert.equal(result.searchParams.get('udm'), '2');
  assert.equal(result.searchParams.get('q'), 'gatinhos fofos & gatos');
  assert.equal(result.searchParams.get('hl'), 'pt-BR');
});

test('buildGoogleImagesUrl rejeita uma pesquisa vazia', () => {
  assert.equal(buildGoogleImagesUrl('  '), null);
  assert.equal(buildGoogleImagesUrl(null), null);
});

test('isSafeImageUrl aceita HTTPS público e rejeita esquemas/hosts locais', () => {
  assert.equal(isSafeImageUrl('https://images.example.com/a.jpg'), true);
  assert.equal(isSafeImageUrl('http://images.example.com/a.jpg'), false);
  assert.equal(isSafeImageUrl('https://127.0.0.1/a.jpg'), false);
  assert.equal(isSafeImageUrl('https://localhost/a.jpg'), false);
  assert.equal(isSafeImageUrl('https://user:pass@images.example.com/a.jpg'), false);
});

test('extractImageResults limita, filtra e deduplica imagens', () => {
  const results = extractImageResults({ images_results: [
    { original: 'https://cdn.example.com/a.jpg', title: 'A', link: 'https://example.com/a' },
    { original: 'https://cdn.example.com/a.jpg', title: 'A duplicada' },
    { original: 'http://127.0.0.1/private.png', thumbnail: 'https://cdn.example.com/b.jpg', title: 'B' },
    { original: 'https://cdn.example.com/c.jpg', title: 'C' },
    { original: 'https://cdn.example.com/d.jpg', title: 'D' },
  ] }, 3);
  assert.deepEqual(results.map(item => item.imageUrl), [
    'https://cdn.example.com/a.jpg',
    'https://cdn.example.com/b.jpg',
    'https://cdn.example.com/c.jpg',
  ]);
  assert.equal(results[0].sourceUrl, 'https://example.com/a');
  assert.equal(extractImageResults({ images_results: [
    { original: 'https://cdn.example.com/one.jpg' },
    { original: 'https://cdn.example.com/two.jpg' },
  ] }).length, 1, 'a busca padrão retorna só uma imagem');
});

test('handleGoogleImageSearch mostra ampulheta e erro quando falta a chave', async () => {
  const messages = [];
  await handleGoogleImageSearch({
    sendMessage: async (...args) => messages.push(args),
  }, { key: {} }, 'jid@g.us', 'gatos', {
    search: async () => { const error = new Error('missing'); error.code = 'MISSING_SERPAPI_KEY'; throw error; },
  });
  assert.equal(messages[0][1].react.text, '⏳');
  assert.match(messages.find(item => item[1].text)?.[1].text, /SERPAPI_KEY/);
  assert.equal(messages.at(-1)[1].react.text, '❌');
});

test('handleGoogleImageSearch envia somente uma imagem e troca ampulheta por check verde', async () => {
  const messages = [];
  const sock = { sendMessage: async (...args) => messages.push(args) };
  await handleGoogleImageSearch(sock, { key: {} }, 'jid@g.us', 'gatos', {
    search: async () => [
      { imageUrl: 'https://cdn.example.com/1.jpg', title: 'Gato 1', sourceUrl: null },
      { imageUrl: 'https://cdn.example.com/2.jpg', title: 'Gato 2', sourceUrl: null },
    ],
    downloadImage: async url => Buffer.from(url.endsWith('1.jpg') ? 'image-one' : 'image-two'),
  });
  assert.equal(messages.length, 3);
  assert.equal(messages[0][1].react.text, '⏳');
  assert.equal(messages[1][1].image.toString(), 'image-one');
  assert.match(messages[1][1].caption, /Gato 1/);
  assert.equal(messages[2][1].react.text, '✅');
  assert.equal(messages.filter(item => item[1].image).length, 1);
});
