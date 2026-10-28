'use strict';

/**
 * Sistema de Roubo — Tico Bot
 * Comandos: !menuroubar, !roubar, !roubarbanco, !menusec, !equiparroubo, !equiparsec
 *           !buyroubarbanco, !equiparroubarbanco, !invroubarbanco
 *           !meusitensroubo, !meussec, !meiosec, !comprarroubo, !comprarsec
 *
 * Toda a lógica é isolada por grupo via CarteiraGrupo.
 * Plata gerenciada exclusivamente pelo carteiraService.
 */

const path = require('path');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const LidMapping    = require(path.join(__dirname, '..', '..', 'models', 'LidMapping'));
const {
  getCarteira,
  alterarGold,
  alterarGoldSeguro,
  formatarSaldo,
} = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { incrementMission } = require('./missoes');
const { normalizarJid } = require(path.join(__dirname, '..', '..', 'utils', 'jid'));
const { getWalletBalance } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'wallet'));

const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));

// ─── CONFIGURAÇÕES ────────────────────────────────────────────────────────────

const COOLDOWN_ROUBO_MS  = 15 * 60 * 1000; // 15 minutos entre tentativas
const COOLDOWN_PRESO_MS  = 2 * 60 * 60 * 1000; // 2 horas preso se falhar
const COOLDOWN_POLICIA_MS = 30 * 60 * 1000; // 30 min pra chamar polícia de novo
const IMUNIDADE_ROUBO_MS  = 2 * 60 * 60 * 1000; // 2h de imunidade após ser roubado
const TAXA_SUCESSO_BASE  = 50;
const TAXA_MIN           = 5;
const TAXA_MAX           = 95;
const ROUBO_MIN_PCT      = 30;
const ROUBO_MAX_PCT      = 100;
const CHANCE_POLICIA     = 40; // % de chance de prender
const DEVOLUCAO_POLICIA  = 50; // % do gold roubado que a vítima recupera

// ─── CATÁLOGO — ITENS DE ATAQUE ───────────────────────────────────────────────

const ITENS_ROUBO = {
  mascara:    { nome: '🎭 Máscara',             preco: 100, bonus: 10 },
  chave:      { nome: '🔧 Chave Inglesa',        preco: 150, bonus: 20 },
  lockpick:   { nome: '🔓 Kit de Arrombamento',  preco: 200, bonus: 30 },
  corda:      { nome: '🪢 Corda Ninja',          preco: 250, bonus: 35 },
  dinamite:   { nome: '💣 Dinamite',             preco: 300, bonus: 40 },
  disfarce:   { nome: '🕵️ Disfarce Premium',     preco: 350, bonus: 45 },
  explorador: { nome: '📡 Detector de Alarmes',  preco: 400, bonus: 50 },
  cavador:    { nome: '⛏️ Picareta de Diamante', preco: 500, bonus: 60 },
};

const ITENS_ROUBO_BANCO = {
  macarico_cofre: { nome: '🔥 Maçarico para Cofre',        preco: 900,  bonus: 15 },
  furadeira:      { nome: '🛠️ Furadeira Industrial',      preco: 1500, bonus: 25 },
  clone_cartao:   { nome: '💳 Clonador de Cartões',        preco: 2400, bonus: 35 },
  pulso_emp:      { nome: '⚡ Pulso Eletromagnético',      preco: 3800, bonus: 45 },
  tuneladora:     { nome: '🚜 Tuneladora de Alta Pressão', preco: 6000, bonus: 60 },
};

// ─── CATÁLOGO — ITENS DE DEFESA ───────────────────────────────────────────────

const ITENS_SEGURANCA = {
  cofre:     { nome: '🔐 Cofre Forte',          preco: 150, defesa: 15 },
  alarme:    { nome: '🚨 Sistema de Alarme',     preco: 200, defesa: 25 },
  camera:    { nome: '📹 Câmera de Vigilância',  preco: 250, defesa: 30 },
  cachorro:  { nome: '🐕 Cão de Guarda',         preco: 300, defesa: 35 },
  seguranca: { nome: '👮 Guarda de Segurança',   preco: 400, defesa: 45 },
  bunker:    { nome: '🛡️ Bunker Subterrâneo',   preco: 500, defesa: 55 },
  laser:     { nome: '🔴 Raios Laser',           preco: 600, defesa: 65 },
  militares: { nome: '🪖 Segurança Militar',     preco: 800, defesa: 80 },
  drones_taticos: { nome: '🚁 Enxame de Drones Táticos',      preco: 1200, defesa: 85 },
  equipe_elite:   { nome: '🦾 Equipe de Segurança de Elite',  preco: 2200, defesa: 90 },
  cofre_titanio:  { nome: '🏦 Cofre Blindado de Titânio',     preco: 4000, defesa: 95 },
  central_ia:     { nome: '🧠 Central de Segurança com IA',   preco: 7500, defesa: 100 },
};

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

/** JID do remetente da mensagem (funciona em grupo e privado) — normalizado */
function getUserId(msg) {
  const raw = msg.key.participant || msg.key.remoteJid;
  return normalizarJid(raw) || raw;
}

/** JID do grupo (ou privado) onde a mensagem foi enviada */
function getGroupId(msg, jid) {
  // jid já vem do handler principal — é o remoteJid correto
  return jid;
}

/** Lê quantidade de item de um Map do Mongoose ou objeto plain */
function getItemQtd(mapaOuObj, chave) {
  if (!mapaOuObj) return 0;
  if (typeof mapaOuObj.get === 'function') return mapaOuObj.get(chave) ?? 0;
  return mapaOuObj[chave] ?? 0;
}

/** Converte ms em string legível: "4min 32s" */
function formatarTempo(ms) {
  const totalSeg = Math.ceil(ms / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min > 0 && seg > 0) return `${min}min ${seg}s`;
  if (min > 0) return `${min}min`;
  return `${seg}s`;
}

/**
 * Incrementa a quantidade de um item no Map (itensRoubo ou itensSec)
 * usando $inc sobre o campo correto no CarteiraGrupo.
 */
async function incrementarItem(idWhatsApp, idGrupo, campo, itemSlug, delta = 1) {
  const filtro = { idWhatsApp, idGrupo };

  // Guarda atômica: só decrementa se ainda houver estoque suficiente —
  // evita ir a negativo com chamadas concorrentes (ex.: cliques duplos
  // em !roubar/!roubarbanco quase simultâneos).
  if (delta < 0) {
    filtro[`${campo}.${itemSlug}`] = { $gte: -delta };
  }

  return CarteiraGrupo.findOneAndUpdate(
    filtro,
    { $inc: { [`${campo}.${itemSlug}`]: delta } },
    { upsert: delta > 0, new: true }
  );
  // Se delta < 0 e a guarda falhar, retorna null — os pontos de chamada já
  // relêem a carteira depois pra decidir se desequipam o slot, então uma
  // falha aqui só significa "nada mudou", sem quebrar o fluxo.
}

// ─── !menuroubar ──────────────────────────────────────────────────────────────

async function handleMenuRoubo(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  let texto =
`╔══════════════════════╗
     🎭 LOJA DE ROUBO
╚══════════════════════╝

🧰 *EQUIPAMENTOS DISPONÍVEIS*
`;

  for (const [key, item] of Object.entries(ITENS_ROUBO)) {
    texto += `  ▸ ${item.nome} — *${formatarSaldo(item.preco)}*\n`;
    texto += `     └ Bônus de sucesso: *+${item.bonus}%* | chave: \`${key}\`\n`;
  }

  texto += `\n🏦 *FERRAMENTAS PARA ASSALTO A BANCO*\n`;
  for (const [key, item] of Object.entries(ITENS_ROUBO_BANCO)) {
    texto += `  ▸ ${item.nome} — *${formatarSaldo(item.preco)}*\n`;
    texto += `     └ Bônus de sucesso: *+${item.bonus}%* | chave: \`${key}\`\n`;
  }

  texto += `
📜 *COMANDOS*
  ▸ ${P}buyroubo _(item)_ — Comprar item/ferramenta
  ▸ ${P}equiparroubo _(item)_ — Equipar para o tipo de roubo
  ▸ ${P}invroubo — Ver inventários de roubo e banco
  ▸ ${P}roubar @pessoa — Roubar alguém
  ▸ ${P}roubarbanco @pessoa — Assaltar o banco de alguém\r\n  ▸ ${P}policia @ladrão — tentar recuperar o que foi roubado

⚠️ *REGRAS*
  • Item equipado é obrigatório para roubar!
  • Assaltar bancos exige ferramenta própria, comprada e equipada pelos comandos acima.
  • A ferramenta é consumida na tentativa de assalto ao banco.
  • Cooldown: *${formatarTempo(COOLDOWN_ROUBO_MS)}* entre tentativas
  • Taxa base de sucesso: *${TAXA_SUCESSO_BASE}%*

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !menusec ─────────────────────────────────────────────────────────────────

async function handleMenuSec(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  let texto =
`╔══════════════════════╗
    🔐 LOJA DE SEGURANÇA
╚══════════════════════╝

🛡️ *EQUIPAMENTOS DE DEFESA*
`;

  for (const [key, item] of Object.entries(ITENS_SEGURANCA)) {
    texto += `  ▸ ${item.nome} — *${formatarSaldo(item.preco)}*\n`;
    texto += `     └ Proteção: *+${item.defesa}%* | chave: \`${key}\`\n`;
  }

  texto += `
📜 *COMANDOS*
  ▸ ${P}buysec _(item)_ — Comprar item
  ▸ ${P}equiparsec _(item)_ — Equipar defesa
  ▸ ${P}invsec — Ver inventário de segurança
  ▸ ${P}meiosec — Ver meio de segurança

⚠️ *ATENÇÃO*
  • Sem defesa, há *${TAXA_SUCESSO_BASE}%* de chance de ser roubado com sucesso!

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !buyroubo ────────────────────────────────────────────────────────────────

async function handleComprarRoubo(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const match = String(caption || '').match(/buyroubo\s+(\S+)/i);
  if (!match) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!buyroubo <item>*\nExemplo: *!buyroubo dinamite*',
    }, { quoted: msg });
    return;
  }

  const itemSlug = match[1].toLowerCase().trim();
  const itemInfo = ITENS_ROUBO[itemSlug] || ITENS_ROUBO_BANCO[itemSlug];
  const campoInventario = ITENS_ROUBO[itemSlug] ? 'itensRoubo' : 'itensRouboBanco';
  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: `⚠️ Item *${itemSlug}* não encontrado na loja de roubo!\nUse *!menuroubar* para ver os disponíveis.`,
    }, { quoted: msg });
    return;
  }

  // Débito atômico: debita o valor exato apenas se o saldo for suficiente.
  try {
    await alterarGold(userId, idGrupo, -itemInfo.preco, `Compra: ${itemInfo.nome}`);
  } catch (e) {
    if (e instanceof RangeError) {
      const carteira = await getCarteira(userId, idGrupo);
      const saldo    = carteira.gold ?? 0;
      const faltam   = Math.max(0, itemInfo.preco - saldo);
      await sock.sendMessage(jid, {
        text:
          `❌ *SALDO INSUFICIENTE!*\n\n` +
          `💵 Preço:      *${formatarSaldo(itemInfo.preco, carteira)}*\n` +
          `💰 Seu saldo:  *${formatarSaldo(saldo, carteira)}*\n` +
          `⚠️ Faltam:     *${formatarSaldo(faltam, carteira)}*`,
      }, { quoted: msg });
      return;
    }
    console.error('Erro ao debitar gold (buyroubo):', e.message);
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao processar a compra. Tente novamente.',
    }, { quoted: msg });
    return;
  }

  try {
    await incrementarItem(userId, idGrupo, campoInventario, itemSlug);
  } catch (e) {
    console.error('Erro ao registrar item de roubo, reembolsando:', e.message);
    try {
      await alterarGold(userId, idGrupo, itemInfo.preco, `Reembolso: ${itemInfo.nome}`);
      await sock.sendMessage(jid, {
        text: '⚠️ Erro ao registrar o item. Seu saldo foi reembolsado.',
      }, { quoted: msg });
    } catch (refundErr) {
      console.error('FALHA CRÍTICA: reembolso também falhou (buyroubo):', refundErr.message);
      await sock.sendMessage(jid, {
        text: '⚠️ Erro ao registrar o item e ao reembolsar o saldo. Contate um administrador.',
      }, { quoted: msg });
    }
    return;
  }

  const carteiraFinal = await getCarteira(userId, idGrupo);

  await sock.sendMessage(jid, {
    text:
      `✅ *COMPRA REALIZADA!*\n\n` +
      `🔧 *Item/ferramenta:* ${itemInfo.nome}\n` +
      `💵 *Preço:* ${itemInfo.preco} Plata\n` +
      `📈 *Bônus:* +${itemInfo.bonus}% de sucesso\n` +
      `💎 *Saldo restante:* ${formatarSaldo(carteiraFinal.gold, carteiraFinal)}\n\n` +
      `💡 Use *!equiparroubo ${itemSlug}* para equipar!`,
  }, { quoted: msg });
}

// ─── !buysec ──────────────────────────────────────────────────────────────────

async function handleComprarSec(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const match = caption.match(/buysec\s+(\S+)/i);
  if (!match) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!buysec <item>*\nExemplo: *!buysec cofre*',
    }, { quoted: msg });
    return;
  }

  const itemSlug = match[1].toLowerCase().trim();
  const itemInfo = ITENS_SEGURANCA[itemSlug];
  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: `⚠️ Item *${itemSlug}* não encontrado na loja de segurança!\nUse *!menusec* para ver os disponíveis.`,
    }, { quoted: msg });
    return;
  }

  // Débito atômico: debita o valor exato apenas se o saldo for suficiente.
  try {
    await alterarGold(userId, idGrupo, -itemInfo.preco, `Compra: ${itemInfo.nome}`);
  } catch (e) {
    if (e instanceof RangeError) {
      const carteira = await getCarteira(userId, idGrupo);
      const saldo    = carteira.gold ?? 0;
      const faltam   = Math.max(0, itemInfo.preco - saldo);
      await sock.sendMessage(jid, {
        text:
          `❌ *SALDO INSUFICIENTE!*\n\n` +
          `💵 Preço:      *${formatarSaldo(itemInfo.preco, carteira)}*\n` +
          `💰 Seu saldo:  *${formatarSaldo(saldo, carteira)}*\n` +
          `⚠️ Faltam:     *${formatarSaldo(faltam, carteira)}*`,
      }, { quoted: msg });
      return;
    }
    console.error('Erro ao debitar gold (buysec):', e.message);
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao processar a compra. Tente novamente.',
    }, { quoted: msg });
    return;
  }

  try {
    await incrementarItem(userId, idGrupo, 'itensSec', itemSlug);
  } catch (e) {
    console.error('Erro ao registrar item de segurança, reembolsando:', e.message);
    try {
      await alterarGold(userId, idGrupo, itemInfo.preco, `Reembolso: ${itemInfo.nome}`);
      await sock.sendMessage(jid, {
        text: '⚠️ Erro ao registrar o item. Seu saldo foi reembolsado.',
      }, { quoted: msg });
    } catch (refundErr) {
      console.error('FALHA CRÍTICA: reembolso também falhou (buysec):', refundErr.message);
      await sock.sendMessage(jid, {
        text: '⚠️ Erro ao registrar o item e ao reembolsar o saldo. Contate um administrador.',
      }, { quoted: msg });
    }
    return;
  }

  const carteiraFinal = await getCarteira(userId, idGrupo);

  await sock.sendMessage(jid, {
    text:
      `✅ *COMPRA REALIZADA!*\n\n` +
      `🔐 *Item:* ${itemInfo.nome}\n` +
      `💵 *Preço:* ${formatarSaldo(itemInfo.preco, carteiraFinal)}\n` +
      `🛡️ *Proteção:* +${itemInfo.defesa}%\n` +
      `💎 *Saldo restante:* ${formatarSaldo(carteiraFinal.gold, carteiraFinal)}\n\n` +
      `💡 Use *!equiparsec ${itemSlug}* para ativar!`,
  }, { quoted: msg });
}

// ─── !equiparroubo ─────────────────────────────────────────────────────────────
async function handleEquiparRoubo(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const match   = String(caption || '').match(/equiparroubo\s+(\S+)/i);

  if (!match) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!equiparroubo <item>*\nExemplo: *!equiparroubo dinamite*',
    }, { quoted: msg });
    return;
  }

  const itemSlug = match[1].toLowerCase().trim();
  const itemInfo = ITENS_ROUBO[itemSlug] || ITENS_ROUBO_BANCO[itemSlug];
  const ferramentaBanco = Boolean(ITENS_ROUBO_BANCO[itemSlug]);
  const campoInventario = ferramentaBanco ? 'itensRouboBanco' : 'itensRoubo';
  const campoEquipado = ferramentaBanco ? 'equiparouboBanco' : 'equiparoubo';

  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: `⚠️ Item *${itemSlug}* não existe!\nUse *!menuroubar* para ver os disponíveis.`,
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(userId, idGrupo);
  const qtd = getItemQtd(carteira[campoInventario], itemSlug);

  if (qtd <= 0) {
    await sock.sendMessage(jid, {
      text:
        `❌ Você não possui *${itemInfo.nome}* neste grupo!\n\n` +
        `🛒 Compre com *!buyroubo ${itemSlug}*`,
    }, { quoted: msg });
    return;
  }

  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: userId, idGrupo },
    { $set: { [campoEquipado]: itemSlug } }
  );

  const taxaBase = ferramentaBanco ? TAXA_SUCESSO_BASE_BANCO : TAXA_SUCESSO_BASE;
  const taxaFinal = Math.min(TAXA_MAX, taxaBase + itemInfo.bonus);
  const destino = ferramentaBanco ? '!roubarbanco @pessoa' : '!roubar @pessoa';

  await sock.sendMessage(jid, {
    text:
      `✅ *${ferramentaBanco ? 'FERRAMENTA BANCÁRIA' : 'ITEM DE ROUBO'} EQUIPADO!* ✅\n\n` +
      `🎭 *Item:* ${itemInfo.nome}\n` +
      `📈 *Bônus de sucesso:* +${itemInfo.bonus}%\n` +
      `🎲 *Taxa com este item:* até *${taxaFinal}%*\n` +
      `🎒 *No inventário:* ${qtd}x\n\n` +
      `🔫 Agora use *${destino}* para atacar!`,
  }, { quoted: msg });
}

// ─── !equiparsec ──────────────────────────────────────────────────────────────

async function handleEquiparSec(sock, msg, jid, caption) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);
  const match   = caption.match(/equiparsec\s+(\S+)/i);

  if (!match) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!equiparsec <item>*\nExemplo: *!equiparsec cofre*',
    }, { quoted: msg });
    return;
  }

  const itemSlug = match[1].toLowerCase().trim();
  const itemInfo = ITENS_SEGURANCA[itemSlug];

  if (!itemInfo) {
    await sock.sendMessage(jid, {
      text: `⚠️ Item *${itemSlug}* não existe!\nUse *!menusec* para ver os disponíveis.`,
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(userId, idGrupo);
  const qtd      = getItemQtd(carteira.itensSec, itemSlug);

  if (qtd <= 0) {
    await sock.sendMessage(jid, {
      text:
        `❌ Você não possui *${itemInfo.nome}* neste grupo!\n\n` +
        `🛒 Compre com *!buysec ${itemSlug}*`,
    }, { quoted: msg });
    return;
  }

  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: userId, idGrupo },
    { $set: { equiparsec: itemSlug } }
  );

  const defesaFinal = Math.min(TAXA_MAX, TAXA_SUCESSO_BASE + itemInfo.defesa);

  await sock.sendMessage(jid, {
    text:
      `✅ *DEFESA ATIVADA!* ✅\n\n` +
      `🔐 *Item:* ${itemInfo.nome}\n` +
      `🛡️ *Proteção:* +${itemInfo.defesa}%\n` +
      `🔒 *Chance de resistir:* até *${defesaFinal}%*\n` +
      `🎒 *No inventário:* ${qtd}x`,
  }, { quoted: msg });
}

// ─── !invroubo ────────────────────────────────────────────────────────────────

async function handleInvRoubo(sock, msg, jid) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);

  const carteira = await getCarteira(userId, idGrupo);
  const secoes = [
    {
      titulo: '🎭 ITENS PARA ROUBO COMUM',
      catalogo: ITENS_ROUBO,
      inventario: carteira.itensRoubo,
      equipado: carteira.equiparoubo,
      taxaBase: TAXA_SUCESSO_BASE,
    },
    {
      titulo: '🏦 FERRAMENTAS PARA ASSALTO A BANCO',
      catalogo: ITENS_ROUBO_BANCO,
      inventario: carteira.itensRouboBanco,
      equipado: carteira.equiparouboBanco,
      taxaBase: TAXA_SUCESSO_BASE_BANCO,
    },
  ];
  let texto = `🎒 ═══ SEUS ITENS DE ROUBO ═══ 🎒\n\n`;
  let possuiItens = false;

  for (const secao of secoes) {
    texto += `*${secao.titulo}*\n`;
    let possuiNaSecao = false;

    for (const [key, item] of Object.entries(secao.catalogo)) {
      const qtd = getItemQtd(secao.inventario, key);
      if (qtd > 0) {
        possuiItens = true;
        possuiNaSecao = true;
        const tag = secao.equipado === key ? ' ⚡ *EQUIPADO*' : '';
        texto += `  ${item.nome}${tag}\n`;
        texto += `    └ Qtd: *${qtd}x* | Bônus: *+${item.bonus}%*\n`;
      }
    }

    if (!possuiNaSecao) {
      texto += `_Nenhum item nesta categoria._\n`;
    } else {
      const itemEquipado = secao.equipado && secao.catalogo[secao.equipado];
      if (itemEquipado) {
        const taxaAtual = Math.min(TAXA_MAX, secao.taxaBase + itemEquipado.bonus);
        texto += `📈 Bônus ativo: *+${itemEquipado.bonus}%* | Chance antes da defesa: *${taxaAtual}%*\n`;
      } else {
        texto += `⚠️ Nenhum item desta categoria equipado.\n`;
      }
    }
    texto += `\n━━━━━━━━━━━━━━━━\n\n`;
  }

  if (!possuiItens) {
    texto += `🛒 Compre itens e ferramentas em *!menuroubar* com *!buyroubo <item>*`;
  } else {
    texto += `Use *!equiparroubo <item>* para escolher o equipamento de cada categoria.`;
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !invsec ──────────────────────────────────────────────────────────────────

async function handleInvSec(sock, msg, jid) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);

  const carteira = await getCarteira(userId, idGrupo);

  let texto   = `🔐 ═══ SEUS ITENS DE SEGURANÇA ═══ 🔐\n\n`;
  let temItem = false;

  for (const [key, item] of Object.entries(ITENS_SEGURANCA)) {
    const qtd = getItemQtd(carteira.itensSec, key);
    if (qtd > 0) {
      temItem = true;
      const ativo = carteira.equiparsec === key;
      const tag = ativo ? ' ⚡ *ATIVO*' : '';
      texto += `  ${item.nome}${tag}\n`;
      texto += `    └ Qtd: *${qtd}x* | Defesa: *+${item.defesa}%*\n`;
    }
  }

  if (!temItem) {
    texto += `😔 Você não possui nenhum item de segurança neste grupo.\n\n`;
    texto += `🛒 Compre itens com *!menusec*!`;
  } else {
    texto += `\n━━━━━━━━━━━━━━━━\n`;

    const eqKey = carteira.equiparsec;
    const eq    = eqKey && ITENS_SEGURANCA[eqKey];

    if (eq) {
      const chanceResistir = Math.min(TAXA_MAX, TAXA_SUCESSO_BASE + eq.defesa);
      texto += `⚡ *Ativo:* ${eq.nome}\n`;
      texto += `🛡️ *Defesa ativa:* +${eq.defesa}% de proteção\n`;
      texto += `🔒 *Chance de resistir:* até ${chanceResistir}%`;
    } else {
      texto += `⚠️ *Nenhuma defesa ativa!*\n`;
      texto += `Use *!equiparsec <item>* para ativar.`;
    }
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !meiosec ─────────────────────────────────────────────────────────────────

async function handleMeioSec(sock, msg, jid) {
  const userId  = getUserId(msg);
  const idGrupo = getGroupId(msg, jid);

  const carteira = await getCarteira(userId, idGrupo);

  let texto = `🛡️ ═══ SUAS DEFESAS ATIVAS ═══ 🛡️\n\n`;

  const eq = carteira.equiparsec && ITENS_SEGURANCA[carteira.equiparsec];
  if (eq) {
    const defesaFinal = Math.min(TAXA_MAX, TAXA_SUCESSO_BASE + eq.defesa);
    texto += `✅ *Defesa equipada:* ${eq.nome}\n`;
    texto += `🔒 *Proteção:* +${eq.defesa}%\n\n`;
    texto += `━━━━━━━━━━━━━━━━\n`;
    texto += `📊 *Como funciona:*\n`;
    texto += `  Base de defesa: *${TAXA_SUCESSO_BASE}%*\n`;
    texto += `  Bônus do item: *+${eq.defesa}%*\n`;
    texto += `  🛡️ Total: *${defesaFinal}%* de chance de resistir\n\n`;
    texto += `🔄 Troque com *!equiparsec <item>*`;
  } else {
    texto += `❌ *Nenhuma defesa ativa!*\n\n`;
    texto += `⚠️ Sem defesa você tem apenas *${TAXA_SUCESSO_BASE}%* de chance de resistir!\n`;
    texto += `🛒 Compre com *!menusec* e equipe com *!equiparsec <item>*`;
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── !roubar @pessoa ──────────────────────────────────────────────────────────

async function handleRoubar(sock, msg, jid) {
  const atacanteId  = getUserId(msg);
  const vitimaIdRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const vitimaId    = vitimaIdRaw ? (normalizarJid(vitimaIdRaw) || vitimaIdRaw) : null;
  const idGrupo     = getGroupId(msg, jid);

  // ── Validações básicas ───────────────────────────────────────────────────────
  if (!vitimaId) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!roubar @pessoa*\nMencione quem você quer roubar!',
    }, { quoted: msg });
    return;
  }

  if (atacanteId === vitimaId) {
    await sock.sendMessage(jid, { text: '❌ Você não pode se roubar!' }, { quoted: msg });
    return;
  }
  // ── Buscar carteiras em paralelo ─────────────────────────────────────────────
  const [carteiraAtacante, carteiraVitima] = await Promise.all([
    getCarteira(atacanteId, idGrupo),
    getCarteira(vitimaId,   idGrupo),
  ]);

  // ── Item equipado obrigatório ────────────────────────────────────────────────
  const itemSlugAtaque = carteiraAtacante.equiparoubo;
  const itemAtaque     = itemSlugAtaque && ITENS_ROUBO[itemSlugAtaque];

  if (!itemAtaque) {
    await sock.sendMessage(jid, {
      text:
        `❌ *Você precisa equipar um item de roubo antes!*\n\n` +
        `🛒 Compre com *!menuroubar*\n` +
        `⚡ Equipe com *!equiparroubo <item>*`,
    }, { quoted: msg });
    return;
  }

  // ── Confere se ainda tem o item em estoque (mesma checagem do !roubarbanco) ──
  const qtdItemAtaque = getItemQtd(carteiraAtacante.itensRoubo, itemSlugAtaque);
  if (qtdItemAtaque <= 0) {
    await sock.sendMessage(jid, {
      text:
        `❌ Você não possui mais *${itemAtaque.nome}* no inventário!\n\n` +
        `🛒 Compre com *!buyroubo ${itemSlugAtaque}*`,
    }, { quoted: msg });
    return;
  }

  // ── Cooldown / Preso ──────────────────────────────────────────────────────────
  const agora = Date.now();

  // Verifica se está preso
  const prestoAte = carteiraAtacante.prestoAte
    ? new Date(carteiraAtacante.prestoAte).getTime()
    : 0;
  if (agora < prestoAte) {
    const restante = prestoAte - agora;
    await sock.sendMessage(jid, {
      text: `🚔 *VOCÊ ESTÁ PRESO!*\n\nAguarde *${formatarTempo(restante)}* para sair da prisão.`,
    }, { quoted: msg });
    return;
  }

  // Verifica cooldown normal entre tentativas
  const ultimoRoubo  = carteiraAtacante.ultimoRoubo
    ? new Date(carteiraAtacante.ultimoRoubo).getTime()
    : 0;
  const tempoPassado = agora - ultimoRoubo;

  if (tempoPassado < COOLDOWN_ROUBO_MS) {
    const restante = COOLDOWN_ROUBO_MS - tempoPassado;
    await sock.sendMessage(jid, {
      text: `⏱️ *COOLDOWN ATIVO!*\n\nAguarde *${formatarTempo(restante)}* para tentar novamente.`,
    }, { quoted: msg });
    return;
  }

  // ── Verificar imunidade da vítima ────────────────────────────────────────
  const imunidadeAte = _tsOuZero(carteiraVitima.imunidadeRouboAte);
  if (agora < imunidadeAte) {
    const restante = imunidadeAte - agora;
    await sock.sendMessage(jid, {
      text: `🛡️ *VÍTIMA IMUNE!*\n\nEssa pessoa foi roubada recentemente e está protegida por mais *${formatarTempo(restante)}*.`,
    }, { quoted: msg });
    return;
  }

  // ── Verificar saldo da vítima ────────────────────────────────────────────
  const saldoVitima = carteiraVitima.gold ?? 0;
  if (saldoVitima <= 0) {
    await sock.sendMessage(jid, {
      text: '❌ A vítima não tem saldo para roubar neste grupo!',
    }, { quoted: msg });
    return;
  }

  // ── Registrar cooldown ANTES da tentativa ────────────────────────────────────
  // (o cooldown consome mesmo se o roubo falhar — custo da tentativa)
  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: atacanteId, idGrupo },
    { $set: { ultimoRoubo: new Date() } }
  );

  // ── Calcular taxa de sucesso ─────────────────────────────────────────────────
  let taxaSucesso = TAXA_SUCESSO_BASE + itemAtaque.bonus;

  const itemDefesaSlug = carteiraVitima.equiparsec;
  const itemDefesa     = itemDefesaSlug && ITENS_SEGURANCA[itemDefesaSlug];
  if (itemDefesa) {
    taxaSucesso -= itemDefesa.defesa;
  }

  taxaSucesso = Math.max(TAXA_MIN, Math.min(TAXA_MAX, taxaSucesso));

  const rolagem = Math.random() * 100;
  const sucesso = rolagem < taxaSucesso;

  // ── Montar resposta ──────────────────────────────────────────────────────────
  let textoResposta =
    `🎭 ═══ TENTATIVA DE ROUBO! ═══ 🎭\n\n` +
    `🔫 *Arma:* ${itemAtaque.nome}\n`;

  if (itemDefesa) {
    textoResposta += `🛡️ *Defesa da vítima:* ${itemDefesa.nome}\n`;
  }

  textoResposta +=
    `🎲 *Rolagem:* ${rolagem.toFixed(1)} / ${taxaSucesso}% necessário\n` +
    `━━━━━━━━━━━━━━━━\n`;

  // ── Consumir item de ataque (sempre, independente do resultado) ──────────
  // Reaproveita o documento retornado pelo próprio decremento — evita um
  // round-trip extra ao banco só para checar se o estoque zerou.
  const carteiraAtacanteAtualizada = await incrementarItem(atacanteId, idGrupo, 'itensRoubo', itemSlugAtaque, -1);
  const qtdItemAtaqueRestante = carteiraAtacanteAtualizada
    ? getItemQtd(carteiraAtacanteAtualizada.itensRoubo, itemSlugAtaque)
    : Math.max(0, getItemQtd(carteiraAtacante.itensRoubo, itemSlugAtaque) - 1); // fallback se a guarda atômica bloqueou

  // ── Consumir item de defesa da vítima (se houver, sempre) ────────────────
  if (itemDefesa) {
    const carteiraVitAtualizada = await incrementarItem(vitimaId, idGrupo, 'itensSec', itemDefesaSlug, -1);
    const qtdDefesaRestante = carteiraVitAtualizada
      ? getItemQtd(carteiraVitAtualizada.itensSec, itemDefesaSlug)
      : Math.max(0, getItemQtd(carteiraVitima.itensSec, itemDefesaSlug) - 1);

    if (qtdDefesaRestante <= 0) {
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: vitimaId, idGrupo },
        { $unset: { equiparsec: '' } }
      );
    }
  }

  if (qtdItemAtaqueRestante <= 0) {
    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: atacanteId, idGrupo },
      { $unset: { equiparoubo: '' } }
    );
  }

  if (sucesso) {
    // ── Roubo bem-sucedido ──────────────────────────────────────────────────
    const pct          = Math.floor(Math.random() * (ROUBO_MAX_PCT - ROUBO_MIN_PCT + 1)) + ROUBO_MIN_PCT;
    const ouroRoubado  = Math.max(1, Math.floor(saldoVitima * pct / 100));

    const { debitado, carteira: carteiraVitimaAtualizada } = await alterarGoldSeguro(
      vitimaId, idGrupo, -ouroRoubado, `Roubado por ${atacanteId}`
    );

    if (debitado === 0) {
      textoResposta +=
        `😅 *AZAR!*\n\n` +
        `A vítima ficou sem saldo no último segundo!\n` +
        `🗑️ *Item consumido:* ${itemAtaque.nome}\n` +
        `⏱️ *Próxima tentativa em:* ${formatarTempo(COOLDOWN_ROUBO_MS)}`;
      await sock.sendMessage(jid, { text: textoResposta }, { quoted: msg });
      return;
    }

    const carteiraAtualizada = await alterarGold(
      atacanteId, idGrupo, debitado, `Roubou de ${vitimaId}`
    );

    await incrementMission(atacanteId, 'roubo3', 1).catch(() => {});

    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: vitimaId, idGrupo },
      {
        $set: {
          imunidadeRouboAte: new Date(agora + IMUNIDADE_ROUBO_MS),
          lastRobbedBy:      atacanteId,
          lastRobbedAmount:  debitado,
          lastRobbedAt:      new Date(),
        },
      }
    );

    textoResposta +=
      `✅ *ROUBO BEM-SUCEDIDO!*\n\n` +
      `💰 *Valor roubado:* ${formatarSaldo(debitado, carteiraAtualizada)} (${pct}% do saldo)\n` +
      `👤 *Seu novo saldo:* ${formatarSaldo(carteiraAtualizada.gold, carteiraAtualizada)}\n` +
      `😢 *Saldo da vítima:* ${formatarSaldo(carteiraVitimaAtualizada.gold, carteiraVitimaAtualizada)}\n` +
      `🗑️ *Item consumido:* ${itemAtaque.nome}\n` +
      (itemDefesa ? `🛡️ *Defesa da vítima consumida:* ${itemDefesa.nome}\n` : ``) +
      `💡 A vítima pode usar *!policia @você* nas próximas 2h!`;
  } else {
    // ── Roubo fracassado — vai preso ────────────────────────────────────────
    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: atacanteId, idGrupo },
      { $set: { prestoAte: new Date(agora + COOLDOWN_PRESO_MS) } }
    );

    textoResposta +=
      `❌ *ROUBO FRACASSADO!*\n\n` +
      `🚔 A polícia chegou e te prendeu!\n` +
      `😌 *Saldo da vítima:* ${formatarSaldo(saldoVitima, carteiraVitima)} (intacto)\n` +
      `🗑️ *Item consumido:* ${itemAtaque.nome}\n` +
      (itemDefesa ? `🛡️ *Defesa da vítima consumida:* ${itemDefesa.nome}\n` : ``) +
      `🔒 *Você ficará preso por:* ${formatarTempo(COOLDOWN_PRESO_MS)}`;
  }

  await sock.sendMessage(jid, { text: textoResposta }, { quoted: msg });
}

// ─── Helpers locais ───────────────────────────────────────────────────────────

function _tsOuZero(valor) {
  if (!valor) return 0;
  const ts = new Date(valor).getTime();
  return isNaN(ts) ? 0 : ts;
}

/**
 * Retorna todas as "formas" conhecidas de um JID (ele mesmo + o par @lid/@pn
 * cadastrado no LidMapping). Sem isso, comparar lastRobbedBy === mentionedJid
 * falha sempre que o WhatsApp entrega a menção num formato diferente do que
 * foi salvo no momento do roubo.
 */
async function resolverVariantesJid(jid) {
  if (!jid) return [];
  const variantes = new Set([jid]);
  try {
    if (jid.endsWith('@lid')) {
      const map = await LidMapping.findOne({ lid: jid }).lean();
      if (map?.pn) variantes.add(map.pn);
    } else {
      const map = await LidMapping.findOne({ pn: jid }).lean();
      if (map?.lid) variantes.add(map.lid);
    }
  } catch (e) {
    console.error('⚠️ Erro ao resolver variantes de JID (roubo):', e.message);
  }
  return [...variantes];
}

function _buildTextoCaptura(numeroLadrao, debitavel = 0) {
  const cabecalho =
    `✅ *LADRÃO PRESO!*\n\n` +
    `🚔 @${numeroLadrao} foi capturado!\n` +
    `🔒 *Ficará preso por mais:* ${formatarTempo(COOLDOWN_PRESO_MS)}\n`;

  if (debitavel > 0) {
    return cabecalho + `💰 *Saldo recuperado:* ${formatarSaldo(debitavel)} (${DEVOLUCAO_POLICIA}% do roubado)`;
  }
  return cabecalho + `😔 O ladrão não tem saldo para devolver.`;
}

// ─── !policia @ladrão ─────────────────────────────────────────────────────────

async function handlePolicia(sock, msg, jid) {
  const vitimaId = getUserId(msg);
  // O roteador aceita mensagens encapsuladas pelo WhatsApp (ex.: temporárias).
  // Extrair a menção do mesmo conteúdo normalizado evita perder o alvo quando
  // o comando chega dentro de ephemeral/view-once.
  const content =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message;
  const ladraoRaw = content?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const ladrao    = ladraoRaw ? (normalizarJid(ladraoRaw) || ladraoRaw) : null;
  const idGrupo   = getGroupId(msg, jid);
  const agora     = Date.now();

  // ── Validações rápidas ────────────────────────────────────────────────────
  if (!ladrao) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!policia @ladrão*\nMencione quem te roubou!',
    }, { quoted: msg });
    return;
  }

  if (vitimaId === ladrao) {
    await sock.sendMessage(jid, {
      text: '❌ Você não pode chamar a polícia em si mesmo!',
    }, { quoted: msg });
    return;
  }
  // ── Buscar carteiras em paralelo ──────────────────────────────────────────
  const [carteiraVitima, carteiraLadrao] = await Promise.all([
    getCarteira(vitimaId, idGrupo),
    getCarteira(ladrao,   idGrupo),
  ]);

  // ── Verificar janela de roubo (imunidade) ─────────────────────────────────
  const imunidadeAte = _tsOuZero(carteiraVitima.imunidadeRouboAte);

  // Compara contra todas as variantes conhecidas do ladrão (@lid ↔ número real)
  // — o mentionedJid da menção pode vir num formato diferente do que foi
  // gravado em lastRobbedBy no momento do !roubar.
  const variantesLadrao = await resolverVariantesJid(ladrao);

  if (!variantesLadrao.includes(carteiraVitima.lastRobbedBy) || agora > imunidadeAte) {
    await sock.sendMessage(jid, {
      text:
        `❌ *NÃO É POSSÍVEL CHAMAR A POLÍCIA!*\n\n` +
        `Você só pode acionar a polícia contra quem te roubou nas últimas 2 horas.`,
    }, { quoted: msg });
    return;
  }

  // ── Cooldown anti-spam ────────────────────────────────────────────────────
  const ultimaPolicia = _tsOuZero(carteiraVitima.ultimaPolicia);
  const restanteCd    = COOLDOWN_POLICIA_MS - (agora - ultimaPolicia);

  if (restanteCd > 0) {
    await sock.sendMessage(jid, {
      text: `⏱️ Aguarde *${formatarTempo(restanteCd)}* para acionar a polícia novamente.`,
    }, { quoted: msg });
    return;
  }

  // ── Registrar chamada (antes da rolagem para evitar spam em erro) ─────────
  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: vitimaId, idGrupo },
    { $set: { ultimaPolicia: new Date() } }
  );

  // ── Rolagem ───────────────────────────────────────────────────────────────
  const rolagem      = Math.random() * 100;
  const prendeu      = rolagem < CHANCE_POLICIA;
  const numeroLadrao = ladrao.split('@')[0].replace(/\D/g, '');

  let textoResultado;

  if (prendeu) {
    // Estender prisão acumulando o tempo restante atual
    const prestoAteAtual = _tsOuZero(carteiraLadrao.prestoAte);
    const novoPrestoAte  = Math.max(agora, prestoAteAtual) + COOLDOWN_PRESO_MS;

    const valorRoubado  = carteiraVitima.lastRobbedAmount ?? 0;
    const valorDevolver = Math.floor(valorRoubado * DEVOLUCAO_POLICIA / 100);
    const saldoLadrao   = carteiraLadrao.gold ?? 0;
    const debitavel     = Math.min(valorDevolver, saldoLadrao);

    // Todas as escritas em paralelo
    const ops = [
      CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: ladrao, idGrupo },
        { $set: { prestoAte: new Date(novoPrestoAte) } }
      ),
    ];

    if (debitavel > 0) {
      ops.push(
        alterarGold(ladrao,   idGrupo, -debitavel, `Apreensão policial para ${vitimaId}`),
        alterarGold(vitimaId, idGrupo,  debitavel, `Recuperado pela polícia de ${ladrao}`)
      );
    }

    await Promise.all(ops);

    textoResultado = _buildTextoCaptura(numeroLadrao, debitavel);
  } else {
    textoResultado =
      `❌ *LADRÃO ESCAPOU!*\n\n` +
      `🏃 @${numeroLadrao} conseguiu fugir da polícia!\n` +
      `😔 Nenhum saldo foi recuperado.`;
  }

  const texto =
    `👮 ═══ ACIONANDO A POLÍCIA! ═══ 👮\n\n` +
    `🎲 *Rolagem:* ${rolagem.toFixed(1)} / ${CHANCE_POLICIA}% necessário\n` +
    `━━━━━━━━━━━━━━━━\n` +
    textoResultado;

  await sock.sendMessage(jid, { text: texto, mentions: [ladrao] }, { quoted: msg });
}

// ─── Configuração !roubarbanco ────────────────────────────────────────────────

const COOLDOWN_ROUBARBANCO_MS = 30 * 60 * 1000;  // 30min entre tentativas
const COOLDOWN_PRESO_BANCO_MS =  4 * 60 * 60 * 1000; // 4h preso se falhar
const TAXA_SUCESSO_BASE_BANCO = 30; // % base (menor que roubo normal)
const MULTA_FALHA_PCT         = 10; // % do gold perdido se falhar
const ROUBO_BANCO_MIN_PCT     = 20; // % mínimo do banco.amount roubado
const ROUBO_BANCO_MAX_PCT     = 40; // % máximo do banco.amount roubado

/**
 * Calcula o intervalo de % roubável do banco baseado no bônus do item.
 * Item melhor → teto mais alto, podendo chegar até 55%.
 */
function calcularPctBanco(bonusItem) {
  const min = ROUBO_BANCO_MIN_PCT;
  const max = Math.min(55, ROUBO_BANCO_MAX_PCT + Math.floor(bonusItem / 10));
  return { min, max };
}

async function consumirFerramentaBanco(atacanteId, idGrupo, itemSlug, carteiraAtacante) {
  const atualizada = await incrementarItem(atacanteId, idGrupo, 'itensRouboBanco', itemSlug, -1);
  const restante = atualizada
    ? getItemQtd(atualizada.itensRouboBanco, itemSlug)
    : Math.max(0, getItemQtd(carteiraAtacante.itensRouboBanco, itemSlug) - 1);

  if (restante <= 0) {
    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: atacanteId, idGrupo },
      { $unset: { equiparouboBanco: '' } }
    );
  }
}

// ─── !roubarbanco @pessoa ─────────────────────────────────────────────────────

async function handleRoubarBanco(sock, msg, jid) {
  const atacanteId  = getUserId(msg);
  const vitimaIdRaw = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const vitimaId    = vitimaIdRaw ? (normalizarJid(vitimaIdRaw) || vitimaIdRaw) : null;
  const idGrupo     = getGroupId(msg, jid);
  const agora       = Date.now();

  // ── Validações básicas ────────────────────────────────────────────────────
  if (!vitimaId) {
    await sock.sendMessage(jid, {
      text:
        '⚠️ Use: *!roubarbanco @pessoa*\n' +
        'Mencione quem você quer assaltar no banco!',
    }, { quoted: msg });
    return;
  }

  if (atacanteId === vitimaId) {
    await sock.sendMessage(jid, {
      text: '❌ Você não pode roubar seu próprio banco!',
    }, { quoted: msg });
    return;
  }
  // ── Buscar carteiras em paralelo ──────────────────────────────────────────
  const [carteiraAtacante, carteiraVitima] = await Promise.all([
    getCarteira(atacanteId, idGrupo),
    getCarteira(vitimaId,   idGrupo),
  ]);

  // ── Item equipado obrigatório ─────────────────────────────────────────────
  const itemSlugAtaque = carteiraAtacante.equiparouboBanco;
  const itemAtaque     = itemSlugAtaque && ITENS_ROUBO_BANCO[itemSlugAtaque];

  if (!itemAtaque) {
    await sock.sendMessage(jid, {
      text:
        `❌ *Você precisa equipar uma ferramenta de banco antes!*\n\n` +
        `🛒 Compre com *!menuroubar*\n` +
        `⚡ Equipe com *!equiparroubarbanco <item>*`,
    }, { quoted: msg });
    return;
  }

  // ── Verificar se atacante tem o item no inventário (vai consumir se falhar) ─
  const qtdItem = getItemQtd(carteiraAtacante.itensRouboBanco, itemSlugAtaque);
  if (qtdItem <= 0) {
    await sock.sendMessage(jid, {
      text:
        `❌ Você não possui *${itemAtaque.nome}* no inventário!\n\n` +
        `🛒 Compre com *!buyroubarbanco ${itemSlugAtaque}*`,
    }, { quoted: msg });
    return;
  }

  // ── Verificar imunidade da vítima (mesma regra do !roubar) ────────────────
  const imunidadeAte = _tsOuZero(carteiraVitima.imunidadeRouboAte);
  if (agora < imunidadeAte) {
    const restante = imunidadeAte - agora;
    await sock.sendMessage(jid, {
      text: `🛡️ *VÍTIMA IMUNE!*\n\nEssa pessoa foi roubada recentemente e está protegida por mais *${formatarTempo(restante)}*.`,
    }, { quoted: msg });
    return;
  }

  // ── Preso? ────────────────────────────────────────────────────────────────
  const prestoAte = _tsOuZero(carteiraAtacante.prestoAte);
  if (agora < prestoAte) {
    await sock.sendMessage(jid, {
      text: `🚔 *VOCÊ ESTÁ PRESO!*\n\nAguarde *${formatarTempo(prestoAte - agora)}* para sair da prisão.`,
    }, { quoted: msg });
    return;
  }

  // ── Cooldown específico do roubarbanco ────────────────────────────────────
  const ultimoRouboBanco = _tsOuZero(carteiraAtacante.ultimoRouboBanco);
  const restanteCd       = COOLDOWN_ROUBARBANCO_MS - (agora - ultimoRouboBanco);
  if (restanteCd > 0) {
    await sock.sendMessage(jid, {
      text: `⏱️ *COOLDOWN ATIVO!*\n\nAguarde *${formatarTempo(restanteCd)}* para tentar assaltar o banco novamente.`,
    }, { quoted: msg });
    return;
  }

  // ── Vítima tem investimento ativo? ────────────────────────────────────────
  const bancoDaVitima = carteiraVitima.banco ?? {};
  const saldoBanco    = bancoDaVitima.amount ?? 0;

  if (saldoBanco <= 0) {
    await sock.sendMessage(jid, {
      text: '❌ *A vítima não possui nenhum investimento ativo no banco!*',
    }, { quoted: msg });
    return;
  }

  // ── Registrar cooldown antes da tentativa ─────────────────────────────────
  await CarteiraGrupo.findOneAndUpdate(
    { idWhatsApp: atacanteId, idGrupo },
    { $set: { ultimoRouboBanco: new Date() } }
  );

  // ── Calcular taxa de sucesso ──────────────────────────────────────────────
  let taxaSucesso = TAXA_SUCESSO_BASE_BANCO + itemAtaque.bonus;

  const itemDefesaSlug = carteiraVitima.equiparsec;
  const itemDefesa     = itemDefesaSlug && ITENS_SEGURANCA[itemDefesaSlug];
  if (itemDefesa) taxaSucesso -= itemDefesa.defesa;

  taxaSucesso = Math.max(TAXA_MIN, Math.min(TAXA_MAX, taxaSucesso));

  const rolagem = Math.random() * 100;
  const sucesso = rolagem < taxaSucesso;

  // ── Cabeçalho da resposta ─────────────────────────────────────────────────
  let texto =
    `🏦 ═══ ASSALTO AO BANCO! ═══ 🏦\n\n` +
    `🔫 *Ferramenta:* ${itemAtaque.nome}\n`;

  if (itemDefesa) {
    texto += `🛡️ *Defesa da vítima:* ${itemDefesa.nome}\n`;
  }

  texto +=
    `🎲 *Rolagem:* ${rolagem.toFixed(1)} / ${taxaSucesso}% necessário\n` +
    `━━━━━━━━━━━━━━━━\n`;

  if (sucesso) {
    // ── Sucesso ───────────────────────────────────────────────────────────
    const { min, max } = calcularPctBanco(itemAtaque.bonus);
    const pct          = Math.floor(Math.random() * (max - min + 1)) + min;
    const valorRoubado = Math.max(1, Math.floor(saldoBanco * pct / 100));

    // Debitar do banco da vítima só se ainda houver saldo suficiente —
    // evita banco.amount negativo com assaltos concorrentes.
    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: vitimaId, idGrupo, 'banco.amount': { $gte: valorRoubado } },
      { $inc: { 'banco.amount': -valorRoubado } }
    );

    // Creditar atacante
    const carteiraAtualizada = await alterarGold(
      atacanteId, idGrupo, valorRoubado, `Assaltou banco de ${vitimaId}`
    );

    await consumirFerramentaBanco(atacanteId, idGrupo, itemSlugAtaque, carteiraAtacante);

    texto +=
      `✅ *ASSALTO BEM-SUCEDIDO!*\n\n` +
      `🏦 *Roubado do banco:* ${formatarSaldo(valorRoubado, carteiraAtualizada)} (${pct}% do investimento)\n` +
      `💰 *Seu novo saldo:* ${formatarSaldo(carteiraAtualizada.gold, carteiraAtualizada)}\n` +
      `🏦 *Banco da vítima restante:* ${formatarSaldo(saldoBanco - valorRoubado, carteiraVitima)}\n` +
      `🗑️ *Item consumido:* ${itemAtaque.nome}\n\n` +
      `💡 A vítima pode usar *!policia @você* nas próximas 2h!`;

    // Registrar para o !policia funcionar
    await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: vitimaId, idGrupo },
      {
        $set: {
          imunidadeRouboAte: new Date(agora + IMUNIDADE_ROUBO_MS),
          lastRobbedBy:      atacanteId,
          lastRobbedAmount:  valorRoubado,
          lastRobbedAt:      new Date(),
        },
      }
    );

  } else {
    // ── Falha — prisão 4h + multa 10% gold + consome item ────────────────
    const saldoAtacante = carteiraAtacante.gold ?? 0;
    const multa         = Math.max(1, Math.floor(saldoAtacante * MULTA_FALHA_PCT / 100));

    await Promise.all([
      // 4h preso
      CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: atacanteId, idGrupo },
        { $set: { prestoAte: new Date(agora + COOLDOWN_PRESO_BANCO_MS) } }
      ),
      // Multa em gold — versão "segura" que nunca lança erro por saldo
      // insuficiente, só debita o que houver (evita crash com gold baixo/zerado).
      alterarGoldSeguro(atacanteId, idGrupo, -multa, 'Multa por falha no assalto ao banco'),
      // Consome 1 item equipado
      consumirFerramentaBanco(atacanteId, idGrupo, itemSlugAtaque, carteiraAtacante),
    ]);

    texto +=
      `❌ *ASSALTO FRACASSADO!*\n\n` +
      `🚔 A segurança do banco te capturou!\n\n` +
      `*PUNIÇÕES:*\n` +
      `  🔒 Preso por: *${formatarTempo(COOLDOWN_PRESO_BANCO_MS)}*\n` +
      `  💸 Multa: *${formatarSaldo(multa, carteiraAtacante)}* (10% do seu saldo)\n` +
      `  🗑️ Item destruído: *${itemAtaque.nome}*\n\n` +
      `😌 *Banco da vítima:* ${formatarSaldo(saldoBanco, carteiraVitima)} (intacto)`;
  }

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── Exportar ─────────────────────────────────────────────────────────────────

module.exports = {
  ITENS_ROUBO,
  ITENS_ROUBO_BANCO,
  ITENS_SEGURANCA,
  handleMenuRoubo,
  handleMenuSec,
  handleComprarRoubo,
  handleComprarSec,
  handleEquiparRoubo,
  handleEquiparSec,
  handleInvRoubo,
  handleInvSec,
  handleMeioSec,
  handleRoubar,
  handleRoubarBanco,
  handlePolicia,
};