'use strict';

/**
 * mesclar-carteiras.js
 * Mescla automaticamente TODAS as carteiras duplicadas (@s.whatsapp.net + @lid)
 * usando o LidMapping como base.
 *
 * USO:
 *   node scripts/mesclar-carteiras.js           ← dry-run (só mostra, não mexe)
 *   node scripts/mesclar-carteiras.js --executar ← executa de verdade
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose      = require('mongoose');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping    = require('../models/LidMapping');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--executar');

const RESET    = '\x1b[0m';
const VERDE    = '\x1b[32m';
const AMARELO  = '\x1b[33m';
const VERMELHO = '\x1b[31m';
const CYAN     = '\x1b[36m';
const BRANCO   = '\x1b[37m';

function fmt(n)  { return Number(n || 0).toLocaleString('pt-BR'); }
function sep()   { console.log(`${BRANCO}${'─'.repeat(70)}${RESET}`); }
function titulo(t) { sep(); console.log(`  ${AMARELO}${t}${RESET}`); sep(); }
function ok(t)   { console.log(`  ${VERDE}✅ ${t}${RESET}`); }
function info(t) { console.log(`  ${CYAN}ℹ️  ${t}${RESET}`); }
function warn(t) { console.log(`  ${AMARELO}⚠️  ${t}${RESET}`); }
function erro(t) { console.log(`  ${VERMELHO}❌ ${t}${RESET}`); }

// Gera variantes de pn brasileiro (com/sem o 9)
function gerarVariantesPn(pn) {
  const digitos = pn.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  const variantes = new Set([`${digitos}@s.whatsapp.net`]);

  if (digitos.startsWith('55') && digitos.length >= 12) {
    const ddd   = digitos.slice(2, 4);
    const resto = digitos.slice(4);
    if (resto.length === 8)
      variantes.add(`55${ddd}9${resto}@s.whatsapp.net`);
    else if (resto.length === 9 && resto.startsWith('9'))
      variantes.add(`55${ddd}${resto.slice(1)}@s.whatsapp.net`);
  }

  return [...variantes];
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  titulo(DRY_RUN
    ? '🔍  DRY-RUN — nada será alterado no banco'
    : '⚡  EXECUÇÃO REAL — alterações permanentes');

  if (DRY_RUN)
    info('Para executar de verdade: node scripts/mesclar-carteiras.js --executar\n');

  await mongoose.connect(process.env.MONGO_URI);
  ok('MongoDB conectado\n');

  // ── 1. Carrega todos os mapeamentos LID ↔ PN ─────────────────────────────
  const mappings = await LidMapping.find({}).lean();
  info(`${mappings.length} mapeamento(s) LID↔PN encontrado(s)\n`);

  let totalMesclados  = 0;
  let totalRenomeados = 0;
  let totalPulados    = 0;
  let totalErros      = 0;

  for (const map of mappings) {
    const { lid, pn } = map;
    if (!lid || !pn) { totalPulados++; continue; }

    const variantesPn = gerarVariantesPn(pn);

    try {
      // Busca todas as carteiras do @lid nesse usuário
      const carteirasLid = await CarteiraGrupo.find({ idWhatsApp: lid }).lean();

      // Busca todas as carteiras de qualquer variante @pn
      const carteirasPn = await CarteiraGrupo.find({
        idWhatsApp: { $in: variantesPn }
      }).lean();

      if (!carteirasLid.length && !carteirasPn.length) {
        totalPulados++;
        continue;
      }

      // Agrupa por idGrupo
      const porGrupo = {};

      for (const c of carteirasLid) {
        porGrupo[c.idGrupo] = porGrupo[c.idGrupo] || {};
        porGrupo[c.idGrupo].lid = c;
      }
      for (const c of carteirasPn) {
        porGrupo[c.idGrupo] = porGrupo[c.idGrupo] || {};
        porGrupo[c.idGrupo].pn = c;
      }

      for (const [idGrupo, par] of Object.entries(porGrupo)) {
        const cLid = par.lid;
        const cPn  = par.pn;

        // Caso 1: só @lid → nada a fazer
        if (cLid && !cPn) continue;

        // Caso 2: só @pn → renomeia para @lid
        if (!cLid && cPn) {
          info(`[RENOMEAR] ${cPn.idWhatsApp} → ${lid} | Grupo: ${idGrupo} | Gold: ${fmt(cPn.gold)}`);

          if (!DRY_RUN) {
            await CarteiraGrupo.updateOne(
              { _id: cPn._id },
              { $set: { idWhatsApp: lid } }
            );
          }

          totalRenomeados++;
          continue;
        }

        // Caso 3: ambas existem → mescla no @lid e deleta o @pn
        if (cLid && cPn) {
          const goldFinal      = (cLid.gold      || 0) + (cPn.gold      || 0);
          const xpFinal        = (cLid.xp        || 0) + (cPn.xp        || 0);
          const mensagensFinal = (cLid.mensagens || 0) + (cPn.mensagens || 0);
          const levelFinal     = Math.max(cLid.level || 1, cPn.level || 1);

          // Bônus diário mais recente
          const bonusLid = cLid.ultimoBonusDiario ? new Date(cLid.ultimoBonusDiario) : null;
          const bonusPn  = cPn.ultimoBonusDiario  ? new Date(cPn.ultimoBonusDiario)  : null;
          const bonusFinal = bonusLid && bonusPn
            ? (bonusLid > bonusPn ? bonusLid : bonusPn)
            : bonusLid || bonusPn;

          // Mescla goldHistory (últimos 50 ordenados por data)
          const histLid = Array.isArray(cLid.goldHistory) ? cLid.goldHistory : [];
          const histPn  = Array.isArray(cPn.goldHistory)  ? cPn.goldHistory  : [];
          const goldHistory = [...histLid, ...histPn]
            .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
            .slice(-50);

          // Campos com fallback para o @pn se @lid estiver vazio
          const nomeFinal        = cLid.nome        || cPn.nome        || '';
          const empregoFinal     = cLid.empregoAtual || cPn.empregoAtual || null;
          const varaFinal        = cLid.varaEquipada || cPn.varaEquipada || null;
          const pescaFinal       = cLid.statsPesca   || cPn.statsPesca   || null;
          const inventarioFinal  = cLid.inventory    || cPn.inventory    || {};
          const configFinal      = cLid.config       || cPn.config       || {};
          const nomeCustomFinal  = cLid.nomeCustom   || cPn.nomeCustom   || '';

          info(`[MESCLAR] ${pn} (${fmt(cPn.gold)}g) + ${lid} (${fmt(cLid.gold)}g) = ${fmt(goldFinal)}g | Grupo: ${idGrupo}`);

          if (!DRY_RUN) {
            // Atualiza @lid com dados mesclados
            await CarteiraGrupo.updateOne(
              { _id: cLid._id },
              {
                $set: {
                  gold:              goldFinal,
                  xp:                xpFinal,
                  mensagens:         mensagensFinal,
                  level:             levelFinal,
                  ultimoBonusDiario: bonusFinal,
                  goldHistory,
                  nome:              nomeFinal,
                  empregoAtual:      empregoFinal,
                  varaEquipada:      varaFinal,
                  statsPesca:        pescaFinal,
                  inventory:         inventarioFinal,
                  config:            configFinal,
                  nomeCustom:        nomeCustomFinal,
                }
              }
            );

            // Deleta a duplicata @pn
            await CarteiraGrupo.deleteOne({ _id: cPn._id });
          }

          totalMesclados++;
        }
      }

    } catch (e) {
      erro(`Erro em ${lid} / ${pn}: ${e.message}`);
      totalErros++;
    }
  }

  // ── Resumo final ──────────────────────────────────────────────────────────
  titulo('📊  RESUMO FINAL');
  ok(`Mesclados:   ${totalMesclados}`);
  ok(`Renomeados:  ${totalRenomeados}`);
  warn(`Pulados:     ${totalPulados}`);
  if (totalErros) erro(`Erros:       ${totalErros}`);

  if (DRY_RUN) {
    console.log(`\n  ${AMARELO}⚠️  Dry-run concluído. Nada foi alterado.${RESET}`);
    console.log(`  Para aplicar: node scripts/mesclar-carteiras.js --executar\n`);
  } else {
    console.log(`\n  ${VERDE}✅ Mesclagem concluída com sucesso!${RESET}\n`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  erro(`Erro inesperado: ${err.message}`);
  process.exit(1);
});