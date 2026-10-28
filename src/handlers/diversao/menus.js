'use strict';

// ─── handleBrincadeiras ───────────────────────────────────────────────────────
async function handleBrincadeiras(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  await sock.sendMessage(jid, {
    text:
      `🎮 *BRINCADEIRAS* 🎮\n\n` +
      `${P}gay [@] — % de gay\n` +
      `${P}sexo [@] — % de sexo\n` +
      `${P}lesbica [@] — % lésbica\n` +
      `${P}trans [@] — % trans\n` +
      `${P}aura [@] — sua aura\n` +
      `${P}ship [@] [@] — shippar\n` +
      `${P}compatibilidade [@] — compatibilidade\n` +
      `${P}dado [lados] — jogar dado\n` +
      `${P}moeda — cara ou coroa\n` +
      `${P}8ball [pergunta] — bola 8\n` +
      `${P}rolar [min] [max] — número aleatório\n` +
      `${P}ppt — pedra papel tesoura\n` +
      `${P}quiz — quiz aleatório\n` +
      `${P}anagrama — jogo de anagrama\n` +
      `${P}roletarussa — roleta russa\n` +
      `${P}eununca — eu nunca\n` +
      `${P}verdadeoudesafio — verdade ou desafio\n` +
      `${P}xingar [@] — xingar alguém\n` +
      `${P}elogio [@] — elogiar alguém\n` +
      `${P}cantada [@] — cantada\n` +
      `${P}crush [@] — crush\n` +
      `${P}julgamento [@] — julgar\n` +
      `${P}fortuna — fortuna\n` +
      `${P}maldizer [@] — maldizer\n` +
      `${P}confissao — confissão\n` +
      `${P}fofoca [@] — contar fofoca\n` +
      `${P}inverter [texto] — inverter texto\n` +
      `${P}gerarnome — gerador de nicknames`,
  }, { quoted: msg });
}

// ─── handleMenuPlata ───────────────────────────────────────────────────────────
async function handleMenuPlata(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  await sock.sendMessage(jid, {
    text:
      `💵 *SISTEMA DE PLATA* 💵\n\n` +
      `${P}plata — ver saldo (comandos antigos continuam funcionando)\n` +
      `${P}loja — loja geral\n` +
      `${P}lojafood — loja de comida\n` +
      `${P}lojapet — loja de itens para personagens\n` +
      `${P}lojatec — loja de tecnologia\n` +
      `${P}lojacasal — loja de casal\n` +
      `${P}buy [item] — comprar item\n` +
      `${P}vender [item] — vender item\n` +
      `${P}inventario — ver inventário\n` +
      `${P}pix [@] [valor] — transferir Plata\n` +
      `${P}pixmulti [@1] [@2] [valor] — transferir para vários\n` +
      `${P}pixdoar [valor] — doar Plata para um membro\n` +
      `${P}apostar [valor] — apostar Plata\n` +
      `${P}slots [valor] — jogar slots\n` +
      `${P}corrida [valor] — corrida de bichos\n` +
      `${P}garimpar — garimpar recursos\n` +
      `${P}extrato — histórico de transações\n` +
      `${P}banco [valor] — investir no banco\n` +
      `${P}resgatar — resgatar do banco\n` +
      `${P}rankplata — ranking de saldo\n` +
      `${P}give [@] [item] — dar item do inventário`,
  }, { quoted: msg });
}

// ─── handleMenuPet ────────────────────────────────────────────────────────────
async function handleMenuPet(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
        🎭 MENU DE PERSONAGENS
╚══════════════════════╝

🎯 *CAPTURA & COLEÇÃO*
  ▸ ${P}capturar — capturar personagem
  ▸ ${P}pets — ver seus personagens
  ▸ ${P}abrigo — colocar personagem no abrigo
  ▸ ${P}renomearpet _(nome)_ — renomear

❤️ *CUIDADOS*
  ▸ ${P}alimentar — alimentar o personagem
  ▸ ${P}brincar — interagir com o personagem
  ▸ ${P}curar — cuidar do personagem

📊 *STATUS & RANKING*
  ▸ ${P}statuspet — ver status do personagem
  ▸ ${P}petrank — ranking de personagens

🛒 *LOJA & AJUDA*
  ▸ ${P}lojapet — loja de itens para personagens
  ▸ ${P}sistempet — como funciona

⚙️ *GRUPO*
  ▸ ${P}pet _(on/off/status)_ — ligar ou desligar os spawns

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── handleSistemaPlata ───────────────────────────────────────────────────────
async function handleSistemaPlata(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  await sock.sendMessage(jid, {
    text:
      `📖 *COMO FUNCIONA A MOEDA* 📖\n\n` +
      `💰 *Plata*\n` +
      `Os saldos e valores da economia do bot são exibidos em Plata ou na moeda local da conta vinculada. Use para comprar itens, apostar e muito mais!\n\n` +
      `📥 *Como ganhar:*\n` +
      `• Bônus diário ao mandar mensagem\n` +
      `• Trabalhar com ${P}trabalhar\n` +
      `• Garimpar com ${P}garimpar\n` +
      `• Vender itens com ${P}vender\n` +
      `• Ganhar no cassino/corrida\n` +
      `• Pescar e vender peixes\n\n` +
      `📤 *Como gastar:*\n` +
      `• Comprar itens na loja\n` +
      `• Apostar em jogos\n` +
      `• Transferir para outros\n` +
      `• Investir no banco (indisponível para contas vinculadas)\n\n` +
      `💡 *Dica:* Use ${P}menuplata para ver todos os comandos!`,
  }, { quoted: msg });
}

// ─── handleSistemaPet ────────────────────────────────────────────────────────
async function handleSistemaPet(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
     🎭 COMO FUNCIONAM
          OS PETS
╚══════════════════════╝

🐾 *O QUE SÃO PETS?*
Pets são companheiros virtuais que você pode capturar, alimentar, curar, renomear e levar ao abrigo!

📊 *ATRIBUTOS*
  • ⚡ Energia — diminui ao brincar
  • 🍽️ Fome — diminui ao brincar; recupere alimentando
  • 😊 Felicidade — melhora ao brincar e cuidar
  • 🏆 XP e nível — aumentam com interações

🎯 *RARIDADES*
  ⭐ Comum → 🌟 Raro
  💎 Ultra-raro → 👑 Lendário

⚠️ *ATENÇÃO*
  • Pet sem cuidados pode fugir
  • Use ${P}abrigo para deixar no abrigo

💡 *DICA*
  ▸ ${P}menupet — todos os comandos

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── handleMenuAuxiliar ──────────────────────────────────────────────────────
async function handleMenuAuxiliar(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  await sock.sendMessage(jid, {
    text:
      `📋 *MENU AUXILIAR* 📋\n\n` +
      `🎮 *Jogos e Diversão:*\n` +
      `▸ ${P}brincadeiras — ver brincadeiras\n` +
      `▸ ${P}menuplata — comandos da economia em Plata\n` +
      `▸ ${P}menupet — comandos de pets\n` +
      `▸ ${P}menumarket — marketplace\n` +
      `▸ ${P}menuwork — empregos\n\n` +
      `⚙️ *Sistemas:*\n` +
      `▸ ${P}sistemplata — como funciona a moeda\n` +
      `▸ ${P}sistempet — como funciona os pets\n` +
      `▸ ${P}sistemmedieval — sistema medieval\n\n` +
      `👥 *Grupos:*\n` +
      `▸ ${P}menuadm — comandos de admin\n` +
      `▸ ${P}menucasal — comandos de casal\n` +
      `▸ ${P}menufilho — comandos de filho`,
  }, { quoted: msg });
}

// ─── handleSistemaMedieval ───────────────────────────────────────────────────
async function handleSistemaMedieval(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      🏰 MODO MEDIEVAL
╚══════════════════════╝

O modo medieval é um RPG completo dentro do grupo!
Crie seu personagem, batalhe, evolua e domine o reino.

👤 *PERSONAGEM*
  • Ao usar ${P}ficha pela primeira vez, um personagem
    é criado automaticamente com classe e elemento aleatórios
  • 12 classes: Guerreiro, Mago, Arqueiro, Paladino,
    Assassino, Druida, Necromante, Bárbaro, Berserker,
    Monge, Bardo e Engenheiro Arcano
  • Cada classe tem ataque, defesa, HP e mana únicos

🔥 *ELEMENTOS*
  • 8 elementos: Fogo, Água, Terra, Ar, Trovão,
    Sombra, Luz e Magia Negra
  • Vantagem elemental: +50% de dano
  • Fraqueza elemental: -30% de dano

⚔️ *COMBATE*
  ▸ ${P}atacar @alguém — ataque físico (cooldown 2min)
     +10 XP (+15 se crítico). Crítico: 15% de chance, dano x1.8
  ▸ ${P}magia @alguém — habilidade elemental (cooldown 5min)
     Consome 30 de mana. Dano x2.2 e +20 XP. Não critica
  • Derrotar um inimigo dá +30 XP (${P}atacar) ou +40 XP (${P}magia)
  • Inimigo derrotado fica com HP 0 até usar ${P}recargamana

🗺️ *MISSÕES*
  ▸ ${P}missaomed — missão aleatória (cooldown 30min)
  • Requer HP mínimo de 20
  • 3 dificuldades: fácil, médio e difícil
  • Sucesso: XP + saldo | Falha: dano + 10 XP de consolação

❤️ *RECUPERAÇÃO*
  ▸ ${P}recargamana — recupera 60% do HP e 100% da mana
     Cooldown de 10 minutos
  • Regeneração passiva: +10% HP e +15% mana por hora
    (apenas em grupos com o modo medieval ativo)

🏪 *LOJA & EQUIPAMENTOS*
  ▸ ${P}lojamedieval — ver armas, armaduras e poções
  ▸ ${P}comprar _(item)_ — comprar com o saldo compartilhado
  ▸ ${P}equipar _(item)_ — equipar arma ou armadura
  ▸ ${P}desequipar _(arma/armadura)_ — remover item equipado
  ▸ ${P}invmed — ver seu inventário medieval
  ▸ ${P}usarpocao _(nome)_ — usar poção (sem cooldown!)
  • Armas aumentam o ataque | Armaduras aumentam a defesa
  • Poções recuperam HP e/ou mana na hora
  • Raridades: comum → incomum → raro → lendário

⭐ *PROGRESSÃO*
  • XP de batalhas e missões sobe seu nível
  • Cada level up aumenta HP máx, mana máx, ataque e defesa
  • Missões têm nível mínimo: mais difícil, mais recompensa
  • Itens raros e lendários exigem nível mínimo
  ▸ ${P}rankmedieval — top 10 guerreiros por vitórias
  ▸ ${P}historico — suas últimas 5 batalhas

📜 *COMANDOS RÁPIDOS*
  👤 ${P}ficha  •  ⚔️ ${P}atacar @  •  🔮 ${P}magia @
  🗺️ ${P}missaomed  •  🌟 ${P}recargamana
  🧪 ${P}usarpocao  •  🎒 ${P}invmed
  🏪 ${P}lojamedieval  •  🏆 ${P}rankmedieval
  📖 ${P}menumediev — menu de comandos

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── handleMenuMarket ────────────────────────────────────────────────────────
async function handleMenuMarket(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      🏪 MARKETPLACE
╚══════════════════════╝

Compre e venda itens com outros jogadores!

📤 *ANUNCIAR & VENDER*
  ▸ ${P}ofertar _(item) (preço) (quantidade)_ — anunciar item à venda
  ▸ ${P}cancelaroferta _(item)_ — cancelar seu anúncio pelo nome do item
  ▸ ${P}minhasofertas — ver seus anúncios ativos

📥 *NAVEGAR & COMPRAR*
  ▸ ${P}avenda _(página)_ — navegar pelos itens à venda
  ▸ ${P}buscaroferta _(item)_ — buscar ofertas de um item
  ▸ ${P}buyoferta _(vendedor) (item) (quantidade)_ — comprar de um anúncio

📊 *HISTÓRICO*
  ▸ ${P}historicomarket — histórico de vendas

_Obs: ${P}aceitaroferta foi descontinuado. Use ${P}buyoferta para comprar diretamente._

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  handleBrincadeiras,
  handleMenuPlata,
  handleMenuPet,
  handleSistemaPlata,
  handleSistemaPet,
  handleMenuAuxiliar,
  handleSistemaMedieval,
  handleMenuMarket,
};