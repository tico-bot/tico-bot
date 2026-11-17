'use strict';

const mongoose = require('mongoose');

const adocaoSolicitacaoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true, trim: true, lowercase: true },
  codigo: { type: String, required: true, unique: true, uppercase: true, trim: true },
  solicitanteId: { type: String, required: true, index: true },
  parceiroId: { type: String, required: true, index: true },
  chaveCasal: { type: String, required: true, index: true },
  nome: { type: String, required: true, trim: true, maxlength: 20 },
  sexo: { type: String, enum: ['menino', 'menina'], required: true },
  personalidade: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['pendente', 'processando', 'aceita', 'recusada', 'cancelada', 'expirada'],
    default: 'pendente',
    index: true,
  },
  expiresAt: { type: Date, required: true, index: true },
  processamentoEm: { type: Date, default: null },
  aceitaEm: { type: Date, default: null },
  filhoId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true, collection: 'adocaosolicitacoes' });

adocaoSolicitacaoSchema.index({ idGrupo: 1, solicitanteId: 1, parceiroId: 1, status: 1 });
adocaoSolicitacaoSchema.index(
  { idGrupo: 1, chaveCasal: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pendente', 'processando'] } } }
);
adocaoSolicitacaoSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.models.AdocaoSolicitacao ||
  mongoose.model('AdocaoSolicitacao', adocaoSolicitacaoSchema);
