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
  // Personagem selvagem ativo, compartilhado entre instâncias do bot.
  personagemAtivo: {
    type: new mongoose.Schema({
      type: { type: String, default: null },
      rarity: { type: String, default: null },
      spawnedAt: { type: Number, default: null },
    }, { _id: false }),
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
    default: false,
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
    { $setOnInsert: { idGrupo: grupoLimpo, spawnAtivo: false } },
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

// A cada inicialização real do bot, a opção automática deve voltar para OFF
// em todos os grupos, inclusive os que foram ativados manualmente antes.
petSpawnSchema.statics.desativarTodosNoBoot = async function () {
  return this.updateMany({}, { $set: { spawnAtivo: false } });
};

module.exports = mongoose.models.PetSpawn || mongoose.model('PetSpawn', petSpawnSchema);