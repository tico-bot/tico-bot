'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose      = require('mongoose');
const path          = require('path');
const Usuario       = require(path.join(__dirname, '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', 'models', 'CarteiraGrupo'));

const RESET   = '\x1b[0m';
const VERDE   = '\x1b[32m';
const AMARELO = '\x1b[33m';
const VERMELHO= '\x1b[31m';
const CYAN    = '\x1b[36m';
const BRANCO  = '\x1b[37m';

const DRY_RUN = !process.argv.includes('--executar');

function fmt(n)    { return Number(n || 0).toLocaleString('pt-BR'); }
function sep()     { console.log(`${BRANCO}${'─'.repeat(70)}${RESET}`); }
function titulo(t) { sep(); console.log(`  ${AMARELO}${t}${RESET}`); sep(); }
function ok(t)     { console.log(`  ${VERDE}✅ ${t}${RESET}`); }
function info(t)   { console.log(`  ${CYAN}ℹ️  ${t}${RESET}`); }
function warn(t)   { console.log(`  ${AMARELO}⚠️  ${t}${RESET}`); }
function erro(t)   { console.log(`  ${VERMELHO}❌ ${t}${RESET}`); }

async function main() {
  titulo(DRY_RUN
    ? '🔍  DRY-RUN — nada será alterado no banco'
    : '⚡  EXECUÇÃO REAL — alterações permanentes');

  if (DRY_RUN)
    info('Para executar de verdade: node src/scripts/migrarPetsParaGrupo.js --executar\n');

  await mongoose.connect(process.env.MONGO_URI);
  ok('MongoDB conectado\n');

  const usuarios = await Usuario.find({
    'pet.name': { $exists: true, $nin: [null, ''] }
  }).lean();

  const total = usuarios.length;

  if (total === 0) {
    ok('Nenhum pet encontrado no campo global. Nada a migrar.');
    await mongoose.disconnect();
    process.exit(0);
  }

  info(`${total} usuário(s) com pet global encontrado(s)\n`);

  let migrados = 0;
  let jaExiste = 0;
  let semGrupo = 0;
  let falhas   = 0;

  for (const u of usuarios) {
    try {
      const carteira = await CarteiraGrupo.findOne({ idWhatsApp: u.idWhatsApp })
        .sort({ xp: -1 })
        .lean();

      if (!carteira) {
        warn(`Sem grupo para ${u.idWhatsApp} — pulando.`);
        semGrupo++;
        continue;
      }

      if (carteira.pet?.name) {
        info(`${u.idWhatsApp} já tem pet no grupo ${carteira.idGrupo} — pulando.`);
        jaExiste++;
        continue;
      }

      info(`[MIGRAR] ${u.idWhatsApp} → grupo ${carteira.idGrupo} | pet: ${u.pet.name}`);

      if (!DRY_RUN) {
        await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp: u.idWhatsApp, idGrupo: carteira.idGrupo },
          { $set: { pet: u.pet } },
          { upsert: false }
        );

        await Usuario.updateOne(
          { idWhatsApp: u.idWhatsApp },
          { $unset: { pet: '' } }
        );
      }

      migrados++;
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      erro(`Erro ao migrar ${u.idWhatsApp}: ${err.message}`);
      falhas++;
    }
  }

  titulo('📊  RESUMO FINAL');
  ok(`Migrados  : ${migrados}`);
  ok(`Já existia: ${jaExiste}`);
  warn(`Sem grupo : ${semGrupo}`);
  if (falhas) erro(`Falhas    : ${falhas}`);

  if (DRY_RUN) {
    console.log(`\n  ${AMARELO}⚠️  Dry-run concluído. Nada foi alterado.${RESET}`);
    console.log(`  Para aplicar: node src/scripts/migrarPetsParaGrupo.js --executar\n`);
  } else {
    console.log(`\n  ${VERDE}✅ Migração concluída com sucesso!${RESET}\n`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  erro(`Erro fatal: ${err.message}`);
  process.exit(1);
});