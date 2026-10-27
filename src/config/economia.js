'use strict';

// ─── Dados estáticos de economia ────────────────────────────────────────────
// Extraído de handlers/diversao/economia.js (monolito antigo).
// Nenhum valor foi alterado — apenas movido para cá.

const ITENS_LOJA = {
  // COMIDAS
  pizza:        { nome: 'Pizza Margherita', preco: 50,  categoria: 'comida' },
  hamburger:    { nome: 'Hamburger Simples', preco: 40,  categoria: 'comida' },
  frango:       { nome: 'Frango Frito',     preco: 35,  categoria: 'comida' },
  picanha:      { nome: 'Picanha',          preco: 120, categoria: 'comida' },
  chocolate:    { nome: 'Chocolate',        preco: 25,  categoria: 'comida' },
  bolo:         { nome: 'Bolo de Aniversário', preco: 150, categoria: 'comida' },
  refrigerante: { nome: 'Refrigerante',     preco: 10,  categoria: 'comida' },
  cerveja:      { nome: 'Cerveja',          preco: 80,  categoria: 'comida' },

  // COMIDA PARA PETS
  racao:        { nome: 'Ração Normal',  preco: 20, categoria: 'petcomida' },
  racaopremium: { nome: 'Ração Premium', preco: 45, categoria: 'petcomida' },
  carnefresh:   { nome: 'Carne Fresca',  preco: 55, categoria: 'petcomida' },
  peixe:        { nome: 'Peixe Fresco',  preco: 60, categoria: 'petcomida' },
  leite:        { nome: 'Leite',         preco: 15, categoria: 'petcomida' },

  // BRINQUEDOS
  bolinha: { nome: 'Bolinha de Tênis', preco: 35,  categoria: 'petbrinquedo' },
  pelucia: { nome: 'Pelúcia',          preco: 50,  categoria: 'petbrinquedo' },
  corda:   { nome: 'Corda de Puxar',   preco: 40,  categoria: 'petbrinquedo' },
  disco:   { nome: 'Disco Voador',     preco: 60,  categoria: 'petbrinquedo' },
  casabrinquedo: { nome: 'Casa de Brinquedo', preco: 150, categoria: 'petbrinquedo' },

  // CUIDADOS PET
  remedio:  { nome: 'Remédio Geral',    preco: 80,  categoria: 'petcuidado' },
  vacina:   { nome: 'Vacina',           preco: 120, categoria: 'petcuidado' },
  shampoo:  { nome: 'Shampoo Especial', preco: 70,  categoria: 'petcuidado' },
  sabonete: { nome: 'Sabonete Pet',     preco: 40,  categoria: 'petcuidado' },

  // ACESSÓRIOS PET
  coleira:     { nome: 'Coleira Colorida', preco: 55,  categoria: 'petacessorio' },
  coleiraouro: { nome: 'Coleira de Ouro',  preco: 200, categoria: 'petacessorio' },
  bandana:     { nome: 'Bandana',          preco: 45,  categoria: 'petacessorio' },
  coroa:       { nome: 'Coroa Pet',        preco: 100, categoria: 'petacessorio' },

  // ESPECIAIS
  trofeu:       { nome: 'Troféu Miniatura', preco: 250, categoria: 'especial' },
  pocaoenergia: { nome: 'Poção de Energia', preco: 180, categoria: 'especial' },
  gema:         { nome: 'Gema Brilhante',   preco: 300, categoria: 'especial' },
  cristal:      { nome: 'Cristal Mágico',   preco: 400, categoria: 'especial' },

  // PETS (compatibilidade)
  cachorro: { nome: 'Cachorro', preco: 100, categoria: 'pet' },
  gato:     { nome: 'Gato',     preco: 100, categoria: 'pet' },
  coelho:   { nome: 'Coelho',   preco: 80,  categoria: 'pet' },

  // CASAL
  flores:   { nome: 'Flores',               preco: 60,  categoria: 'casal' },
  carta:    { nome: 'Carta de Amor',         preco: 80,  categoria: 'casal' },
  anel:     { nome: 'Anel',                  preco: 500, categoria: 'casal' },
  morango:  { nome: 'Morango com Chocolate', preco: 55,  categoria: 'casal' },
  perfume:  { nome: 'Perfume Premium',       preco: 150, categoria: 'casal' },
  urso:     { nome: 'Ursinho de Pelúcia',    preco: 130, categoria: 'casal' },
  caixa:    { nome: 'Caixa Presente Luxo',   preco: 50,  categoria: 'casal' },
  garrafa:  { nome: 'Garrafa Vinho Tinto',   preco: 250, categoria: 'casal' },

  // ESTILO
  camiseta: { nome: 'Camiseta', preco: 50, categoria: 'estilo' },
  calcas:   { nome: 'Calças',   preco: 60, categoria: 'estilo' },
  sapato:   { nome: 'Sapato',   preco: 70, categoria: 'estilo' },

  // TECNOLOGIA
  celular:          { nome: 'Celular',           preco: 200,   categoria: 'tec' },
  notebook:         { nome: 'Notebook Gamer',    preco: 5000,  categoria: 'tec' },
  smartphonebasico: { nome: 'Smartphone Básico', preco: 1500,  categoria: 'tec' },
  mousegamer:       { nome: 'Mouse Gamer',       preco: 350,   categoria: 'tec' },
  monitor24:        { nome: 'Monitor 24"',       preco: 1200,  categoria: 'tec' },
  fonesemfio:       { nome: 'Fone Sem Fio',      preco: 600,   categoria: 'tec' },
  ssd1tb:           { nome: 'SSD 1TB',           preco: 800,   categoria: 'tec' },
  pcgamerlegendario:{ nome: 'PC Gamer Lendário', preco: 15000, categoria: 'tec' },
};

// ─── Tabela de minérios do !garimpar (do mais raro ao mais comum) ───────────
const MINERIOS = [
  // ── LENDÁRIOS (chance ≤ 1%) ─────────────────────────────────────────────
  { nome: '🌟 Cristal Estelar',  emoji: '🌟', gold: 15000, chance: 0.1,  xp: 360 },
  { nome: '🔱 Obsidiana Divina', emoji: '🔱', gold: 10500, chance: 0.2,  xp: 300 },
  { nome: '💎 Diamante Negro',   emoji: '💎', gold: 7500,  chance: 0.3,  xp: 255 },
  { nome: '🪬 Pedra do Destino', emoji: '🪬', gold: 6000,  chance: 0.4,  xp: 225 },
  { nome: '💎 Diamante',         emoji: '💎', gold: 5400,  chance: 0.5,  xp: 195 },

  // ── ÉPICOS (chance 1–3%) ─────────────────────────────────────────────────
  { nome: '🔮 Ametista Negra',   emoji: '🔮', gold: 3900,  chance: 1.0,  xp: 154 },
  { nome: '🔮 Ametista',         emoji: '🔮', gold: 3360,  chance: 1.5,  xp: 134 },
  { nome: '💠 Safira Real',      emoji: '💠', gold: 2800,  chance: 2.0,  xp: 118 },
  { nome: '💠 Safira',           emoji: '💠', gold: 2380,  chance: 3.0,  xp: 106 },

  // ── RAROS (chance 4–8%) ──────────────────────────────────────────────────
  { nome: '❤️‍🔥 Rubi de Fogo',   emoji: '❤️‍🔥', gold: 1875, chance: 4.0, xp: 80  },
  { nome: '❤️ Rubi',             emoji: '❤️', gold: 1500,  chance: 5.0,  xp: 70  },
  { nome: '🫧 Aquamarine',       emoji: '🫧', gold: 1300,  chance: 6.0,  xp: 60  },
  { nome: '🟣 Tanzanita',        emoji: '🟣', gold: 1125,  chance: 7.0,  xp: 55  },
  { nome: '🔵 Turquesa',         emoji: '🔵', gold: 1000,  chance: 8.0,  xp: 50  },

  // ── INCOMUNS (chance 9–17%) ──────────────────────────────────────────────
  { nome: '🟡 Topázio Dourado',  emoji: '🟡', gold: 770,   chance: 9.0,  xp: 40  },
  { nome: '🟡 Topázio',          emoji: '🟡', gold: 616,   chance: 11.0, xp: 33  },
  { nome: '🟢 Esmeralda',        emoji: '🟢', gold: 506,   chance: 13.0, xp: 29  },
  { nome: '🟠 Ônix Laranja',     emoji: '🟠', gold: 418,   chance: 15.0, xp: 24  },
  { nome: '🪩 Opala',            emoji: '🪩', gold: 352,   chance: 17.0, xp: 20  },

  // ── COMUNS (chance 20–40%) ───────────────────────────────────────────────
  { nome: '⚪ Quartzo Rosa',     emoji: '⚪', gold: 234,   chance: 20.0, xp: 13  },
  { nome: '⚪ Quartzo',          emoji: '⚪', gold: 180,   chance: 25.0, xp: 9   },
  { nome: '🩶 Granito',          emoji: '🩶', gold: 135,   chance: 28.0, xp: 7   },
  { nome: '🪨 Pedra Calcária',   emoji: '🪨', gold: 99,    chance: 33.0, xp: 5   },
  { nome: '🪨 Pedra Comum',      emoji: '🪨', gold: 63,    chance: 40.0, xp: 4   },
];
// Soma das chances ≈ 100% — o fallback do garimpo cobre eventuais diferenças de float

// ─── Eventos especiais do !garimpar ──────────────────────────────────────────
const EVENTOS_GARIMPO = [
  { id: 'veia_rica',    chance: 5, multiplicador: 2,   msg: '✨ *VEIA RICA ENCONTRADA!* Você achou o dobro!'                       },
  { id: 'explosao',     chance: 3, multiplicador: 0,   msg: '💥 *EXPLOSÃO!* O minério foi destruído. Você saiu ileso, mas sem nada!' },
  { id: 'treasure',     chance: 1, multiplicador: 3,   msg: '🏆 *TESOURO ESCONDIDO!* Você triplicou o ganho!'                       },
  { id: 'inundacao',    chance: 4, multiplicador: 0.5, msg: '🌊 *INUNDAÇÃO!* A mina alagou e você salvou só metade.'                },
  { id: 'pedra_magica', chance: 2, multiplicador: 2.5, msg: '🔮 *PEDRA MÁGICA!* Uma energia estranha multiplicou seu ganho!'        },
];

// ─── Narrativas por raridade do !garimpar ────────────────────────────────────
const NARRATIVAS = {
  lendario: [
    '🌟 O chão brilhou e você não acreditou no que viu...',
    '⚡ Um clarão iluminou a mina inteira...',
    '👑 Lenda! Você achou o que ninguém encontra...',
  ],
  raro: [
    '✨ Seus olhos brilharam ao ver o reflexo...',
    '💫 A picareta fez um som diferente dessa vez...',
    '🔥 Algo especial estava escondido nessa rocha...',
  ],
  incomum: [
    '🔹 Não é o melhor, mas ainda vale muito...',
    '⛏️ Você cavou fundo e valeu a pena...',
    '🧱 Entre as pedras, algo se destacou...',
  ],
  comum: [
    '▫️ Mais um dia de garimpo honesto...',
    '🪨 O trabalho é duro, mas o saldo cai...',
    '⛏️ Nada de extraordinário, mas rendeu!',
  ],
};

module.exports = { ITENS_LOJA, MINERIOS, EVENTOS_GARIMPO, NARRATIVAS };