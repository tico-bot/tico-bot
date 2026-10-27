'use strict';
const mongoose = require('mongoose');

// ─── Sequência diária + conquistas ───────────────────────────────────────────
const schema = new mongoose.Schema({
  idWhatsApp:   { type: String, required: true, unique: true, trim: true, lowercase: true },
  lastClaim:    { type: String, default: null },   // 'YYYY-MM-DD' (fuso America/Cuiaba)
  streak:       { type: Number, default: 0, min: 0 },
  best:         { type: Number, default: 0, min: 0 },
  totalClaims:  { type: Number, default: 0, min: 0 },
  achievements: { type: [String], default: [] },   // ids de conquistas já desbloqueadas
}, { timestamps: true, collection: 'daily_streaks' });

module.exports = mongoose.models.DailyStreak || mongoose.model('DailyStreak', schema);
