'use strict';
const mongoose = require('mongoose');

const dependenteSchema = new mongoose.Schema({
  filhoId: { type: mongoose.Schema.Types.ObjectId, required: true },
  nome: { type: String, default: 'Dependente' },
  idade: { type: Number, default: 0, min: 0 },
}, { _id: false });

const republicaBeneficioSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  householdKey: { type: String, required: true },
  titularId: { type: String, required: true },
  adultos: { type: [String], default: () => [] },
  dependentes: { type: [dependenteSchema], default: () => [] },
  ativo: { type: Boolean, default: true, index: true },
  solicitadoEm: { type: Date, default: Date.now },
  ultimoPagamentoDia: { type: String, default: null },
  protecaoAte: { type: String, default: null },
  motivoSuspensao: { type: String, default: null },
}, { timestamps: true, collection: 'republicabeneficios' });

republicaBeneficioSchema.index({ idGrupo: 1, householdKey: 1 }, { unique: true });
republicaBeneficioSchema.index({ idGrupo: 1, ativo: 1 });
module.exports = mongoose.models.RepublicaBeneficio || mongoose.model('RepublicaBeneficio', republicaBeneficioSchema);
