'use strict';
const mongoose = require('mongoose');

const otpCadastroSchema = new mongoose.Schema({
  idWhatsApp: { type: String, required: true, trim: true, lowercase: true },
  codigo:     { type: String, required: true },
  expiresAt:  { type: Date,   required: true, index: { expireAfterSeconds: 0 } },
  usado:      { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.OtpCadastro ||
  mongoose.model('OtpCadastro', otpCadastroSchema);