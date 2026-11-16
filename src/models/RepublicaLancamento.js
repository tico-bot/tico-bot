'use strict';
const mongoose = require('mongoose');

const republicaLancamentoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  requestId: { type: String, required: true },
  tipo: { type: String, enum: ['arrecadacao', 'despesa', 'beneficio', 'licenca', 'estorno'], required: true },
  fundo: { type: String, enum: ['bolsa_familia', 'licenca_parental', 'eventos', 'desenvolvimento', 'reserva', 'misto'], required: true },
  categoria: { type: String, required: true, maxlength: 80 },
  valor: { type: Number, required: true, min: 0 },
  origem: { type: String, default: null, maxlength: 120 },
  usuarioId: { type: String, default: null },
  responsavelId: { type: String, default: null },
  observacao: { type: String, default: '', maxlength: 500 },
}, { timestamps: true, collection: 'republicalancamentos' });

republicaLancamentoSchema.index({ idGrupo: 1, requestId: 1 }, { unique: true });
republicaLancamentoSchema.index({ idGrupo: 1, createdAt: -1 });

module.exports = mongoose.models.RepublicaLancamento || mongoose.model('RepublicaLancamento', republicaLancamentoSchema);
