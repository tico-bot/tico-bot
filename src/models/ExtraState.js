'use strict';
const mongoose = require('mongoose');

// Pequeno key-value persistente (ex.: "último dia em que os parabéns foram enviados"),
// para que os agendadores não repitam mensagens após um restart do Render.
const schema = new mongoose.Schema({
  _id:   { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: 'extra_state' });

module.exports = mongoose.models.ExtraState || mongoose.model('ExtraState', schema);
