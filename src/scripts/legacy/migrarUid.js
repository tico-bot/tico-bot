// src/scripts/migrarUid.js
'use strict';

const mongoose = require('mongoose');
const path = require('path');
const Usuario = require(path.join(__dirname, '..', 'models', 'Usuario'));

async function migrarUidsExistentes() {
  const semUid = await Usuario.find({ uid: { $exists: false } });

  for (const u of semUid) {
    u.uid = new mongoose.Types.ObjectId().toHexString();
    await u.save();
  }

  console.log(`✅ ${semUid.length} usuário(s) receberam uid.`);
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/piroquinhas';
  mongoose.set('strictQuery', false);
  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado');

  await migrarUidsExistentes();

  await mongoose.disconnect();
  console.log('🔌 Desconectado. Migração finalizada.');
}

main().catch(err => {
  console.error('❌ Erro na migração:', err.message);
  process.exit(1);
});