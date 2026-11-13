'use strict';

const {
  MINERIOS,
  EVENTOS_GARIMPO,
  NARRATIVAS,
  FALAS_GARIMPO,
} = require('../config/economia');

const RARIDADES = {
  mitico: '🌌 *MÍTICO!*',
  lendario: '🌟 *LENDÁRIO!*',
  epico: '💜 *Épico!*',
  raro: '✨ *Raro!*',
  incomum: '🔹 Incomum',
  comum: '▫️ Comum',
};

const ORDEM_RARIDADES = [
  { key: 'mitico', titulo: '🌌 *MÍTICOS*' },
  { key: 'lendario', titulo: '🌟 *LENDÁRIOS*' },
  { key: 'epico', titulo: '💜 *ÉPICOS*' },
  { key: 'raro', titulo: '✨ *RAROS*' },
  { key: 'incomum', titulo: '🔹 *INCOMUNS*' },
  { key: 'comum', titulo: '▫️ *COMUNS*' },
];

function formatarCatalogoMinerios(prefix = '!') {
  const formatarNumero = (valor) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(valor);
  const formatarChance = (valor) => new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: valor > 0 && valor < 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(valor);

  const linhas = [
    '⛏️ *CATÁLOGO DE MINÉRIOS*',
    '💰 Os valores-base em Pratas foram triplicados para todos os minérios.',
    '',
    `📚 Existem *${MINERIOS.length} minérios* para descobrir.`,
    '🎲 Cada tentativa sorteia um minério; as probabilidades individuais somam 100%.',
    `⚡ Acontecimento especial: *${formatarChance(EVENTOS_GARIMPO.reduce((soma, evento) => soma + evento.chance, 0))}%* de chance por tentativa.`,
    `⏳ Cooldown do ${prefix}garimpar: *15 minutos*.`,
  ];

  for (const raridade of ORDEM_RARIDADES) {
    const itens = MINERIOS.filter((minerio) => minerio.raridade === raridade.key);
    if (!itens.length) continue;
    const chanceTotal = itens.reduce((soma, minerio) => soma + minerio.chance, 0);
    linhas.push('', `${raridade.titulo} — *${formatarChance(chanceTotal)}% do total*`);
    for (const minerio of itens) {
      linhas.push(`  ${minerio.nome} — *${formatarChance(minerio.chance)}%* · ${formatarNumero(minerio.gold)} Prata · ${formatarNumero(minerio.xp)} XP`);
    }
  }

  linhas.push('', '━━━━━━━━━━━━━━━━━━━━', `Use *${prefix}garimpar* para tentar a sorte!`);
  return linhas.join('\n');
}

function randomPercent(random = Math.random) {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON) * 100;
}

function sortearMinerio(random = Math.random) {
  const roll = randomPercent(random);
  let acumulado = 0;
  for (const minerio of MINERIOS) {
    acumulado += minerio.chance;
    if (roll < acumulado) return minerio;
  }
  return MINERIOS[MINERIOS.length - 1] ?? null;
}

function sortearEvento(random = Math.random) {
  const roll = randomPercent(random);
  let acumulado = 0;
  for (const evento of EVENTOS_GARIMPO) {
    acumulado += evento.chance;
    if (roll < acumulado) return evento;
  }
  return null;
}

function escolherAleatorio(lista, random = Math.random) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const indice = Math.min(Math.floor(randomPercent(random) / 100 * lista.length), lista.length - 1);
  return lista[indice];
}

function getRaridadeKey(minerioOuChance) {
  if (minerioOuChance && typeof minerioOuChance === 'object' && RARIDADES[minerioOuChance.raridade]) {
    return minerioOuChance.raridade;
  }
  const chance = typeof minerioOuChance === 'number'
    ? minerioOuChance
    : Number(minerioOuChance?.chance ?? 100);
  if (chance <= 0.15) return 'mitico';
  if (chance <= 0.5) return 'lendario';
  if (chance <= 2) return 'epico';
  if (chance <= 5) return 'raro';
  if (chance <= 10) return 'incomum';
  return 'comum';
}

function getRaridadeLabel(minerioOuChance) {
  return RARIDADES[getRaridadeKey(minerioOuChance)] ?? RARIDADES.comum;
}

function narrativaAleatoria(key, random = Math.random) {
  const lista = NARRATIVAS[key] ?? NARRATIVAS.comum;
  return escolherAleatorio(lista, random) ?? '⛏️ Você encontrou uma nova formação rochosa...';
}

function falaAleatoria(key, random = Math.random) {
  const lista = FALAS_GARIMPO[key] ?? FALAS_GARIMPO.comum;
  return escolherAleatorio(lista, random) ?? null;
}

function mensagemEvento(evento, random = Math.random) {
  if (!evento) return '';
  if (Array.isArray(evento.mensagens)) {
    return escolherAleatorio(evento.mensagens, random) ?? evento.msg ?? '';
  }
  return evento.msg ?? '';
}

function calcularResultadoGarimpo(minerio, evento = null) {
  const goldBase = Math.max(0, Number(minerio?.gold) || 0);
  const xpBase = Math.max(0, Number(minerio?.xp) || 0);
  if (!evento) return { goldFinal: Math.floor(goldBase), xpFinal: Math.floor(xpBase) };

  const multiplicador = Math.max(0, Number(evento.multiplicador) || 0);
  const xpMultiplicador = Number.isFinite(Number(evento.xpMultiplicador))
    ? Math.max(0, Number(evento.xpMultiplicador))
    : Math.max(multiplicador, 0.5);

  return {
    goldFinal: Math.floor(goldBase * multiplicador),
    xpFinal: Math.floor(xpBase * xpMultiplicador),
  };
}

module.exports = {
  RARIDADES,
  formatarCatalogoMinerios,
  sortearMinerio,
  sortearEvento,
  getRaridadeKey,
  getRaridadeLabel,
  narrativaAleatoria,
  falaAleatoria,
  mensagemEvento,
  calcularResultadoGarimpo,
};
