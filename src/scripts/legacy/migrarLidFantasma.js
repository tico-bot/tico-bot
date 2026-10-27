'use strict';

const mongoose = require('mongoose');
const path = require('path');
const Usuario = require(path.join(__dirname, '..', 'models', 'Usuario'));

/**
 * Corrige registros de Usuario cujo idWhatsApp foi salvo erroneamente
 * como "{digitosDoLid}@s.whatsapp.net" em vez de "{digitosDoLid}@lid".
 *
 * Diferente da migração de CarteiraGrupo (que é por grupo), Usuario é
 * GLOBAL — então aqui verificamos contra TODOS os grupos em que o bot
 * está, unindo os participantes de cada um.
 *
 * Uso: chamar migrarLidFantasmaUsuario(sock) depois que o bot conectar.
 */
async function migrarLidFantasmaUsuario(sock) {
  // ── Monta o conjunto de todos os JIDs @lid conhecidos, em todos os grupos ──
  let grupos;
  try {
    grupos = await sock.groupFetchAllParticipating();
  } catch (e) {
    console.log(`⚠️ Não foi possível listar os grupos: ${e.message}`);
    return;
  }

  const lidsConhecidos = new Set();
  for (const idGrupo of Object.keys(grupos)) {
    const participants = grupos[idGrupo]?.participants || [];
    for (const p of participants) {
      const id = p.id?.toLowerCase();
      if (id?.endsWith('@lid')) lidsConhecidos.add(id);
    }
  }

  console.log(`ℹ️ ${lidsConhecidos.size} JID(s) @lid conhecidos encontrados em ${Object.keys(grupos).length} grupo(s).`);

  // ── Busca registros fantasma: "{digitos}@s.whatsapp.net" cujo
  // "{digitos}@lid" está em lidsConhecidos ──
  const registros = await Usuario.find({
    idWhatsApp: { $regex: /@s\.whatsapp\.net$/ },
  }).lean();

  let totalCorrigidos = 0;

  for (const reg of registros) {
    const digitos     = reg.idWhatsApp.split('@')[0];
    const possivelLid = `${digitos}@lid`;

    if (!lidsConhecidos.has(possivelLid)) continue;

    const existente = await Usuario.findOne({ idWhatsApp: possivelLid }).lean();

    if (existente) {
      // Já existe registro real com esse @lid — mescla os campos numéricos
      // e remove o fantasma
      await Usuario.updateOne(
        { _id: existente._id },
        {
          $inc: {
            xp:        reg.xp ?? 0,
            mensagens: reg.mensagens ?? 0,
            gold:      reg.gold ?? 0,
            xpCasal:   reg.xpCasal ?? 0,
          },
        }
      );
      await Usuario.deleteOne({ _id: reg._id });
      console.log(`🔁 Mesclado fantasma ${reg.idWhatsApp} → ${possivelLid}`);
    } else {
      // Não existe ainda — apenas renomeia
      await Usuario.updateOne(
        { _id: reg._id },
        { $set: { idWhatsApp: possivelLid } }
      );
      console.log(`✏️  Renomeado ${reg.idWhatsApp} → ${possivelLid}`);
    }

    totalCorrigidos++;
  }

  console.log(`\n✅ Migração de Usuario concluída. ${totalCorrigidos} registro(s) corrigido(s).`);
}

module.exports = { migrarLidFantasmaUsuario };