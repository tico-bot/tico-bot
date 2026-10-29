'use strict';
const mongoose = require('mongoose');

const otpCadastroSchema = new mongoose.Schema({
  idWhatsApp: { type: String, required: true, trim: true, lowercase: true },
  codigo:     { type: String, required: true, select: false }, // HMAC-SHA256; nunca guardar OTP em texto puro
  tentativas: { type: Number, default: 0, min: 0, max: 5 },
  // New codes must declare their purpose; old untagged codes must be reissued.
  finalidade: { type: String, enum: ['cadastro', 'recuperacao'], required: true, index: true },
  expiresAt:  { type: Date,   required: true, index: { expireAfterSeconds: 0 } },
  usado:      { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.OtpCadastro ||
  mongoose.model('OtpCadastro', otpCadastroSchema);