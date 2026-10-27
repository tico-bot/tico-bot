'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const Usuario       = require(path.join(__dirname, '..', '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', '..', 'models', 'CarteiraGrupo'));
const { getCarteira, comprarComGold, venderComGold, formatarSaldo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const { getSenderJid, resolveGlobalId, resolveUserFromMsg, extrairNumero } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const { ITENS_LOJA } = require(path.join(__dirname, '..', '..', '..', 'config', 'economia'));

// Safe lazy fallback if pesca config is missing
let VARAS_PESCA = {}, ISCAS = {};
try {
  const pescaModule = require(path.join(__dirname, '..', 'pesca'));
  VARAS_PESCA = pescaModule.VARAS_PESCA || {};
  ISCAS = pescaModule.ISCAS || {};
} catch {}

const { resolverItemKey } = require('./_shared');
const { formatWalletAmount, getWalletBalance } = require('../../../utils/carteira/wallet');

async function getMoneyFormatter(msg) {
  const userId = jidNormalizedUser(resolveUserFromMsg(msg));
  const wallet = await getWalletBalance(userId);
  return amount => formatWalletAmount(amount, wallet);
}

async function moedaDaConta() {
  return null; // Este bot usa somente a carteira local.
}

// !gold
async function handleGold(sock, msg, jid, getPrefix, contactNames) {
  const userIdRaw = getSenderJid(msg);
  const userId    = jidNormalizedUser(resolveGlobalId(userIdRaw));
  const idGrupo   = jid;

  try {
    const carteira  = await getCarteira(userId, idGrupo);
    const gold      = carteira?.gold ?? 0;
    const saldoFormatado = formatWalletAmount(gold, carteira);
    const numero    = userId.split('@')[0];
    // msg.pushName é o nome de exibição que o próprio WhatsApp já manda em
    // toda mensagem — funciona mesmo antes do evento contacts.upsert chegar.
    const userName  = contactNames?.[userIdRaw] || contactNames?.[userId] || msg.pushName || numero;

    let status = '🪨 Pobre';
    if (gold >= 1000)     status = '💰 Rico';
    else if (gold >= 500) status = '💵 Abastado';
    else if (gold >= 100) status = '💴 Confortável';

    const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
    const texto =
      `💰 *SALDO DA CONTA* 💰\n\n` +
      `👤 *${userName}*\n` +
      `💵 Saldo ${carteira?.walletLinked ? 'da conta' : 'neste grupo'}: *${saldoFormatado}*\n` +
      `📊 Status: ${status}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `*FORMAS DE GANHAR:*\n` +
      `  📋 Missões: ${P}missao\n` +
      `  ⛏️ Garimpar: ${P}garimpar\n` +
      `  🎲 Apostar: ${P}apostar <valor>\n\n` +
      `*FORMAS DE GASTAR:*\n` +
      `  🛒 Loja: ${P}loja\n` +
      `  🎁 Comprar: ${P}comprar <item>\n` +
      `  💸 PIX: ${P}pix @pessoa <valor>`;

    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
  } catch (e) {
    console.error('⚠️ Erro handleGold:', e.message);
    await sock.sendMessage(jid, { text: '⚠️ Erro ao buscar saldo!' }, { quoted: msg });
  }
}

// !loja
async function handleLoja(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const texto =
    `🛒 *LOJA Tico* 🛒\n\n` +
    `📂 *CATEGORIAS DISPONÍVEIS*\n\n` +
    `🍔 *COMIDA* → ${P}lojafood\n` +
    `🐾 *PETS* → ${P}lojapet\n` +
    `💕 *CASAL* → ${P}lojacasal\n` +
    `💻 *TECNOLOGIA* → ${P}lojatec\n` +
    `🎣 *VARAS DE PESCA* → ${P}lojavara\n` +
    `🪱 *ISCAS* → ${P}lojaisca\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `*COMO COMPRAR?*\n  ${P}buy <nome_item>\n\n` +
    `*SEUS ITENS?*\n  ${P}inventario\n\n` +
    `*VENDER ITENS?*\n  ${P}vender <item>`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// !lojafood
async function handleLojaFood(sock, msg, jid, getPrefix) {
  const formatMoney = await getMoneyFormatter(msg);
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const currencyInfo = await moedaDaConta(msg);
  const categorias = {
    '🍕 PRINCIPAIS': ['pizza', 'hamburger', 'frango', 'picanha'],
    '🍫 DOCES':      ['chocolate', 'bolo'],
    '🥤 BEBIDAS':    ['refrigerante', 'cerveja'],
  };

  let texto = `🍔 ═══ LOJA DE COMIDA ═══ 🍔\n*ITENS DISPONÍVEIS:*\n`;
  for (const [cat, keys] of Object.entries(categorias)) {
    texto += `\n${cat}\n`;
    for (const k of keys) {
      const item = ITENS_LOJA[k];
      if (item) {
        texto += `  🍽️ ${item.nome} — *${formatMoney(item.preco)}*\n`;
        texto += `    └ chave: \`${k}\`\n`;
      }
    }
  }
  texto +=
    `━━━━━━━━━━━━━━━━\n` +
    `*COMANDOS:*\n` +
    `  ${P}buy <item>      — Comprar item\n` +
    `  ${P}inventario      — Ver seus itens\n` +
    `  ${P}vender <item>   — Vender item`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// !lojapet
async function handleLojaPet(sock, msg, jid, getPrefix) {
  const formatMoney = await getMoneyFormatter(msg);
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const currencyInfo = await moedaDaConta(msg);
  const categorias = {
    '🦴 COMIDAS':      ['racao', 'racaopremium', 'carnefresh', 'peixe', 'leite'],
    '🎾 BRINQUEDOS':   ['bolinha', 'pelucia', 'corda', 'disco', 'casabrinquedo'],
    '💊 MEDICAMENTOS': ['remedio', 'vacina', 'shampoo', 'sabonete'],
    '🎀 ACESSÓRIOS':   ['coleira', 'coleiraouro', 'bandana', 'coroa'],
  };

  let texto = `🐾 ═══ LOJA DE PETS ═══ 🐾\n*ITENS DISPONÍVEIS:*\n`;
  for (const [cat, keys] of Object.entries(categorias)) {
    texto += `\n${cat}\n`;
    for (const k of keys) {
      const item = ITENS_LOJA[k];
      if (item) {
        texto += `  🐾 ${item.nome} — *${formatMoney(item.preco)}*\n`;
        texto += `    └ chave: \`${k}\`\n`;
      }
    }
  }
  texto +=
    `━━━━━━━━━━━━━━━━\n` +
    `*COMANDOS:*\n` +
    `  ${P}buy <item>      — Comprar item\n` +
    `  ${P}inventario      — Ver seus itens\n` +
    `  ${P}vender <item>   — Vender item`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// !lojatec
async function handleLojaTec(sock, msg, jid, getPrefix) {
  const formatMoney = await getMoneyFormatter(msg);
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const currencyInfo = await moedaDaConta(msg);
  const categorias = {
    '🖥️ COMPUTADORES': ['notebook', 'pcgamerlegendario'],
    '📱 SMARTPHONES':  ['celular', 'smartphonebasico'],
    '🎮 PERIFÉRICOS':  ['mousegamer', 'monitor24'],
    '🎧 ÁUDIO':        ['fonesemfio'],
    '💾 ARMAZENAMENTO':['ssd1tb'],
  };

  let texto = `💻 ═══ LOJA DE TECNOLOGIA ═══ 💻\n*ITENS DISPONÍVEIS:*\n`;
  for (const [cat, keys] of Object.entries(categorias)) {
    texto += `\n${cat}\n`;
    for (const k of keys) {
      const item = ITENS_LOJA[k];
      if (item) {
        texto += `  💻 ${item.nome} — *${formatMoney(item.preco)}*\n`;
        texto += `    └ chave: \`${k}\`\n`;
      }
    }
  }
  texto +=
    `━━━━━━━━━━━━━━━━\n` +
    `*COMANDOS:*\n` +
    `  ${P}buy <item>      — Comprar item\n` +
    `  ${P}inventario      — Ver seus itens\n` +
    `  ${P}vender <item>   — Vender item`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// !lojacasal
async function handleLojaCasal(sock, msg, jid, getPrefix) {
  const formatMoney = await getMoneyFormatter(msg);
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const currencyInfo = await moedaDaConta(msg);
  const categorias = {
    '🎁 PRESENTES ROMÂNTICOS': ['flores', 'carta', 'morango', 'urso', 'caixa'],
    '💎 JOIAS':                ['anel'],
    '🍷 BEBIDAS E GOURMET':    ['garrafa', 'perfume'],
  };

  let texto = `💕 ═══ LOJA DE CASAL ═══ 💕\n*ITENS DISPONÍVEIS:*\n`;
  for (const [cat, keys] of Object.entries(categorias)) {
    texto += `\n${cat}\n`;
    for (const k of keys) {
      const item = ITENS_LOJA[k];
      if (item) {
        texto += `  💕 ${item.nome} — *${formatMoney(item.preco)}*\n`;
        texto += `    └ chave: \`${k}\`\n`;
      }
    }
  }
  texto +=
    `━━━━━━━━━━━━━━━━\n` +
    `*COMANDOS:*\n` +
    `  ${P}buy <item>      — Comprar item\n` +
    `  ${P}inventario      — Ver seus itens\n` +
    `  ${P}vender <item>   — Vender item\n\n` +
    `💑 _Mostre seu amor com presentes incríveis!_`;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// !buy
async function handleComprar(sock, msg, jid, caption) {
  const userId  = jidNormalizedUser(resolveUserFromMsg(msg));
  const idGrupo = jid;
  const match   = caption.match(/buy\s+(.+)/i);

  if (!match) {
    await sock.sendMessage(jid, { text: '⚠️ Use: *!buy <nome_do_item>*\nExemplo: *!buy pizza*' }, { quoted: msg });
    return;
  }

  const itemDigitado = match[1].trim();
  const currencyInfo = await moedaDaConta(msg);
  const itemNome = resolverItemKey(itemDigitado);

  const itemInfo = itemNome
    ? (ITENS_LOJA[itemNome] || VARAS_PESCA?.[itemNome] || ISCAS?.[itemNome])
    : null;

  if (!itemInfo) {
    const formatMoney = await getMoneyFormatter(msg);
    const lista = Object.entries(ITENS_LOJA)
      .slice(0, 15)
      .map(([, v]) => `  • ${v.nome} (${formatMoney(v.preco)})`)
      .join('\n');
    await sock.sendMessage(jid, {
      text:
        `⚠️ *ITEM NÃO ENCONTRADO*\n\nO item *${itemDigitado}* não existe!\n\n` +
        `━━━━━━━━━━━━━━━━\n*ITENS DISPONÍVEIS:*\n${lista}\n\n` +
        `*USE:*\n  !buy <item>\n  Exemplo: !buy pizza`,
    }, { quoted: msg });
    return;
  }

  const walletBalance = await getWalletBalance(userId);
  if (walletBalance.linked) {
    await sock.sendMessage(jid, {
      text: 'A compra de itens com efeitos no inventário está temporariamente indisponível para contas vinculadas.',
    }, { quoted: msg });
    return;
  }

  const preco   = itemInfo.preco;
  const ehPesca = !!(VARAS_PESCA?.[itemNome] || ISCAS?.[itemNome]);

  const resultado = await comprarComGold({
    idWhatsApp: userId,
    idGrupo,
    preco,
    descricaoGold: `Compra: ${itemInfo.nome}`,
    modeloInventario: ehPesca ? CarteiraGrupo : Usuario,
    filtroInventario: ehPesca
      ? { idWhatsApp: userId, idGrupo }
      : { idWhatsApp: userId },
    campoInventario: ehPesca
      ? `itensPesca.${itemNome}`
      : `inventory.${itemNome}`,
  });

  if (!resultado.ok) {
    if (resultado.motivo === 'GOLD_INSUFICIENTE') {
      const carteiraAtual = await getCarteira(userId, idGrupo);
      const saldoAtual    = carteiraAtual?.gold ?? 0;
      await sock.sendMessage(jid, {
        text:
          `⚠️ *SALDO INSUFICIENTE*\n\nVocê não tem *${formatWalletAmount(preco, walletBalance)}* neste grupo!\n\n` +
          `━━━━━━━━━━━━━━━━\n*SEU SALDO:*\n` +
          `  💰 Disponível: *${formatWalletAmount(saldoAtual, carteiraAtual)}*\n` +
          `  💎 Precisa de: *${formatWalletAmount(preco, carteiraAtual)}*`,
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao processar a compra. Nada foi debitado. Tente novamente.',
    }, { quoted: msg });
    return;
  }

  const saldoFinal = resultado.carteira?.gold ?? 0;

  await sock.sendMessage(jid, {
    text:
      `✅ ═══ COMPRA REALIZADA! ═══ ✅\n\n` +
      `🛒 *Você comprou com sucesso!*\n\n` +
      `━━━━━━━━━━━━━━━━\n*DETALHES:*\n` +
      `  📦 Item: *${itemInfo.nome}*\n` +
      `  💵 Preço: *${formatWalletAmount(preco, walletBalance)}*\n\n` +
      `━━━━━━━━━━━━━━━━\n*SALDO ATUALIZADO:*\n` +
      `  ✅ Novo saldo: *${formatWalletAmount(saldoFinal, resultado.carteira)}*`,
  }, { quoted: msg });
}

// !vender
async function handleVender(sock, msg, jid, caption) {
  const userId = jidNormalizedUser(resolveUserFromMsg(msg));
  const wallet = await getWalletBalance(userId);
  if (wallet.linked) {
    await sock.sendMessage(jid, {
      text: 'A venda direta de itens está temporariamente indisponível para contas vinculadas; seu saldo permanece seguro.',
    }, { quoted: msg });
    return;
  }
  const match  = caption.match(/vender\s+(\S+)\s+(\d+)\s+(\d+)/i);

  if (!match) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!vender <item> <preco> <quantidade>*\nExemplo: *!vender pizza 50 3*',
    }, { quoted: msg });
    return;
  }

  const itemKey        = match[1].toLowerCase().trim();
  const precoDigitado  = parseInt(match[2]);
  const quantidade     = parseInt(match[3]);
  const itemInfo       = ITENS_LOJA[itemKey];

  if (!itemInfo) {
    await sock.sendMessage(jid, { text: `⚠️ Item *${itemKey}* não existe! Use *!loja* para ver os itens.` }, { quoted: msg });
    return;
  }
  if (precoDigitado <= 0 || quantidade <= 0) {
    await sock.sendMessage(jid, { text: '⚠️ Preço e quantidade devem ser maiores que 0!' }, { quoted: msg });
    return;
  }

  // ⚠️ SEGURANÇA: o preço de venda nunca pode ultrapassar o preço oficial
  // do item (itemInfo.preco). Sem esta trava, qualquer pessoa poderia
  // digitar um preço absurdo (ex: !vender pizza 999999999 1) e mintar
  // gold do nada, quebrando toda a economia do bot.
  const preco = Math.min(precoDigitado, itemInfo.preco);

  const user = await Usuario.findOne({ idWhatsApp: userId }).select('inventory').lean();
  const qtdDisponivel = user?.inventory?.[itemKey] ?? 0;

  if (qtdDisponivel < quantidade) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *ESTOQUE INSUFICIENTE*\n\n` +
        `📦 Você tem: *${qtdDisponivel}x ${itemInfo.nome}*\n` +
        `📊 Precisa de: *${quantidade}x*`,
    }, { quoted: msg });
    return;
  }

  const totalRecebido = preco * quantidade;
  const resultado = await venderComGold({
    idWhatsApp: userId,
    idGrupo: jid,
    valorTotal: totalRecebido,
    descricaoGold: `Venda: ${itemInfo.nome} x${quantidade}`,
    modeloInventario: Usuario,
    filtroInventario: { idWhatsApp: userId },
    campoInventario: `inventory.${itemKey}`,
    quantidade,
  });
  if (!resultado.ok) {
    if (resultado.motivo === 'ITEM_INSUFICIENTE') {
      await sock.sendMessage(jid, {
        text: `⚠️ Estoque de *${itemInfo.nome}* mudou antes da venda ser concluída. Tente novamente.`,
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(jid, {
      text: '⚠️ Não foi possível concluir a venda. Seu item continua no inventário.',
    }, { quoted: msg });
    return;
  }

  const carteira = resultado.carteira;

  const avisoPrecoAjustado = preco < precoDigitado
    ? `\n_(preço ajustado para o máximo permitido.)_`
    : '';

  await sock.sendMessage(jid, {
    text:
      `✅ *VENDA REALIZADA!* ✅\n\n` +
      `📦 Item: *${itemInfo.nome}*\n` +
      `💵 Preço unitário: *${formatWalletAmount(preco, carteira)}*${avisoPrecoAjustado}\n` +
      `📊 Quantidade: *${quantidade}*\n` +
      `💰 Total recebido: *${formatWalletAmount(totalRecebido, carteira)}*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💎 Novo saldo: *${formatWalletAmount(carteira?.gold ?? 0, carteira)}*`,
  }, { quoted: msg });
}

// !inventario
const MSG_INVENTARIO_VAZIO =
  `📦 *SEU INVENTÁRIO* 📦\n\n` +
  `Você não possui itens no momento!\n\n` +
  `*COMO GANHAR ITENS?*\n` +
  `  🛒 Comprar na loja: *!loja*\n` +
  `  📋 Completar missões: *!missao*\n\n` +
  `Use *!buy <item>* para começar!`;

async function handleInventario(sock, msg, jid) {
  const userId = jidNormalizedUser(resolveUserFromMsg(msg));

  const [user, carteira] = await Promise.all([
    Usuario.findOne({ idWhatsApp: userId }).select('inventory').lean(),
    getCarteira(userId, jid),
  ]);

  const itensValidos = Object.entries(user?.inventory ?? {})
    .filter(([key, qtd]) => qtd > 0 && ITENS_LOJA[key])
    .map(([key, qtd]) => ({ info: ITENS_LOJA[key], qtd }));

  if (itensValidos.length === 0) {
    await sock.sendMessage(jid, { text: MSG_INVENTARIO_VAZIO }, { quoted: msg });
    return;
  }

  const totalItens = itensValidos.reduce((acc, { qtd }) => acc + qtd, 0);

  const porCategoria = {};
  for (const { info, qtd } of itensValidos) {
    const cat = info.categoria || 'outros';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(`  • ${info.nome} × ${qtd}`);
  }

  const EMOJI_CAT = {
    comida: '🍔', petcomida: '🦴', petbrinquedo: '🎾', petcuidado: '💊',
    petacessorio: '🎀', especial: '⭐', casal: '💕', tec: '💻',
    estilo: '👗', pet: '🐾', outros: '📦',
  };

  const linhas = Object.entries(porCategoria)
    .map(([cat, items]) => `${EMOJI_CAT[cat] ?? '📦'} *${cat.toUpperCase()}*\n${items.join('\n')}`)
    .join('\n\n');

  await sock.sendMessage(jid, {
    text:
      `📦 *SEU INVENTÁRIO* 📦\n\n` +
      `${linhas}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `*TOTAL:* ${totalItens} item(ns)\n\n` +
      `💰 *SALDO ${carteira?.walletLinked ? 'DA CONTA' : 'NESTE GRUPO'}:* *${formatWalletAmount(carteira?.gold ?? 0, carteira)}*`,
  }, { quoted: msg });
}

module.exports = {
  handleGold,
  handleLoja,
  handleLojaFood,
  handleLojaPet,
  handleLojaTec,
  handleLojaCasal,
  handleComprar,
  handleVender,
  handleInventario,
};
