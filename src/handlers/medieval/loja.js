'use strict';

// ─── Handlers da Loja, Inventário, Compra, Equipamentos e Troca de Itens ──────

const mongoose           = require('mongoose');
const MedievalPersonagem = require('../../models/MedievalPersonagem');
const CarteiraGrupo      = require('../../models/CarteiraGrupo');
const { getCarteira, alterarGold, formatarSaldo } = require('../../utils/carteira');

const {
  ARMAS, ARMADURAS, POCOES, getClasse, getElemento, getArma, getArmadura, getPocao,
  getModoAtivo, getOuCriarPersonagem, somenteGrupo,
  getInventarioMap, normalizarItemKey, itemKeyParaNome, bloqueadoPorVinculo,
} = require('../../utils/medievalUtils');

// ─── !lojamedieval ────────────────────────────────────────────────────────────

async function handleLojaMedieval(sock, msg, jid, senderJid, nomeDisplay, args) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }

    const [carteira, p] = await Promise.all([
      getCarteira(senderJid, jid),
      getOuCriarPersonagem(senderJid, jid, nomeDisplay),
    ]);
    const gold            = carteira?.gold || 0;
    const nivelJog        = p.nivel;
    const mostrarTodas    = typeof args === 'string' && args.trim().toLowerCase() === 'todas';
    const classeData      = getClasse(p.classe);
    const armasPermitidas = classeData?.armasPermitidas || [];
    const RARIDADE_EMOJI  = { comum: '⚪', incomum: '🟢', raro: '🔵', lendário: '🟣' };

    const armasFiltradas     = mostrarTodas ? ARMAS     : ARMAS.filter(a => nivelJog >= a.nivelMinimo && armasPermitidas.includes(a.nome));
    const armadurasFiltradas = mostrarTodas ? ARMADURAS : ARMADURAS.filter(a => nivelJog >= a.nivelMinimo);

    const armasTexto = armasFiltradas.length === 0
      ? '_Nenhuma arma disponível para o seu nível e classe._'
      : armasFiltradas.map(a => {
          const chave           = normalizarItemKey(a.nome);
          const bloqueadoNivel  = nivelJog < a.nivelMinimo;
          const bloqueadoClasse = !armasPermitidas.includes(a.nome);
          const mana            = a.bonusMana ? `\n   💧 Bônus de mana: *+${a.bonusMana}*` : '';

          let statusTag = '';
          if (mostrarTodas && bloqueadoClasse) {
            statusTag = `   ⛔ *Classe incompatível*\n`;
          } else if (mostrarTodas && bloqueadoNivel) {
            statusTag = `   🔒 Requer Nível ${a.nivelMinimo}\n`;
          }

          return (
            `${bloqueadoClasse && mostrarTodas ? '⛔' : bloqueadoNivel && mostrarTodas ? '🔒' : a.emoji} *${a.nome}*\n` +
            `📦 Preço: *${formatarSaldo(a.preco, carteira)}*\n` +
            `⚔️ Bônus de ataque: *+${a.bonusAtaque}*${mana}\n` +
            `${RARIDADE_EMOJI[a.raridade] || '⚪'} Raridade: *${a.raridade}*\n` +
            statusTag +
            `🛒 \`!comprar ${chave}\``
          );
        }).join('\n\n');

    const armadurasTexto = armadurasFiltradas.length === 0
      ? '_Nenhuma armadura disponível para o seu nível._'
      : armadurasFiltradas.map(a => {
          const chave     = normalizarItemKey(a.nome);
          const bloqueado = nivelJog < a.nivelMinimo;
          const mana      = a.bonusMana ? `\n   💧 Bônus de mana: *+${a.bonusMana}*` : '';
          const statusTag = mostrarTodas && bloqueado
            ? `   🔒 Requer Nível ${a.nivelMinimo}\n`
            : '';
          return (
            `${bloqueado && mostrarTodas ? '🔒' : a.emoji} *${a.nome}*\n` +
            `📦 Preço: *${formatarSaldo(a.preco, carteira)}*\n` +
            `🛡️ Bônus de defesa: *+${a.bonusDefesa}*${mana}\n` +
            `${RARIDADE_EMOJI[a.raridade] || '⚪'} Raridade: *${a.raridade}*\n` +
            statusTag +
            `🛒 \`!comprar ${chave}\``
          );
        }).join('\n\n');

    const pocoesTexto = POCOES.map(poc => {
      const chave  = normalizarItemKey(poc.nome);
      const tipoIc = poc.tipo === 'hp' ? '❤️' : poc.tipo === 'mana' ? '💧' : '❤️💧';
      const tipoTx = poc.tipo === 'ambos' ? 'HP e Mana' : poc.tipo.toUpperCase();
      return (
        `${poc.emoji} *${poc.nome}*\n` +
        `📦 Preço: *${formatarSaldo(poc.preco, carteira)}*\n` +
        `${tipoIc} Restaura: *+${poc.valor} ${tipoTx}*\n` +
        `${RARIDADE_EMOJI[poc.raridade] || '⚪'} Raridade: *${poc.raridade}*\n` +
        `🛒 \`!comprar ${chave}\``
      );
    }).join('\n\n');

    const rodape = mostrarTodas
      ? `_Mostrando todos os itens. Use *!lojamedieval* para ver só os do seu nível._`
      : `_Mostrando itens do Nível ${nivelJog}. Use *!lojamedieval todas* para ver tudo._`;

    await sock.sendMessage(jid, {
      text:
        `🏪 *LOJA MEDIEVAL* — Nível ${nivelJog} 🏪\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🪙 Seu saldo: *${formatarSaldo(gold, carteira)}*\n` +
        `🏅 Classe: *${p.classe}* ${classeData?.emoji || ''}\n\n` +
        `⚔️ *ARMAS DISPONÍVEIS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${armasTexto}\n\n` +
        `🛡️ *ARMADURAS DISPONÍVEIS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${armadurasTexto}\n\n` +
        `🧪 *POÇÕES*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${pocoesTexto}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        rodape,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Loja] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao carregar a loja. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !comprar ─────────────────────────────────────────────────────────────────

async function handleComprarMedieval(sock, msg, jid, senderJid, nomeDisplay, args) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    const nomeItem = itemKeyParaNome((args || '').trim());
    if (!nomeItem) {
      return sock.sendMessage(jid, { text: '🏪 Diga o nome do item!\nExemplo: *!comprar Espada* ou *!comprar Espada_Rúnica*' }, { quoted: msg });
    }

    const arma     = ARMAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const armadura = ARMADURAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const pocao    = getPocao(nomeItem);
    const item     = arma || armadura || pocao;

    if (!item) {
      return sock.sendMessage(jid, {
        text: `❌ Item *"${nomeItem}"* não encontrado na loja!\nUse *!lojamedieval* para ver os itens disponíveis.`,
      }, { quoted: msg });
    }

    const p = await getOuCriarPersonagem(senderJid, jid, nomeDisplay);

    if (item.nivelMinimo && p.nivel < item.nivelMinimo) {
      return sock.sendMessage(jid, {
        text:
          `❌ Você precisa ser *Nível ${item.nivelMinimo}* para comprar *${item.nome}*!\n` +
          `📊 Seu nível atual: *${p.nivel}*`,
      }, { quoted: msg });
    }

    if (arma) {
      const classeData = getClasse(p.classe);
      if (classeData && !classeData.armasPermitidas.includes(item.nome)) {
        return sock.sendMessage(jid, {
          text:
            `❌ *${p.classe}* não pode equipar *${item.nome}*!\n` +
            `🗡️ Armas permitidas para sua classe: *${classeData.armasPermitidas.join(', ')}*\n\n` +
            `_Você não pode comprar itens que sua classe não consegue usar._`,
        }, { quoted: msg });
      }
    }

    const chave = `inventarioMedieval.${normalizarItemKey(item.nome)}`;

    const carteira = await getCarteira(senderJid, jid);
    let carteiraAtualizada;
    if (carteira.currencyInfo) {
      let debitada;
      try {
        debitada = await alterarGold(senderJid, jid, -item.preco, `Compra medieval: ${item.nome}`);
        const personagemAtualizado = await MedievalPersonagem.updateOne(
          { idWhatsApp: senderJid, idGrupo: jid },
          { $inc: { [chave]: 1 } },
        );
        if (personagemAtualizado.matchedCount !== 1) {
          throw new Error('Personagem não encontrado para registrar o item comprado.');
        }
        carteiraAtualizada = { ...carteira, gold: debitada.gold, currencyInfo: debitada.currencyInfo };
      } catch (error) {
        if (debitada) {
          try {
            await alterarGold(senderJid, jid, item.preco, `Estorno compra medieval: ${item.nome}`);
          } catch (refundError) {
            console.error('❌ Estorno crítico de compra medieval falhou:', refundError.message);
          }
        }
        if (error instanceof RangeError) {
          return sock.sendMessage(jid, {
            text: `❌ Saldo insuficiente!\n🪙 Você tem: *${formatarSaldo(carteira.gold, carteira)}* | Necessário: *${formatarSaldo(item.preco, carteira)}*`,
          }, { quoted: msg });
        }
        throw error;
      }
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          carteiraAtualizada = await CarteiraGrupo.findOneAndUpdate(
            { idWhatsApp: senderJid, idGrupo: jid, gold: { $gte: item.preco } },
            { $inc: { gold: -item.preco } },
            { new: true, upsert: false, session },
          );
          if (!carteiraAtualizada) throw new Error('GOLD_INSUFICIENTE');
          await MedievalPersonagem.updateOne(
            { idWhatsApp: senderJid, idGrupo: jid },
            { $inc: { [chave]: 1 } },
            { session },
          );
        });
      } catch (errTx) {
        if (errTx.message === 'GOLD_INSUFICIENTE') {
          const saldoAtual = await getCarteira(senderJid, jid);
          return sock.sendMessage(jid, {
            text: `❌ Saldo insuficiente!\n🪙 Você tem: *${formatarSaldo(saldoAtual?.gold ?? 0, saldoAtual)}* | Necessário: *${formatarSaldo(item.preco, saldoAtual)}*`,
          }, { quoted: msg });
        }
        console.error('⚠️ Erro na transação de compra (medieval):', errTx.message);
        return sock.sendMessage(jid, {
          text: '⚠️ Erro ao processar a compra. Nada foi debitado.',
        }, { quoted: msg });
      } finally {
        await session.endSession();
      }
    }

    const saldoFinal = carteira.currencyInfo
      ? carteiraAtualizada.gold
      : carteiraAtualizada.gold;
    const isPocao = !!pocao;

    await sock.sendMessage(jid, {
      text:
        `✅ *COMPRA REALIZADA!*\n\n` +
        `${item.emoji} *${item.nome}* adquirido!\n` +
        `🪙 Gasto: *${formatarSaldo(item.preco, carteiraAtualizada)}*\n` +
        `🪙 Saldo restante: *${formatarSaldo(saldoFinal, carteiraAtualizada)}*\n\n` +
        (isPocao
          ? `_Use *!usarpocao ${item.nome}* para consumir!_`
          : `_Use *!equipar ${item.nome}* para equipar!_`),
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Comprar] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao processar a compra. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !equipar ─────────────────────────────────────────────────────────────────

async function handleEquipar(sock, msg, jid, senderJid, nomeDisplay, args) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    const nomeItem = itemKeyParaNome((args || '').trim());
    if (!nomeItem) {
      return sock.sendMessage(jid, { text: '🎽 Diga o nome do item!\nExemplo: *!equipar Espada* ou *!equipar Espada_Rúnica*' }, { quoted: msg });
    }

    const arma     = ARMAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const armadura = ARMADURAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const item     = arma || armadura;

    if (!item) {
      return sock.sendMessage(jid, { text: `❌ Item *"${nomeItem}"* não encontrado!` }, { quoted: msg });
    }

    const p        = await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    const chaveInv = normalizarItemKey(item.nome);
    const invMap   = getInventarioMap(p);
    const qtdInv   = invMap.get(chaveInv) || 0;

    if (qtdInv <= 0) {
      return sock.sendMessage(jid, {
        text: `❌ Você não possui *${item.nome}* no inventário!\nUse *!comprar ${item.nome}* para comprar.`,
      }, { quoted: msg });
    }

    if (item.nivelMinimo && p.nivel < item.nivelMinimo) {
      return sock.sendMessage(jid, {
        text:
          `❌ Você precisa ser *Nível ${item.nivelMinimo}* para equipar *${item.nome}*!\n` +
          `📊 Seu nível atual: *${p.nivel}*`,
      }, { quoted: msg });
    }

    if (arma) {
      const classeData = getClasse(p.classe);
      if (classeData && !classeData.armasPermitidas.includes(item.nome)) {
        return sock.sendMessage(jid, {
          text:
            `❌ *${p.classe}* não pode equipar *${item.nome}*!\n` +
            `🗡️ Armas permitidas: ${classeData.armasPermitidas.join(', ')}`,
        }, { quoted: msg });
      }
    }

    const updateFields = {};
    if (arma) {
      updateFields.armaEquipada = item.nome;
      if (item.bonusMana || p.armaEquipada) {
        const armaAnterior    = p.armaEquipada ? getArma(p.armaEquipada) : null;
        const bonusAnt        = armaAnterior?.bonusMana || 0;
        const bonusNovo       = item.bonusMana           || 0;
        const deltaMana       = bonusNovo - bonusAnt;
        const novoManaMax     = Math.max(1, p.manaMax + deltaMana);
        updateFields.manaMax  = novoManaMax;
        updateFields.mana     = Math.min(p.mana + deltaMana, novoManaMax);
      }
    } else {
      updateFields.armaduraEquipada = item.nome;
      // Ao trocar uma armadura com bônus de mana por outra sem bônus,
      // também é necessário remover o bônus anterior.
      if (item.bonusMana || p.armaduraEquipada) {
        const armaduraAnt     = p.armaduraEquipada ? ARMADURAS.find(a => a.nome === p.armaduraEquipada) : null;
        const bonusAnt        = armaduraAnt?.bonusMana || 0;
        const bonusNovo       = item.bonusMana || 0;
        const deltaMana       = bonusNovo - bonusAnt;
        const novoManaMax     = Math.max(1, p.manaMax + deltaMana);
        updateFields.manaMax  = novoManaMax;
        updateFields.mana     = Math.min(p.mana + deltaMana, novoManaMax);
      }
    }

    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      { $set: updateFields }
    );

    await sock.sendMessage(jid, {
      text:
        `✅ *${item.emoji} ${item.nome}* equipado!\n\n` +
        (arma ? `⚔️ Bônus de ataque: +${item.bonusAtaque}` : `🛡️ Bônus de defesa: +${item.bonusDefesa}`) +
        (item.bonusMana ? `\n💧 Bônus de mana: +${item.bonusMana}` : '') +
        `\n\n_Use *!ficha* para ver seus status!_`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Equipar] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao equipar o item. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !desequipar ───────────────────────────────────────────────────────────────

async function handleDesequipar(sock, msg, jid, senderJid, nomeDisplay, args) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    const tipo = (args || '').trim().toLowerCase();
    if (!['arma', 'armadura'].includes(tipo)) {
      return sock.sendMessage(jid, {
        text: '🎽 Use *!desequipar arma* ou *!desequipar armadura*',
      }, { quoted: msg });
    }

    const p = await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    const updateFields = {};

    if (tipo === 'arma') {
      if (!p.armaEquipada) {
        return sock.sendMessage(jid, { text: '❌ Você não tem nenhuma arma equipada.' }, { quoted: msg });
      }
      const armaAnt = getArma(p.armaEquipada);
      if (armaAnt?.bonusMana) {
        const novoManaMax      = Math.max(1, p.manaMax - armaAnt.bonusMana);
        updateFields.manaMax   = novoManaMax;
        updateFields.mana      = Math.min(p.mana, novoManaMax);
      }
      updateFields.armaEquipada = null;
    } else {
      if (!p.armaduraEquipada) {
        return sock.sendMessage(jid, { text: '❌ Você não tem nenhuma armadura equipada.' }, { quoted: msg });
      }
      const armaduraAnt = ARMADURAS.find(a => a.nome === p.armaduraEquipada);
      if (armaduraAnt?.bonusMana) {
        const novoManaMax      = Math.max(1, p.manaMax - armaduraAnt.bonusMana);
        updateFields.manaMax   = novoManaMax;
        updateFields.mana      = Math.min(p.mana, novoManaMax);
      }
      updateFields.armaduraEquipada = null;
    }

    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      { $set: updateFields }
    );

    await sock.sendMessage(jid, {
      text: `✅ ${tipo === 'arma' ? '⚔️ Arma' : '🛡️ Armadura'} desequipada com sucesso!\n_Use *!ficha* para ver seus status._`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Desequipar] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao desequipar. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !inventario ───────────────────────────────────────────────────────────────

async function handleInvMed(sock, msg, jid, senderJid, nomeDisplay) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    const p   = await getOuCriarPersonagem(senderJid, jid, nomeDisplay);
    const inv = getInventarioMap(p);

    if (!inv || inv.size === 0) {
      return sock.sendMessage(jid, {
        text: `🎒 Seu inventário está vazio!\nUse *!lojamedieval* para comprar itens.`,
      }, { quoted: msg });
    }

    const linhas = [];
    for (const [chave, qtd] of inv.entries()) {
      if (qtd <= 0) continue;
      const nomeReal = itemKeyParaNome(chave);
      const arma     = getArma(nomeReal);
      const armItem  = ARMADURAS.find(a => a.nome === nomeReal) || null;
      const pocao    = getPocao(nomeReal);
      const itemData = arma || armItem || pocao;
      const emoji    = itemData?.emoji || '📦';
      const equipado = p.armaEquipada === nomeReal || p.armaduraEquipada === nomeReal
        ? ' _(equipado)_' : '';
      linhas.push(`${emoji} *${nomeReal}* x${qtd}${equipado}`);
    }

    if (!linhas.length) {
      return sock.sendMessage(jid, {
        text: `🎒 Seu inventário está vazio!\nUse *!lojamedieval* para comprar itens.`,
      }, { quoted: msg });
    }

    await sock.sendMessage(jid, {
      text:
        `🎒 *INVENTÁRIO DE ${p.nome.toUpperCase()}*\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        linhas.join('\n') +
        `\n\n━━━━━━━━━━━━━━━━━━━\n` +
        `_Use *!equipar [item]* ou *!usarpocao [item]*_\n_Veja tudo com *!invmed*_`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:InvMed] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao carregar seu inventário. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !usarpocao ────────────────────────────────────────────────────────────────

async function handleUsarPocao(sock, msg, jid, senderJid, nomeDisplay, args) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    const nomePocao = itemKeyParaNome((args || '').trim());
    if (!nomePocao) {
      return sock.sendMessage(jid, {
        text: '🧪 Diga o nome da poção!\nExemplo: *!usarpocao Poção_de_Cura* ou *!usarpocao Poção de Cura*',
      }, { quoted: msg });
    }

    const pocao = getPocao(nomePocao);
    if (!pocao) {
      return sock.sendMessage(jid, { text: `❌ Poção *"${nomePocao}"* não encontrada!` }, { quoted: msg });
    }

    const chaveInv = normalizarItemKey(pocao.nome);
    const chaveMap = `inventarioMedieval.${chaveInv}`;

    const resultado = await MedievalPersonagem.findOneAndUpdate(
      {
        idWhatsApp: senderJid,
        idGrupo:    jid,
        [chaveMap]: { $gt: 0 },
      },
      { $inc: { [chaveMap]: -1 } },
      { new: false }
    );

    if (!resultado) {
      return sock.sendMessage(jid, {
        text: `❌ Você não possui *${pocao.nome}*!\nUse *!comprar ${pocao.nome}* para comprar.`,
      }, { quoted: msg });
    }

    const updateFields  = {};
    const linhasEfeito  = [];
    const invResultado = getInventarioMap(resultado);
    const qtdAntes     = invResultado.get(chaveInv) || 0;

    let hpDepois = resultado.hp;

    if (pocao.tipo === 'hp' || pocao.tipo === 'ambos') {
      const hpAntes   = resultado.hp;
      const novoHp    = Math.min(resultado.hpMax, hpAntes + pocao.valor);
      updateFields.hp = novoHp;
      hpDepois        = novoHp;
      linhasEfeito.push(`❤️ HP: ${hpAntes} → ${novoHp} (+${novoHp - hpAntes})`);
    }
    if (pocao.tipo === 'mana' || pocao.tipo === 'ambos') {
      const manaAntes   = resultado.mana;
      const novaMana    = Math.min(resultado.manaMax, manaAntes + pocao.valor);
      updateFields.mana = novaMana;
      linhasEfeito.push(`💧 Mana: ${manaAntes} → ${novaMana} (+${novaMana - manaAntes})`);
    }

    const setUpdate = { $set: updateFields };
    if (hpDepois > 0 && resultado.derrotadoEm) {
      setUpdate.$unset = { derrotadoEm: '', derrotadoPor: '' };
    }

    await MedievalPersonagem.updateOne(
      { idWhatsApp: senderJid, idGrupo: jid },
      setUpdate
    );

    await sock.sendMessage(jid, {
      text:
        `${pocao.emoji} *${pocao.nome}* usada!\n\n` +
        linhasEfeito.join('\n') +
        `\n\n_Restam: ${qtdAntes - 1}x ${pocao.nome}_`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:UsarPocao] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao usar a poção. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !sellmed ─────────────────────────────────────────────────────────────────

async function handleSellMed(sock, msg, jid, senderJid, nomeDisplay, args) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    const partes      = (args || '').trim().split(/\s+/);
    const ultimaParte = partes[partes.length - 1];
    const temQtd      = /^\d+$/.test(ultimaParte) && partes.length > 1;
    const quantidade  = temQtd ? Math.max(1, parseInt(ultimaParte, 10)) : 1;
    const nomeItem    = itemKeyParaNome((temQtd ? partes.slice(0, -1) : partes).join(' ').trim());

    if (!nomeItem) {
      return sock.sendMessage(jid, {
        text:
          `🏷️ *Como vender:*\n` +
          `▸ *!sellmed Espada* — vende 1 unidade\n` +
          `▸ *!sellmed Poção_de_Cura 3* — vende 3 unidades\n\n` +
          `_Use *!invmed* para ver seus itens._`,
      }, { quoted: msg });
    }

    const arma     = ARMAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const armadura = ARMADURAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const pocao    = POCOES.find(p => p.nome.toLowerCase() === nomeItem.toLowerCase());
    const item     = arma || armadura || pocao;

    if (!item) {
      return sock.sendMessage(jid, {
        text: `❌ Item *"${nomeItem}"* não encontrado!\n_Use *!invmed* para ver seus itens._`,
      }, { quoted: msg });
    }

    const chaveInv = normalizarItemKey(item.nome);
    const chaveMap = `inventarioMedieval.${chaveInv}`;

    const p = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);

    const invMap   = getInventarioMap(p);
    const qtdAtual = invMap.get(chaveInv) || 0;

    if (qtdAtual <= 0) {
      return sock.sendMessage(jid, {
        text: `❌ Você não possui *${item.nome}* no inventário!\n_Use *!invmed* para ver seus itens._`,
      }, { quoted: msg });
    }

    if (quantidade > qtdAtual) {
      return sock.sendMessage(jid, {
        text: `❌ Você só tem *${qtdAtual}x ${item.nome}* no inventário!`,
      }, { quoted: msg });
    }

    if (p.armaEquipada === item.nome) {
      return sock.sendMessage(jid, {
        text: `❌ *${item.nome}* está equipado!\nUse *!desequipar arma* primeiro.`,
      }, { quoted: msg });
    }
    if (p.armaduraEquipada === item.nome) {
      return sock.sendMessage(jid, {
        text: `❌ *${item.nome}* está equipado!\nUse *!desequipar armadura* primeiro.`,
      }, { quoted: msg });
    }

    const valorUnit  = Math.floor(item.preco * 0.5);
    const valorTotal = valorUnit * quantidade;

    const resultado = await MedievalPersonagem.findOneAndUpdate(
      {
        idWhatsApp: senderJid,
        idGrupo:    jid,
        [chaveMap]: { $gte: quantidade },
      },
      { $inc: { [chaveMap]: -quantidade } },
      { new: false }
    );

    if (!resultado) {
      return sock.sendMessage(jid, {
        text: `❌ Não foi possível vender *${item.nome}*.\n_Verifique seu inventário com *!invmed*._`,
      }, { quoted: msg });
    }

    let carteiraAtualizada;
    try {
      carteiraAtualizada = await alterarGold(senderJid, jid, valorTotal, `Venda medieval: ${item.nome}`);
    } catch (error) {
      const itemRestaurado = await MedievalPersonagem.updateOne(
        { idWhatsApp: senderJid, idGrupo: jid },
        { $inc: { [chaveMap]: quantidade } },
      );
      if (itemRestaurado.matchedCount !== 1) {
        console.error('❌ Falha crítica ao restaurar item após falha no crédito da venda medieval:', error.message);
      }
      throw error;
    }

    const qtdRestante = qtdAtual - quantidade;

    await sock.sendMessage(jid, {
      text:
        `💰 *VENDA REALIZADA!*\n\n` +
        `${item.emoji} *${item.nome}* x${quantidade}\n\n` +
        `🪙 Valor unitário: *${formatarSaldo(valorUnit, carteiraAtualizada)}*\n` +
        `🪙 Total recebido: *+${formatarSaldo(valorTotal, carteiraAtualizada)}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        (qtdRestante > 0
          ? `_Restam *${qtdRestante}x ${item.nome}* no inventário._`
          : `_Você não tem mais *${item.nome}* no inventário._`),
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:SellMed] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao vender o item. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !givemed ─────────────────────────────────────────────────────────────────

async function handleGiveMed(sock, msg, jid, senderJid, nomeDisplay, targetJid, args) {
  if (!somenteGrupo(jid)) return;
  if (!await getModoAtivo(jid)) return;

  try {
    if (!targetJid) {
      return sock.sendMessage(jid, {
        text: '🎁 Marque quem vai receber o item!\nExemplo: *!givemed @fulano Espada* ou *!givemed @fulano Poção_de_Cura 3*',
      }, { quoted: msg });
    }
    if (targetJid === senderJid) {
      return sock.sendMessage(jid, { text: '😂 Você não pode enviar um item para si mesmo!' }, { quoted: msg });
    }

    const partes      = (args || '').trim().split(/\s+/).filter(Boolean);
    const ultimaParte = partes[partes.length - 1];
    const temQtd      = /^\d+$/.test(ultimaParte) && partes.length > 1;
    const quantidade  = temQtd ? Math.max(1, parseInt(ultimaParte, 10)) : 1;
    const nomeItem    = itemKeyParaNome((temQtd ? partes.slice(0, -1) : partes).join(' ').trim());

    if (!nomeItem) {
      return sock.sendMessage(jid, {
        text:
          `🎁 *Como enviar um item:*\n` +
          `▸ *!givemed @pessoa Espada* — envia 1 unidade\n` +
          `▸ *!givemed @pessoa Poção_de_Cura 3* — envia 3 unidades\n\n` +
          `_Use *!invmed* para ver seus itens._`,
      }, { quoted: msg });
    }

    const arma     = ARMAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const armadura = ARMADURAS.find(a => a.nome.toLowerCase() === nomeItem.toLowerCase());
    const pocao    = POCOES.find(p => p.nome.toLowerCase() === nomeItem.toLowerCase());
    const item     = arma || armadura || pocao;

    if (!item) {
      return sock.sendMessage(jid, {
        text: `❌ Item *"${nomeItem}"* não encontrado!\n_Use *!invmed* para ver seus itens._`,
      }, { quoted: msg });
    }

    const chaveInv = normalizarItemKey(item.nome);
    const chaveMap = `inventarioMedieval.${chaveInv}`;

    const p = await MedievalPersonagem.findOne({ idWhatsApp: senderJid, idGrupo: jid })
      ?? await getOuCriarPersonagem(senderJid, jid, nomeDisplay);

    const invMap   = getInventarioMap(p);
    const qtdAtual = invMap.get(chaveInv) || 0;

    if (qtdAtual <= 0) {
      return sock.sendMessage(jid, {
        text: `❌ Você não possui *${item.nome}* no inventário!\n_Use *!invmed* para ver seus itens._`,
      }, { quoted: msg });
    }
    if (quantidade > qtdAtual) {
      return sock.sendMessage(jid, {
        text: `❌ Você só tem *${qtdAtual}x ${item.nome}* no inventário!`,
      }, { quoted: msg });
    }

    if (p.armaEquipada === item.nome) {
      return sock.sendMessage(jid, {
        text: `❌ *${item.nome}* está equipado!\nUse *!desequipar arma* primeiro.`,
      }, { quoted: msg });
    }
    if (p.armaduraEquipada === item.nome) {
      return sock.sendMessage(jid, {
        text: `❌ *${item.nome}* está equipado!\nUse *!desequipar armadura* primeiro.`,
      }, { quoted: msg });
    }

    await getOuCriarPersonagem(targetJid, jid, (typeof sock.getName === 'function' && sock.getName(targetJid)) || targetJid.split('@')[0]);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const resultado = await MedievalPersonagem.findOneAndUpdate(
          { idWhatsApp: senderJid, idGrupo: jid, [chaveMap]: { $gte: quantidade } },
          { $inc: { [chaveMap]: -quantidade } },
          { new: false, session }
        );
        if (!resultado) {
          throw new Error('ESTOQUE_INSUFICIENTE');
        }
        await MedievalPersonagem.updateOne(
          { idWhatsApp: targetJid, idGrupo: jid },
          { $inc: { [chaveMap]: quantidade } },
          { session }
        );
      });
    } catch (errTx) {
      await session.endSession();
      if (errTx.message === 'ESTOQUE_INSUFICIENTE') {
        return sock.sendMessage(jid, {
          text: `❌ Não foi possível enviar *${item.nome}*.\n_Verifique seu inventário com *!invmed*._`,
        }, { quoted: msg });
      }
      console.error('⚠️ Erro na transação de givemed:', errTx.message);
      return sock.sendMessage(jid, {
        text: `⚠️ Erro ao enviar o item. Nada foi transferido.`,
      }, { quoted: msg });
    }
    await session.endSession();

    const qtdRestante = qtdAtual - quantidade;

    await sock.sendMessage(jid, {
      text:
        `🎁 *ITEM ENVIADO!*\n\n` +
        `${item.emoji} *${item.nome}* x${quantidade}\n` +
        `👤 Para: *@${targetJid.split('@')[0]}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        (qtdRestante > 0
          ? `_Restam *${qtdRestante}x ${item.nome}* no seu inventário._`
          : `_Você não tem mais *${item.nome}* no inventário._`),
      mentions: [senderJid, targetJid],
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:GiveMed] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao enviar o item. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !rankmedieval ────────────────────────────────────────────────────────────

async function handleRankMedieval(sock, msg, jid) {
  if (!somenteGrupo(jid)) return;
  try {
    if (!await getModoAtivo(jid)) {
      return sock.sendMessage(jid, { text: '⚔️ O modo medieval não está ativo!' }, { quoted: msg });
    }

    const personagens = await MedievalPersonagem.find({ idGrupo: jid })
      .sort({ vitorias: -1, nivel: -1 })
      .limit(10)
      .lean();

    if (!personagens.length) {
      return sock.sendMessage(jid, {
        text: '⚔️ Nenhum guerreiro registrado ainda!\nUse *!ficha* para criar seu personagem.',
      }, { quoted: msg });
    }

    const MEDALHAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const linhas   = personagens.map((p, i) => {
      const classe    = getClasse(p.classe);
      const elemento  = getElemento(p.elemento);
      const nomeRaw   = (p.nome || '').trim();
      const nomeExib  = nomeRaw && nomeRaw !== '.' ? nomeRaw : `Guerreiro #${i + 1}`;
      const vitorias  = p.vitorias ?? 0;
      const derrotas  = p.derrotas ?? 0;
      const total     = vitorias + derrotas;
      const winrate   = total > 0 ? Math.round((vitorias / total) * 100) : 0;
      return (
        `${MEDALHAS[i]} *${nomeExib}*\n` +
        `   ${classe?.emoji || '⚔️'} ${p.classe || '?'} • ${elemento?.emoji || '✨'} ${p.elemento || '?'} • ⭐ Nível ${p.nivel}\n` +
        `   🏆 ${vitorias}V / ${derrotas}D • Taxa: ${winrate}%`
      );
    }).join('\n\n');

    await sock.sendMessage(jid, {
      text:
        `⚔️ *RANKING MEDIEVAL* ⚔️\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `${linhas}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `_Use *!ficha* para ver sua posição!_`,
    }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Rank] Erro:', err.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao carregar o ranking. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !menumediev ───────────────────────────────────────────────────────────────

async function handleMenuMedieval(sock, msg, jid, getPrefix) {
  try {
    const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
    const menu =
`╔══════════════════════╗
      🏰 MENU MEDIEVAL
╚══════════════════════╝

👤 *PERSONAGEM*
  ▸ ${P}ficha — Ver sua ficha de herói
  ▸ ${P}recargamana — Recuperar HP e mana (10min)

⚔️ *COMBATE*
  ▸ ${P}atacar @alguém — Atacar com arma (2min)
  ▸ ${P}magia @alguém — Habilidade elemental (5min)
  ▸ ${P}saquear @alguém — Levar pertences de inimigos derrotados

🗺️ *AVENTURA*
  ▸ ${P}missaomed — Embarcar em missão (30min)

🏪 *LOJA & ITENS*
  ▸ ${P}lojamedieval — Ver loja de armas, armaduras e poções
  ▸ ${P}comprar _(item)_ — Comprar um item
  ▸ ${P}equipar _(item)_ — Equipar arma ou armadura
  ▸ ${P}desequipar _(arma/armadura)_ — Remover item equipado
  ▸ ${P}usarpocao _(nome)_ — Usar poção do inventário
  ▸ ${P}invmed — Ver seus itens
  ▸ ${P}sellmed _(item)_ — Vender item
  ▸ ${P}givemed @alguém _(item)_ — Entregar item a alguém
  ▸ ${P}sistemmedieval — Como funciona o sistema

📊 *RANKING & HISTÓRICO*
  ▸ ${P}rankmedieval — Ranking de guerreiros
  ▸ ${P}historico — Suas últimas batalhas

⚙️ *ADMIN*
  ▸ ${P}medieval on/off — Ativar/desativar modo

━━━━━━━━━━━━━━━━━━━━━━━━
🔥 *Elementos:* Fogo 💧 Água 🌍 Terra 🌪️ Ar ⚡ Trovão 🌑 Sombra ✨ Luz 🖤 Magia Negra
_Cada elemento tem vantagens e fraquezas!_`;

    await sock.sendMessage(jid, { text: menu }, { quoted: msg });
  } catch (err) {
    console.error('⚠️ [Medieval:Menu] Erro:', err.message);
  }
}

module.exports = {
  handleLojaMedieval,
  handleComprarMedieval,
  handleEquipar,
  handleDesequipar,
  handleInvMed,
  handleUsarPocao,
  handleSellMed,
  handleGiveMed,
  handleRankMedieval,
  handleMenuMedieval,
};
