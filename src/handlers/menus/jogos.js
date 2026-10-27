'use strict';

async function handleMenuJogos(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
   🎮 MENU JOGOS & DIVERSÃO
╚══════════════════════╝

💰 *ECONOMIA*
  ▸ ${P}menugold — economia em Reais
  ▸ ${P}missao
  ▸ ${P}garimpar
  ▸ ${P}extrato

🧩 *MINI-JOGOS*
  ▸ ${P}quiz _(tema)_
  ▸ ${P}anagrama
  ▸ ${P}ppt _(pedra/papel/tesoura)_
  ▸ ${P}eununca
  ▸ ${P}brincadeiras

🎰 *APOSTAS & SORTE*
  ▸ ${P}apostar _(quantia)_
  ▸ ${P}slots
  ▸ ${P}corrida
  ▸ ${P}roletarussa
  ▸ ${P}roletarussa2
  ▸ ${P}roletarussa3

🎯 *OUTROS*
  ▸ ${P}tiro
  ▸ ${P}morte
  ▸ ${P}falta
  ▸ ${P}baterfalta
  ▸ ${P}pontos
  ▸ ${P}rankjogos
  ▸ ${P}ranklevel
  ▸ ${P}level

⚽ *COPA DO MUNDO*
  ▸ ${P}worldcup — Tabela da Copa 2026 🏆

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

async function handleBrincadeiras(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      🎮 BRINCADEIRAS
╚══════════════════════╝

📊 *PORCENTAGENS*
  ▸ ${P}gay @ — % de gay
  ▸ ${P}sexo @ — % de sexo
  ▸ ${P}lesbica @ — % lésbica
  ▸ ${P}trans @ — % trans
  ▸ ${P}aura @ — sua aura
  ▸ ${P}compatibilidade @ — compatibilidade

💘 *SOCIAL*
  ▸ ${P}ship @ @ — shippar
  ▸ ${P}crush @ — crush
  ▸ ${P}cantada @ — cantada
  ▸ ${P}elogio @ — elogiar alguém
  ▸ ${P}xingar @ — xingar alguém
  ▸ ${P}julgamento @ — julgar
  ▸ ${P}maldizer @ — maldizer
  ▸ ${P}fofoca @ — contar fofoca

🎲 *SORTE & JOGOS*
  ▸ ${P}dado _(lados)_ — jogar dado
  ▸ ${P}moeda — cara ou coroa
  ▸ ${P}8ball _(pergunta)_ — bola 8
  ▸ ${P}rolar _(min) (max)_ — número aleatório
  ▸ ${P}ppt — pedra papel tesoura
  ▸ ${P}quiz — quiz aleatório
  ▸ ${P}anagrama — jogo de anagrama
  ▸ ${P}roletarussa — roleta russa
  ▸ ${P}eununca — eu nunca
  ▸ ${P}verdadeoudesafio — verdade ou desafio

🔮 *OUTROS*
  ▸ ${P}fortuna — fortuna
  ▸ ${P}confissao — confissão
  ▸ ${P}inverter _(texto)_ — inverter texto
  ▸ ${P}gerarnome — gerador de nicknames

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleMenuJogos, handleBrincadeiras };
