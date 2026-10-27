'use strict';

/**
 * Handler de Pesca — Bot WhatsApp
 * Sistema de pesca com itens, cooldown, raridade e inventário por grupo
 *
 * v3.0:
 *  - Economia e inventário isolados por grupo (CarteiraGrupo)
 *  - Melhor vara/isca selecionada automaticamente (maior bônus)
 *  - !venderpesca [item] [qtd] — vende itens por 70% do valor
 *  - !rankingpesca              — top 10 pescadores do grupo
 *  - !statspesca                — equipamento atual + chances em tempo real
 *  - Logs de erro completos
 */

const path          = require('path');
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { getCarteira, alterarGold, resolverJidCarteira, formatarSaldo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));

// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────────

const CONFIG_PESCA = {
  COOLDOWN_MS:       15 * 60 * 1000, // 15 minutos entre pescas
  CHANCE_FALHA_BASE: 30,             // 30% de falha sem vara
  CHANCE_FALHA_MIN:  5,              // mínimo de 5% de falha
  PERCENTUAL_VENDA:  0.70,           // 70% do valor base na venda
};

// ─── VARAS DE PESCA ───────────────────────────────────────────────────────────

const VARAS_PESCA = {
  // ── Progressão base ───────────────────────────────────────────────────────
  vara_bambu:      { nome: '🎋 Vara de Bambu',       preco: 80,    bonus_raridade: 0,  reduce_falha: 5  },
  vara_galho:      { nome: '🌿 Vara de Galho',        preco: 110,   bonus_raridade: 2,  reduce_falha: 6  },
  vara_madeira:    { nome: '🪵 Vara de Madeira',      preco: 150,   bonus_raridade: 5,  reduce_falha: 8  },
  vara_reforçada:  { nome: '🔧 Vara Reforçada',       preco: 220,   bonus_raridade: 8,  reduce_falha: 10 },
  vara_fibra:      { nome: '🎣 Vara de Fibra',        preco: 300,   bonus_raridade: 10, reduce_falha: 12 },
  vara_carbono:    { nome: '⚫ Vara de Carbono',      preco: 600,   bonus_raridade: 18, reduce_falha: 18 },
  vara_titanio:    { nome: '🔩 Vara de Titânio',      preco: 1200,  bonus_raridade: 28, reduce_falha: 22 },
  vara_lendaria:   { nome: '✨ Vara Lendária',        preco: 3000,  bonus_raridade: 45, reduce_falha: 25 },
  // ── Temáticas ─────────────────────────────────────────────────────────────
  vara_magica:     { nome: '🪄 Vara Mágica',          preco: 2000,  bonus_raridade: 38, reduce_falha: 20 },
  vara_amaldiçoada:{ nome: '💀 Vara Amaldiçoada',     preco: 2500,  bonus_raridade: 42, reduce_falha: 15 },
  vara_divina:     { nome: '⚡ Vara Divina',           preco: 5000,  bonus_raridade: 60, reduce_falha: 28 },
  vara_sombria:    { nome: '🌑 Vara das Sombras',      preco: 4000,  bonus_raridade: 52, reduce_falha: 24 },
  vara_coral:      { nome: '🪸 Vara de Coral',         preco: 1800,  bonus_raridade: 35, reduce_falha: 19 },
  vara_cristal:    { nome: '💠 Vara de Cristal',       preco: 3500,  bonus_raridade: 48, reduce_falha: 26 },
};

// ─── ISCAS ────────────────────────────────────────────────────────────────────

const ISCAS = {
  // ── Progressão base ───────────────────────────────────────────────────────
  isca_minhoca:   { nome: '🪱 Minhoca',           preco: 20,   bonus_raridade: 0,  reduce_falha: 2  },
  isca_grilo:     { nome: '🦗 Grilo',              preco: 35,   bonus_raridade: 3,  reduce_falha: 3  },
  isca_camarao:   { nome: '🦐 Camarão',            preco: 50,   bonus_raridade: 5,  reduce_falha: 5  },
  isca_mosca:     { nome: '🪰 Mosca Artificial',   preco: 80,   bonus_raridade: 8,  reduce_falha: 7  },
  isca_peixinho:  { nome: '🐟 Peixinho Vivo',      preco: 120,  bonus_raridade: 12, reduce_falha: 10 },
  isca_caranguejo:{ nome: '🦀 Caranguejo',          preco: 160,  bonus_raridade: 15, reduce_falha: 12 },
  isca_lula:      { nome: '🦑 Lula',               preco: 200,  bonus_raridade: 18, reduce_falha: 14 },
  isca_polvo:     { nome: '🐙 Polvo Pequeno',      preco: 280,  bonus_raridade: 22, reduce_falha: 16 },
  isca_magica:    { nome: '🌟 Isca Mágica',        preco: 500,  bonus_raridade: 30, reduce_falha: 20 },
  // ── Temáticas ─────────────────────────────────────────────────────────────
  isca_sangue:    { nome: '🩸 Isca de Sangue',     preco: 350,  bonus_raridade: 25, reduce_falha: 18 },
  isca_cristal:   { nome: '💎 Isca de Cristal',    preco: 600,  bonus_raridade: 33, reduce_falha: 21 },
  isca_divina:    { nome: '✨ Isca Divina',         preco: 1000, bonus_raridade: 45, reduce_falha: 25 },
  isca_sombria:   { nome: '🌑 Isca das Sombras',   preco: 800,  bonus_raridade: 38, reduce_falha: 22 },
  isca_vulcânica: { nome: '🌋 Isca Vulcânica',     preco: 750,  bonus_raridade: 35, reduce_falha: 23 },
};

// ─── CATÁLOGO DE ITENS PESCÁVEIS ──────────────────────────────────────────────

const PEIXES_E_ITENS = {
  // ── Peixes comuns ─────────────────────────────────────────────────────────
  peixe_pequeno:    { nome: '🐟 Peixe Pequeno',       raridade: 'comum',    peso: 55, gold: 18  },
  peixe_listrado:   { nome: '🐠 Peixe Listrado',      raridade: 'comum',    peso: 45, gold: 22  },
  peixe_gordinho:   { nome: '🐡 Peixe Gordinho',      raridade: 'comum',    peso: 38, gold: 28  },
  bagre:            { nome: '😶 Bagre',                raridade: 'comum',    peso: 42, gold: 25  },
  sardinha:         { nome: '🐟 Sardinha',             raridade: 'comum',    peso: 48, gold: 15  },

  // ── Peixes incomuns ───────────────────────────────────────────────────────
  peixe_medio:      { nome: '🐠 Peixe Médio',         raridade: 'incomum',  peso: 22, gold: 45  },
  truta:            { nome: '🎣 Truta',                raridade: 'incomum',  peso: 20, gold: 55  },
  piranha:          { nome: '🦷 Piranha',              raridade: 'incomum',  peso: 18, gold: 65  },
  peixe_voador:     { nome: '🕊️ Peixe Voador',        raridade: 'incomum',  peso: 15, gold: 70  },
  enguia:           { nome: '⚡ Enguia Elétrica',      raridade: 'incomum',  peso: 16, gold: 75  },

  // ── Peixes raros ──────────────────────────────────────────────────────────
  peixe_grande:     { nome: '🐡 Peixe Grande',        raridade: 'raro',     peso: 9,  gold: 100 },
  peixe_fantasma:   { nome: '👻 Peixe Fantasma',      raridade: 'raro',     peso: 5,  gold: 130 },
  tubarao_pequeno:  { nome: '🦈 Tubarão Filhote',     raridade: 'raro',     peso: 6,  gold: 145 },
  peixe_fogo:       { nome: '🔥 Peixe de Fogo',       raridade: 'raro',     peso: 5,  gold: 160 },
  peixe_gelo:       { nome: '❄️ Peixe de Gelo',       raridade: 'raro',     peso: 5,  gold: 155 },
  arraia:           { nome: '🌊 Arraia Gigante',       raridade: 'raro',     peso: 7,  gold: 135 },

  // ── Peixes épicos ─────────────────────────────────────────────────────────
  peixe_espada:     { nome: '⚔️ Peixe-Espada',        raridade: 'epico',    peso: 3,  gold: 250 },
  peixe_abissal:    { nome: '🦑 Peixe Abissal',       raridade: 'epico',    peso: 2,  gold: 300 },
  peixe_venenoso:   { nome: '☠️ Peixe Venenoso',      raridade: 'epico',    peso: 2,  gold: 320 },
  kraken_filhote:   { nome: '🐙 Filhote de Kraken',   raridade: 'epico',    peso: 1,  gold: 400 },
  peixe_celestial:  { nome: '🌠 Peixe Celestial',     raridade: 'epico',    peso: 2,  gold: 350 },
  sereia_escama:    { nome: '🧜 Escama de Sereia',     raridade: 'epico',    peso: 2,  gold: 380 },

  // ── Peixes lendários ──────────────────────────────────────────────────────
  peixe_lendario:   { nome: '🌈 Peixe Arco-Íris',     raridade: 'lendario', peso: 1,  gold: 600 },
  peixe_dourado:    { nome: '✨ Peixe Dourado',        raridade: 'lendario', peso: 1,  gold: 750 },
  leviatã:          { nome: '🐋 Leviatã Miniatura',    raridade: 'lendario', peso: 1,  gold: 1000},
  peixe_temporal:   { nome: '⏳ Peixe Temporal',       raridade: 'lendario', peso: 1,  gold: 950 },
  dragao_aquatico:  { nome: '🐉 Dragão Aquático',      raridade: 'lendario', peso: 1,  gold: 1200},

  // ── Lixo (descartável) ────────────────────────────────────────────────────
  bota_velha:       { nome: '👢 Bota Velha',           raridade: 'comum',    peso: 40, gold: 0   },
  lata_enferrujada: { nome: '🥫 Lata Enferrujada',    raridade: 'comum',    peso: 35, gold: 0   },
  pneu_velho:       { nome: '🛞 Pneu Velho',           raridade: 'comum',    peso: 30, gold: 0   },
  garrafa_vazia:    { nome: '🍾 Garrafa Vazia',        raridade: 'comum',    peso: 32, gold: 0   },
  meia_velha:       { nome: '🧦 Meia Velha',           raridade: 'comum',    peso: 28, gold: 0   },
  guarda_chuva:     { nome: '☂️ Guarda-chuva Quebrado',raridade: 'comum',    peso: 25, gold: 0   },
  calcinha_perdida: { nome: '👙 Roupa Molhada',        raridade: 'comum',    peso: 27, gold: 0   },

  // ── Lixo com pequeno valor ────────────────────────────────────────────────
  alga:             { nome: '🌿 Monte de Algas',       raridade: 'comum',    peso: 28, gold: 3   },
  osso_peixe:       { nome: '🦴 Espinha de Peixe',     raridade: 'comum',    peso: 30, gold: 5   },
  concha_quebrada:  { nome: '🐚 Concha Quebrada',      raridade: 'comum',    peso: 26, gold: 8   },

  // ── Tesouros incomuns ─────────────────────────────────────────────────────
  moeda_antiga:     { nome: '🪙 Moeda Antiga',         raridade: 'incomum',  peso: 18, gold: 60  },
  mapa_afundado:    { nome: '🗺️ Mapa Afundado',        raridade: 'incomum',  peso: 12, gold: 80  },
  ampulheta:        { nome: '⏳ Ampulheta Antiga',      raridade: 'incomum',  peso: 14, gold: 75  },
  dente_tubarao:    { nome: '🦷 Dente de Tubarão',     raridade: 'incomum',  peso: 16, gold: 65  },
  frasco_poção:     { nome: '🧪 Frasco com Poção',     raridade: 'incomum',  peso: 13, gold: 85  },

  // ── Tesouros raros ────────────────────────────────────────────────────────
  anel_perdido:     { nome: '💍 Anel Perdido',         raridade: 'raro',     peso: 7,  gold: 180 },
  estatueta:        { nome: '🗿 Estatueta Antiga',     raridade: 'raro',     peso: 6,  gold: 200 },
  espada_enferrujada:{ nome:'⚔️ Espada Enferrujada',   raridade: 'raro',     peso: 5,  gold: 220 },
  calice_dourado:   { nome: '🏆 Cálice Dourado',       raridade: 'raro',     peso: 5,  gold: 240 },
  livro_submerso:   { nome: '📖 Livro Submerso',       raridade: 'raro',     peso: 6,  gold: 190 },

  // ── Tesouros épicos ───────────────────────────────────────────────────────
  perola:           { nome: '🦪 Pérola Rara',          raridade: 'epico',    peso: 3,  gold: 450 },
  cofre_miniatura:  { nome: '🔒 Cofre Miniatura',      raridade: 'epico',    peso: 2,  gold: 500 },
  coroa_afundada:   { nome: '👑 Coroa Afundada',       raridade: 'epico',    peso: 2,  gold: 550 },
  orbe_magico:      { nome: '🔮 Orbe Mágico',          raridade: 'epico',    peso: 2,  gold: 520 },
  armadura_sereia:  { nome: '🧜 Armadura de Sereia',   raridade: 'epico',    peso: 2,  gold: 480 },

  // ── Tesouros lendários ────────────────────────────────────────────────────
  tesouro:          { nome: '💎 Cristal do Fundo',     raridade: 'lendario', peso: 1,  gold: 900 },
  tridente_poseidon:{ nome: '🔱 Tridente de Poseidon', raridade: 'lendario', peso: 1,  gold: 1100},
  ovo_dragao:       { nome: '🥚 Ovo de Dragão',        raridade: 'lendario', peso: 1,  gold: 1300},
  espelho_abissal:  { nome: '🪞 Espelho Abissal',      raridade: 'lendario', peso: 1,  gold: 1050},
};

const ITENS_BONUS_PESCA = {
  // ── Comuns ────────────────────────────────────────────────────────────────
  chocolate:        { nome: '🍫 Chocolate',              raridade: 'comum',    peso: 22, gold: 20  },
  pedra_rio:        { nome: '🪨 Pedra do Rio',           raridade: 'comum',    peso: 30, gold: 10  },
  cogumelo_aqua:    { nome: '🍄 Cogumelo Aquático',      raridade: 'comum',    peso: 20, gold: 15  },

  // ── Incomuns ──────────────────────────────────────────────────────────────
  mascara:          { nome: '🎭 Máscara',                raridade: 'incomum',  peso: 14, gold: 45  },
  flores:           { nome: '🌹 Flores',                 raridade: 'incomum',  peso: 13, gold: 40  },
  bussola_quebrada: { nome: '🧭 Bússola Quebrada',       raridade: 'incomum',  peso: 10, gold: 70  },
  pena_rara:        { nome: '🪶 Pena Rara',              raridade: 'incomum',  peso: 12, gold: 55  },
  estrela_do_mar:   { nome: '⭐ Estrela-do-Mar',         raridade: 'incomum',  peso: 15, gold: 60  },
  boneco_pano:      { nome: '🪆 Boneco de Pano',         raridade: 'incomum',  peso: 11, gold: 50  },

  // ── Raros ─────────────────────────────────────────────────────────────────
  corda:            { nome: '🪢 Corda Ninja',             raridade: 'raro',     peso: 5,  gold: 120 },
  garrafa_mensagem: { nome: '📜 Garrafa com Mensagem',   raridade: 'raro',     peso: 6,  gold: 160 },
  lanterna_fundo:   { nome: '🔦 Lanterna do Fundo',      raridade: 'raro',     peso: 5,  gold: 140 },
  telescopio:       { nome: '🔭 Telescópio Antigo',      raridade: 'raro',     peso: 5,  gold: 175 },
  harpa_sereia:     { nome: '🎵 Harpa de Sereia',        raridade: 'raro',     peso: 4,  gold: 185 },
  tinta_magica:     { nome: '🖋️ Tinta Mágica',           raridade: 'raro',     peso: 5,  gold: 150 },

  // ── Épicos ────────────────────────────────────────────────────────────────
  mapa_estelar:     { nome: '🗺️ Mapa Estelar',           raridade: 'epico',    peso: 2,  gold: 420 },
  reliquiario:      { nome: '⚗️ Relicário Místico',      raridade: 'epico',    peso: 2,  gold: 460 },
  cristal_tempo:    { nome: '💠 Cristal do Tempo',       raridade: 'epico',    peso: 2,  gold: 490 },

  // ── Lendários ─────────────────────────────────────────────────────────────
  tomo_abissal:     { nome: '📚 Tomo Abissal',           raridade: 'lendario', peso: 1,  gold: 850 },
  amuleto_poseidon: { nome: '🔱 Amuleto de Poseidon',    raridade: 'lendario', peso: 1,  gold: 1150},
};

const CATALOGO_PESCA = { ...PEIXES_E_ITENS, ...ITENS_BONUS_PESCA };

const LIXO_KEYS        = new Set(['bota_velha', 'lata_enferrujada', 'alga', 'pneu_velho', 'garrafa_vazia']);
const DESCARTAVEL_KEYS = new Set([
  'bota_velha', 'lata_enferrujada', 'pneu_velho', 'garrafa_vazia',
  'meia_velha', 'guarda_chuva', 'calcinha_perdida',
]);

const RARIDADE_LABEL = {
  comum:    '⚪ Comum',
  incomum:  '🟢 Incomum',
  raro:     '🔵 Raro',
  epico:    '🟣 Épico',
  lendario: '🟡 Lendário',
};

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function reply(sock, jid, msg, texto) {
  return sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

/**
 * Resolve userId e groupId a partir da mensagem.
 * groupId vem null se for conversa privada (PV).
 * userId vem null apenas se a mensagem estiver malformada (sem key).
 */
function resolverContexto(msg) {
  const userId    = msg?.key?.participant || msg?.key?.remoteJid || null;
  const remoteJid = msg?.key?.remoteJid ?? '';
  const groupId   = remoteJid.endsWith('@g.us') ? remoteJid : null;
  return { userId, groupId };
}

/**
 * Lê quantidade de um item no mapa itensPesca (suporta Map Mongoose ou objeto plano).
 */
function getQtdItem(carteira, key) {
  const mapa = carteira?.itensPesca;
  if (!mapa) return 0;
  const val = mapa instanceof Map ? mapa.get(key) : mapa[key];
  const quantidade = Number(val ?? 0);
  return Number.isSafeInteger(quantidade) && quantidade > 0 ? quantidade : 0;
}

// Impede quantidades negativas, decimais, notação parcial e números enormes
// nos comandos de compra, venda e transferência.
function parseQuantidade(valor, padrao = 1, maximo = 1000) {
  if (valor == null || String(valor).trim() === '') return padrao;
  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto)) return null;
  const quantidade = Number(texto);
  if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > maximo) return null;
  return quantidade;
}

/**
 * Seleciona a melhor vara disponível no inventário (maior bonus_raridade).
 */
function selecionarMelhorVara(carteira) {
  return Object.entries(VARAS_PESCA)
    .filter(([k]) => getQtdItem(carteira, k) > 0)
    .sort((a, b) => b[1].bonus_raridade - a[1].bonus_raridade)[0]?.[0] ?? null;
}

/**
 * Seleciona a melhor isca disponível no inventário (maior bonus_raridade).
 */
function selecionarMelhorIsca(carteira) {
  return Object.entries(ISCAS)
    .filter(([k]) => getQtdItem(carteira, k) > 0)
    .sort((a, b) => b[1].bonus_raridade - a[1].bonus_raridade)[0]?.[0] ?? null;
}

/**
 * Calcula a chance de falha (%) com base na vara e isca selecionadas.
 * Aceita varaKey/iscaKey nulos (sem equipamento = sem redução).
 */
function calcularChanceFalha(varaKey, iscaKey) {
  const reducaoVara = varaKey ? (VARAS_PESCA[varaKey]?.reduce_falha ?? 0) : 0;
  const reducaoIsca = iscaKey ? (ISCAS[iscaKey]?.reduce_falha ?? 0) : 0;
  const reducaoTotal = reducaoVara + reducaoIsca;
  return Math.max(CONFIG_PESCA.CHANCE_FALHA_MIN, CONFIG_PESCA.CHANCE_FALHA_BASE - reducaoTotal);
}

/**
 * Calcula o bônus de raridade combinado de vara + isca.
 * Aceita varaKey/iscaKey nulos.
 */
function calcularBonusRaridade(varaKey, iscaKey) {
  const bonusVara = varaKey ? (VARAS_PESCA[varaKey]?.bonus_raridade ?? 0) : 0;
  const bonusIsca = iscaKey ? (ISCAS[iscaKey]?.bonus_raridade ?? 0) : 0;
  return bonusVara + bonusIsca;
}

/**
 * Sorteia um item do catálogo de pesca, ponderado pela raridade e pelo
 * bônus de raridade do equipamento usado.
 */
function sortearItem(bonusRaridade = 0) {
  const mult = {
    comum:    Math.max(0.1, 1 - bonusRaridade * 0.015),
    incomum:  Math.max(0.1, 1 + bonusRaridade * 0.01),
    raro:     Math.max(0.1, 1 + bonusRaridade * 0.03),
    epico:    Math.max(0.1, 1 + bonusRaridade * 0.05),
    lendario: Math.max(0.1, 1 + bonusRaridade * 0.08),
  };

  const pool = Object.entries(CATALOGO_PESCA).map(([key, item]) => ({
    key,
    ...item,
    pesoAjustado: Math.max(0.5, item.peso * (mult[item.raridade] ?? 1)),
  }));

  const total = pool.reduce((acc, i) => acc + i.pesoAjustado, 0);
  let sorteio = Math.random() * total;

  for (const item of pool) {
    sorteio -= item.pesoAjustado;
    if (sorteio <= 0) return item;
  }

  // Fallback de segurança (erro de arredondamento de float) — nunca deve
  // acontecer na prática, mas evita retornar undefined em caso extremo.
  return pool[pool.length - 1];
}

/**
 * Formata milissegundos em string legível.
 * Ex: 90min → "1h 30min" | 75s → "1min 15s"
 */
function formatarTempo(ms) {
  if (ms <= 0) return '0s';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

// ─── !pescar ──────────────────────────────────────────────────────────────────

async function handlePescar(sock, msg, jid) {
  let { userId, groupId } = resolverContexto(msg);

  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  if (!groupId) {
    return reply(sock, jid, msg,
      '🎣 *A pesca só funciona em grupos!*\n\n' +
      'Entre em um grupo e use *!pescar* por lá.'
    );
  }

  userId = await resolverJidCarteira(userId, groupId);
  try {
    const carteira = await getCarteira(userId, groupId);
    const cooldownLimite = CONFIG_PESCA.COOLDOWN_MS;

    // ── Cooldown ──────────────────────────────────────────────────────────
    const agora       = Date.now();
    const ultimaPesca = carteira.ultimaPesca ? new Date(carteira.ultimaPesca).getTime() : 0;
    const msPassado   = agora - ultimaPesca;

    if (msPassado < cooldownLimite) {
      const restante = cooldownLimite - msPassado;
      return reply(sock, jid, msg,
        `⏳ *AGUARDE PARA PESCAR!*\n\n` +
        `🎣 Você pescou recentemente neste grupo.\n` +
        `⏰ Próxima pesca em: *${formatarTempo(restante)}*`
      );
    }

    // ── Melhor vara e isca disponíveis ────────────────────────────────────
    const varaKey = selecionarMelhorVara(carteira);
    const iscaKey = selecionarMelhorIsca(carteira);

    if (!varaKey) {
      return reply(sock, jid, msg,
        `🎣 *VOCÊ PRECISA DE UMA VARA!*\n\n` +
        `Sem vara de pesca não dá pra pescar neste grupo!\n\n` +
        `🛒 Compre uma na loja: *!buypesca vara_bambu*\n` +
        `📋 Ver varas disponíveis: *!varas*`
      );
    }

    // ── Registrar cooldown + consumir isca de forma atômica e segura ──────
    // Evita exploits de iscas negativas ou bypass de cooldown caso o usuário execute comandos simultâneos
    const limiteData = new Date(agora - cooldownLimite);
    const queryUpdate = {
      idWhatsApp: userId,
      idGrupo: groupId,
      $or: [
        { ultimaPesca: { $exists: false } },
        { ultimaPesca: null },
        { ultimaPesca: { $lte: limiteData } },
      ],
    };

    if (iscaKey) {
      queryUpdate[`itensPesca.${iscaKey}`] = { $gt: 0 };
    }

    const atualizacaoConsumo = await CarteiraGrupo.findOneAndUpdate(
      queryUpdate,
      {
        $set: { ultimaPesca: new Date(agora) },
        ...(iscaKey ? { $inc: { [`itensPesca.${iscaKey}`]: -1 } } : {}),
      },
      { new: true }
    );

    // Se o update falhou mas a conta não tinha a isca necessária, tenta registrar cooldown atômico sem isca
    const usouIscaEfetivamente = !!(iscaKey && atualizacaoConsumo);

    if (!atualizacaoConsumo) {
      const tentouSemIsca = await CarteiraGrupo.findOneAndUpdate(
        {
          idWhatsApp: userId,
          idGrupo: groupId,
          $or: [
            { ultimaPesca: { $exists: false } },
            { ultimaPesca: null },
            { ultimaPesca: { $lte: limiteData } },
          ],
        },
        { $set: { ultimaPesca: new Date(agora) } },
        { upsert: false, new: true }
      );

      if (!tentouSemIsca) {
        return reply(sock, jid, msg,
          `⏳ *AGUARDE PARA PESCAR!*\n\n` +
          `🎣 Você pescou recentemente neste grupo.\n` +
          `⏰ Próxima pesca em: *${formatarTempo(cooldownLimite)}*`
        );
      }
    }

    const varaNome = VARAS_PESCA[varaKey].nome;
    const iscaNome = usouIscaEfetivamente ? ISCAS[iscaKey]?.nome : null;

    const cabecalho =
      `🎣 *PESCARIA!*\n\n` +
      `🪝 Vara: *${varaNome}*\n` +
      (iscaNome ? `🪱 Isca: *${iscaNome}* _(consumida)_\n` : `🪱 Isca: _nenhuma_\n`) +
      `━━━━━━━━━━━━━━━━\n`;

    // ── Sistema de Falha ──────────────────────────────────────────────────
    const chanceFalha   = calcularChanceFalha(varaKey, usouIscaEfetivamente ? iscaKey : null);
    const bonusRaridade = calcularBonusRaridade(varaKey, usouIscaEfetivamente ? iscaKey : null);
    const falhou        = Math.random() * 100 < chanceFalha;

    if (falhou) {
      const mensagensFalha = [
        '🌊 O peixe deu uma mordida na linha e escapou!',
        '💨 Nada por aqui... a água está quieta demais neste momento.',
        '😔 Você ficou esperando horas na beirada, mas nada apareceu.',
        '🐟 O peixe olhou para a sua proposta e foi embora desdenhando.',
        '🌿 Você puxou a linha com força e veio um bando de algas inúteis.',
        '🤣 Um peixinho esperto roubou sua isca e sumiu na correnteza!',
        '🌧️ O tempo mudou de repente e espantou os cardumes.',
        '🦈 Uma sombra gigantesca passou por baixo e assustou os peixes menores...',
      ];
      const msgFalha = mensagensFalha[Math.floor(Math.random() * mensagensFalha.length)];

      const avisoIsca = iscaNome
        ? `\n🪱 _Sua isca foi consumida nessa tentativa._\n`
        : '';

      return reply(sock, jid, msg,
        cabecalho +
        `\n${msgFalha}\n` +
        avisoIsca +
        `\n💡 Tente novamente em *${formatarTempo(cooldownLimite)}*\n` +
        `📈 Equipe iscas melhores para mitigar perdas! _(Taxa atual: ${chanceFalha.toFixed(1)}% de falha)_`
      );
    }

    // ── Sucesso: Sortear item do catálogo ─────────────────────────────────
    const item     = sortearItem(bonusRaridade);
    const rarLabel = RARIDADE_LABEL[item.raridade] ?? item.raridade;

    const ehLixo = LIXO_KEYS.has(item.key);
    const ehDesc = DESCARTAVEL_KEYS.has(item.key);

    // ── Persistência de Recompensas e Inventário ──────────────────────────
    const carteiraRecompensa = item.gold > 0
      ? await alterarGold(userId, groupId, item.gold, `Pesca: ${item.nome}`)
      : await getCarteira(userId, groupId);

    if (!ehDesc) {
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: userId, idGrupo: groupId },
        { $inc: { [`itensPesca.${item.key}`]: 1 } }
      );
    }

    // ── Geração de Resposta Visual ────────────────────────────────────────
    const reacoes = {
      comum:    '',
      incomum:  '✨ Não é de todo mal!',
      raro:     '🔥 Que sorte absurda! Um item raro despontou na água!',
      epico:    '🤩 CARÁCULO, É ÉPICO! Uma fisgada digna de histórias!',
      lendario: '🏆 MEU DEUS, LENDÁRIO!! VOCÊ ACABA DE SE TORNAR UM MESTRE DOS MARES!!!',
    };

    const taxaVenda  = CONFIG_PESCA.PERCENTUAL_VENDA;
    const precoVenda = item.gold > 0 ? Math.floor(item.gold * taxaVenda) : null;

    let resultado =
      cabecalho +
      `\n🎉 *VOCÊ SUCEDEU NA PESCARIA!*\n\n` +
      `📦 *${item.nome}*\n` +
      `🏷️ Raridade: *${rarLabel}*\n`;

    if (item.gold > 0) resultado += `💰 *+${formatarSaldo(item.gold, carteiraRecompensa)}* adicionados ao saldo\n`;

    if (ehDesc)   resultado += `\n🗑️ _Apenas entulho de rio descartável desta vez..._\n`;
    else          resultado += `\n📥 _Item guardado com sucesso no inventário do grupo._\n`;

    if (precoVenda && !ehLixo && !ehDesc) {
      resultado += `💵 _Venda rápida por: *${formatarSaldo(precoVenda, carteiraRecompensa)}* → !sellpesca ${item.key}_\n`;
    }

    const reacao = reacoes[item.raridade] ?? '';
    if (reacao) resultado += `\n${reacao}\n`;

    resultado +=
      `\n━━━━━━━━━━━━━━━━\n` +
      `⏰ Próxima pesca em *${formatarTempo(cooldownLimite)}*\n` +
      `📦 Veja seus pertences: *!inventariopesca*`;

    return reply(sock, jid, msg, resultado);

  } catch (err) {
    console.error('[Pesca] handlePescar:', err);
    return reply(sock, jid, msg, '⚠️ Ocorreu um erro interno ao processar a pescaria! Tente novamente.');
  }
}

// ─── !varas ───────────────────────────────────────────────────────────────────

async function handleVaras(sock, msg, jid) {
  try {
    const listaVaras = Object.entries(VARAS_PESCA);

    let texto = `🎣 *VARAS DE PESCA*\n\n_A melhor vara disponível no seu inventário é usada automaticamente nas pescarias._\n\n`;

    for (const [key, vara] of listaVaras) {
      texto +=
        `${vara.nome}\n` +
        `   💵 Preço: *${formatarSaldo(vara.preco)}*\n` +
        `   📈 Bônus raridade: *+${vara.bonus_raridade}*\n` +
        `   🎯 Reduz falha: *-${vara.reduce_falha}%*\n` +
        `   🛒 \`!buypesca ${key}\`\n\n`;
    }

    texto +=
      `━━━━━━━━━━━━━━━━\n` +
      `🪱 Ver iscas disponíveis: *!iscas*\n` +
      `🎣 Pescar agora: *!pescar*`;

    return reply(sock, jid, msg, texto);

  } catch (err) {
    console.error('[Pesca] handleVaras:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao carregar o menu de varas!');
  }
}

// ─── !iscas ───────────────────────────────────────────────────────────────────

async function handleIscas(sock, msg, jid) {
  try {
    const listaIscas = Object.entries(ISCAS);

    let texto = `🪱 *ISCAS DE PESCA*\n\n_A melhor isca disponível no seu inventário é usada automaticamente (1 por tentativa)._\n\n`;

    for (const [key, isca] of listaIscas) {
      texto +=
        `${isca.nome}\n` +
        `   💵 Preço: *${formatarSaldo(isca.preco)}*\n` +
        `   📈 Bônus raridade: *+${isca.bonus_raridade}*\n` +
        `   🎯 Reduz falha: *-${isca.reduce_falha}%*\n` +
        `   🛒 \`!buypesca ${key}\`\n\n`;
    }

    texto +=
      `━━━━━━━━━━━━━━━━\n` +
      `💡 _A isca é consumida a cada pesca executada!_\n` +
      `🎣 Ver varas disponíveis: *!varas*`;

    return reply(sock, jid, msg, texto);

  } catch (err) {
    console.error('[Pesca] handleIscas:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao carregar o menu de iscas!');
  }
}

// ─── !buypesca ────────────────────────────────────────────────────────────────

/**
 * !buypesca <item> [quantidade]
 * Compra vara ou isca de pesca. Aceita a chave técnica (vara_bambu) ou
 * busca parcial pelo nome amigável (ex: "bambu", "minhoca").
 * Varas são equipamento único — não acumulam quantidade.
 * Iscas são consumíveis — aceitam quantidade.
 */
async function handleComprarPesca(sock, msg, jid, caption) {
  let { userId, groupId } = resolverContexto(msg);

  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  if (!groupId) {
    return reply(sock, jid, msg, '🎣 A loja de pesca só funciona em grupos!');
  }

  userId = await resolverJidCarteira(userId, groupId);
  // ── Remove o prefixo do comando antes de parsear os argumentos ──
  // Sem isso, partes[0] capturaria "!buypesca" como nome do item.
  const args     = (caption ?? '').replace(/^[!.,\/]buypesca\s*/i, '').trim().split(/\s+/);
  const buscaRaw = (args[0] ?? '').toLowerCase();
  const qtd      = parseQuantidade(args[1]);

  if (!buscaRaw) {
    return reply(sock, jid, msg,
      `🛒 *COMPRAR EQUIPAMENTO DE PESCA*\n\n` +
      `Uso: *!buypesca <item> [quantidade]*\n` +
      `Exemplo: *!buypesca vara_bambu*\n` +
      `Exemplo: *!buypesca isca_minhoca 5*\n\n` +
      `📋 Ver varas: *!varas*\n` +
      `📋 Ver iscas: *!iscas*`
    );
  }

  if (qtd === null) {
    return reply(sock, jid, msg, '⚠️ Quantidade inválida. Use um número inteiro entre 1 e 1000.');
  }

  // ── Resolve o item: tenta chave exata primeiro, depois busca parcial por nome ──
  const catalogoCompleto = { ...VARAS_PESCA, ...ISCAS };

  let itemKey = catalogoCompleto[buscaRaw] ? buscaRaw : null;

  if (!itemKey) {
    const encontrado = Object.entries(catalogoCompleto).find(([key, item]) =>
      key.includes(buscaRaw) ||
      item.nome.toLowerCase().includes(buscaRaw)
    );
    itemKey = encontrado?.[0] ?? null;
  }

  if (!itemKey) {
    return reply(sock, jid, msg,
      `⚠️ Item *"${buscaRaw}"* não encontrado.\n\n` +
      `📋 Ver varas disponíveis: *!varas*\n` +
      `📋 Ver iscas disponíveis: *!iscas*`
    );
  }

  const ehVara = !!VARAS_PESCA[itemKey];
  const info   = ehVara ? VARAS_PESCA[itemKey] : ISCAS[itemKey];

  try {
    const qtdComprar = ehVara ? 1 : qtd;
    const custoTotal = info.preco * qtdComprar;

    // ── BUG 10 FIX: a checagem "já tem vara" e o débito eram duas operações
    // separadas (findOne depois findOneAndUpdate) sem trava nenhuma entre
    // elas — duas compras simultâneas da mesma vara podiam passar as duas
    // pela checagem antes que qualquer uma gravasse, comprando a "vara única"
    // em dobro. Agora a condição "não tem a vara ainda" entra na MESMA query
    // atômica do débito.
    const guardaVaraUnica = ehVara
      ? { [`itensPesca.${itemKey}`]: { $not: { $gt: 0 } } }
      : {};

    // ── Verifica saldo (e, se for vara, ausência prévia) e debita de forma atômica ──
    const operacaoCompra = await CarteiraGrupo.findOneAndUpdate(
      {
        idWhatsApp: userId,
        idGrupo: groupId,
        gold: { $gte: custoTotal },
        ...guardaVaraUnica,
      },
      {
        $inc: {
          gold: -custoTotal,
          [`itensPesca.${itemKey}`]: qtdComprar,
        },
      },
      { new: true, upsert: false },
    );

    if (!operacaoCompra) {
      // A guarda pode ter falhado por dois motivos diferentes — busca o
      // estado atual pra reportar a causa certa em vez de sempre dizer
      // "saldo insuficiente" quando na verdade já tinha a vara.
      const carteiraAtual = await getCarteira(userId, groupId);
      const saldoAtual    = carteiraAtual?.gold ?? 0;

      if (ehVara && getQtdItem(carteiraAtual, itemKey) > 0) {
        return reply(sock, jid, msg,
          `⚠️ Você já possui *${info.nome}*!\n\n` +
          `_Varas não acumulam — venda a antiga antes de comprar outra (em breve)._`
        );
      }

      return reply(sock, jid, msg,
        `❌ *SALDO INSUFICIENTE!*\n\n` +
        `💰 Você tem: *${formatarSaldo(saldoAtual, carteiraAtual)}*\n` +
        `💵 Necessário: *${formatarSaldo(custoTotal, carteiraAtual)}*\n` +
        `📉 Faltam: *${formatarSaldo(custoTotal - saldoAtual, carteiraAtual)}*`
      );
    }

    const tipoLabel = ehVara ? '🪝 Vara' : '🪱 Isca';
    const qtdLabel = ehVara
  ? (qtd > 1 ? ' _(varas são unitárias, comprada apenas 1)_' : '')
  : ` ×${qtdComprar}`;

    return reply(sock, jid, msg,
      `✅ *COMPRA REALIZADA!*\n\n` +
      `${tipoLabel}: *${info.nome}*${qtdLabel}\n` +
      `💵 Total pago: *${formatarSaldo(custoTotal, operacaoCompra)}*\n` +
      `💰 Saldo restante: *${formatarSaldo(operacaoCompra.gold, operacaoCompra)}*\n\n` +
      `${ehVara ? '🎣 Use *!pescar* para testar sua nova vara!' : '📦 Veja seu inventário: *!inventariopesca*'}`
    );

  } catch (err) {
    console.error('[Pesca] handleComprarPesca:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao processar a compra! Tente novamente.');
  }
}

// ─── !inventariopesca ─────────────────────────────────────────────────────────

async function handleInventarioPesca(sock, msg, jid) {
  let { userId, groupId } = resolverContexto(msg);

  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  if (!groupId) {
    return reply(sock, jid, msg, '🎣 O inventário de pesca é por grupo!\nUse este comando em um grupo.');
  }

  userId = await resolverJidCarteira(userId, groupId);

  try {
    const carteira = await getCarteira(userId, groupId);

    const semItens =
      `🎣 *SEU INVENTÁRIO DE PESCA ESTÁ VAZIO*\n\n` +
      `Para começar:\n` +
      `  🪝 Compre uma vara: *!buypesca vara_bambu*\n` +
      `  🪱 Compre uma isca: *!buypesca isca_minhoca* _(opcional)_\n` +
      `  🎣 Então pesque: *!pescar*\n\n` +
      `📋 Ver varas disponíveis: *!varas*\n` +
      `📋 Ver iscas disponíveis: *!iscas*`;

    if (!carteira) return reply(sock, jid, msg, semItens);

    const invRaw = carteira.itensPesca;
    const inv    = invRaw instanceof Map ? Object.fromEntries(invRaw) : (invRaw ?? {});

    const chaves = Object.keys(inv).filter(k => (inv[k] ?? 0) > 0);
    if (chaves.length === 0) return reply(sock, jid, msg, semItens);

    const varas    = chaves.filter(k => VARAS_PESCA[k]);
    const iscas    = chaves.filter(k => ISCAS[k]);
    const pescados = chaves.filter(k => !VARAS_PESCA[k] && !ISCAS[k]);

    let texto = `🎣 *INVENTÁRIO DE PESCA* _(neste grupo)_\n\n`;

    // ── Varas ────────────────────────────────────────────────────────────────
    if (varas.length > 0) {
      const melhorVara = selecionarMelhorVara(carteira);
      texto += `🪝 *VARAS DE PESCA*\n`;
      for (const k of varas) {
        const info  = VARAS_PESCA[k];
        const ativa = k === melhorVara ? ' ✅ _(em uso)_' : '';
        const precoVenda = Math.floor(info.preco * 0.50);
        texto += `   ${info.nome} × ${inv[k]}${ativa}\n`;
        texto += `   ├ Bônus raridade: *+${info.bonus_raridade}* · Reduz falha: *-${info.reduce_falha}%*\n`;
        texto += `   └ Venda: *${formatarSaldo(precoVenda, carteira)}* → \`!sellpesca ${k}\`\n\n`;
      }
    }

    // ── Iscas ─────────────────────────────────────────────────────────────────
    if (iscas.length > 0) {
      const melhorIsca = selecionarMelhorIsca(carteira);
      texto += `🪱 *ISCAS*\n`;
      for (const k of iscas) {
        const info  = ISCAS[k];
        const ativa = k === melhorIsca ? ' ✅ _(próxima a usar)_' : '';
        // Para iscas (consumíveis vendem a 70% assim como itens pescados):
const precoVenda = Math.floor(info.preco * CONFIG_PESCA.PERCENTUAL_VENDA); // 0.70
        texto += `   ${info.nome} × ${inv[k]}${ativa}\n`;
        texto += `   ├ Bônus raridade: *+${info.bonus_raridade}* · Reduz falha: *-${info.reduce_falha}%*\n`;
        texto += `   └ Venda: *${formatarSaldo(precoVenda, carteira)}* → \`!sellpesca ${k}\`\n\n`;
      }
    }

    // ── Itens pescados ────────────────────────────────────────────────────────
    if (pescados.length > 0) {
      const taxaVenda = CONFIG_PESCA.PERCENTUAL_VENDA;
      texto += `📦 *ITENS PESCADOS*\n`;
      for (const k of pescados) {
        const info       = CATALOGO_PESCA[k];
        const nome       = info?.nome ?? k;
        const rarLabel   = RARIDADE_LABEL[info?.raridade] ?? '';
        const goldBase   = info?.gold ?? 0;
        const precoVenda = goldBase > 0 ? Math.floor(goldBase * taxaVenda) : null;

        texto += `   ${nome} × ${inv[k]} ${rarLabel}\n`;
        if (precoVenda) {
          texto += `   └ Venda: *${formatarSaldo(precoVenda, carteira)}* → \`!sellpesca ${k}\`\n\n`;
        } else {
          texto += `   └ _(sem valor de mercado)_\n\n`;
        }
      }
    }

    // ── Cooldown ──────────────────────────────────────────────────────────────
    const agora       = Date.now();
    const ultimaPesca = carteira.ultimaPesca ? new Date(carteira.ultimaPesca).getTime() : 0;
    const msRestante  = Math.max(0, CONFIG_PESCA.COOLDOWN_MS - (agora - ultimaPesca));

    const cooldownStr = msRestante > 0
      ? `⏳ Próxima pesca em *${formatarTempo(msRestante)}*`
      : `✅ *Pronto para pescar!*`;

    texto +=
      `━━━━━━━━━━━━━━━━\n` +
      `💰 Saldo neste grupo: *${formatarSaldo(carteira.gold ?? 0, carteira)}*\n` +
      `${cooldownStr}\n\n` +
      `🎣 *!pescar* · 💵 *!sellpesca <item> [qtd]* · 🛒 *!buypesca <item>*\n` +
      `🎁 *!givepesca @fulano <item> [qtd]* · 📊 *!statspesca*`;

    return reply(sock, jid, msg, texto);

  } catch (err) {
    console.error('[Pesca] handleInventarioPesca:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao carregar seu inventário de pesca!');
  }
}

// ─── !sellpesca ───────────────────────────────────────────────────────────────

/**
 * !sellpesca <item> [quantidade]
 * Vende itens pescados (70% do gold base) ou equipamentos (50% do preco base).
 */
async function handleVenderPesca(sock, msg, jid, caption) {
  let { userId, groupId } = resolverContexto(msg);

  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  if (!groupId) return reply(sock, jid, msg, '🎣 Venda de pesca só funciona em grupos!');

  userId = await resolverJidCarteira(userId, groupId);
  const args    = (caption ?? '').replace(/^[!.,\/]sellpesca\s*/i, '').trim().split(/\s+/);
  const itemKey = (args[0] ?? '').toLowerCase() || null;
  const qtd     = parseQuantidade(args[1]);

  if (!itemKey) {
    return reply(sock, jid, msg,
      `💵 *VENDER ITEM DE PESCA*\n\n` +
      `Uso: *!sellpesca <item> [quantidade]*\n` +
      `Exemplos:\n` +
      `  • *!sellpesca peixe_pequeno 5*\n` +
      `  • *!sellpesca vara_bambu*\n` +
      `  • *!sellpesca isca_minhoca 3*\n\n` +
      `📦 Ver seus itens: *!inventariopesca*`
    );
  }

  if (qtd === null) {
    return reply(sock, jid, msg, '⚠️ Quantidade inválida. Use um número inteiro entre 1 e 1000.');
  }

  // ── Resolve catálogo: equipamentos têm `preco`, itens pescados têm `gold` ──
  const ehVara  = !!VARAS_PESCA[itemKey];
  const ehIsca  = !!ISCAS[itemKey];
  const ehEquip = ehVara || ehIsca;

  const info = ehVara
    ? VARAS_PESCA[itemKey]
    : ehIsca
    ? ISCAS[itemKey]
    : CATALOGO_PESCA[itemKey];

  if (!info) {
    return reply(sock, jid, msg,
      `⚠️ Item *${itemKey}* não encontrado.\n\n` +
      `📦 Veja seus itens usando: *!inventariopesca*`
    );
  }

  // ── Valor base e taxa ────────────────────────────────────────────────────────
  // Varas: vendem por 50% do preço de compra (equipamento único, valor mais alto)
  // Iscas E itens pescados: vendem por 70% (consumíveis/coletáveis)
  //
  // BUG 9 FIX: antes "ehEquip" (vara OU isca) usava 50%, mas o preço mostrado
  // em !inventariopesca pras iscas já calculava com 70% — o jogador via um
  // valor no inventário e recebia outro (menor) ao vender de fato.
  const valorBase     = ehEquip ? (info.preco ?? 0) : (info.gold ?? 0);
  const taxaVenda     = ehVara ? 0.50 : CONFIG_PESCA.PERCENTUAL_VENDA;
  const precoUnitario = Math.floor(valorBase * taxaVenda);

  if (valorBase <= 0 || precoUnitario <= 0) {
    return reply(sock, jid, msg,
      `🗑️ *${info.nome}* não tem valor comercial.\n\n` +
      `_Este item não pode ser vendido._`
    );
  }

  try {
    const carteira = await getCarteira(userId, groupId);

    const invRaw     = carteira?.itensPesca;
    const inv        = invRaw instanceof Map ? Object.fromEntries(invRaw) : (invRaw ?? {});
    const disponivel = inv[itemKey] ?? 0;

    if (disponivel <= 0) {
      return reply(sock, jid, msg,
        `⚠️ Você não possui *${info.nome}* no inventário deste grupo.\n\n` +
        `📦 Digite *!inventariopesca* para verificar seus itens.`
      );
    }

    const qtdVender = Math.min(qtd, disponivel);
    const totalGold = precoUnitario * qtdVender;

    // ── Debita do inventário de forma atômica ────────────────────────────────
    const operacaoMochila = await CarteiraGrupo.findOneAndUpdate(
      {
        idWhatsApp: userId,
        idGrupo:    groupId,
        [`itensPesca.${itemKey}`]: { $gte: qtdVender },
      },
      { $inc: { [`itensPesca.${itemKey}`]: -qtdVender } },
      { new: true }
    );

    if (!operacaoMochila) {
      return reply(sock, jid, msg,
        `⚠️ Falha de sincronia. Você tentou vender mais itens do que possui!\n\n` +
        `📦 Use *!inventariopesca* para conferir seu estoque atual.`
      );
    }

    // ── Credita o gold; se o crédito falhar, devolve os itens debitados ────
    try {
      await alterarGold(userId, groupId, totalGold, `Venda pesca: ${info.nome} ×${qtdVender}`);
    } catch (erroCredito) {
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: userId, idGrupo: groupId },
        { $inc: { [`itensPesca.${itemKey}`]: qtdVender } }
      );
      throw erroCredito;
    }

    const carteiraFinal = await getCarteira(userId, groupId);

    // BUG 9 FIX: o aviso de "50%" só faz sentido pra vara agora — iscas
    // vendem na mesma taxa que itens pescados (70%), então não são mais
    // tratadas como "equipamento desvalorizado" aqui.
    const avisoEquip = ehVara
      ? `⚠️ _Equipamento vendido por 50% do valor de compra._\n\n`
      : '';

    return reply(sock, jid, msg,
      `💵 *VENDA REALIZADA COM SUCESSO!*\n\n` +
      `📦 Item: *${info.nome}*\n` +
      `🔢 Quantidade vendida: *${qtdVender}×*\n` +
      `💰 Valor unitário: *${formatarSaldo(precoUnitario, carteiraFinal)}* (${Math.round(taxaVenda * 100)}% do valor base)\n` +
      `🏆 Total recebido: *+${formatarSaldo(totalGold, carteiraFinal)}*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      avisoEquip +
      `📦 Restante no inventário: *${disponivel - qtdVender}×*\n` +
      `💰 Saldo atual no grupo: *${formatarSaldo(carteiraFinal?.gold ?? 0, carteiraFinal)}*`
    );

  } catch (err) {
    console.error('[Pesca] handleVenderPesca:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao processar a venda! Tente novamente.');
  }
}

// ─── !rankingpesca ────────────────────────────────────────────────────────────

async function handleRankingPesca(sock, msg, jid, contactNames) {
  const { groupId } = resolverContexto(msg);

  if (!groupId) {
    return reply(sock, jid, msg, '🎣 Ranking de pesca só funciona em grupos!');
  }

  try {
    // Coleta os membros que pertencem ao grupo neste exato momento
    const metadata = await sock.groupMetadata(jid);
    const membrosAtuais = new Set(metadata.participants.map(p => p.id));

    // ── BUG 11 FIX: antes buscava TODOS os documentos do grupo (com o
    // itensPesca inteiro de cada um) e só depois somava/ordenava em memória —
    // isso cresce sem limite conforme o grupo e o histórico de pesca crescem.
    // Agora a soma e a ordenação acontecem no próprio MongoDB via agregação,
    // e só os 50 melhores candidatos (mesma margem de segurança que
    // !rankgold usa) trafegam pro Node antes do filtro de membros ativos.
    const chavesExcluidas = [
      ...Object.keys(VARAS_PESCA),
      ...Object.keys(ISCAS),
      ...DESCARTAVEL_KEYS,
    ];

    const candidatosBrutos = await CarteiraGrupo.aggregate([
      // Filtra membros atuais antes do limite, para que carteiras de ex-membros
      // não ocupem as vagas do Top 50 e escondam pescadores ativos.
      { $match: { idGrupo: groupId, idWhatsApp: { $in: [...membrosAtuais] } } },
      { $addFields: {
          _itensArray: { $objectToArray: { $ifNull: ['$itensPesca', {}] } },
        },
      },
      { $addFields: {
          _total: {
            $sum: {
              $map: {
                input: '$_itensArray',
                as: 'i',
                in: {
                  $cond: [
                    { $in: ['$$i.k', chavesExcluidas] },
                    0,
                    { $ifNull: ['$$i.v', 0] },
                  ],
                },
              },
            },
          },
        },
      },
      { $match: { _total: { $gt: 0 } } },
      { $sort: { _total: -1 } },
      { $limit: 50 },
      { $project: { idWhatsApp: 1, gold: 1, total: '$_total' } },
    ]);

    // Remove inativos/banidos (mesmo padrão de !rankgold)
    const candidatos = candidatosBrutos
      .filter(s => membrosAtuais.has(s.idWhatsApp));

    // Organiza por pontuação decrescente e extrai o Top 10
    const scores = candidatos
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    if (scores.length === 0) {
      return reply(sock, jid, msg,
        `🎣 *RANKING DE PESCA*\n\n` +
        `Nenhum membro ativo pescou nada neste grupo ainda!\n\n` +
        `Seja o primeiro usando: *!pescar*`
      );
    }

    const medalhas = ['🥇', '🥈', '🥉', '🔹 4.', '🔹 5.', '🔹 6.', '🔹 7.', '🔹 8.', '🔹 9.', '🔹 10.'];
    const maxTotal = scores[0].total || 1;
    const totalGeralGrupo = scores.reduce((a, x) => a + x.total, 0);

    let texto = `🎣 *RANKING DE PESCA — MEMBROS ATIVOS* 🎣\n\n`;

    scores.forEach((s, i) => {
      const numero  = s.idWhatsApp.split('@')[0].split(':')[0];
      const medalha = medalhas[i] ?? `🔹 *${i + 1}.*`;

      const pct = totalGeralGrupo > 0 ? ((s.total / totalGeralGrupo) * 100).toFixed(1) : '0.0';
      const tamanhoBarra = Math.min(Math.round((s.total / maxTotal) * 10), 10);
      const bar = '█'.repeat(tamanhoBarra) + '░'.repeat(10 - tamanhoBarra);

      texto +=
        `${medalha} *@${numero}*\n` +
        `   ${bar} ${s.total} 🐟 (${pct}%)\n` +
        `   💰 ${formatarSaldo(s.gold)}\n\n`;
    });

    const mentions = scores.map(s => s.idWhatsApp);

    texto +=
      `━━━━━━━━━━━━━━━━\n` +
      `🐟 Total pescado no Top 10: *${totalGeralGrupo} itens*\n` +
      `🎣 Use *!pescar* para subir no ranking!`;

    await sock.sendMessage(jid, {
      text: texto,
      mentions,
    }, { quoted: msg });

  } catch (err) {
    console.error('[Pesca] handleRankingPesca:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao carregar o ranking de pesca. Tente novamente!');
  }
}

// ─── !statspesca ─────────────────────────────────────────────────────────────

/**
 * Mostra equipamento atual, cooldown restante, chance de falha e bônus de raridade.
 */
async function handleStatsPesca(sock, msg, jid) {
  let { userId, groupId } = resolverContexto(msg);

  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  if (!groupId) {
    return reply(sock, jid, msg, '🎣 Stats de pesca só funcionam em grupos!');
  }

  userId = await resolverJidCarteira(userId, groupId);

  try {
    const carteira = await CarteiraGrupo
      .findOne({ idWhatsApp: userId, idGrupo: groupId })
      .lean();

    if (!carteira) {
      return reply(sock, jid, msg,
        `🎣 *STATS DE PESCA*\n\nVocê ainda não tem uma carteira neste grupo.\n\n` +
        `Compre uma vara usando: *!buypesca vara_bambu*`
      );
    }

    const varaKey = selecionarMelhorVara(carteira);
    const iscaKey = selecionarMelhorIsca(carteira);

    const varaNome = varaKey ? VARAS_PESCA[varaKey]?.nome ?? '_Nenhuma_' : '_Nenhuma_';
    const iscaNome = iscaKey ? ISCAS[iscaKey]?.nome ?? '_Nenhuma_'       : '_Nenhuma_';

    const chanceFalha   = calcularChanceFalha(varaKey, iscaKey);
    const bonusRaridade = calcularBonusRaridade(varaKey, iscaKey);
    const chanceAcerto  = Math.max(0, 100 - chanceFalha);

    // ── Cooldown restante ────────────────────────────────────────────────
    const agora       = Date.now();
    const ultimaPesca = carteira.ultimaPesca ? new Date(carteira.ultimaPesca).getTime() : 0;
    const cooldownMs  = CONFIG_PESCA.COOLDOWN_MS;
    const msRestante  = Math.max(0, cooldownMs - (agora - ultimaPesca));

    const cooldownStr = msRestante > 0
      ? `⏳ *${formatarTempo(msRestante)}* restantes`
      : `✅ *Pronto para pescar!*`;

    // ── Distribuição de raridade ajustada pelo bônus de equipamento ──────
    const mult = {
      comum:    Math.max(0.1, 1 - bonusRaridade * 0.015),
      incomum:  Math.max(0.1, 1 + bonusRaridade * 0.01),
      raro:     Math.max(0.1, 1 + bonusRaridade * 0.03),
      epico:    Math.max(0.1, 1 + bonusRaridade * 0.05),
      lendario: Math.max(0.1, 1 + bonusRaridade * 0.08),
    };

    const pesoBase = { comum: 47, incomum: 20, raro: 9, epico: 3.5, lendario: 1 };
    const pesoAdj  = Object.fromEntries(
      Object.entries(pesoBase).map(([r, p]) => [r, p * mult[r]])
    );

    const totalPeso = Object.values(pesoAdj).reduce((a, b) => a + b, 0);
    const chances   = Object.fromEntries(
      Object.entries(pesoAdj).map(([r, p]) => [r, ((p / totalPeso) * 100).toFixed(1)])
    );

    const texto =
      `🎣 *STATS DE PESCA* _(neste grupo)_\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `*EQUIPAMENTO ATIVO:*\n` +
      `  🪝 Vara: *${varaNome}*\n` +
      `  🪱 Isca: *${iscaNome}*\n\n` +
      `*COOLDOWN:*\n` +
      `  ${cooldownStr}\n\n` +
      `*CHANCES (se pescar agora):*\n` +
      `  ✅ Acerto: *${chanceAcerto.toFixed(1)}%* | ❌ Falha: *${chanceFalha.toFixed(1)}%*\n\n` +
      `*DISTRIBUIÇÃO DE RARIDADE:*\n` +
      `  ⚪ Comum:    *${chances.comum}%*\n` +
      `  🟢 Incomum:  *${chances.incomum}%*\n` +
      `  🔵 Raro:     *${chances.raro}%*\n` +
      `  🟣 Épico:    *${chances.epico}%*\n` +
      `  🟡 Lendário: *${chances.lendario}%*\n\n` +
      `  📈 Bônus raridade total: *+${bonusRaridade}*\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📦 *!inventariopesca* · 🎣 *!pescar* · 🛒 *!buypesca <item>*`;

    return reply(sock, jid, msg, texto);

  } catch (err) {
    console.error('[Pesca] handleStatsPesca:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao carregar seus dados de pesca!');
  }
}

// ─── !givepesca ───────────────────────────────────────────────────────────────

/**
 * !givepesca @fulano <item> [quantidade]
 * Transfere varas, iscas ou itens pescados do inventário do remetente
 * para o destinatário — ambos no mesmo grupo.
 */
async function handleGivePesca(sock, msg, jid, caption) {
  const { userId, groupId } = resolverContexto(msg);

  if (!userId) return reply(sock, jid, msg, '⚠️ Não foi possível identificar seu usuário.');
  if (!groupId) {
    return reply(sock, jid, msg, '🎣 Transferência de itens de pesca só funciona em grupos!');
  }

  const rawMentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

  if (!rawMentioned) {
    return reply(sock, jid, msg,
      `⚠️ *TRANSFERIR ITEM DE PESCA*\n\n` +
      `Marque quem vai receber!\n\n` +
      `Uso: *!givepesca @fulano <item> [quantidade]*\n` +
      `Exemplos:\n` +
      `  • *!givepesca @João vara_bambu*\n` +
      `  • *!givepesca @João isca_minhoca 5*\n` +
      `  • *!givepesca @João peixe_dourado 2*\n\n` +
      `📦 Ver seus itens: *!inventariopesca*`
    );
  }

  const mentionedJid = await resolverJidCarteira(rawMentioned, groupId);

  // Compara apenas o número (parte antes do @), ignorando domínio diferente
  // entre @s.whatsapp.net e @lid para evitar falso positivo no auto-give
  const userNumero  = userId.split('@')[0].split(':')[0];
  const alvoNumero  = mentionedJid.split('@')[0].split(':')[0];

  if (userNumero === alvoNumero) {
    return reply(sock, jid, msg, '😂 Você não pode dar um item para si mesmo!');
  }

  // ── Extrai item e quantidade da caption ──────────────────────────────────────
  // Remove o prefixo do comando e todas as menções (@numero ou @numero@dominio)
  // antes de parsear, para aceitar tanto:
  //   !givepesca @João vara_bambu 2
  //   !givepesca vara_bambu 2 @João   (ordem alternativa)
  const semPrefixo = (caption ?? '').replace(/^[!.,\/]givepesca\s*/i, '').trim();
  const semMencao  = semPrefixo.replace(/@\S+/g, '').replace(/\s{2,}/g, ' ').trim();
  const partes     = semMencao.split(/\s+/);
  const itemKey    = partes[0]?.toLowerCase() || null;
  const qtd        = parseQuantidade(partes[1]);

  if (qtd === null) {
    return reply(sock, jid, msg, '⚠️ Quantidade inválida. Use um número inteiro entre 1 e 1000.');
  }

  if (!itemKey) {
    return reply(sock, jid, msg,
      `⚠️ Informe o item a transferir!\n\n` +
      `Uso: *!givepesca @fulano <item> [quantidade]*\n` +
      `Exemplo: *!givepesca @João vara_bambu*\n\n` +
      `📦 Ver seus itens: *!inventariopesca*`
    );
  }

  // ── Resolve catálogo completo ────────────────────────────────────────────────
  const catalogoCompleto = { ...VARAS_PESCA, ...ISCAS, ...CATALOGO_PESCA };
  const info = catalogoCompleto[itemKey];

  if (!info) {
    return reply(sock, jid, msg,
      `⚠️ Item *${itemKey}* não existe no sistema de pesca.\n\n` +
      `📦 Veja seus itens: *!inventariopesca*\n` +
      `🛒 Comprar equipamentos: *!varas* · *!iscas*`
    );
  }

  try {
    // ── Debita do remetente de forma atômica ─────────────────────────────────
    // A condição $gte garante que não é possível ficar com quantidade negativa,
    // mesmo que o usuário dispare o comando duas vezes simultaneamente.
    const retirada = await CarteiraGrupo.findOneAndUpdate(
      {
        idWhatsApp: userId,
        idGrupo:    groupId,
        [`itensPesca.${itemKey}`]: { $gte: qtd },
      },
      { $inc: { [`itensPesca.${itemKey}`]: -qtd } },
      { new: false } // retorna doc ANTES da atualização para ler disponivel
    );

    if (!retirada) {
      // Busca quantidade real para exibir no erro
      const carteira   = await CarteiraGrupo
        .findOne({ idWhatsApp: userId, idGrupo: groupId })
        .select('itensPesca')
        .lean();
      const invRaw     = carteira?.itensPesca;
      const inv        = invRaw instanceof Map ? Object.fromEntries(invRaw) : (invRaw ?? {});
      const disponivel = inv[itemKey] ?? 0;

      return reply(sock, jid, msg,
        `⚠️ *ESTOQUE INSUFICIENTE*\n\n` +
        `📦 Você tem: *${disponivel}× ${info.nome}*\n` +
        `📊 Precisa de: *${qtd}×*\n\n` +
        `_Use !inventariopesca para ver seu inventário completo._`
      );
    }

    // ── Bloqueia give de vara se destinatário já tiver uma igual ─────────────
    if (VARAS_PESCA[itemKey]) {
      const carteiraAlvo = await CarteiraGrupo
        .findOne({ idWhatsApp: mentionedJid, idGrupo: groupId })
        .lean();

      if (getQtdItem(carteiraAlvo, itemKey) > 0) {
        // Estorna a retirada já feita do remetente
        await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp: userId, idGrupo: groupId },
          { $inc: { [`itensPesca.${itemKey}`]: qtd } }
        );
        return reply(sock, jid, msg,
          `⚠️ *@${alvoNumero} já possui ${info.nome}!*\n\n` +
          `_Varas não acumulam. Item devolvido para você._`
        );
      }
    }

    // ── Credita ao destinatário ───────────────────────────────────────────────
    // upsert: true garante criação do documento caso o destinatário ainda
    // não tenha registro neste grupo (ex: nunca pescou antes).
    try {
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: mentionedJid, idGrupo: groupId },
        {
          $setOnInsert: { idWhatsApp: mentionedJid, idGrupo: groupId },
          $inc: { [`itensPesca.${itemKey}`]: qtd },
        },
        { upsert: true }
      );
    } catch (erroCredito) {
      // Não deixar o item desaparecer se a carteira do destinatário falhar.
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp: userId, idGrupo: groupId },
        { $inc: { [`itensPesca.${itemKey}`]: qtd } }
      );
      throw erroCredito;
    }

    const numeroAlvo    = alvoNumero;
    const qtdLabel      = qtd > 1 ? ` × ${qtd}` : '';
    const disponivelAnt = retirada.itensPesca instanceof Map
      ? (retirada.itensPesca.get(itemKey) ?? 0)
      : (retirada.itensPesca?.[itemKey] ?? 0);
    const restante      = disponivelAnt - qtd;

    return sock.sendMessage(jid, {
      text:
        `🎁 *ITEM TRANSFERIDO!* 🎁\n\n` +
        `📦 Item: *${info.nome}*${qtdLabel}\n` +
        `➡️ Para: *@${numeroAlvo}*\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📊 Restante no seu inventário: *${restante}×*\n` +
        `_Use !inventariopesca para conferir seus itens._`,
      mentions: [mentionedJid],
    }, { quoted: msg });

  } catch (err) {
    console.error('[Pesca] handleGivePesca:', err);
    return reply(sock, jid, msg, '⚠️ Erro interno ao transferir o item! Tente novamente.');
  }
}

// ─── Exportar ─────────────────────────────────────────────────────────────────

module.exports = {
  handlePescar,
  handleVaras,
  handleIscas,
  handleComprarPesca,
  handleInventarioPesca,
  handleVenderPesca,
  handleGivePesca,
  handleRankingPesca,
  handleStatsPesca,

  // Catálogos (usados pelo marketplace.js)
  VARAS_PESCA,
  ISCAS,
  CATALOGO_PESCA,
  PEIXES_E_ITENS,
};