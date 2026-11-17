'use strict';
const mongoose = require('mongoose');

const candidaturaSchema = new mongoose.Schema({
  presidenteId: { type: String, required: true },
  viceId: { type: String, required: true },
  presidenteNome: { type: String, default: 'Candidato' },
  viceNome: { type: String, default: 'Candidato' },
  plano: { type: String, default: '', maxlength: 500 },
  campanha: { type: String, default: '', maxlength: 500 },
  campanhaEm: { type: Date, default: null },
  viceAceitou: { type: Boolean, default: false },
  criadaEm: { type: Date, default: Date.now },
  confirmadaEm: { type: Date, default: null },
}, { _id: false });

const republicaEleicaoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, trim: true, lowercase: true },
  codigo: { type: String, default: null, uppercase: true, trim: true },
  tipoEleicao: { type: String, enum: ['geral', 'vice'], default: 'geral', index: true },
  status: {
    type: String,
    enum: ['aberta', 'encerrada', 'sem_candidatos', 'sem_votos', 'sem_quorum', 'rejeitada', 'empate', 'cancelada'],
    default: 'aberta',
    index: true,
  },
  fase: {
    type: String,
    enum: ['candidaturas', 'campanha', 'votacao', 'segundo_turno', 'apurada', 'cancelada'],
    default: 'candidaturas',
  },
  iniciaEm: { type: Date, default: Date.now },
  faseIniciaEm: { type: Date, default: Date.now },
  faseEncerraEm: { type: Date, required: true },
  encerraEm: { type: Date, required: true },
  encerradaEm: { type: Date, default: null },
  candidaturas: { type: [candidaturaSchema], default: () => [] },
  totalEleitores: { type: Number, default: 0, min: 0 },
  eleitoresHashes: { type: [String], default: () => [] },
  quorumMinimo: { type: Number, default: 0.25, min: 0, max: 1 },
  tipoVotacao: { type: String, enum: ['chapas', 'aprovacao'], default: 'chapas' },
  rodadaAtual: { type: Number, default: 1, min: 1, max: 2 },
  resultadoPrimeiraRodada: {
    type: [{ candidatoId: { type: String, required: true }, votos: { type: Number, min: 0, required: true } }],
    default: () => [],
  },
  votosPrimeiraRodada: { type: Number, default: 0, min: 0 },
  candidaturasSegundoTurnoIds: { type: [String], default: () => [] },
  canceladaPor: { type: String, default: null },
  canceladaEm: { type: Date, default: null },
  motivoEncerramento: { type: String, default: null, maxlength: 250 },
  resultado: {
    cargo: { type: String, enum: ['presidencia', 'vice'], default: 'presidencia' },
    presidenteId: { type: String, default: null },
    viceId: { type: String, default: null },
    votos: { type: Number, default: 0 },
    votosTotais: { type: Number, default: 0 },
    primeiroTurno: {
      type: [{ candidatoId: { type: String, required: true }, votos: { type: Number, min: 0, required: true } }],
      default: () => [],
    },
    votosPrimeiroTurno: { type: Number, default: 0, min: 0 },
    quorum: { type: Number, default: 0 },
    apuracao: {
      aprovar: { type: Number, default: null },
      rejeitar: { type: Number, default: null },
    },
    segundoTurno: { type: Boolean, default: false },
    apuradoEm: { type: Date, default: null },
  },
}, { timestamps: true, collection: 'republicaeleicoes' });

republicaEleicaoSchema.index(
  { idGrupo: 1 },
  { unique: true, partialFilterExpression: { status: 'aberta' } }
);
republicaEleicaoSchema.index({ idGrupo: 1, createdAt: -1 });
republicaEleicaoSchema.index({ codigo: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.RepublicaEleicao || mongoose.model('RepublicaEleicao', republicaEleicaoSchema);
