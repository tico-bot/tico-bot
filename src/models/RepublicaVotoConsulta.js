'use strict';
const mongoose = require('mongoose');

const republicaVotoConsultaSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  idConsulta: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  eleitorId: { type: String, required: true },
  voto: { type: String, enum: ['sim', 'nao'], required: true },
}, { timestamps: true, collection: 'republicavotosconsultas' });

republicaVotoConsultaSchema.index({ idConsulta: 1, eleitorId: 1 }, { unique: true });
module.exports = mongoose.models.RepublicaVotoConsulta || mongoose.model('RepublicaVotoConsulta', republicaVotoConsultaSchema);
