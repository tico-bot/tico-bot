'use strict';
const mongoose = require('mongoose');

const republicaConsultaSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  tipo: { type: String, enum: ['novo_imposto', 'emenda_constitucional', 'despesa_publica'], required: true },
  titulo: { type: String, required: true, maxlength: 100 },
  proposta: { type: mongoose.Schema.Types.Mixed, required: true },
  autorId: { type: String, required: true },
  status: { type: String, enum: ['aberta', 'aprovada', 'rejeitada', 'expirada'], default: 'aberta', index: true },
  iniciaEm: { type: Date, default: Date.now },
  encerraEm: { type: Date, required: true },
  totalSim: { type: Number, default: 0, min: 0 },
  totalNao: { type: Number, default: 0, min: 0 },
  quorumMinimo: { type: Number, default: 0.25, min: 0, max: 1 },
  maioriaMinima: { type: Number, default: 0.5, min: 0, max: 1 },
}, { timestamps: true, collection: 'republicaconsultas' });

republicaConsultaSchema.index({ idGrupo: 1, createdAt: -1 });
republicaConsultaSchema.index(
  { idGrupo: 1, tipo: 1 },
  { unique: true, partialFilterExpression: { status: 'aberta' } }
);
module.exports = mongoose.models.RepublicaConsulta || mongoose.model('RepublicaConsulta', republicaConsultaSchema);
