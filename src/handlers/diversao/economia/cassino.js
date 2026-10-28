'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getCarteira, alterarGold } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const {
  formatWalletAmount,
  localMinorUnitsToBrlCents,
} = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira', 'wallet'));
const { resolveGlobalId } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const { randomUUID, randomInt } = require('crypto');

// Credita o prêmio com um requestId fixo: se a 1ª chamada tiver sido aplicada
// e a resposta se perder, a 2ª é reconhecida pelo servidor e não credita em dobro.
// Só repete para conta vinculada (o fluxo legado não é idempotente).
async function creditarPremio(carteira, senderNorm, jid, valor, descricao) {
  const requestId = randomUUID();
  const opts = { requestId, allowLinked: true };
  try {
    return await alterarGold(senderNorm, jid, valor, descricao, opts);
  } catch (e) {
    if (!carteira?.walletLinked) throw e;
    console.error(`[cassino] falha ao creditar "${descricao}", repetindo com o mesmo requestId:`, e.message);
    return alterarGold(senderNorm, jid, valor, descricao, opts);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !slots ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const SLOTS_SIMBOLOS = [
  { emoji: '💎', nome: 'Diamante', peso: 2  },
  { emoji: '7️⃣',  nome: 'Sete',    peso: 5  },
  { emoji: '🔔', nome: 'Sino',    peso: 10 },
  { emoji: '🍇', nome: 'Uva',     peso: 15 },
  { emoji: '🍉', nome: 'Melancia', peso: 18 },
  { emoji: '🍋', nome: 'Limão',   peso: 22 },
  { emoji: '🍒', nome: 'Cereja',  peso: 28 },
];

const SLOTS_POOL = SLOTS_SIMBOLOS.flatMap(s => Array(s.peso).fill(s.emoji));

// Aceita apenas valores inteiros positivos, sem aceitar entradas como '10abc' ou '1.5'.
function parseAposta(valor) {
  const texto = String(valor ?? '').trim();
  if (!/^\d+$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function argumento(caption, indice) {
  return typeof caption === 'string' ? caption.trim().split(/\s+/)[indice] : undefined;
}

const SLOTS_MULTIPLICADORES = {
  '💎': { tres: 50, dois: 5  },
  '7️⃣':  { tres: 25, dois: 3  },
  '🔔': { tres: 15, dois: 2  },
  '🍇': { tres: 10, dois: 1.5 },
  '🍉': { tres: 8,  dois: 1.5 },
  '🍋': { tres: 6,  dois: 1.2 },
  '🍒': { tres: 4,  dois: 1.2 },
};

const SLOTS_FRAMES_ANIM = [
  ['🎲', '🎲', '🎲'],
  ['🍒', '🎲', '🎲'],
  ['🍋', '🍇', '🎲'],
  ['🍉', '🔔', '🍒'],
  ['🔔', '🍋', '🍒'],
  ['🍇', '🍉', '🍋'],
];
const SLOTS_FRAME_DELAY = 320;

function sortearSlots() {
  const pick = () => SLOTS_POOL[randomInt(SLOTS_POOL.length)];
  return [pick(), pick(), pick()];
}

function calcularResultado(r1, r2, r3, aposta) {
  if (r1 === r2 && r2 === r3) {
    const mult  = SLOTS_MULTIPLICADORES[r1]?.tres ?? 4;
    const label =
      mult >= 25
        ? `🌟 *JACKPOT LENDÁRIO!* Três ${r1} — *${mult}x*!`
        : mult >= 10
        ? `🎉 *JACKPOT!* Três ${r1} — *${mult}x*!`
        : `✨ *TRÊS IGUAIS!* ${r1}${r1}${r1} — *${mult}x*!`;
    return { mult, label, tipo: 'tres' };
  }

  if (r1 === r2 || r2 === r3 || r1 === r3) {
    const simbolo = r1 === r2 ? r1 : r3 === r2 ? r2 : r1;
    const mult    = SLOTS_MULTIPLICADORES[simbolo]?.dois ?? 1.2;
    return {
      mult,
      label: `💫 *DOIS IGUAIS!* ${simbolo}${simbolo} — *${mult}x*`,
      tipo: 'dois',
    };
  }

  return { mult: 0, label: `❌ *Perdeu!* O cassino agradece 🏦`, tipo: 'derrota' };
}

function buildFrame(s1, s2, s3, girando = true) {
  const status = girando ? `_Girando..._` : `_Resultado_`;
  return (
    `🎰 *CASSINO Tico* 🎰\n\n` +
    `┌─────────────────┐\n` +
    `│   ${s1}  │  ${s2}  │  ${s3}   │\n` +
    `└─────────────────┘\n\n` +
    status
  );
}

function buildResultado(r1, r2, r3, aposta, mult, label, lucroLiq, saldoFinal, wallet) {
  const premio  = Math.floor(aposta * mult);
  const icone   = lucroLiq > 0 ? '📈' : lucroLiq === 0 ? '➖' : '📉';
  const sinal   = lucroLiq >= 0 ? '+' : '-';

  return (
    `🎰 *CASSINO Tico* 🎰\n\n` +
    `┌─────────────────┐\n` +
    `│   ${r1}  │  ${r2}  │  ${r3}   │\n` +
    `└─────────────────┘\n\n` +
    `${label}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📋 *DETALHES DA RODADA*\n` +
    `  💵 Aposta:      *${formatWalletAmount(aposta, wallet)}*\n` +
    (mult > 0
      ? `  ✖️  Multiplicador: *${mult}x*\n` +
        `  🏆 Prêmio:      *${formatWalletAmount(premio, wallet)}*\n`
      : '') +
    `  ${icone} Resultado:   *${sinal}${formatWalletAmount(Math.abs(lucroLiq), wallet)}*\n` +
    `  💰 Saldo final: *${formatWalletAmount(saldoFinal, wallet)}*`
  );
}

async function handleSlots(sock, msg, jid, senderJid, caption) {
  if (!jid || !senderJid) return;
  const args       = (typeof caption === 'string' ? caption : '').trim().split(/\s+/);
  let aposta       = parseAposta(args[1]);
  const senderNorm = jidNormalizedUser(senderJid);

  if (aposta === null) {
    await sock.sendMessage(jid, {
      text:
        `🎰 *CASSINO Tico* 🎰\n\n` +
        `⚠️ Uso correto: *!slots [valor]*\n` +
        `Exemplo: *!slots 100*\n\n` +
        `💎 Símbolos e multiplicadores (3x iguais):\n` +
        SLOTS_SIMBOLOS.map(s =>
          `  ${s.emoji} ${s.nome}: *${SLOTS_MULTIPLICADORES[s.emoji].tres}x* (par: ${SLOTS_MULTIPLICADORES[s.emoji].dois}x)`
        ).join('\n'),
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(senderNorm, jid);
  if (carteira?.walletLinked) {
    aposta = localMinorUnitsToBrlCents(aposta, { rate: carteira.walletRate });
    if (aposta <= 0) {
      await sock.sendMessage(jid, { text: '⚠️ A aposta é menor que o valor mínimo aceito após a conversão da moeda.' }, { quoted: msg });
      return;
    }
  }
  const saldo    = Number.isSafeInteger(carteira?.gold) && carteira.gold >= 0 ? carteira.gold : 0;

  if (saldo < aposta) {
    await sock.sendMessage(jid, {
      text:
        `🎰 *CASSINO Tico* 🎰\n\n` +
        `❌ *Saldo insuficiente!*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💰 Seu saldo:  *${formatWalletAmount(saldo, carteira)}*\n` +
        `🎲 Aposta:     *${formatWalletAmount(aposta, carteira)}*\n` +
        `📉 Faltam:     *${formatWalletAmount(aposta - saldo, carteira)}*`,
    }, { quoted: msg });
    return;
  }

  await alterarGold(senderNorm, jid, -aposta, 'Slots (aposta)', { allowLinked: true });

  const msgInicial = await sock.sendMessage(
    jid,
    { text: buildFrame('🎲', '🎲', '🎲', true) },
    { quoted: msg }
  );

  for (const [s1, s2, s3] of SLOTS_FRAMES_ANIM) {
    await new Promise(r => setTimeout(r, SLOTS_FRAME_DELAY));
    try { await sock.sendMessage(jid, { text: buildFrame(s1, s2, s3, true), edit: msgInicial.key }); } catch {}
  }

  await new Promise(r => setTimeout(r, SLOTS_FRAME_DELAY));

  const [r1, r2, r3]    = sortearSlots();
  const { mult, label } = calcularResultado(r1, r2, r3, aposta);
  const premio          = Math.floor(aposta * mult);
  const lucroLiq        = premio - aposta;

  let saldoFinal = saldo - aposta;
  if (premio > 0) {
    try {
      const carteiraAtualizada = await creditarPremio(carteira, senderNorm, jid, premio, `Slots (${mult}x)`);
      saldoFinal = carteiraAtualizada.gold;
    } catch (e) {
      console.error(`[slots] PRÊMIO NÃO CREDITADO jid=${senderNorm} premio=${premio}:`, e.message);
      await sock.sendMessage(jid, {
        text: '⚠️ Não consegui creditar seu prêmio agora. Fale com um admin; a rodada foi registrada.',
      }, { quoted: msg });
      return;
    }
  }

  const textoFinal = buildResultado(r1, r2, r3, aposta, mult, label, lucroLiq, saldoFinal, carteira);

  try { await sock.sendMessage(jid, { text: textoFinal, edit: msgInicial.key }); }
  catch { await sock.sendMessage(jid, { text: textoFinal }, { quoted: msg }); }
}

// ═══════════════════════════════════════════════════════════════
// ─── !corrida ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const CORRIDA_BICHOS = [
  { nome: '🐎 Cavalo',    emoji: '🐎', odds: 2.0, velocidade: 9 },
  { nome: '🐅 Tigre',     emoji: '🐅', odds: 2.5, velocidade: 8 },
  { nome: '🦊 Raposa',    emoji: '🦊', odds: 3.0, velocidade: 7 },
  { nome: '🐕 Cachorro',  emoji: '🐕', odds: 3.5, velocidade: 6 },
  { nome: '🐗 Javali',    emoji: '🐗', odds: 4.0, velocidade: 5 },
  { nome: '🐢 Tartaruga', emoji: '🐢', odds: 8.0, velocidade: 2 },
];

const CORRIDA_PISTA_LEN   = 12;

function sortearVencedor() {
  const pool = CORRIDA_BICHOS.flatMap((b, i) => Array(b.velocidade).fill(i));
  return pool[randomInt(pool.length)];
}

async function handleCorrida(sock, msg, jid, senderJid, caption) {
  if (!jid || !senderJid) return;
  const args       = (typeof caption === 'string' ? caption : '').trim().split(/\s+/);
  const escolhaRaw = argumento(caption, 1);
  const apostaRaw  = argumento(caption, 2);
  const escolha    = /^\d+$/.test(String(escolhaRaw ?? '')) ? Number(escolhaRaw) : NaN;
  let aposta       = parseAposta(apostaRaw);
  const senderNorm = jidNormalizedUser(senderJid);

  const escolhaValida = escolha >= 1 && escolha <= CORRIDA_BICHOS.length;

  if (!Number.isSafeInteger(escolha) || !escolhaValida || aposta === null) {
    await sock.sendMessage(jid, {
      text:
        `🏁 *CORRIDA DE BICHOS* 🏁\n\n` +
        `⚠️ Uso: *!corrida [bicho] [valor]*\n\n` +
        `*Escolha seu corredor:*\n` +
        CORRIDA_BICHOS.map((b, i) =>
          `  ${i + 1}️⃣ ${b.nome} — odds *${b.odds}x*`
        ).join('\n'),
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(senderNorm, jid);
  if (carteira?.walletLinked) {
    aposta = localMinorUnitsToBrlCents(aposta, { rate: carteira.walletRate });
    if (aposta <= 0) {
      await sock.sendMessage(jid, { text: '⚠️ A aposta é menor que o valor mínimo aceito após a conversão da moeda.' }, { quoted: msg });
      return;
    }
  }
  const saldo    = Number.isSafeInteger(carteira?.gold) && carteira.gold >= 0 ? carteira.gold : 0;

  if (saldo < aposta) {
    await sock.sendMessage(jid, {
      text:
        `🏁 *CORRIDA DE BICHOS* 🏁\n\n` +
        `❌ *Saldo insuficiente!*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💰 Seu saldo: *${formatWalletAmount(saldo, carteira)}*\n` +
        `🎲 Aposta:    *${formatWalletAmount(aposta, carteira)}*`,
    }, { quoted: msg });
    return;
  }

  await alterarGold(senderNorm, jid, -aposta, 'Corrida (aposta)', { allowLinked: true });

  const vencedorIdx = sortearVencedor();
  const escolhaIdx  = escolha - 1;
  const venceu      = vencedorIdx === escolhaIdx;
  const bichoEscolha = CORRIDA_BICHOS[escolhaIdx];
  const bichoVencedor = CORRIDA_BICHOS[vencedorIdx];
  const premio       = venceu ? Math.floor(aposta * bichoEscolha.odds) : 0;
  const lucroLiq     = premio - aposta;

  let saldoFinal = saldo - aposta;
  if (venceu && premio > 0) {
    try {
      const carteiraAtualizada = await creditarPremio(carteira, senderNorm, jid, premio, `Corrida (${bichoEscolha.nome})`);
      saldoFinal = carteiraAtualizada.gold;
    } catch (e) {
      console.error(`[corrida] PRÊMIO NÃO CREDITADO jid=${senderNorm} premio=${premio}:`, e.message);
      await sock.sendMessage(jid, {
        text: '⚠️ Não consegui creditar seu prêmio agora. Fale com um admin; a rodada foi registrada.',
      }, { quoted: msg });
      return;
    }
  }

  const FRASES_VITORIA_CORRIDA = [
    'Disparou na reta final e ninguém alcançou! 🏆',
    'Passou os outros bichos como se estivessem parados!',
    'Chegou raspando, mas chegou primeiro — e é isso que importa!',
    'Dominou a pista do início ao fim! 🔥',
    'Uma corrida perfeita — seu corredor não deu chance aos outros!',
  ];

  const FRASES_DERROTA_CORRIDA = [
    'Seu bicho até tentou, mas não teve pernas pra vencer hoje.',
    'Ficou pra trás logo na largada... 😔',
    'Foi uma corrida disputada, mas a sorte não ajudou dessa vez.',
    'Quase lá! Só faltou um pouco mais de fôlego.',
    'A pista foi cruel dessa vez — tenta outro bicho na próxima!',
  ];

  const statusTxt = venceu
    ? `🎉 *VITÓRIA!*\n${FRASES_VITORIA_CORRIDA[randomInt(FRASES_VITORIA_CORRIDA.length)]}`
    : `❌ *DERROTA!*\n${FRASES_DERROTA_CORRIDA[randomInt(FRASES_DERROTA_CORRIDA.length)]}`;

  const resultadoLinha = venceu
    ? `📈 Ganho líquido: *+${formatWalletAmount(lucroLiq, carteira)}* _(prêmio de ${formatWalletAmount(premio, carteira)} pelas odds ${bichoEscolha.odds}x)_`
    : `📉 Perda: *-${formatWalletAmount(aposta, carteira)}*`;

  await sock.sendMessage(jid, {
    text:
      `🏁 *CORRIDA DE BICHOS* 🏁\n\n` +
      `🎯 Sua aposta: *${bichoEscolha.nome}* (odds ${bichoEscolha.odds}x)\n` +
      `🏆 Vencedor da corrida: *${bichoVencedor.nome}*\n\n` +
      `${statusTxt}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${resultadoLinha}\n` +
      `💰 Saldo final: *${formatWalletAmount(saldoFinal, carteira)}*\n\n` +
      `_Quer correr de novo? !corrida [bicho] [valor]_`,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !apostar (Coin Flip / 50-50) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleApostar(sock, msg, jid, senderJid, caption) {
  if (!jid || !senderJid) return;
  const args       = (typeof caption === 'string' ? caption : '').trim().split(/\s+/);
  let aposta       = parseAposta(args[1]);
  const senderNorm = jidNormalizedUser(senderJid);

  if (aposta === null) {
    await sock.sendMessage(jid, {
      text: '🎲 Uso: *!apostar <valor>*\nExemplo: *!apostar 50*',
    }, { quoted: msg });
    return;
  }

  const carteira = await getCarteira(senderNorm, jid);
  if (carteira?.walletLinked) {
    aposta = localMinorUnitsToBrlCents(aposta, { rate: carteira.walletRate });
    if (aposta <= 0) {
      await sock.sendMessage(jid, { text: '⚠️ A aposta é menor que o valor mínimo aceito após a conversão da moeda.' }, { quoted: msg });
      return;
    }
  }
  const saldo    = Number.isSafeInteger(carteira?.gold) && carteira.gold >= 0 ? carteira.gold : 0;

  if (saldo < aposta) {
    await sock.sendMessage(jid, {
      text: `❌ *Saldo insuficiente!* Você possui *${formatWalletAmount(saldo, carteira)}*.`,
    }, { quoted: msg });
    return;
  }

  const FRASES_VITORIA = [
    'A moeda girou no ar e caiu do seu lado! 🪙',
    'Sorte grande dessa vez — a banca chorou! 😎',
    'CARA! A sorte tava mesmo com você hoje.',
    'A moeda bateu no chão e... vitória absoluta!',
    'Você sentiu que ia ganhar, e ganhou! 🔥',
  ];

  const FRASES_DERROTA = [
    'A moeda caiu do lado errado dessa vez... 😔',
    'Quase! A sorte não sorriu pra você agora.',
    'A banca levou essa rodada. Volte com tudo na próxima!',
    'Foi por pouco — tenta de novo!',
    'A moeda rolou, rolou... e não deu essa.',
  ];

  const venceu = randomInt(2) === 0;

  if (venceu) {
    const frase = FRASES_VITORIA[randomInt(FRASES_VITORIA.length)];
    const carteiraAtualizada = await alterarGold(senderNorm, jid, aposta, 'Aposta (Vitória)', { allowLinked: true });
    const novoSaldo = carteiraAtualizada?.gold ?? (saldo + aposta);

    await sock.sendMessage(jid, {
      text:
        `🎉 *APOSTA GANHA!* 🎉\n\n` +
        `🪙 ${frase}\n\n` +
        `💵 Valor apostado: *${formatWalletAmount(aposta, carteira)}*\n` +
        `📈 Ganho: *+${formatWalletAmount(aposta, carteira)}*\n` +
        `💰 Novo saldo: *${formatWalletAmount(novoSaldo, carteiraAtualizada)}*\n\n` +
        `_Quer arriscar de novo? !apostar <valor>_`,
    }, { quoted: msg });
  } else {
    const frase = FRASES_DERROTA[randomInt(FRASES_DERROTA.length)];
    const carteiraAtualizada = await alterarGold(senderNorm, jid, -aposta, 'Aposta (Derrota)', { allowLinked: true });
    const novoSaldo = carteiraAtualizada?.gold ?? (saldo - aposta);

    await sock.sendMessage(jid, {
      text:
        `💔 *APOSTA PERDIDA!* 💔\n\n` +
        `🪙 ${frase}\n\n` +
        `💵 Valor apostado: *${formatWalletAmount(aposta, carteira)}*\n` +
        `📉 Perda: *-${formatWalletAmount(aposta, carteira)}*\n` +
        `💰 Novo saldo: *${formatWalletAmount(novoSaldo, carteiraAtualizada)}*\n\n` +
        `_Não desanima — tenta de novo! !apostar <valor>_`,
    }, { quoted: msg });
  }
}

module.exports = {
  handleSlots,
  handleCorrida,
  handleApostar,
};
