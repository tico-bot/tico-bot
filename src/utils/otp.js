'use strict';

const crypto = require('crypto');

const OTP_MAX_ATTEMPTS = 5;

function hashOtpCode(code) {
  const value = String(code ?? '').trim();
  if (!/^\d{6}$/.test(value)) throw new TypeError('O código OTP deve conter exatamente seis dígitos.');
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('OTP_SECRET ou JWT_SECRET deve conter ao menos 16 caracteres.');
  }
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

// Claims one canonical account OTP atomically. Five failed guesses invalidate it.
// New code issuance must persist only one record keyed by the user's canonical idWhatsApp.
async function consumeOtp(OtpCadastro, idWhatsApp, code, finalidade = 'recuperacao') {
  const canonicalId = String(idWhatsApp || '').trim().toLowerCase();
  if (!canonicalId || !['cadastro', 'recuperacao'].includes(finalidade)
      || !/^\d{6}$/.test(String(code ?? '').trim())) return null;

  const now = new Date();
  const activeFilter = {
    idWhatsApp: canonicalId,
    finalidade,
    usado: false,
    expiresAt: { $gt: now },
    $or: [
      { tentativas: { $lt: OTP_MAX_ATTEMPTS } },
      { tentativas: { $exists: false } },
    ],
  };
  const hashedCode = hashOtpCode(code);

  const claimed = await OtpCadastro.findOneAndUpdate(
    { ...activeFilter, codigo: hashedCode },
    { $set: { usado: true }, $inc: { tentativas: 1 } },
    { new: true, sort: { createdAt: -1 } },
  );
  if (claimed) return claimed;

  const failed = await OtpCadastro.findOneAndUpdate(
    activeFilter,
    { $inc: { tentativas: 1 } },
    { new: true, sort: { createdAt: -1 } },
  );
  if (failed && Number(failed.tentativas || 0) >= OTP_MAX_ATTEMPTS) {
    await OtpCadastro.updateOne(
      { _id: failed._id, usado: false },
      { $set: { usado: true } },
    );
  }
  return null;
}

module.exports = { hashOtpCode, consumeOtp, OTP_MAX_ATTEMPTS };
