'use strict';

/**
 * Script: atribuir XP/level aleatório (10-25) para CarteirasGrupo com xp = 0
 * Uso: node src/scripts/atribuirXpAleatorio.js
 */

require('dotenv').config();
const dns      = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose      = require('mongoose');
const CarteiraGrupo = require('../models/CarteiraGrupo');

function xpParaLevel(level) {
  const lvl = Math.max(1, Math.floor(level));
  return Math.floor(80 * Math.pow(lvl - 1, 1.4));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI não definida!');

  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado\n');

  // Busca apenas carteiras com xp = 0 ou sem xp
  const carteiras = await CarteiraGrupo
    .find({ $or: [{ xp: 0 }, { xp: { $exists: false } }] })
    .select('_id idWhatsApp idGrupo xp level')
    .lean();

  console.log(`📋 Total de carteiras com xp = 0: ${carteiras.length}\n`);

  if (carteiras.length === 0) {
    console.log('Nenhuma carteira para atualizar.');
    await mongoose.disconnect();
    return;
  }

  let atualizadas = 0;
  let erros       = 0;

  for (const c of carteiras) {
    try {
      const levelAleatorio = randInt(10, 25);
      const xpBase         = xpParaLevel(levelAleatorio);

      // Adiciona um XP extra aleatório dentro da faixa do level
      // para não deixar todo mundo exatamente no início do level
      const xpProximo = xpParaLevel(levelAleatorio + 1);
      const xpExtra   = randInt(0, xpProximo - xpBase - 1);
      const xpFinal   = xpBase + xpExtra;

      await CarteiraGrupo.updateOne(
        { _id: c._id },
        { $set: { xp: xpFinal, level: levelAleatorio } }
      );

      console.log(`✅ ${c.idWhatsApp} | grupo: ${c.idGrupo} → level ${levelAleatorio} | xp ${xpFinal}`);
      atualizadas++;

    } catch (err) {
      console.error(`❌ Erro em ${c.idWhatsApp}:`, err.message);
      erros++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━`);
  console.log(`✅ Atualizadas: ${atualizadas}`);
  console.log(`❌ Erros:       ${erros}`);
  console.log(`━━━━━━━━━━━━━━━━`);

  await mongoose.disconnect();
  console.log('\n🔌 MongoDB desconectado. Script finalizado.');
}

main().catch(err => {
  console.error('❌ Erro crítico:', err);
  process.exit(1);
});