'use strict';
const mongoose = require('mongoose');

const candidaturaSchema = new mongoose.Schema({
  presidenteId: { type: String, required: true },
  viceId: { type: String, required: true },
  presidenteNome: { type: String, default: 'Candidato' },
  viceNome: { type: String, default: 'Candidato' },
  plano: { type: String, default: '', maxlength: 500 },
  viceAceitou: { type: Boolean, default: false },
  criadaEm: { type: Date, default: Date.now },
  confirmadaEm: { type: Date, default: null },
}, { _id: false });

const republicaEleicaoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, trim: true, lowercase: true },
  status: { type: String, enum: ['aberta', 'encerrada', 'sem_candidatos', 'sem_votos'], default: 'aberta', index: true },
  iniciaEm: { type: Date, default: Date.now },
  encerraEm: { type: Date, required: true },
  candidaturas: { type: [candidaturaSchema], default: () => [] },
  rodadasDesempate: { type: Number, default: 0, min: 0, max: 1 },
  resultado: {
    presidenteId: { type: String, default: null },
    viceId: { type: String, default: null },
    votos: { type: Number, default: 0 },
    apuradoEm: { type: Date, default: null },
  },
}, { timestamps: true, collection: 'republicaeleicoes' });

republicaEleicaoSchema.index(
  { idGrupo: 1 },
  { unique: true, partialFilterExpression: { status: 'aberta' } }
);
republicaEleicaoSchema.index({ idGrupo: 1, createdAt: -1 });

module.exports = mongoose.models.RepublicaEleicao || mongoose.model('RepublicaEleicao', republicaEleicaoSchema);
