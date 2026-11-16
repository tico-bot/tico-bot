'use strict';
const mongoose = require('mongoose');

const republicaLicencaSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  usuarioId: { type: String, required: true },
  filhoId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tipo: { type: String, enum: ['maternidade', 'paternidade'], required: true },
  inicio: { type: Date, required: true },
  fim: { type: Date, required: true },
  salarioDiario: { type: Number, default: 0, min: 0 },
  ultimoPagamentoDia: { type: String, default: null },
  pagamentosRealizados: { type: Number, default: 0, min: 0, max: 2 },
  ativa: { type: Boolean, default: true, index: true },
}, { timestamps: true, collection: 'republicalicencas' });

republicaLicencaSchema.index({ idGrupo: 1, usuarioId: 1, filhoId: 1 }, { unique: true });
module.exports = mongoose.models.RepublicaLicenca || mongoose.model('RepublicaLicenca', republicaLicencaSchema);
