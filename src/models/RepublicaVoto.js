'use strict';
const mongoose = require('mongoose');

// A cédula guarda apenas um HMAC irreversível do eleitor.
// O JID bruto nunca é armazenado junto da opção escolhida.
const republicaVotoSchema = new mongoose.Schema({
  idGrupo: { type: String, required: true, index: true },
  idEleicao: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  eleitorHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  candidatoId: { type: String, default: null },
  votoAprovacao: { type: String, enum: ['aprovar', 'rejeitar', null], default: null },
  votadoEm: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'republicavotos' });

// O índice único é criado depois da migração dos votos antigos, para
// remover o índice legado baseado em eleitorId sem bloquear a migração.
module.exports = mongoose.models.RepublicaVoto || mongoose.model('RepublicaVoto', republicaVotoSchema);
