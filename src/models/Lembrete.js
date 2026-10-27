'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  idWhatsApp: { type: String, required: true, trim: true },   // quem criou
  idChat:     { type: String, required: true, trim: true },   // onde avisar (grupo ou privado)
  texto:      { type: String, required: true, trim: true, maxlength: 300 },
  quando:     { type: Date,   required: true },
  enviado:    { type: Boolean, default: false },
  tentativas: { type: Number,  default: 0 },
}, { timestamps: true, collection: 'lembretes' });

schema.index({ enviado: 1, quando: 1 });
schema.index({ idWhatsApp: 1, enviado: 1 });

module.exports = mongoose.models.Lembrete || mongoose.model('Lembrete', schema);
