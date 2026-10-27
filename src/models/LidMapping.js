'use strict';

const mongoose = require('mongoose');

// Guarda o par LID ↔ telefone (PN) que o Baileys entrega em msg.key.participantPn
// toda vez que alguém manda mensagem em grupo. Sem essa tabela, não tem como
// o painel admin (ou qualquer rota da API) resolver um número de telefone
// digitado manualmente para o JID @lid real usado nas carteiras.
const lidMappingSchema = new mongoose.Schema({
  lid: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  pn:  { type: String, required: true, index: true,  lowercase: true, trim: true },
}, { timestamps: true });

module.exports = mongoose.models.LidMapping || mongoose.model('LidMapping', lidMappingSchema);