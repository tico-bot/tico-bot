'use strict';

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Usuario = require(path.join(__dirname, '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', 'models', 'CarteiraGrupo'));

async function backup() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/piroquinhas';
  mongoose.set('strictQuery', false);
  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado');

  const pastaSaida = path.join(__dirname, '..', '..', 'backup_antes_migracao');
  if (!fs.existsSync(pastaSaida)) fs.mkdirSync(pastaSaida, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const usuarios = await Usuario.find({}).lean();
  const usuariosPath = path.join(pastaSaida, `usuarios_${timestamp}.json`);
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));
  console.log(`📦 Usuario: ${usuarios.length} documento(s) → ${usuariosPath}`);

  const carteiras = await CarteiraGrupo.find({}).lean();
  const carteirasPath = path.join(pastaSaida, `carteiraGrupo_${timestamp}.json`);
  fs.writeFileSync(carteirasPath, JSON.stringify(carteiras, null, 2));
  console.log(`📦 CarteiraGrupo: ${carteiras.length} documento(s) → ${carteirasPath}`);

  await mongoose.disconnect();
  console.log('\n✅ Backup concluído.');
}

backup().catch(err => {
  console.error('❌ Erro no backup:', err);
  process.exit(1);
});