'use strict';

// ─── Handlers Principais de Combate e Personagem Medieval ────────────────────

const MedievalPersonagem = require('../../models/MedievalPersonagem');
const CarteiraGrupo      = require('../../models/CarteiraGrupo');
const GrupoConfig        = require('../../models/GrupoConfig');
const { alterarGold, formatarSaldo } = require('../../utils/carteira');

const {
  CLASSES, ELEMENTOS, MISSOES,
  sortearAleatorio, getClasse, getElemento, getArma, getArmadura,
  calcularDano, narrarCombate, xpParaNivel, verificarCooldown,
  somenteGrupo, getModoAtivo, getOuCriarPersonagem, gerarBarra,
  verificarRecuperacaoDerrota, verificarLevelUp, JANELA_SAQUE_MS,
  bloqueadoPorVinculo,
} = require('../../utils/medievalUtils');

// ── Cooldowns (ms) ────────────────────────────────────────────────────────────
const CD_ATAQUE  = 2  * 60 * 1000;
const CD_MAGIA   = 5  * 60 * 1000;
const CD_MISSAO  = 30 * 60 * 1000;
const CD_RECARGA = 10 * 60 * 1000;

// ── Regeneração passiva de HP e mana — roda a cada 1 hora ────────────────────
if (!global._medievalRegenAtivo) {
  global._medievalRegenAtivo = true;
  setInterval(async () => {
    try {
      const gruposAtivos = await GrupoConfig.find({ medievalAtivo: true }, { idGrupo: 1 }).lean();
      const idsAtivos    = gruposAtivos.map(g => g.idGrupo);
      if (!idsAtivos.length) return;

      await MedievalPersonagem.updateMany(
        {
          idGrupo: { $in: idsAtivos },
          $expr: { $or: [
            { $lt: ['$hp',   '$hpMax']   },
            { $lt: ['$mana', '$manaMax'] },
          ]},
        },
        [{ $set: {
          hp:   { $min: ['$hpMax',   { $add: ['$hp',   { $floor: { $multiply: ['$hpMax',   0.10] } }] }] },
          mana: { $min: ['$manaMax', { $add: ['$mana', { $floor: { $multiply: ['$manaMax', 0.15] } }] }] },
        }}]
      );
    } catch (err) {
      console.error('[Medieval] Erro na regeneração passiva:', err.message);
    }
  }, 60 * 60 * 1000);
}

// ─── !medieval on/off ─────────────────────────────────────────────────────────

async function handleMedievalToggle(sock, msg, jid, args, isAdmin) {
  if (!somenteGrupo(jid)) {
    return sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg });
  }
  if (!isAdmin) {
    return sock.sendMessage(jid, { text: '❌ Apenas admins podem ativar o modo medieval!' }, { quoted: msg });
  }

  try {
    const acao = (args || '').trim().toLowerCase();
    if (!['on', 'off'].includes(acao)) {
      return sock.sendMessage(jid, {
        text: '⚔️ Use *!medieval on* para ativar ou *!medieval off* para desativar.',
      }, { quoted: msg });
    }

    const ativo    = acao === 'on';
    const cfgAtual = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    const jaAtivo  = cfgAtual?.medievalAtivo === true;

    if (ativo && jaAtivo) {
      return sock.sendMessage(jid, {
        text: `⚔️ O modo medieval *já está ativo* neste grupo!\n_Use *!medieval off* para desativar._`,
      }, { quoted: msg });
    }

    if (!ativo && !jaAtivo) {
      return sock.sendMessage(jid, {
        text: `🏰 O modo medieval *já está desativado* neste grupo!\n_Use *!medieval on* para ativar._`,
      }, { quoted: msg });
    }

    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { medievalAtivo: ativo } },
      { upsert: true }
    );

    if (ativo) {
      return sock.sendMessage(jid, {
        text:
          `⚔️🏰 *MODO MEDIEVAL ATIVADO!* 🏰⚔️\n\n` +
          `🗡️ O reino desperta! Guerreiros, magos e heróis — preparem-se para a batalha!\n\n` +
          `📜 *Comandos disponíveis:*\n` +
          `▸ *!ficha* — Ver sua ficha de personagem\n` +
          `▸ *!atacar @alguém* — Atacar um inimigo\n` +
          `▸ *!magia @alguém* — Usar habilidade elemental\n` +
          `▸ *!missaomed* — Embarcar em uma missão\n` +
          `▸ *!recargamana* — Recuperar HP e mana\n` +
          `▸ *!lojamedieval* — Ver loja de armas, armaduras e poções\n` +
          `▸ *!comprar [item]* — Comprar um item\n` +
          `▸ *!equipar [item]* — Equipar arma ou armadura\n` +
          `▸ *!desequipar arma/armadura* — Remover item equipado\n` +
          `▸ *!usarpocao [nome]* — Usar poção do inventário\n` +
          `▸ *!invmed* — Ver seus itens\n` +
          `▸ *!sistemmedieval* — Como funciona o sistema\n\n` +
          `📊 *RANKING E HISTÓRICO*\n` +
          `▸ *!rankmedieval* — Ranking de guerreiros\n` +
          `▸ *!historico* — Suas últimas batalhas\n` +
          `▸ *!menumediev* — Ver todos os comandos\n\n` +
          `_Use *!ficha* para criar seu personagem!_ ⚔️`,
      }, { quoted: msg });
    } else {
      return sock.sendMessage(jid, {
        text: `🏰 *Modo Medieval desativado.*\n_Os guerreiros descansam por ora..._`,
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('⚠️ [Medieval:Toggle] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao alternar o modo medieval. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !ficha ───────────────────────────────────────────────────────────────────

async function handleFicha(sock, msg, jid, senderJid, nomeDisplay) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo! Use *!medieval on*.' }, { quoted: msg });
    }

    const p        = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    await verificarRecuperacaoDerrota(p);

    const classe   = getClasse(p.classe);
    const elemento = getElemento(p.elemento);
    const arma     = p.armaEquipada     ? getArma(p.armaEquipada)         : null;
    const armadura = p.armaduraEquipada ? getArmadura(p.armaduraEquipada) : null;

    const xpAtual   = p.xpMedieval;
    const xpProx    = xpParaNivel(p.nivel + 1);
    const barraHP   = gerarBarra(p.hp, p.hpMax);
    const barraMana = gerarBarra(p.mana, p.manaMax, '🔵');
    const isNovo    = xpAtual === 0 && p.vitorias === 0;

    await sock.sendMessage(jid, {
      text:
        `${classe?.emoji || '⚔️'} *FICHA DE PERSONAGEM* ${elemento?.emoji || ''}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Nome:* ${p.nome}\n` +
        `🏅 *Classe:* ${p.classe} ${classe?.emoji || ''}\n` +
        `✨ *Elemento:* ${p.elemento} ${elemento?.emoji || ''}\n` +
        `⭐ *Nível:* ${p.nivel}\n` +
        `📊 *XP:* ${xpAtual}/${xpProx}\n\n` +
        `❤️ *HP:* ${p.hp}/${p.hpMax}\n` +
        `${barraHP}\n` +
        `💧 *Mana:* ${p.mana}/${p.manaMax}\n` +
        `${barraMana}\n\n` +
        `⚔️ *Ataque:* ${p.ataque}${arma     ? ` (+${arma.bonusAtaque} ${arma.emoji}) = *${p.ataque + arma.bonusAtaque}*`         : ''}\n` +
        `🛡️ *Defesa:* ${p.defesa}${armadura ? ` (+${armadura.bonusDefesa} ${armadura.emoji}) = *${p.defesa + armadura.bonusDefesa}*` : ''}\n\n` +
        `🗡️ *Arma:* ${arma     ? `${arma.emoji} ${arma.nome}`         : '_Nenhuma equipada_'}\n` +
        `🛡️ *Armadura:* ${armadura ? `${armadura.emoji} ${armadura.nome}` : '_Nenhuma equipada_'}\n\n` +
        `🏆 *Vitórias:* ${p.vitorias} | 💀 *Derrotas:* ${p.derrotas}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        (isNovo
          ? `_✨ Personagem criado! Boa sorte, ${p.classe}!_\n_Use !atacar @alguém para batalhar!_`
          : `_Use !magia para habilidades especiais!_`),
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Ficha] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao carregar sua ficha. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !atacar ──────────────────────────────────────────────────────────────────

async function handleAtacar(sock, msg, jid, senderJid, nomeDisplay, targetJid) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }
    if (!targetJid || targetJid === senderJid) {
      return sock.sendMessage(jid, { text: '⚔️ Marque um inimigo para atacar!\nExemplo: *!atacar @fulano*' }, { quoted: msg });
    }

    const atacante = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    await verificarRecuperacaoDerrota(atacante);

    const { pode, tempoRestante } = verificarCooldown(atacante.ultimoAtaque, CD_ATAQUE);
    if (!pode) {
      return sock.sendMessage(jid, {
        text: `⏳ Você ainda está se recuperando do último ataque!\n_Aguarde *${tempoRestante}* para atacar novamente._`,
      }, { quoted: msg });
    }

    if (atacante.hp <= 0) {
      return sock.sendMessage(jid, {
        text: `💀 Você está caído em batalha! Use *!recargamana* para se recuperar.`,
      }, { quoted: msg });
    }

    const defensor = await MedievalPersonagem.findOne({ idWhatsApp: targetJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(targetJid, jid, (typeof sock.getName === 'function' && sock.getName(targetJid)) || targetJid.split('@')[0]);
    await verificarRecuperacaoDerrota(defensor);

    if (defensor.hp <= 0) {
      return sock.sendMessage(jid, {
        text: `💀 *${defensor.nome || targetJid.split('@')[0]}* já está derrotado!`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    const farmBloqueado =
      atacante.ultimoAlvoAtaque === targetJid &&
      atacante.quandoAtacouAlvo &&
      (Date.now() - new Date(atacante.quandoAtacouAlvo).getTime()) < CD_ATAQUE;

    if (farmBloqueado) {
      return sock.sendMessage(jid, {
        text: `⚠️ Você atacou *${defensor.nome || targetJid.split('@')[0]}* recentemente!\n_Aguarde antes de atacar o mesmo alvo novamente._`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    const { dano, critico, multElemento } = calcularDano(atacante, defensor);

    // Atualização condicional impede que dois ataques simultâneos atinjam
    // um personagem já derrotado e concedam duas recompensas de vitória.
    const defensorAtualizado = await MedievalPersonagem.findOneAndUpdate(
      { idWhatsApp: targetJid, idGrupo: jid, hp: { $gt: 0 } },
      [{ $set: { hp: { $max: [0, { $subtract: ['$hp', dano] }] } } }],
      { new: true }
    );
    if (!defensorAtualizado) {
      return sock.sendMessage(jid, {
        text: `💀 *${defensor.nome || targetJid.split('@')[0]}* já foi derrotado por outro ataque.`,
        mentions: [targetJid],
      }, { quoted: msg });
    }
    const novoHp = defensorAtualizado.hp;

    const xpGanho   = critico ? 15 : 10;
    const vitoria   = novoHp <= 0;
    const xpTotal   = vitoria ? xpGanho + 30 : xpGanho;

    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      {
        $set: {
          ultimoAtaque: new Date(),
          ultimoAlvoAtaque: targetJid,
          quandoAtacouAlvo: new Date(),
        },
        $inc: { xpMedieval: xpTotal, ...(vitoria && { vitorias: 1 }) },
      }
    );

    const narr      = narrarCombate(atacante, defensor, dano, critico);
    const multTexto = multElemento > 1
      ? '\n🔥 *Vantagem elemental!* +50% de dano!'
      : multElemento < 1
        ? '\n💧 *Desvantagem elemental.* -30% de dano.'
        : '';
    const critTexto = critico ? '\n💥 *CRÍTICO!*' : '';
    const hpTexto   = `\n\n❤️ HP de *${defensor.nome || targetJid.split('@')[0]}*: ${novoHp}/${defensor.hpMax}`;

    let textoFinal = `${narr}${multTexto}${critTexto}${hpTexto}\n+${xpGanho} XP ⭐`;

    if (vitoria) {
      textoFinal +=
        `\n\n💀 *${defensor.nome || targetJid.split('@')[0]} foi derrotado!*\n🏆 *${atacante.nome}* ganhou +30 XP de vitória!` +
        `\n\n💰 Você tem *3 minutos* para saquear os pertences dele!\n_Use *!saquear @${targetJid.split('@')[0].split(':')[0]}*._`;
    }

    await sock.sendMessage(jid, {
      text: textoFinal,
      mentions: [senderJid, targetJid],
    }, { quoted: msg });

    const entradaAtacante = { tipo: 'ataque', oponente: defensor.nome, dano, resultado: vitoria ? 'vitoria' : 'neutro', critico };
    const entradaDefensor = { tipo: 'defesa', oponente: atacante.nome, dano, resultado: vitoria ? 'derrota' : 'neutro', critico };
    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      { $push: { historicoBatalhas: { $each: [entradaAtacante], $slice: -5 } } }
    );
    await MedievalPersonagem.updateOne(
      { idWhatsApp: targetJid, idGrupo: jid },
      {
        $set:  { ...(vitoria && { derrotadoEm: new Date(), derrotadoPor: senderJid }) },
        $inc:  { ...(vitoria && { derrotas: 1 }) },
        $push: { historicoBatalhas: { $each: [entradaDefensor], $slice: -5 } },
      }
    );

    await verificarLevelUp(sock, jid, senderJid);
  } catch (err) {
    console.error('⚠️ [Medieval:Atacar] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Ocorreu um erro ao atacar. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !magia ───────────────────────────────────────────────────────────────────

async function handleMagia(sock, msg, jid, senderJid, nomeDisplay, targetJid) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }
    if (!targetJid || targetJid === senderJid) {
      return sock.sendMessage(jid, { text: '🔮 Marque um alvo para usar sua magia!\nExemplo: *!magia @fulano*' }, { quoted: msg });
    }

    const atacante = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    await verificarRecuperacaoDerrota(atacante);

    if (atacante.hp <= 0) {
      return sock.sendMessage(jid, {
        text: '💀 Você está caído em batalha! Use *!recargamana* para se recuperar antes de lançar magia.',
      }, { quoted: msg });
    }

    const { pode, tempoRestante } = verificarCooldown(atacante.ultimaMagia, CD_MAGIA);
    if (!pode) {
      return sock.sendMessage(jid, {
        text: `⏳ Sua magia ainda está se recarregando!\n_Aguarde *${tempoRestante}*._`,
      }, { quoted: msg });
    }

    const custMana = 30;
    if (atacante.mana < custMana) {
      return sock.sendMessage(jid, {
        text: `💧 Mana insuficiente! Você tem *${atacante.mana}/${atacante.manaMax}* de mana.\n_Use *!recargamana* para recuperar._`,
      }, { quoted: msg });
    }

    const defensor = await MedievalPersonagem.findOne({ idWhatsApp: targetJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(targetJid, jid, (typeof sock.getName === 'function' && sock.getName(targetJid)) || targetJid.split('@')[0]);
    await verificarRecuperacaoDerrota(defensor);
    if (defensor.hp <= 0) {
      return sock.sendMessage(jid, {
        text: `💀 *${defensor.nome || targetJid.split('@')[0]}* já está derrotado!`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    const farmBloqueado =
      atacante.ultimoAlvoMagia === targetJid &&
      atacante.quandoUsouMagiaAlvo &&
      (Date.now() - new Date(atacante.quandoUsouMagiaAlvo).getTime()) < CD_MAGIA;

    if (farmBloqueado) {
      return sock.sendMessage(jid, {
        text: `⚠️ Você usou magia em *${defensor.nome || targetJid.split('@')[0]}* recentemente!\n_Aguarde antes de atacar o mesmo alvo novamente._`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    const elemento   = getElemento(atacante.elemento);
    const habilidade = elemento?.habilidadeUltima || 'Magia Elemental';
    const { dano }   = calcularDano(atacante, defensor, true);

    // A condição hp > 0 torna a resolução da derrota segura contra ataques
    // simultâneos: apenas o primeiro golpe que zera o HP recebe a vitória.
    const defensorAtualizado = await MedievalPersonagem.findOneAndUpdate(
      { idWhatsApp: targetJid, idGrupo: jid, hp: { $gt: 0 } },
      [{ $set: { hp: { $max: [0, { $subtract: ['$hp', dano] }] } } }],
      { new: true }
    );
    if (!defensorAtualizado) {
      return sock.sendMessage(jid, {
        text: `💀 *${defensor.nome || targetJid.split('@')[0]}* já foi derrotado por outro ataque.`,
        mentions: [targetJid],
      }, { quoted: msg });
    }
    const novoHp   = defensorAtualizado.hp;
    const novaMana = atacante.mana - custMana;

    const vitoria = novoHp <= 0;
    const xpTotal = vitoria ? 20 + 40 : 20;

    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      {
        $set: {
          ultimaMagia: new Date(),
          mana: novaMana,
          ultimoAlvoMagia: targetJid,
          quandoUsouMagiaAlvo: new Date(),
        },
        $inc: { xpMedieval: xpTotal, ...(vitoria && { vitorias: 1 }) },
      }
    );

    const narr = narrarCombate(atacante, defensor, dano, false, habilidade);
    let textoFinal =
      `${elemento?.emoji || '✨'} *HABILIDADE ESPECIAL!*\n\n` +
      `${narr}\n\n` +
      `❤️ HP de *${defensor.nome || targetJid.split('@')[0]}*: ${novoHp}/${defensor.hpMax}\n` +
      `💧 Sua mana: ${novaMana}/${atacante.manaMax}\n` +
      `+20 XP ⭐`;

    if (vitoria) {
      textoFinal +=
        `\n\n💀 *${defensor.nome || targetJid.split('@')[0]} foi aniquilado pela magia!*\n🏆 +40 XP de vitória!` +
        `\n\n💰 Você tem *3 minutos* para saquear os pertences dele!\n_Use *!saquear @${targetJid.split('@')[0].split(':')[0]}*._`;
    }

    await sock.sendMessage(jid, {
      text: textoFinal,
      mentions: [senderJid, targetJid],
    }, { quoted: msg });

    const entradaAtacante = { tipo: 'magia', oponente: defensor.nome, dano, resultado: vitoria ? 'vitoria' : 'neutro', critico: false };
    const entradaDefensor = { tipo: 'defesa', oponente: atacante.nome, dano, resultado: vitoria ? 'derrota' : 'neutro', critico: false };
    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      { $push: { historicoBatalhas: { $each: [entradaAtacante], $slice: -5 } } }
    );
    await MedievalPersonagem.updateOne(
      { idWhatsApp: targetJid, idGrupo: jid },
      {
        $set:  { ...(vitoria && { derrotadoEm: new Date(), derrotadoPor: senderJid }) },
        $inc:  { ...(vitoria && { derrotas: 1 }) },
        $push: { historicoBatalhas: { $each: [entradaDefensor], $slice: -5 } },
      }
    );

    await verificarLevelUp(sock, jid, senderJid);
  } catch (err) {
    console.error('⚠️ [Medieval:Magia] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Ocorreu um erro ao lançar a magia. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !missaomed ───────────────────────────────────────────────────────────────

async function handleMissao(sock, msg, jid, senderJid, nomeDisplay) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }
    const p = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    const { pode, tempoRestante } = verificarCooldown(p.ultimaMissao, CD_MISSAO);
    if (!pode) {
      return sock.sendMessage(jid, {
        text: `⏳ Você ainda está se recuperando da última missão!\n_Próxima missão em: *${tempoRestante}*_`,
      }, { quoted: msg });
    }

    if (p.hp < 20) {
      return sock.sendMessage(jid, {
        text: `💀 Você está muito ferido para missões! HP: *${p.hp}/${p.hpMax}*\n_Use *!recargamana* para recuperar._`,
      }, { quoted: msg });
    }

    const missoesDisponiveis = MISSOES.filter(m => p.nivel >= m.nivelMinimo);
    if (!missoesDisponiveis.length) {
      return sock.sendMessage(jid, {
        text: `⚠️ Nenhuma missão disponível para o seu nível!\n_Suba de nível para desbloquear missões._`,
      }, { quoted: msg });
    }
    const missao = sortearAleatorio(missoesDisponiveis);
    if (!missao) {
      return sock.sendMessage(jid, { text: '⚠️ Nenhuma missão disponível no momento.' }, { quoted: msg });
    }

    const taxaFracasso = missao.dificuldade === 'lendário' ? 0.65
      : missao.dificuldade === 'difícil' ? 0.45
      : missao.dificuldade === 'médio'   ? 0.30
      : 0.15;
    const sucesso = Math.random() > taxaFracasso;

    await sock.sendMessage(jid, {
      text:
        `${missao.emoji} *MISSÃO: ${missao.titulo}*\n` +
        `⚠️ Dificuldade: *${missao.dificuldade.toUpperCase()}*\n\n` +
        `_${p.nome} parte em busca de glória..._\n` +
        `⏳ _Aguarde o resultado..._`,
    }, { quoted: msg });

    await new Promise(r => setTimeout(r, 1200));

    if (sucesso) {
      const xpBonus   = Math.floor(missao.xpReward   * (0.8 + Math.random() * 0.4));
      const goldBonus = Math.floor(missao.goldReward  * (0.8 + Math.random() * 0.4));

      await MedievalPersonagem.updateOne(
        { idWhatsApp: senderJid, idGrupo: jid },
        { $set: { ultimaMissao: new Date() }, $inc: { xpMedieval: xpBonus } }
      );
      const carteiraAtualizada = await alterarGold(
        senderJid,
        jid,
        goldBonus,
        `Recompensa de missão medieval: ${missao.titulo}`,
      );

      await sock.sendMessage(jid, {
        text:
          `✅ *MISSÃO CONCLUÍDA!*\n\n` +
          `${missao.emoji} *${missao.titulo}*\n\n` +
          `🏆 *${p.nome}* retornou vitorioso!\n\n` +
          `🎁 *Recompensas:*\n` +
          `⭐ +${xpBonus} XP Medieval\n` +
          `🪙 +${formatarSaldo(goldBonus, carteiraAtualizada)}\n\n` +
          `_Próxima missão disponível em 30 minutos._`,
      }, { quoted: msg });

      await verificarLevelUp(sock, jid, senderJid);
    } else {
      const danoTomado = Math.floor(Math.random() * 30) + 10;

      const antes = await MedievalPersonagem.findOneAndUpdate(
        { idWhatsApp: senderJid, idGrupo: jid },
        [{
          $set: {
            hp:           { $max: [5, { $subtract: ['$hp', danoTomado] }] },
            xpMedieval:   { $add: ['$xpMedieval', 10] },
            ultimaMissao: new Date(),
          },
        }],
        { new: false }
      );
      const novoHp   = Math.max(5, antes.hp - danoTomado);
      const danoReal = antes.hp - novoHp;

      await sock.sendMessage(jid, {
        text:
          `❌ *MISSÃO FRACASSADA!*\n\n` +
          `${missao.emoji} *${missao.titulo}*\n\n` +
          `💀 *${p.nome}* foi derrotado e recuou!\n` +
          `❤️ HP: ${novoHp}/${p.hpMax} (-${danoReal})\n` +
          `+10 XP pela tentativa ⭐\n\n` +
          `_Recupere-se e tente novamente em 30 minutos._`,
      }, { quoted: msg });

      await verificarLevelUp(sock, jid, senderJid);
    }
  } catch (err) {
    console.error('⚠️ [Medieval:Missao] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao processar a missão. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !recargamana ─────────────────────────────────────────────────────────────

async function handleRecargaMana(sock, msg, jid, senderJid, nomeDisplay) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }

    const p = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    const { pode, tempoRestante } = verificarCooldown(p.ultimaRecarga, CD_RECARGA);
    if (!pode) {
      return sock.sendMessage(jid, {
        text: `⏳ Você ainda está meditando!\n_Próxima recarga em: *${tempoRestante}*_`,
      }, { quoted: msg });
    }

    const antes = await MedievalPersonagem.findOneAndUpdate(
      { idWhatsApp: senderJid, idGrupo: jid },
      [{
        $set: {
          hp:            { $min: ['$hpMax', { $add: ['$hp', { $floor: { $multiply: ['$hpMax', 0.6] } }] }] },
          mana:          '$manaMax',
          ultimaRecarga: new Date(),
        },
      }],
      { new: false }
    );

    const hpGanhoCalc = Math.floor(antes.hpMax * 0.6);
    const novoHp       = Math.min(antes.hpMax, antes.hp + hpGanhoCalc);
    const hpGanho       = novoHp - antes.hp;
    const novaMana      = antes.manaMax;

    if (novoHp > 0 && antes.derrotadoEm) {
      await MedievalPersonagem.updateOne(
        { idWhatsApp: senderJid, idGrupo: jid },
        { $unset: { derrotadoEm: '', derrotadoPor: '' } }
      );
    }

    const hpTexto = hpGanho > 0
      ? `❤️ HP: ${novoHp}/${antes.hpMax} (+${hpGanho})`
      : `❤️ HP: ${novoHp}/${antes.hpMax} _(já estava cheio)_`;

    await sock.sendMessage(jid, {
      text:
        `🌟 *RECARGA COMPLETA!*\n\n` +
        `✨ *${p.nome}* medita e recupera suas forças!\n\n` +
        `${hpTexto}\n` +
        `💧 Mana: ${novaMana}/${antes.manaMax} _(Completa!)_\n\n` +
        `_Próxima recarga em 10 minutos._`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:RecargaMana] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao recarregar. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !historico ───────────────────────────────────────────────────────────────

async function handleHistorico(sock, msg, jid, senderJid, nomeDisplay) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }

    const p = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);

    if (!p.historicoBatalhas || p.historicoBatalhas.length === 0) {
      return sock.sendMessage(jid, {
        text: `📜 Você ainda não tem batalhas registradas!\nUse *!atacar @alguém* para começar.`,
      }, { quoted: msg });
    }

    const ICONES = { ataque: '⚔️', magia: '🔮', defesa: '🛡️' };
    const RESULT  = { vitoria: '🏆 Vitória', derrota: '💀 Derrota', neutro: '⚡ Combate' };

    const linhas = [...p.historicoBatalhas].reverse().map((b, i) => {
      const icone  = ICONES[b.tipo]  || '⚔️';
      const result = RESULT[b.resultado] || '⚡';
      const crit   = b.critico ? ' _(crítico!)_' : '';
      const data   = new Date(b.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `${i + 1}. ${icone} ${result} vs *${b.oponente}*\n   💥 ${b.dano} de dano${crit} — ${data}`;
    });

    await sock.sendMessage(jid, {
      text:
        `📜 *HISTÓRICO DE BATALHAS — ${p.nome.toUpperCase()}*\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        linhas.join('\n\n') +
        `\n\n━━━━━━━━━━━━━━━━━━━\n` +
        `_Últimas ${p.historicoBatalhas.length} batalhas registradas._`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Historico] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao carregar seu histórico. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

module.exports = {
  handleMedievalToggle,
  handleFicha,
  handleAtacar,
  handleMagia,
  handleMissao,
  handleRecargaMana,
  handleHistorico,
  getModoAtivo,
  getOuCriarPersonagem,
  somenteGrupo,
  verificarRecuperacaoDerrota,
  JANELA_SAQUE_MS,
};
