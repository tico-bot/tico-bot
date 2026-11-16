'use strict';
const mongoose = require('mongoose');

const republicaVotoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  idEleicao: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  eleitorId: { type: String, required: true },
  candidatoId: { type: String, required: true },
  votadoEm: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'republicavotos' });

republicaVotoSchema.index({ idEleicao: 1, eleitorId: 1 }, { unique: true });
module.exports = mongoose.models.RepublicaVoto || mongoose.model('RepublicaVoto', republicaVotoSchema);
