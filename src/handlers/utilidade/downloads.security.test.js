'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  _isPublicAddress,
  _validateExternalUrl,
} = require('./downloads');

test('blocks private, loopback, link-local, and special-use IP addresses', () => {
  assert.equal(_isPublicAddress('127.0.0.1', 4), false);
  assert.equal(_isPublicAddress('10.2.3.4', 4), false);
  assert.equal(_isPublicAddress('169.254.169.254', 4), false);
  assert.equal(_isPublicAddress('::1', 6), false);
  assert.equal(_isPublicAddress('fe80::1', 6), false);
  assert.equal(_isPublicAddress('::ffff:127.0.0.1', 6), false);
  assert.equal(_isPublicAddress('8.8.8.8', 4), true);
  assert.equal(_isPublicAddress('2606:4700:4700::1111', 6), true);
});

test('rejects non-HTTPS links and embedded credentials', async () => {
  await assert.rejects(_validateExternalUrl('http://example.com'), /HTTPS público/);
  await assert.rejects(_validateExternalUrl('https://user:pass@example.com'), /HTTPS público/);
});

test('rejects literal and DNS-resolved private destinations', async () => {
  await assert.rejects(_validateExternalUrl('https://127.0.0.1'), /não permitido/);
  await assert.rejects(_validateExternalUrl('https://[::1]'), /não permitido/);
  await assert.rejects(_validateExternalUrl('https://localhost'), /não permitido/);
});
