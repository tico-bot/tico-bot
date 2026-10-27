'use strict';

const mongoose = require('mongoose');

// Estado temporário dos casais que precisa sobreviver a restart:
//  - tipo 'diario'  → uso diário de carinho (chave: "diario:<relKey>:<cmd>:<YYYY-MM-DD>")
//  - tipo 'xpBonus' → XP Dobro ativo       (chave: "bonus:<relKey>")
// O índice TTL em "expiry" faz o próprio Mongo apagar os registros vencidos.
const casalEstadoSchema = new mongoose.Schema({
  chave:  { type: String, required: true, unique: true },
  tipo:   { type: String, enum: ['diario', 'xpBonus'], required: true },
  expiry: { type: Date,   required: true },
});

casalEstadoSchema.index({ expiry: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.CasalEstado || mongoose.model('CasalEstado', casalEstadoSchema);