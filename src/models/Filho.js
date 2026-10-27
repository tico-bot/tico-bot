'use strict';

const mongoose = require('mongoose');

const FilhoSchema = new mongoose.Schema({
  // Casal
  jidA:    { type: String, required: true, index: true, trim: true, lowercase: true }, // pai/mãe A
  jidB:    { type: String, required: true, index: true, trim: true, lowercase: true }, // pai/mãe B
  idGrupo: { type: String, required: true, index: true, trim: true, lowercase: true },

  // Identidade
  nome:          { type: String, required: true, trim: true },
  sexo:          { type: String, enum: ['menino', 'menina'], required: true },
  personalidade: { type: String, required: true, trim: true },

  // Idade
  nascidoEm: { type: Date, default: Date.now }, // a cada 7 dias = +1 ano

  // Atributos (0–100)
  felicidade: { type: Number, default: 100, min: 0, max: 100 },
  fome:       { type: Number, default: 100, min: 0, max: 100 },
  sono:       { type: Number, default: 100, min: 0, max: 100 },
  alegria:    { type: Number, default: 100, min: 0, max: 100 },

  // Estado
  doente: { type: Boolean, default: false },

  // Guarda compartilhada
  guardaAtual: { type: String, default: null, trim: true, lowercase: true }, // jid de quem está com o filho agora
  ultimaTroca: { type: Date,   default: Date.now },

  // Cuidado diário
  ultimoCuidado: { type: Date, default: null },
}, { timestamps: true });

// Índice composto para buscas comuns por grupo + casal
FilhoSchema.index({ idGrupo: 1, jidA: 1, jidB: 1 });

// ── Idade calculada em "anos" (1 ano = 7 dias reais) com fallback seguro ──
FilhoSchema.virtual('idade').get(function () {
  const ts = this.nascidoEm instanceof Date
    ? this.nascidoEm.getTime()
    : (this.nascidoEm ? new Date(this.nascidoEm).getTime() : Date.now());
  const validTs = isNaN(ts) ? Date.now() : ts;
  const diasVividos = (Date.now() - validTs) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.floor(diasVividos / 7));
});

FilhoSchema.set('toJSON',   { virtuals: true });
FilhoSchema.set('toObject', { virtuals: true });

// ── Statics e Methods ─────────────────────────────────────────────────────────
FilhoSchema.statics.buscarFilhoDoCasal = function (idGrupo, user1, user2) {
  if (!idGrupo || !user1 || !user2) return null;
  const g = String(idGrupo).trim().toLowerCase();
  const u1 = String(user1).trim().toLowerCase();
  const u2 = String(user2).trim().toLowerCase();

  return this.findOne({
    idGrupo: g,
    $or: [
      { jidA: u1, jidB: u2 },
      { jidA: u2, jidB: u1 },
    ],
  });
};

FilhoSchema.methods.ajustarAtributo = function (attr, valorDelta) {
  const attrs = ['felicidade', 'fome', 'sono', 'alegria'];
  if (!attrs.includes(attr)) return;
  const atual = typeof this[attr] === 'number' ? this[attr] : 100;
  this[attr] = Math.min(100, Math.max(0, atual + valorDelta));
};

module.exports = mongoose.models.Filho || mongoose.model('Filho', FilhoSchema);