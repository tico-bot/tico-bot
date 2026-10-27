'use strict';
const mongoose = require('mongoose');

const pinnedMessageSchema = new mongoose.Schema({
  // unique: true já cria o índice — index: true separado seria redundante
  chatJid:   { type: String, required: true, unique: true },
  text:      { type: String, default: '[Mídia]' },
  messageId: { type: String, required: true },
  orig:      { type: String, default: null }, // JID de quem enviou a msg
  fixadoPor: { type: String, default: null }, // JID de quem fixou
  fixadoEm:  { type: Date,   default: Date.now },
}, { timestamps: false });

module.exports = mongoose.models.PinnedMessage
  || mongoose.model('PinnedMessage', pinnedMessageSchema);