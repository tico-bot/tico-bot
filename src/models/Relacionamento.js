'use strict';

const mongoose = require('mongoose');

const relacionamentoSchema = new mongoose.Schema({
  chave: { type: String, required: true, unique: true },
  idGrupo: { type: String, required: true, index: true },
  jidA: { type: String, required: true },
  jidB: { type: String, required: true },
  participantes: {
    type: [String],
    required: true,
    validate: {
      validator: value => Array.isArray(value) && value.length === 2 && value[0] !== value[1],
      message: 'Um relacionamento precisa ter exatamente dois participantes diferentes.',
    },
  },
  tipo: { type: String, enum: ['namoro', 'casamento'], required: true },
  desde: { type: Date, required: true },
  xpCasal: { type: Number, default: 0, min: 0 },
  nomeA: { type: String, default: '' },
  nomeB: { type: String, default: '' },
}, { timestamps: true, collection: 'relacionamentos' });

// Evita que um participante tenha dois parceiros no mesmo grupo, inclusive
// quando dois pedidos são aceitos quase simultaneamente.
relacionamentoSchema.index({ idGrupo: 1, participantes: 1 }, { unique: true });
relacionamentoSchema.index({ idGrupo: 1, desde: -1 });

module.exports = mongoose.models.Relacionamento ||
  mongoose.model('Relacionamento', relacionamentoSchema);
