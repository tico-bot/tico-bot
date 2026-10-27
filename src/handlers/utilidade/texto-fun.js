'use strict';

const path = require('path');

async function safeReact(sock, jid, msgKey, emoji) {
  try {
    await sock.sendMessage(jid, { react: { text: emoji, key: msgKey } });
  } catch {}
}

async function handleQrcode(sock, msg, jid, caption) {
  let texto = caption.replace(/^[!.,\/#]qrcode\s*/i, '').trim();

  if (!texto) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
      texto =
        quotedMsg.conversation ||
        quotedMsg.extendedTextMessage?.text ||
        quotedMsg.imageMessage?.caption ||
        '';
    }
  }

  if (!texto) {
    await sock.sendMessage(jid, { text: '⚠️ Digite o texto/link ou responda a uma mensagem.\nExemplo: *!qrcode https://google.com*' }, { quoted: msg });
    return;
  }

  await safeReact(sock, jid, msg.key, '⏳');
  try {
    const QRCodeLib = require('qrcode');
    const qrBuffer  = await QRCodeLib.toBuffer(texto, { type: 'png', width: 512, margin: 2 });
    await sock.sendMessage(jid, { image: qrBuffer, caption: `🔳 *QR Code gerado!*\n\n_${texto.slice(0, 80)}_` }, { quoted: msg });
    await safeReact(sock, jid, msg.key, '✅');
  } catch {
    await safeReact(sock, jid, msg.key, '❌');
    await sock.sendMessage(jid, { text: '❌ Não consegui gerar o QR Code.' }, { quoted: msg });
  }
}

async function handleEncurtar(sock, msg, jid, caption) {
  const link = caption.replace(/^[!.,\/#]encurtar\s*/i, '').trim();
  if (!link || !/^https?:\/\//i.test(link)) {
    await sock.sendMessage(jid, { text: '⚠️ Envie um link válido com http:// ou https://.\nExemplo: *!encurtar https://google.com*' }, { quoted: msg });
    return;
  }
  await safeReact(sock, jid, msg.key, '⏳');
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const encurtado = (await res.text()).trim();
    if (!encurtado.startsWith('http')) throw new Error('Inválido');

    await sock.sendMessage(jid, { text: `🔗 *Link encurtado com sucesso:*\n\n${encurtado}` }, { quoted: msg });
    await safeReact(sock, jid, msg.key, '✅');
  } catch {
    await safeReact(sock, jid, msg.key, '❌');
    await sock.sendMessage(jid, { text: '❌ Não consegui encurtar o link.' }, { quoted: msg });
  }
}

async function handlePiada(sock, msg, jid) {
  const piadas = [
    'Por que o livro de matemática foi ao psicólogo?\nPorque tinha muitos problemas! 😂',
    'O que o zero disse para o oito?\nQue cinto bonito! 😆',
    'Por que o computador foi ao médico?\nPorque estava com vírus! 🤣',
    'O que o pato disse para a pata?\nPato-cê é linda! 🦆',
    'Por que o fantasma não mente?\nPorque ele é trans-pa-rente! 👻',
    'Por que o espantalho ganhou um prêmio?\nPorque era o melhor do campo! 🌾',
    'Por que a planta não fala?\nPorque ela é mudinha! 🌿',
    'O que a impressora disse para a outra?\nEssa folha é sua ou é impressão minha? 🖨️',
    'Qual é o cúmulo da paciência?\nContar a areia da praia com uma pinça! 🏖️',
    'Como o cozinheiro se defende de assaltantes?\nEle usa o sal-tante! 🧂',
    'Por que o jacaré foi à praia?\nPara tomar um banho de jacaré! 🐊',
    'Qual a comida preferida dos astronautas?\nO astro-nauta com batata palha! 🚀',
  ];
  const piada = piadas[Math.floor(Math.random() * piadas.length)];
  await sock.sendMessage(jid, { text: `😂 *Piada do Dia*\n\n${piada}` }, { quoted: msg });
}

async function handleFato(sock, msg, jid) {
  const fatos = [
    'Os polvos têm três corações e sangue azul.',
    'Mel não estraga nunca. Arqueólogos encontraram mel com 3.000 anos ainda comestível.',
    'O cérebro humano produz energia suficiente para acender uma pequena lâmpada.',
    'As abelhas conseguem reconhecer rostos humanos.',
    'Formigas nunca dormem e não possuem pulmões.',
    'Existem mais estrelas no universo do que grãos de areia em todas as praias da Terra.',
    'Os golfinhos dão nomes próprios uns aos outros através de assobios únicos.',
    'A água da Terra é mais antiga do que o próprio Sol.',
    'Um dia em Vênus é mais longo do que um ano em Vênus.',
    'Bananas são ligeiramente radioativas por causa do potássio.',
    'O tubarão-da-Groenlândia pode viver por mais de 400 anos.',
  ];
  const fato = fatos[Math.floor(Math.random() * fatos.length)];
  await sock.sendMessage(jid, { text: `📚 *Fato Incrível*\n\n🤓 ${fato}` }, { quoted: msg });
}

async function handleCodigoMorse(sock, msg, jid, caption) {
  const MORSE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.', '0': '-----', ' ': '/', '.': '.-.-.-', ',': '--..--',
    '?': '..--..', '!': '-.-.--', '-': '-....-', '/': '-..-.',
  };

  let texto = caption.replace(/^[!.,\/#](morse|codigomorse)\s*/i, '').trim();

  if (!texto) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
      texto = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
    }
  }

  if (!texto) {
    await sock.sendMessage(jid, { text: '⚠️ Digite o texto ou responda a uma mensagem para converter para Morse.' }, { quoted: msg });
    return;
  }

  const limpo = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const codificado = limpo.split('').map(c => MORSE[c] || c).join(' ');

  await sock.sendMessage(jid, { text: `📡 *Código Morse:*\n\n\`${codificado}\`` }, { quoted: msg });
}

async function handleDecodificarMorse(sock, msg, jid, caption) {
  const REVERSE_MORSE = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
    '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
    '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
    '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
    '-.--': 'Y', '--..': 'Z', '.----': '1', '..---': '2', '...--': '3',
    '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8',
    '----.': '9', '-----': '0', '/': ' ', '.-.-.-': '.', '--..--': ',',
    '..--..': '?', '-.-.--': '!', '-....-': '-', '-..-.': '/',
  };

  let codigo = caption.replace(/^[!.,\/#](demorse|decodificarmorse)\s*/i, '').trim();

  if (!codigo) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
      codigo = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
    }
  }

  if (!codigo) {
    await sock.sendMessage(jid, { text: '⚠️ Digite o código Morse para decodificar.' }, { quoted: msg });
    return;
  }

  const decodificado = codigo.split(/\s+/).map(c => REVERSE_MORSE[c] || c).join('');
  await sock.sendMessage(jid, { text: `📻 *Texto Decodificado:*\n\n${decodificado}` }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── NOVAS FUNÇÕES: !inverter, !fofoca, !gerarnome ─────────────
// ═══════════════════════════════════════════════════════════════

async function handleReverseText(sock, msg, jid, caption) {
  let texto = caption.replace(/^[!.,\/#]inverter\s*/i, '').trim();

  if (!texto) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
      texto = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
    }
  }

  if (!texto) {
    await sock.sendMessage(jid, { text: '⚠️ Digite o texto ou responda a uma mensagem para inverter.\nExemplo: *!inverter Olá Mundo*' }, { quoted: msg });
    return;
  }

  const invertido = texto.split('').reverse().join('');
  await sock.sendMessage(jid, { text: `🔄 *Texto Invertido:*\n\n${invertido}` }, { quoted: msg });
}

async function handleSayFofoca(sock, msg, content, jid, author, contactNames) {
  const ctx = content?.extendedTextMessage?.contextInfo;
  const mentionedJid = ctx?.mentionedJid?.[0] || null;
  const targetJid = mentionedJid || msg.key.participant || msg.key.remoteJid;
  const nomeAlvo = contactNames?.[targetJid] || `@${targetJid.split('@')[0].split(':')[0]}`;

  const fofocas = [
    `👀 Vazou! *${nomeAlvo}* foi visto(a) conversando no privado por 3 horas seguidas ontem à noite!`,
    `🤫 Fofoca quente: *${nomeAlvo}* mandou mensagem pro ex e apagou logo em seguida pra ninguém ver!`,
    `🍿 Dicazinha: *${nomeAlvo}* jura que tá de dieta, mas pediu 2 pizzas escondido no final de semana!`,
    `📱 Babado: *${nomeAlvo}* stalkeou a foto antiga de alguém e curtiu sem querer sem perceber! 😂`,
    `🔥 Rumores dizem que *${nomeAlvo}* tá preparando uma surpresa secreta pro grupo...`,
    `💃 Boato: *${nomeAlvo}* treina dancinhas do TikTok na frente do espelho todo dia quando ninguém tá olhando!`,
  ];

  const fofoca = fofocas[Math.floor(Math.random() * fofocas.length)];
  await sock.sendMessage(jid, {
    text: `📢 ═══ *FOFOCA DO DIA* ═══ 📢\n\n${fofoca}\n\n_Contado por: ${author}_ 🤫`,
    mentions: [targetJid],
  }, { quoted: msg });
}

async function handleGerarNome(sock, msg, jid, caption) {
  const estilo = caption.replace(/^[!.,\/#]gerarnome\s*/i, '').trim().toLowerCase();

  const prefixos = ['Sombra', 'Caçador', 'Velo', 'Trovão', 'Ciber', 'Místico', 'Lorde', 'Viper', 'Fenix', 'Titã', 'Zero', 'Kage'];
  const sufixos  = ['Slayer', 'Master', 'X', 'Blade', 'Vortex', 'Prime', 'Ninja', 'Phantom', 'Dragon', 'Pulse', 'Rider', 'Storm'];

  const nP = prefixos[Math.floor(Math.random() * prefixos.length)];
  const nS = sufixos[Math.floor(Math.random() * sufixos.length)];
  const num = Math.floor(Math.random() * 99) + 1;

  const nickname = `${nP}_${nS}${num}`;

  await sock.sendMessage(jid, {
    text: `🏷️ *NICKNAME GERADO:*\n\n👉 \`${nickname}\`\n\n_Copie para usar em jogos e redes sociais!_ 🎮`,
  }, { quoted: msg });
}

module.exports = {
  handleQrcode,
  handleEncurtar,
  handlePiada,
  handleFato,
  handleCodigoMorse,
  handleDecodificarMorse,
  handleReverseText,
  handleSayFofoca,
  handleGerarNome,
};
