'use strict';

const mongoose = require('mongoose');

const jogoRequestSchema = new mongoose.Schema({
  idWhatsApp: { type: String, required: true, trim: true, lowercase: true },
  requestId:  { type: String, required: true, trim: true, lowercase: true },
  jogo:       { type: String, required: true, enum: ['slots', 'corrida'] },
  idGrupo:    { type: String, required: true, trim: true, lowercase: true },
  aposta:     { type: Number, required: true, min: 10, max: 100000 },
  escolha:    { type: Number, default: null, min: 0, max: 5 },
  status:     { type: String, required: true, enum: ['pending', 'completed'], default: 'pending' },
  httpStatus: { type: Number, default: null },
  response:   { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, minimize: false });

// A mesma rodada do mesmo usuário só pode ser registrada uma vez.
jogoRequestSchema.index({ idWhatsApp: 1, requestId: 1 }, { unique: true });
// Mantém o ledger por sete dias após a última alteração para evitar crescimento infinito.
jogoRequestSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.models.JogoRequest || mongoose.model('JogoRequest', jogoRequestSchema);
