'use strict';
const mongoose = require('mongoose');

const faixaIRPFSchema = new mongoose.Schema({
  ate: { type: Number, default: null, min: 0 },
  aliquota: { type: Number, required: true, min: 0, max: 25 },
}, { _id: false });

const leiSchema = new mongoose.Schema({
  id: { type: String, required: true },
  titulo: { type: String, required: true, maxlength: 100 },
  texto: { type: String, required: true, maxlength: 1000 },
  autorId: { type: String, required: true },
  aprovadaEm: { type: Date, default: Date.now },
  ativa: { type: Boolean, default: true },
}, { _id: false });

const novoImpostoSchema = new mongoose.Schema({
  id: { type: String, required: true },
  nome: { type: String, required: true, maxlength: 50 },
  aliquota: { type: Number, required: true, min: 0, max: 20 },
  base: { type: String, required: true, maxlength: 100 },
  aprovadoEm: { type: Date, default: Date.now },
  ativo: { type: Boolean, default: true },
}, { _id: false });

const republicaEstadoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, unique: true, trim: true, lowercase: true },
  tesouro: {
    bolsaFamilia: { type: Number, default: 0, min: 0 },
    licencaParental: { type: Number, default: 0, min: 0 },
    eventos: { type: Number, default: 0, min: 0 },
    desenvolvimento: { type: Number, default: 0, min: 0 },
    reserva: { type: Number, default: 0, min: 0 },
    arrecadadoTotal: { type: Number, default: 0, min: 0 },
    gastoTotal: { type: Number, default: 0, min: 0 },
  },
  impostos: {
    // IRPF progressivo: o ajuste presidencial desloca as faixas tributáveis,
    // preservando a ordem crescente das alíquotas.
    ajusteIrpfPp: { type: Number, default: 0, min: -2, max: 8 },
    cbs: { type: Number, default: 0.9, min: 0, max: 20 },
    ibs: { type: Number, default: 0.1, min: 0, max: 20 },
    iof: { type: Number, default: 1.5, min: 0, max: 20 },
    ajustesMandato: {
      irpf: { type: Number, default: 0 },
      cbs: { type: Number, default: 0 },
      ibs: { type: Number, default: 0 },
      iof: { type: Number, default: 0 },
    },
    mandatoDoUltimoAjuste: { type: String, default: null },
    novos: { type: [novoImpostoSchema], default: () => [] },
    vigenciaDiaria: {
      dia: { type: String, default: null },
      ajusteIrpfPp: { type: Number, default: 0, min: -2, max: 8 },
      cbs: { type: Number, default: 0.9, min: 0, max: 20 },
      ibs: { type: Number, default: 0.1, min: 0, max: 20 },
      iof: { type: Number, default: 1.5, min: 0, max: 20 },
      novos: { type: [novoImpostoSchema], default: () => [] },
    },
  },
  governo: {
    presidenteId: { type: String, default: null },
    viceId: { type: String, default: null },
    presidenteNome: { type: String, default: null },
    viceNome: { type: String, default: null },
    eleitoEm: { type: Date, default: null },
    mandatoAte: { type: Date, default: null },
    numeroMandato: { type: Number, default: 0, min: 0 },
  },
  eleicaoAtualId: { type: mongoose.Schema.Types.ObjectId, default: null },
  recompensaTemporaria: {
    multiplicador: { type: Number, default: 1, min: 0.8, max: 1.2 },
    ate: { type: Date, default: null },
    mandatoId: { type: String, default: null },
    alteracoesNoMandato: { type: Number, default: 0, min: 0 },
  },
  constituicao: {
    limiteAjusteImpostoPp: { type: Number, default: 2, min: 0, max: 5 },
    quorumEmenda: { type: Number, default: 0.6, min: 0.5, max: 1 },
    maioriaEmenda: { type: Number, default: 2 / 3, min: 0.5, max: 1 },
  },
  leis: { type: [leiSchema], default: () => [] },
  atualizadoEm: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'republicaestados' });

module.exports = mongoose.models.RepublicaEstado || mongoose.model('RepublicaEstado', republicaEstadoSchema);
