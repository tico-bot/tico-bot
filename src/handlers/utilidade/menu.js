'use strict';

// (helper enviar() removido — só era usado pelas funções de menu que
// foram retiradas deste arquivo abaixo; handleMenu, handleMenuUtil,
// handleMenuJogos, handleMenuBaixar, handleMenuRelacionamento,
// handleAlteradores e handleMenuFilho — as únicas realmente chamadas
// pelo bot.js via utilidadeHandler — já usam sock.sendMessage direto.)

// ─── !menu ────────────────────────────────────────────────────────────────────

async function handleMenu(sock, msg, jid, caption, getPrefix, author) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  const timeStr = new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Cuiaba',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const hour = parseInt(timeStr.slice(0, 2), 10);

  let greeting = 'Olá';
  if (hour >= 5  && hour < 12) greeting = '🌅 Bom dia';
  else if (hour >= 12 && hour < 18) greeting = '☀️ Boa tarde';
  else                               greeting = '🌙 Boa noite';

  const userMention = author ? `*${author}*` : '';

  const menu =
`╔══════════════════════╗
       🔥 Tico 🔥
╚══════════════════════╝

${greeting}, ${userMention}! São ${timeStr} ⏰

━━━━━━━━━━━━━━━━━━━━━━━━
🎨 *FIGURINHAS & EFEITOS*
  ▸ ${P}menufig
  ▸ ${P}menuefeitos

🛡️ *ADMINISTRAÇÃO*
  ▸ ${P}menuadm
  ▸ ${P}reportar _(marque a mensagem)_

🎮 *DIVERSÃO & JOGOS*
  ▸ ${P}menujogos
  ▸ ${P}brincadeiras
  ▸ ${P}alteradores
  ▸ ${P}menuplata — economia em Plata
  ▸ ${P}menumarket
  ▸ ${P}menumediev
  ▸ ${P}menuroubar
  ▸ ${P}menusec
  ▸ ${P}menupet

💑 *RELACIONAMENTOS*
  ▸ ${P}menucasal
  ▸ ${P}menuaniversario
  ▸ ${P}menufilho

💼 *EMPREGOS*
  ▸ ${P}menuwork

🔧 *UTILIDADES*
  ▸ ${P}menuutil
  ▸ ${P}menubaixar
━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── !menuutil ────────────────────────────────────────────────────────────────

async function handleMenuUtil(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
     🔧 MENU UTILIDADES
╚══════════════════════╝

📍 *CONSULTAS*
  ▸ ${P}cep _(número)_
  ▸ ${P}clima _(cidade)_
  ▸ ${P}calcular _(expressão)_

🌐 *TEXTO & IDIOMAS*
  ▸ ${P}traduzir _(idioma) (texto)_
  ▸ ${P}inverter _(texto)_
  ▸ ${P}gerarnome
  ▸ ${P}fofoca _([@alguém])_

📡 *CÓDIGO MORSE*
  ▸ ${P}morse _(texto)_
  ▸ ${P}demorse _(código)_

👤 *PERFIL*
  ▸ ${P}perfil
  ▸ ${P}bio _(texto)_
  ▸ ${P}level
  ▸ ${P}ranklevel

🔗 *OUTROS & DIVERSÃO*
  ▸ ${P}encurtar _(link)_
  ▸ ${P}qrcode _(texto)_
  ▸ ${P}alteradores
  ▸ ${P}piada
  ▸ ${P}fato

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── !menujogos ───────────────────────────────────────────────────────────────

async function handleMenuJogos(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
   🎮 MENU JOGOS & DIVERSÃO
╚══════════════════════╝

💰 *ECONOMIA*
  ▸ ${P}menuplata — economia em Plata
  ▸ ${P}missao
  ▸ ${P}garimpar
  ▸ ${P}extrato

🧩 *MINI-JOGOS*
  ▸ ${P}quiz _(tema)_ — perguntas por tema
  ▸ ${P}quizfut — quiz de futebol
  ▸ ${P}quizgeo — quiz de geografia
  ▸ ${P}quizhis — quiz de história
  ▸ ${P}quizmat — quiz de matemática
  ▸ ${P}quizctec — ciência e tecnologia
  ▸ ${P}quizbsq — conhecimentos gerais
  ▸ ${P}quizanime — quiz de anime
  ▸ ${P}anagrama — desembaralhe uma palavra
  ▸ ${P}ppt _(pedra/papel/tesoura)_
  ▸ ${P}dado _(lados)_ — role um dado
  ▸ ${P}moeda — cara ou coroa
  ▸ ${P}8ball _(pergunta)_ — bola mágica
  ▸ ${P}rolar _(mín) (máx)_ — número aleatório
  ▸ ${P}charada — resolva uma charada
  ▸ ${P}contas — desafio de matemática
  ▸ ${P}termo — descubra a palavra
  ▸ ${P}eununca — eu nunca
  ▸ ${P}verdadeoudesafio — verdade ou desafio
  ▸ ${P}fortuna — receba sua fortuna
  ▸ ${P}brincadeiras — mais diversão
  ▸ ${P}ship @pessoa — veja a combinação do casal
  ▸ ${P}compatibilidade @pessoa — teste a compatibilidade
  ▸ ${P}aura @pessoa — descubra a aura de alguém
  ▸ ${P}podre — resultado aleatório engraçado
  ▸ ${P}frango — descubra quem é o frangão
  ▸ ${P}crush @pessoa — brincadeira sobre seu crush
  ▸ ${P}cantada @pessoa — gere uma cantada
  ▸ ${P}elogio @pessoa — envie um elogio
  ▸ ${P}julgamento @pessoa — julgamento divertido
  ▸ ${P}maldizer @pessoa — maldição de brincadeira
  ▸ ${P}falta — desafio de falta no futebol
  ▸ ${P}baterfalta @pessoa — disputa de cobrança de falta
  ▸ ${P}tiro @pessoa — resultado de duelo fictício
  ▸ ${P}morte @pessoa — cena fictícia aleatória
  ▸ ${P}confissao — envie uma confissão
  ▸ ${P}sorte — teste sua sorte do dia
  ▸ ${P}mimica — desafio de mímica para o grupo
  ▸ ${P}animal — adivinhe o animal pelas pistas
  ▸ ${P}superpoder — descubra seu superpoder aleatório
  ▸ ${P}vilao — gere seu nome de vilão
  ▸ ${P}heroi — descubra sua identidade de herói
  ▸ ${P}previsao — previsão divertida do futuro
  ▸ ${P}segredo — receba um segredo fictício aleatório
  ▸ ${P}detetive — resolva um pequeno mistério
  ▸ ${P}sobrevivencia — escolha como sobreviver
  ▸ ${P}campeonato — disputa improvável
  ▸ ${P}dilema — responda a um dilema impossível
  ▸ ${P}palavra — desembaralhe uma palavra
  ▸ ${P}memoria — teste rápido de memória
  ▸ ${P}numero — adivinhe o número secreto

🕹️ *JOGOS DE GRUPO*
  ▸ ${P}forca — adivinhe a palavra
  ▸ ${P}letra _(a)_ / ${P}chutar _(palavra)_ — jogar a forca
  ▸ ${P}adivinha — adivinhe o número (1-100)
  ▸ ${P}palpite _(número)_ — dar um palpite
  ▸ ${P}velha @pessoa — jogo da velha
  ▸ ${P}jogar _(1-9)_ — marcar casa na velha
  ▸ ${P}contas — conta rápida valendo 30s
  ▸ ${P}charada — charada valendo 60s
  ▸ ${P}resp _(resposta)_ — responder conta ou charada
  ▸ ${P}termo — descubra a palavra de 5 letras
  ▸ ${P}tentar _(palavra)_ — palpite no termo
  ▸ ${P}batata — batata quente (explode sozinha)
  ▸ ${P}passar @pessoa — passar a batata
  ▸ ${P}duelo @pessoa — duelo de dados

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

⚽ *FUTEBOL*
  ▸ ${P}brasileirao [A/B/C/D] — Tabelas do Brasileirão 🇧🇷
  ▸ ${P}brasileirao — tabela da Série A
  ▸ ${P}brasileiraojg — jogos da Série A
  ▸ ${P}rodada [A/B/C/D] [grupo] — jogos da rodada atual
  ▸ ${P}futebol — menu de futebol
  ▸ ${P}campeonato — competições disponíveis
  ▸ ${P}classificacao [código] — tabela internacional
  ▸ ${P}jogos [código] [data] — partidas
  ▸ ${P}clubes [código] — clubes da competição
  ▸ ${P}artilheiros [código] [n] — goleadores
  ▸ ${P}champions / ${P}premier — tabelas
  ▸ ${P}championsjg / ${P}premierjg — jogos
  ▸ ${P}laliga, ${P}bundesliga, ${P}seriea, ${P}ligue1, ${P}portuguesa — tabelas
  ▸ Adicione jg ao nome da liga para ver os jogos

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── !alteradores ─────────────────────────────────────────────────────────────

async function handleAlteradores(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
     🎛️ MENU ALTERADORES
╚══════════════════════╝

_Responda uma mídia com o comando desejado_

🎬 *VÍDEO*
  ▸ ${P}videolento
  ▸ ${P}videorapido
  ▸ ${P}videocontrario
  ▸ ${P}reversevideo
  ▸ ${P}videosemaudio

🎵 *ÁUDIO*
  ▸ ${P}audiolento
  ▸ ${P}audiorapido
  ▸ ${P}audioreverse
  ▸ ${P}grave
  ▸ ${P}esquilo
  ▸ ${P}bass
  ▸ ${P}graveprofundo
  ▸ ${P}normalizaraudio
  ▸ ${P}limparaudio
  ▸ ${P}audiovolume
  ▸ ${P}reverb

🎭 *VOZ*
  ▸ ${P}vozmenino
  ▸ ${P}vozgrossa
  ▸ ${P}vozmulher
  ▸ ${P}vozrobo
  ▸ ${P}vozalien
  ▸ ${P}vozvelho
  ▸ ${P}vozcrianca
  ▸ ${P}vozdemonio
  ▸ ${P}nightcore

🔊 *AMBIENTE*
  ▸ ${P}eco
  ▸ ${P}caverna
  ▸ ${P}telefone
  ▸ ${P}radio
  ▸ ${P}megafone
  ▸ ${P}underwater

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── !menucasal ───────────────────────────────────────────────────────────────

async function handleMenuRelacionamento(sock, msg, jid, getPrefix) {
  return require('../menus/casal').handleMenuRelacionamento(sock, msg, jid, getPrefix);
}

// ─── !menufilho ───────────────────────────────────────────────────────────────
async function handleMenuFilho(sock, msg, jid, getPrefix) {
  return require('../menus/casal').handleMenuFilho(sock, msg, jid, getPrefix);
}

// ─── !menubaixar ──────────────────────────────────────────────────────────────

async function handleMenuBaixar(sock, msg, jid, getPrefix) {
  const P = getPrefix ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      📥 MENU DOWNLOADS
╚══════════════════════╝

🎵 *MÚSICA & ÁUDIO*
  ▸ ${P}som _(nome da música)_
  ▸ ${P}audio _(link)_

📱 *VÍDEO & REDES SOCIAIS*
  ▸ ${P}tiktok _(link)_
  ▸ ${P}save _(link)_ — baixar mídia de várias redes
  ▸ ${P}saverec _(link)_ — recortar os primeiros 10 segundos
  ▸ ${P}pinterest _(link)_ — baixar vídeo ou imagem

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// (handleBrincadeiras, handleMenuGold, handleMenuPet, handleSistemaGold,
// handleSistemaPet e handleSistemaMedieval foram removidos deste arquivo.
// Eram código morto: o bot.js nunca roteia esses comandos para
// utilidadeHandler, sempre usa diversaoHandler — ver handlers/diversao/menus.js
// e handlers/diversao/emprego.js, que são as versões realmente ativas.
// Mantê-los aqui, com o mesmo nome e texto quase idêntico às versões reais,
// é exatamente o tipo de duplicata que causa confusão ao editar o bug errado.)

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  handleMenu,
  handleMenuUtil,
  handleMenuJogos,
  handleMenuBaixar,
  handleMenuRelacionamento,
  handleAlteradores,
  handleMenuFilho,
};