'use strict';
const mongoose = require('mongoose');

// Pacote de figurinhas salvas por grupo (!figsalvar / !figenviar).
const schema = new mongoose.Schema({
  idGrupo:    { type: String, required: true, trim: true },
  nome:       { type: String, required: true, trim: true, lowercase: true, maxlength: 20 },
  webp:       { type: Buffer, required: true },
  criadoPor:  { type: String, default: null },
}, { timestamps: true, collection: 'sticker_packs' });

schema.index({ idGrupo: 1, nome: 1 }, { unique: true });

module.exports = mongoose.models.StickerPack || mongoose.model('StickerPack', schema);
