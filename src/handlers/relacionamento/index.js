/**
 * Handler de Relacionamentos — Tico Bot
 * Comandos: !casar, !namorar, !euaceito, !eurecuso, !cancelarpedido,
 *           !cancelarcasamento, !terminar, !flores, !doces, !carta,
 *           !mimo, !beijo, !rankcasais, !fixar, !pinned, !desfixar,
 *           !abraco, !presente, !jantar, !cinema, !viajar,
 *           !declarar, !ciumento, !statu, !aniversario_casal,
 *           !meupar, !xpdobro, !serenata, !duelodecasais, !surpresa
 */

const path = require('path');
const fs   = require('fs');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const Usuario     = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CasalEstado = require(path.join(__dirname, '..', '..', 'models', 'CasalEstado'));
const { getGroupPrefix } = require(path.join(__dirname, '..', '..', 'utils', 'prefixos'));

// ═══════════════════════════════════════════════════════════════
// ─── ESTADO GLOBAL ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function relKey(jid, a, b) { return [jid, ...[a, b].sort()].join('|'); }

const xpCasais      = new Map(); // relKey → number
const bloqueados    = new Map(); // jid → timestamp_expiry
const diariosUsados = new Map(); // `${relKey}:${cmd}:YYYY-MM-DD` → true
const ciumentosMap  = new Map(); // jid → timestamp (cooldown de 1h)
const xpBonus       = new Map(); // relKey → { ativo: bool, expiry: number }

// ═══════════════════════════════════════════════════════════════
// ─── HELPERS ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const FUSO = 'America/Cuiaba';

/** Número puro de um JID (sem sufixo de dispositivo nem domínio). */
function numeroDe(jid) {
  return String(jid || '').split(':')[0].split('@')[0];
}

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília, independente do fuso do servidor. */
function hoje() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
  } catch {
    // Fallback se o Node estiver sem suporte a fuso: UTC-3 fixo (o Brasil não usa horário de verão).
    return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

// ─── Limpeza periódica de memória ─────────────────────────────
function limparDiariosAntigos() {
  const hojeStr = hoje();
  let removidos = 0;
  for (const chave of diariosUsados.keys()) {
    const dataNaChave = chave.slice(-10);
    if (dataNaChave !== hojeStr) {
      diariosUsados.delete(chave);
      removidos++;
    }
  }
  if (removidos > 0) {
    console.log(`🧹 [relacionamento] ${removidos} entrada(s) antiga(s) removida(s) de diariosUsados.`);
  }
}

function limparExpirados() {
  let removidos = 0;

  for (const [key, bonus] of xpBonus.entries()) {
    if (!bonus.ativo || Date.now() > bonus.expiry) {
      xpBonus.delete(key);
      removidos++;
    }
  }

  for (const [jid, expiry] of ciumentosMap.entries()) {
    if (Date.now() > expiry) {
      ciumentosMap.delete(jid);
      removidos++;
    }
  }

  for (const [jid, expiry] of bloqueados.entries()) {
    if (Date.now() > expiry) {
      bloqueados.delete(jid);
      removidos++;
    }
  }

  if (removidos > 0) {
    console.log(`🧹 [relacionamento] ${removidos} entrada(s) expirada(s) removida(s).`);
  }
}

setInterval(limparDiariosAntigos, 60 * 60 * 1000);
setInterval(limparExpirados, 15 * 60 * 1000);

function isBloqueado(jid) {
  const norm = jidNormalizedUser(jid);
  if (!bloqueados.has(norm)) return false;
  if (Date.now() > bloqueados.get(norm)) { bloqueados.delete(norm); return false; }
  return true;
}

function minutosRestantes(jid) {
  const norm = jidNormalizedUser(jid);
  if (!bloqueados.has(norm)) return 0;
  return Math.ceil((bloqueados.get(norm) - Date.now()) / (1000 * 60));
}

function getRelacionamento(jid, a, b, relacionamentos) {
  return relacionamentos.get(relKey(jid, jidNormalizedUser(a), jidNormalizedUser(b))) || null;
}

async function syncCasamentoToDb(jidA, jidB, tipo = 'casamento', desde = Date.now(), idGrupo = null) {
  const normA = jidNormalizedUser(jidA);
  const normB = jidNormalizedUser(jidB);
  try {
    await Promise.all([
      Usuario.findOneAndUpdate(
        { idWhatsApp: normA },
        { $set: { casadoCom: normB, casadoTipo: tipo, casadoDesde: desde, casadoGrupo: idGrupo, idWhatsApp: normA } },
        { upsert: true, new: true }
      ),
      Usuario.findOneAndUpdate(
        { idWhatsApp: normB },
        { $set: { casadoCom: normA, casadoTipo: tipo, casadoDesde: desde, casadoGrupo: idGrupo, idWhatsApp: normB } },
        { upsert: true, new: true }
      ),
    ]);
  } catch (e) {
    console.error('⚠️ Erro ao sincronizar casamento no MongoDB:', e.message);
  }
}

async function clearCasamentoDb(jidA, jidB) {
  const normA = jidNormalizedUser(jidA);
  const normB = jidNormalizedUser(jidB);
  const limpar = { $set: { casadoCom: null, casadoTipo: null, casadoDesde: null, casadoGrupo: null, xpCasal: 0 } };
  try {
    await Promise.all([
      Usuario.updateOne({ idWhatsApp: normA }, limpar),
      Usuario.updateOne({ idWhatsApp: normB }, limpar),
    ]);
  } catch (e) {
    console.error('⚠️ Erro ao limpar casamento no MongoDB:', e.message);
  }
}

function findRelByJid(jid, userJid, relacionamentos) {
  const num = numeroDe(userJid);
  if (!num) return null;
  for (const [key, rel] of relacionamentos) {
    if (!key.startsWith(jid + '|')) continue;
    const [, a, b] = key.split('|'); // chave = grupo|jidA|jidB
    if (numeroDe(a) === num || numeroDe(b) === num) return { key, rel };
  }
  return null;
}

function temXpBonus(key) {
  if (!xpBonus.has(key)) return false;
  const b = xpBonus.get(key);
  if (!b.ativo || Date.now() > b.expiry) { xpBonus.delete(key); return false; }
  return true;
}

function formatarTempo(ms) {
  const dias   = Math.floor(ms / (1000 * 60 * 60 * 24));
  const horas  = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins   = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (dias > 0)  return `${dias} dia(s) e ${horas}h`;
  if (horas > 0) return `${horas}h e ${mins}min`;
  return `${mins} minuto(s)`;
}

/** Prefixo configurado no grupo (com fallback seguro para "!"). */
function prefixo(jid) {
  try {
    const p = getGroupPrefix(jid);
    return typeof p === 'string' && p ? p : '!';
  } catch {
    return '!';
  }
}

/**
 * Recarrega do Mongo o estado dos casais que estava só em memória.
 * Chamar UMA vez depois que `relacionamentos` já foi carregado (ver bot.js).
 *  - xpCasais: usa o maior Usuario.xpCasal entre os dois parceiros
 *  - xpBonus:  restaura o XP Dobro que ainda não expirou
 */
async function hidratarEstadoCasais(relacionamentos) {
  try {
    const jids = new Set();
    for (const [, r] of relacionamentos.entries()) {
      if (r.jidA) jids.add(jidNormalizedUser(r.jidA));
      if (r.jidB) jids.add(jidNormalizedUser(r.jidB));
    }

    let casaisRestaurados = 0;
    if (jids.size > 0) {
      const docs = await Usuario.find(
        { idWhatsApp: { $in: [...jids] } },
        { idWhatsApp: 1, xpCasal: 1 }
      ).lean();
      const xpPorJid = new Map(docs.map(d => [d.idWhatsApp, d.xpCasal || 0]));

      for (const [key, r] of relacionamentos.entries()) {
        if (xpCasais.has(key)) continue; // já tem valor em memória: não sobrescreve
        const xpA = xpPorJid.get(jidNormalizedUser(r.jidA)) || 0;
        const xpB = xpPorJid.get(jidNormalizedUser(r.jidB)) || 0;
        xpCasais.set(key, Math.max(xpA, xpB));
        casaisRestaurados++;
      }
    }

    const bonus = await CasalEstado.find({ tipo: 'xpBonus', expiry: { $gt: new Date() } }).lean();
    for (const b of bonus) {
      const key = b.chave.replace(/^bonus:/, '');
      xpBonus.set(key, { ativo: true, expiry: new Date(b.expiry).getTime() });
    }

    console.log(`♻️ [relacionamento] XP restaurado para ${casaisRestaurados} casal(is); ${bonus.length} XP Dobro ativo(s) restaurado(s).`);
  } catch (e) {
    console.error('⚠️ [relacionamento] Erro ao hidratar estado dos casais:', e.message);
  }
}

// ─── Mapa: comando → item obrigatório no inventário ────────────
const ITEM_NECESSARIO = {
  flores:   { key: 'flores',   nome: 'Flores 🌹'                },
  doces:    { key: 'morango',  nome: 'Morango com Chocolate 🍓'  },
  carta:    { key: 'carta',    nome: 'Carta de Amor 💌'          },
  mimo:     { key: 'caixa',    nome: 'Caixa Presente Luxo 🎁'    },
  jantar:   { key: 'taça',     nome: 'Taça para Vinho 🍷'        },
  cinema:   { key: 'almofada', nome: 'Almofada Casal 🛋️'         },
  viajar:   { key: 'garrafa',  nome: 'Garrafa Vinho Tinto 🍾'    },
  serenata: { key: 'vela',     nome: 'Vela Aromática 🕯️'         },
};

const CARINHOS_SEM_ITEM = new Set(['abraco', 'beijo']);
const CARINHOS_SEM_RELACIONAMENTO = new Set(['abraco']);

async function handleCarinh(sock, msg, jid, author, senderJid, relacionamentos, cmd, emoji, verbo, xpValor = 5) {
  const senderJidNormalizado = jidNormalizedUser(senderJid);
  const found = findRelByJid(jid, senderJidNormalizado, relacionamentos);
  const P = prefixo(jid); // prefixo configurado no grupo

  let key, rel;
  let jidANormalizado = null;
  let jidBNormalizado = null;
  let parcJid = null;
  const temRelacionamento = !!found;

  if (found) {
    ({ key, rel } = found);
    jidANormalizado = rel.jidA ? jidNormalizedUser(rel.jidA) : null;
    jidBNormalizado = rel.jidB ? jidNormalizedUser(rel.jidB) : null;
    // Compara pelo número: tolera diferenças de domínio/dispositivo no JID.
    parcJid = numeroDe(jidANormalizado) === numeroDe(senderJidNormalizado) ? jidBNormalizado : jidANormalizado;
  } else {
    if (!CARINHOS_SEM_RELACIONAMENTO.has(cmd)) {
      await sock.sendMessage(jid, {
        text: `💔 Você precisa estar em um relacionamento para usar *${P}${cmd}*!\n_Use *${P}casar @alguem* ou *${P}namorar @alguem* primeiro._`,
      }, { quoted: msg });
      return;
    }

    const mentionedJid =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
      msg.message?.extendedTextMessage?.contextInfo?.participant ||
      null;

    if (!mentionedJid) {
      await sock.sendMessage(jid, {
        text: `🤗 Marque a pessoa que vai receber o abraço!\n_Ex: *${P}abraco @alguem*_`,
      }, { quoted: msg });
      return;
    }

    parcJid = jidNormalizedUser(mentionedJid);

    if (numeroDe(parcJid) === numeroDe(senderJidNormalizado)) {
      await sock.sendMessage(jid, {
        text: `🤔 Você não pode dar *${P}${cmd}* em você mesmo(a)!`,
      }, { quoted: msg });
      return;
    }

    jidANormalizado = senderJidNormalizado;
    jidBNormalizado = parcJid;
    key = relKey(jid, senderJidNormalizado, parcJid);
  }

  // ── 1. Verifica Cooldown Diário PRIMEIRO (Evita consumo/consultas desnecessárias) ──
  const diarioKey = `${key}:${cmd}:${hoje()}`;

  const avisarCooldown = () => sock.sendMessage(jid, {
    text: cmd === 'abraco'
      ? `⏰ Vocês já trocaram um abraço hoje! Volte amanhã para mais um carinho. 🤗`
      : `⏰ Você já usou *${P}${cmd}* hoje! Volte amanhã, ansioso(a)! 😊`,
  }, { quoted: msg });

  // Cache em memória (rápido)
  if (diariosUsados.has(diarioKey)) {
    await avisarCooldown();
    return;
  }

  // Reserva o uso diário no Mongo (índice único em "chave"): sobrevive a restart e
  // impede que duas mensagens simultâneas consumam o item duas vezes.
  try {
    await CasalEstado.create({
      chave:  `diario:${diarioKey}`,
      tipo:   'diario',
      expiry: new Date(Date.now() + 48 * 60 * 60 * 1000), // o TTL do Mongo limpa depois
    });
  } catch (e) {
    if (e?.code === 11000) { // chave duplicada → já usou hoje (mesmo após restart)
      diariosUsados.set(diarioKey, true);
      await avisarCooldown();
      return;
    }
    // Se o Mongo falhar por outro motivo, segue só com a trava em memória.
    console.error(`[handleCarinh:${cmd}] Erro ao reservar uso diário no DB:`, e.message);
  }

  diariosUsados.set(diarioKey, true);
  const liberarUso = () => {
    diariosUsados.delete(diarioKey);
    CasalEstado.deleteOne({ chave: `diario:${diarioKey}` }).catch(() => {});
  };

  // ── 2. Define e consome item (se o comando exigir) ──
  const itemInfo  = ITEM_NECESSARIO[cmd] || null;
  const exigeItem = !CARINHOS_SEM_ITEM.has(cmd) && !!itemInfo;
  const itemKey   = itemInfo?.key  ?? cmd;
  const itemNome  = itemInfo?.nome ?? cmd;

  let consumo = null;

  if (exigeItem) {
    try {
      const userDoc = await Usuario.findOne(
        { idWhatsApp: senderJidNormalizado },
        { [`inventory.${itemKey}`]: 1 }
      ).lean();

      const qtdItem = userDoc?.inventory?.[itemKey] ?? 0;

      if (qtdItem < 1) {
        liberarUso();
        await sock.sendMessage(jid, {
          text: `🛒 Você não tem *${itemNome}* para dar!\nCompre na *${P}lojacasal* e surpreenda seu par! 💝`,
        }, { quoted: msg });
        return;
      }

      consumo = await Usuario.findOneAndUpdate(
        { idWhatsApp: senderJidNormalizado, [`inventory.${itemKey}`]: { $gte: 1 } },
        { $inc: { [`inventory.${itemKey}`]: -1 } },
        { new: true }
      );

      if (!consumo) {
        liberarUso();
        await sock.sendMessage(jid, {
          text: `⚠️ Não foi possível usar o item agora. Tente novamente.`,
        }, { quoted: msg });
        return;
      }
    } catch (e) {
      liberarUso();
      throw e;
    }
  }

  // ── 3. Cálculo e Persistência de XP ──
  const temBonus = temRelacionamento && temXpBonus(key);
  const ganho    = temBonus ? xpValor * 2 : xpValor;
  const xpAtual  = (xpCasais.get(key) || 0) + ganho;

  xpCasais.set(key, xpAtual);

  const jidsParaXp = temRelacionamento
    ? [jidANormalizado, jidBNormalizado].filter(Boolean)
    : [senderJidNormalizado];

  Usuario.updateMany(
    { idWhatsApp: { $in: jidsParaXp } },
    { $inc: { xpCasal: ganho } }
  ).catch(e => console.error(`[handleCarinh:${cmd}] Erro ao persistir XP no DB:`, e.message));

  // ── 4. Formatação da Resposta ──
  const tagRemetente = `@${numeroDe(senderJidNormalizado)}`;
  const tagParceiro  = parcJid
    ? `@${numeroDe(parcJid)}`
    : (rel?.nomeA === author ? rel?.nomeB : rel?.nomeA);

  const bonusStr = temBonus ? ` _(XP Duplo ativo! +${xpValor} bônus)_` : '';
  const inventarioStr = exigeItem
    ? `\n🎒 *${itemNome}* restantes no seu inventário: *${consumo.inventory?.[itemKey] ?? 0}*`
    : '';

  const xpLabel = temRelacionamento ? 'Total do casal' : 'Seu total';
  const listaMentions = [senderJidNormalizado];
  if (parcJid) listaMentions.push(parcJid);

  await sock.sendMessage(jid, {
    text:
      `${emoji} ${tagRemetente} ${verbo} para ${tagParceiro}! 💕\n\n` +
      `💰 *+${ganho} XP*${bonusStr} | ${xpLabel}: *${xpAtual} XP*` +
      inventarioStr,
    mentions: listaMentions,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── PEDIDO DE CASAMENTO / NAMORO ─────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleRelacionamento(sock, msg, content, jid, author, tipo, relacionamentos, pedidosPendentes, contactNames) {
  const senderJid    = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
  const contextInfo  = content.extendedTextMessage?.contextInfo;
  const mentionedJid = contextInfo?.mentionedJid || [];

  if (mentionedJid.length === 0) {
    const exemplos = tipo === 'casamento'
      ? ['Marca aí, seu(ua) indeciso(a)! 😤', 'MARCA UM JUIZ AGORA! 💍']
      : ['Bora! Não tem tímido aqui! 😏', 'Marca agora ou tá com medo? 👀'];
    await sock.sendMessage(jid, {
      text: `${exemplos[Math.floor(Math.random() * exemplos.length)]}\nExemplo: *${prefixo(jid)}${tipo === 'casamento' ? 'casar' : 'namorar'} @fulano*`,
    }, { quoted: msg });
    return;
  }

  const alvoJid  = jidNormalizedUser(mentionedJid[0]);
  const nomeAlvo = contactNames[alvoJid] || alvoJid.split('@')[0];

  if (alvoJid.split('@')[0] === senderJid.split('@')[0]) {
    const frases = [
      '😅 Narcisista demais! Procura alguém de verdade!',
      '🤡 Casamento consigo mesmo? Tá ouvindo voz?',
      '💀 Auto-sabotagem extrema detected!',
    ];
    await sock.sendMessage(jid, {
      text: frases[Math.floor(Math.random() * frases.length)],
    }, { quoted: msg });
    return;
  }

  if (isBloqueado(senderJid)) {
    const frases = [
      `🚫 TÁ CANCELADO(A)! Sua ex te largou! Aguarde *${minutosRestantes(senderJid)} minuto(s)* para a poeira baixar! 💔`,
      `😤 Respira! Você precisa de *${minutosRestantes(senderJid)} minuto(s)* de terapia antes de tentar de novo!`,
      `💀 Seu histórico de divórcio rápido tá te perseguindo! Volta em *${minutosRestantes(senderJid)} minuto(s)*!`,
    ];
    await sock.sendMessage(jid, {
      text: frases[Math.floor(Math.random() * frases.length)],
    }, { quoted: msg });
    return;
  }

  if (isBloqueado(alvoJid)) {
    const frases = [
      `🚫 *${nomeAlvo}* tá em RECLUSÃO! O término ainda tá fresco! Volta em *${minutosRestantes(alvoJid)} minuto(s)* seu(ua) insensível! 😤`,
      `💔 Ué, qual é? *${nomeAlvo}* tá recuperando o coração! Espera *${minutosRestantes(alvoJid)} minuto(s)* pra propor!`,
    ];
    await sock.sendMessage(jid, {
      text: frases[Math.floor(Math.random() * frases.length)],
      mentions: [alvoJid],
    }, { quoted: msg });
    return;
  }

  const relacionamentoAtual = getRelacionamento(jid, senderJid, alvoJid, relacionamentos);

  if (tipo === 'casamento') {
    const tresDiasMs = 3 * 24 * 60 * 60 * 1000;
    if (!relacionamentoAtual || relacionamentoAtual.tipo !== 'namoro') {
      await sock.sendMessage(jid, {
        text: `💍 Calma lá! Antes de casar, vocês precisam estar namorando há pelo menos *3 dias*. Use *${prefixo(jid)}namorar @${alvoJid.split('@')[0]}* primeiro.`,
        mentions: [alvoJid],
      }, { quoted: msg });
      return;
    }

    const inicioNamoro = Number(relacionamentoAtual.desde) || new Date(relacionamentoAtual.desde).getTime();
    const tempoNamoro = Date.now() - inicioNamoro;
    if (!Number.isFinite(inicioNamoro) || tempoNamoro < tresDiasMs) {
      const restanteMs = tresDiasMs - Math.max(0, tempoNamoro);
      const horasRestantes = Math.ceil(restanteMs / (60 * 60 * 1000));
      await sock.sendMessage(jid, {
        text: `⏳ Pedido de casamento bloqueado! Vocês precisam namorar por *3 dias completos*. Ainda faltam aproximadamente *${horasRestantes} hora(s)*. 💕`,
        mentions: [alvoJid],
      }, { quoted: msg });
      return;
    }
  }

  if (relacionamentoAtual && tipo !== 'casamento') {
    const frases = [
      `😂 Vocês já tão juntos, mas quer fazer um evento de renovação de votos? Que romântico... ou dramático!`,
      `😒 Tá querendo propor NOVAMENTE? Já era pra ter pedido em outro lugar!`,
      `😂 Vocês já tão tão casadinhos que nem precisa mais disso!`,
    ];
    await sock.sendMessage(jid, {
      text: frases[Math.floor(Math.random() * frases.length)],
    }, { quoted: msg });
    return;
  }

  const jaSender = findRelByJid(jid, senderJid, relacionamentos);
  if (jaSender) {
    const frases = [
      `💔 TRAIDOR(A)! Você já tem alguém! Quer derramar todo o drama com *${prefixo(jid)}terminar*? 😤`,
      `🤡 Boa tentativa de bigamia! Termina seu relacionamento primeiro, seu(ua) miserável!`,
      `😒 Seu(ua) parceiro(a) tá aqui vendo isso... prepare-se para a guerra! 💀`,
    ];
    await sock.sendMessage(jid, {
      text: frases[Math.floor(Math.random() * frases.length)],
    }, { quoted: msg });
    return;
  }

  const jaAlvo = findRelByJid(jid, alvoJid, relacionamentos);
  if (jaAlvo) {
    const frases = [
      `😂 *${nomeAlvo}* JÁ tá comprometido(a)! Vai afastar esse lobisomem aí!`,
      `💔 Deprimente! *${nomeAlvo}* tá numa relação! Esse é o seu sinal pra desistir!`,
      `🚫 *${nomeAlvo}*: "Não, muito obrigado(a)! Já tenho meu/minha babe!"`,
    ];
    await sock.sendMessage(jid, {
      text: frases[Math.floor(Math.random() * frases.length)],
      mentions: [alvoJid],
    }, { quoted: msg });
    return;
  }

  if (pedidosPendentes.has(alvoJid)) {
    await sock.sendMessage(jid, {
      text: `⏳ @${alvoJid.split('@')[0]} já tem um pedido pendente aguardando resposta.`,
      mentions: [alvoJid],
    }, { quoted: msg });
    return;
  }

  const pedido = { tipo, jidPedinte: senderJid, nomePedinte: author, jid };
  pedidosPendentes.set(alvoJid, pedido);

  // O timer fica guardado no próprio pedido (pedido.timer): aceitar, recusar e cancelar
  // conseguem cancelá-lo. E ele só expira ESTE pedido — nunca um pedido novo feito depois.
  pedido.timer = setTimeout(() => {
    if (pedidosPendentes.get(alvoJid) !== pedido) return;
    pedidosPendentes.delete(alvoJid);
    sock.sendMessage(jid, {
      text: `⌛ O pedido de *${author}* para @${alvoJid.split('@')[0]} expirou sem resposta. Que falta de respeito!`,
      mentions: [alvoJid],
    }).catch(() => {});
  }, 5 * 60 * 1000);

  const tipoEmoji = tipo === 'casamento' ? '💍' : '💝';
  const tipoVerbo = tipo === 'casamento' ? 'casar' : 'namorar';
  const caption =
    `${tipoEmoji} *${author}* está pedindo @${alvoJid.split('@')[0]} em ${tipo}!\n\n` +
    `@${alvoJid.split('@')[0]}, você aceita ${tipoVerbo} com *${author}*? 🥺\n\n` +
    `Use *${prefixo(jid)}euaceito* ou *${prefixo(jid)}eurecuso*\n_⏰ Expira em 5 minutos_`;

  const imagemNome = tipo === 'casamento'
    ? 'pedidocasamento.jpeg'
    : ['imagecasal.jpg', 'imagecasal2.jpg', 'imagecasal3.jpg'][Math.floor(Math.random() * 3)];
  const imagemPath = path.join(__dirname, '..', '..', '..', 'Audio-Image', imagemNome);

  try {
    const imageBuffer = fs.readFileSync(imagemPath);
    await sock.sendMessage(jid, {
      image: imageBuffer,
      caption,
      mentions: [alvoJid],
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, {
      text: caption,
      mentions: [alvoJid],
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── ACEITAR OU RECUSAR PEDIDO ────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleEuAceito(sock, msg, jid, senderJid, relacionamentos, pedidosPendentes, contactNames) {
  const senderNorm = jidNormalizedUser(senderJid);
  const pedido = pedidosPendentes.get(senderNorm) || pedidosPendentes.get(senderJid);
  if (!pedido) {
    await sock.sendMessage(jid, { text: '⚠️ Você não tem nenhum pedido pendente.' }, { quoted: msg });
    return;
  }
  if (pedido.timer) clearTimeout(pedido.timer);
  pedidosPendentes.delete(senderNorm);
  pedidosPendentes.delete(senderJid);

  const nomeAlvo = msg.pushName || contactNames[senderNorm] || senderNorm.split('@')[0];
  const { jidPedinte, nomePedinte, jid: jidOrigem, tipo } = pedido;
  const pedinteNorm = jidNormalizedUser(jidPedinte);
  const grupoOrigem = jidOrigem || jid;

  // Durante os 5 minutos de espera, um dos dois pode ter entrado em outro relacionamento.
  if (findRelByJid(grupoOrigem, senderNorm, relacionamentos) ||
      findRelByJid(grupoOrigem, pedinteNorm, relacionamentos)) {
    await sock.sendMessage(jid, {
      text: '⚠️ Um de vocês já está em outro relacionamento. O pedido foi cancelado.',
    }, { quoted: msg });
    return;
  }

  const key   = relKey(grupoOrigem, senderNorm, pedinteNorm);
  const agora = Date.now();

  relacionamentos.set(key, {
    tipo:    tipo || 'casamento',
    nomeA:   nomePedinte,
    nomeB:   nomeAlvo,
    jidA:    pedinteNorm,
    jidB:    senderNorm,
    desde:   agora,
    idGrupo: grupoOrigem,
  });
  xpCasais.set(key, 0);
  await syncCasamentoToDb(pedinteNorm, senderNorm, tipo || 'casamento', agora, grupoOrigem);

  const frases = [
    `💍 CARALHOOOOO! *${nomePedinte}* e *${nomeAlvo}* são CASADOS AGORA! Corre gritando que ninguém acreditava! 😂💍`,
    `💕🏆 É NAMORO! *${nomePedinte}* e *${nomeAlvo}* tão beijando por aí! Que cena constrangedora... bora ver mais! 😏`,
    `🥳 *${nomePedinte}* conseguiu prender *${nomeAlvo}*! Tomara que a corrente segure! 🔐💍`,
    `🌟 UAUUU! Contra todos os prognósticos, *${nomePedinte}* ganhou o coração de *${nomeAlvo}*! Que surpresa! 😱`,
  ];
  const idx     = tipo === 'namoro' ? [1, 3][Math.floor(Math.random() * 2)] : [0, 2][Math.floor(Math.random() * 2)];
  const caption = frases[idx] + '\n\n💪 *Ganhem XP juntos com os comandos! Um casal fraco não vira lenda!*';

  const imagemNome = (tipo || 'casamento') === 'casamento'
    ? 'casado.jpeg'
    : ['imagecasal.jpg', 'imagecasal2.jpg', 'imagecasal3.jpg'][Math.floor(Math.random() * 3)];
  const imagemPath = path.join(__dirname, '..', '..', '..', 'Audio-Image', imagemNome);

  try {
    const imageBuffer = fs.readFileSync(imagemPath);
    await sock.sendMessage(grupoOrigem, {
      image: imageBuffer,
      caption,
      mentions: [senderNorm, pedinteNorm],
    });
  } catch {
    await sock.sendMessage(grupoOrigem, {
      text: caption,
      mentions: [senderNorm, pedinteNorm],
    });
  }
}

async function handleEuRecuso(sock, msg, jid, senderJid, pedidosPendentes, contactNames) {
  const senderNorm = jidNormalizedUser(senderJid);
  const pedido = pedidosPendentes.get(senderNorm) || pedidosPendentes.get(senderJid);
  if (!pedido) {
    await sock.sendMessage(jid, { text: '⚠️ Você não tem nenhum pedido pendente.' }, { quoted: msg });
    return;
  }
  if (pedido.timer) clearTimeout(pedido.timer);
  pedidosPendentes.delete(senderNorm);
  pedidosPendentes.delete(senderJid);

  const { jidPedinte, jid: jidOrigem } = pedido;
  const pedinteNorm = jidNormalizedUser(jidPedinte);

  const frases = [
    `💔 @${senderNorm.split('@')[0]} COM TODA FORÇA recusou @${pedinteNorm.split('@')[0]}! DESTRUÍDO(A)! 😭😭😭`,
    `🚫 @${senderNorm.split('@')[0]} não quer nem saber! @${pedinteNorm.split('@')[0]} saiu de ré levando o balde d'agua! 🪣`,
    `😒 Que MANCADA! @${pedinteNorm.split('@')[0]} tomou um fora espetacular de @${senderNorm.split('@')[0]}! AHAHAHA! 😂`,
    `🤡 CANCELAMENTO! @${pedinteNorm.split('@')[0]} é PERSONA NON GRATA na vida de @${senderNorm.split('@')[0]}! 🚷`,
  ];

  const caption = frases[Math.floor(Math.random() * frases.length)];
  const imagemPath = path.join(__dirname, '..', '..', '..', 'Audio-Image', 'imagemcasalrecusar.jpeg');

  try {
    const imageBuffer = fs.readFileSync(imagemPath);
    await sock.sendMessage(jidOrigem || jid, {
      image: imageBuffer,
      caption,
      mentions: [senderNorm, pedinteNorm],
    });
  } catch {
    await sock.sendMessage(jidOrigem || jid, {
      text: caption,
      mentions: [senderNorm, pedinteNorm],
    });
  }
}

async function handleCancelarCasamento(sock, msg, jid, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = findRelByJid(jid, senderNorm, relacionamentos);
  if (!found) {
    await sock.sendMessage(jid, {
      text: '💔 Você não está em nenhum relacionamento para terminar.',
    }, { quoted: msg });
    return;
  }

  const { key, rel } = found;
  const parcJid = jidNormalizedUser(numeroDe(rel.jidA) === numeroDe(senderNorm) ? rel.jidB : rel.jidA);
  const tagSelf = `@${numeroDe(senderNorm)}`;
  const tagParc = `@${numeroDe(parcJid)}`;

  relacionamentos.delete(key);
  xpCasais.delete(key);
  xpBonus.delete(key); // o XP Dobro pertence ao casal: não deve sobrar depois do término
  CasalEstado.deleteOne({ chave: `bonus:${key}` }).catch(() => {});
  await clearCasamentoDb(senderNorm, parcJid);

  const expiry = Date.now() + 10 * 60 * 1000;
  bloqueados.set(senderNorm, expiry);
  bloqueados.set(parcJid,   expiry);

  const frases = [
    `💔 ${tagSelf} TERMINOU com ${tagParc}! Drama total! 🎭`,
    `🚪 ${tagSelf} bateu a porta na cara de ${tagParc}! Sem volta! 😤`,
    `💀 Fim de linha! ${tagSelf} e ${tagParc} se separaram. RIP ao casal! 🪦`,
    `😭 ${tagParc} acabou de tomar um pé na bunda de ${tagSelf}! Que vexame! 🤡`,
  ];

  const caption = frases[Math.floor(Math.random() * frases.length)] +
    `\n\n⏳ Ambos ficam bloqueados por *10 minutos* antes de se comprometer novamente.`;
  const imagemPath = path.join(__dirname, '..', '..', '..', 'Audio-Image', 'imagecasal4.jpg');

  try {
    const imageBuffer = fs.readFileSync(imagemPath);
    await sock.sendMessage(jid, {
      image: imageBuffer,
      caption,
      mentions: [senderNorm, parcJid],
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, { text: caption, mentions: [senderNorm, parcJid] }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── EXPORTS ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const relacionamentoExtra = require(path.join(__dirname, 'extra'));
const relacionamentoFixar = require(path.join(__dirname, 'fixar'));

module.exports = Object.assign(
  {
    // ── estado compartilhado ──
    relKey,
    xpCasais,
    bloqueados,
    diariosUsados,
    ciumentosMap,
    xpBonus,

    // ── helpers ──
    hoje,
    isBloqueado,
    minutosRestantes,
    diasRestantes: minutosRestantes,
    getRelacionamento,
    syncCasamentoToDb,
    clearCasamentoDb,
    findRelByJid,
    temXpBonus,
    formatarTempo,
    prefixo,
    hidratarEstadoCasais,

    // ── handlers deste arquivo ──
    handleCarinh,
    handleRelacionamento,
    handleEuAceito,
    handleEuRecuso,
    handleCancelarCasamento,
  },
  relacionamentoExtra,
  relacionamentoFixar,
);
