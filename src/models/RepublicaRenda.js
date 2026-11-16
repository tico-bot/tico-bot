'use strict';
const mongoose = require('mongoose');

const republicaRendaSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  usuarioId: { type: String, required: true },
  dia: { type: String, required: true },
  totalBruto: { type: Number, default: 0, min: 0 },
  totalSalario: { type: Number, default: 0, min: 0 },
  totalIrpf: { type: Number, default: 0, min: 0 },
  ajusteIrpfPp: { type: Number, default: 0, min: -2, max: 8 },
}, { timestamps: true, collection: 'republicarendas' });

republicaRendaSchema.index({ idGrupo: 1, usuarioId: 1, dia: 1 }, { unique: true });
republicaRendaSchema.index({ idGrupo: 1, dia: 1, usuarioId: 1 });
module.exports = mongoose.models.RepublicaRenda || mongoose.model('RepublicaRenda', republicaRendaSchema);
