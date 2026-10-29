'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OTP_SECRET = 'long-test-only-otp-secret-2026';
const { hashOtpCode, consumeOtp, OTP_MAX_ATTEMPTS } = require('./otp');

test('OTP hash is deterministic, six-digit-only, and not the plaintext code', () => {
  const hashed = hashOtpCode('012345');
  assert.equal(hashed, hashOtpCode('012345'));
  assert.match(hashed, /^[a-f0-9]{64}$/);
  assert.notEqual(hashed, '012345');
  assert.throws(() => hashOtpCode('12345'), /seis dígitos/);
  assert.throws(() => hashOtpCode('123456x'), /seis dígitos/);
});

test('consumeOtp atomically accepts a correct OTP once and records bad attempts', async () => {
  const record = { _id: 'otp-1', idWhatsApp: '5511999999999@s.whatsapp.net', finalidade: 'recuperacao', codigo: hashOtpCode('123456'), usado: false, tentativas: 0, expiresAt: new Date(Date.now() + 60000) };
  const updates = [];
  const Model = {
    async findOneAndUpdate(filter, update) {
      updates.push({ filter, update });
      if (record.usado || record.expiresAt <= new Date() || record.tentativas >= OTP_MAX_ATTEMPTS) return null;
      if (filter.finalidade && filter.finalidade !== record.finalidade) return null;
      if (filter.codigo && filter.codigo !== record.codigo) return null;
      if (update.$inc?.tentativas) record.tentativas += update.$inc.tentativas;
      if (update.$set?.usado === true) record.usado = true;
      return { ...record };
    },
    async updateOne(filter, update) {
      if (filter._id === record._id && !record.usado && update.$set?.usado === true) record.usado = true;
      return { modifiedCount: 1 };
    },
  };
  const accepted = await consumeOtp(Model, record.idWhatsApp, '123456');
  assert.equal(accepted._id, 'otp-1');
  assert.equal(record.usado, true);
  assert.equal(await consumeOtp(Model, record.idWhatsApp, '123456'), null);
  assert.ok(updates[0].filter.codigo, 'OTP comparison must use the stored HMAC');
});


test('OTP cannot be used for a different purpose and five wrong attempts invalidate it', async () => {
  const record = { _id: 'otp-2', idWhatsApp: '5511999999999@s.whatsapp.net', finalidade: 'recuperacao', codigo: hashOtpCode('654321'), usado: false, tentativas: 0, expiresAt: new Date(Date.now() + 60000) };
  const Model = {
    async findOneAndUpdate(filter, update) {
      if (record.usado || record.expiresAt <= new Date() || record.tentativas >= OTP_MAX_ATTEMPTS) return null;
      if (filter.finalidade && filter.finalidade !== record.finalidade) return null;
      if (filter.codigo && filter.codigo !== record.codigo) return null;
      if (update.$inc?.tentativas) record.tentativas += update.$inc.tentativas;
      if (update.$set?.usado === true) record.usado = true;
      return { ...record };
    },
    async updateOne(filter, update) {
      if (filter._id === record._id && !record.usado && update.$set?.usado === true) record.usado = true;
      return { modifiedCount: 1 };
    },
  };
  assert.equal(await consumeOtp(Model, record.idWhatsApp, '654321', 'cadastro'), null);
  assert.equal(record.tentativas, 0, 'a code for another purpose is not even treated as a bad guess');
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    assert.equal(await consumeOtp(Model, record.idWhatsApp, '000000', 'recuperacao'), null);
  }
  assert.equal(record.tentativas, OTP_MAX_ATTEMPTS);
  assert.equal(record.usado, true);
  assert.equal(await consumeOtp(Model, record.idWhatsApp, '654321', 'recuperacao'), null);
});

test('consumeOtp rejects malformed codes before a database lookup', async () => {
  let calls = 0;
  const Model = { async findOneAndUpdate() { calls++; return null; } };
  assert.equal(await consumeOtp(Model, '5511999999999@s.whatsapp.net', '123'), null);
  assert.equal(await consumeOtp(Model, '', '123456'), null);
  assert.equal(calls, 0);
});
