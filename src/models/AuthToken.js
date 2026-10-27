'use strict';

const mongoose = require('mongoose');

const authTokenSchema = new mongoose.Schema({
  telefone:   { type: String, required: true, trim: true, index: true },
  idWhatsApp: { type: String, required: true, trim: true },
  token:      { type: String, required: true, unique: true, index: true },
  expiresAt:  { type: Date,   required: true },
  usado:      { type: Boolean, default: false },
}, { timestamps: true });

authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AuthToken
  || mongoose.model('AuthToken', authTokenSchema);
