'use strict';

const mongoose = require('mongoose');

const walletMigrationSchema = new mongoose.Schema({
  jid: { type: String, required: true, index: true },
  linkedAtMs: { type: Number, required: true },
  migrationId: { type: String, required: true, unique: true },
  goldCents: { type: Number, default: 0 },
  bankCents: { type: Number, default: 0 },
  state: { type: String, enum: ['pending', 'complete'], default: 'pending' },
}, { timestamps: true, collection: 'wallet_migration_epochs' });

walletMigrationSchema.index({ jid: 1, linkedAtMs: 1 }, { unique: true });

module.exports = mongoose.models.WalletMigration
  || mongoose.model('WalletMigration', walletMigrationSchema);
