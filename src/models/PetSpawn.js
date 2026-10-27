'use strict';

const mongoose = require('mongoose');

const petSpawnSchema = new mongoose.Schema({
  idGrupo: {
    type:      String,
    required:  true,
    unique:    true,
    trim:      true,
    lowercase: true,
  },
  ultimoSpawn: {
    type:    Date,
    default: null,
  },
  totalSpawns: {
    type:    Number,
    default: 0,
    min:     0,
  },
  // Controla se o spawn automático está ativo neste grupo.
  // Alterado via !pet on / !pet off (somente admins).
  spawnAtivo: {
    type:    Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// ─── Statics ──────────────────────────────────────────────────────────────────
petSpawnSchema.statics.obterOuCriar = async function (idGrupo) {
  if (!idGrupo) return null;
  const grupoLimpo = String(idGrupo).trim().toLowerCase();
  return this.findOneAndUpdate(
    { idGrupo: grupoLimpo },
    { $setOnInsert: { idGrupo: grupoLimpo, spawnAtivo: true } },
    { upsert: true, new: true }
  );
};

petSpawnSchema.statics.registrarSpawn = async function (idGrupo) {
  if (!idGrupo) return null;
  const grupoLimpo = String(idGrupo).trim().toLowerCase();
  return this.findOneAndUpdate(
    { idGrupo: grupoLimpo },
    { $set: { ultimoSpawn: new Date() }, $inc: { totalSpawns: 1 } },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.models.PetSpawn || mongoose.model('PetSpawn', petSpawnSchema);