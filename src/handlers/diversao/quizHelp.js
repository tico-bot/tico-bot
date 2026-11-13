'use strict';

const { perguntasQuiz } = require('./quiz');

async function handleQuizHelp(sock, msg, jid, prefix = '/') {
  const P = typeof prefix === 'string' && prefix ? prefix : '/';
  const numero = new Intl.NumberFormat('pt-BR');
  const contar = temas => perguntasQuiz.filter(q => temas.includes(q.d)).length;
  const porTema = tema => perguntasQuiz.filter(q => q.d === tema).length;

  const linhas = [
    '╔════════════════════════════════╗',
    '          🧠 AJUDA DO QUIZ',
    '╚════════════════════════════════╝',
    '',
    '📚 BANCO ATUAL: ' + numero.format(perguntasQuiz.length) + ' PERGUNTAS',
    '',
    '🎮 TEMAS E COMANDOS',
    '  ⚽ ' + P + 'quizfut — Futebol (' + porTema('Futebol') + ' perguntas)',
    '  📜 ' + P + 'quizhis — História (' + porTema('História') + ' perguntas)',
    '  🌍 ' + P + 'quizgeo — Geografia (' + porTema('Geografia') + ' perguntas)',
    '  🏀 ' + P + 'quizbsq — Basquete (' + porTema('Basquete') + ' perguntas)',
    '  🎌 ' + P + 'quizanime — Anime (' + porTema('Anime') + ' perguntas)',
    '  🧮 ' + P + 'quizmat — Matemática, Geometria, Cálculo e Estatística (' +
      contar(['Matemática', 'Geometria', 'Cálculo', 'Estatística']) + ' perguntas)',
    '     └ Matemática ' + porTema('Matemática') + ' · Geometria ' + porTema('Geometria') +
      ' · Cálculo ' + porTema('Cálculo') + ' · Estatística ' + porTema('Estatística'),
    '  🔬 ' + P + 'quizctec — Ciências e tecnologia (' +
      contar(['Ciência', 'Astronomia', 'Tecnologia', 'Biologia', 'Química', 'Física']) + ' perguntas)',
    '     └ Ciência ' + porTema('Ciência') + ' · Astronomia ' + porTema('Astronomia') +
      ' · Tecnologia ' + porTema('Tecnologia'),
    '     └ Biologia ' + porTema('Biologia') + ' · Química ' + porTema('Química') +
      ' · Física ' + porTema('Física'),
    '  🎲 ' + P + 'quiz — sorteia uma pergunta de qualquer tema (' +
      numero.format(perguntasQuiz.length) + ' perguntas)',
    '  ℹ️ Reabra esta ajuda com ' + P + 'quizhelp.',
    '',
    '📖 COMO JOGAR',
    '  1. Envie um dos comandos acima.',
    '  2. O Tico enviará uma pergunta aleatória do tema escolhido.',
    '  3. Responda em uma mensagem de texto, sem precisar repetir o comando.',
    '  4. Você tem 30 segundos para responder.',
    '',
    '✅ RESPOSTAS FLEXÍVEIS',
    '  • Maiúsculas ou minúsculas não fazem diferença.',
    '  • Acentos, espaços duplicados e pontuação são normalizados.',
    '  • Nomes podem ser respondidos por uma parte válida.',
    '  • Pequenos erros de digitação são tolerados.',
    '  • Siglas e apelidos conhecidos também são aceitos quando cadastrados, como SP, RJ, EUA e CR7.',
    '',
    '🏆 PONTOS E RECOMPENSAS',
    '  • Cada acerto: +10 pontos e +15 Pratas.',
    '  • Três respostas certas no dia: +500 Pratas extras.',
    '  • Os três primeiros do ranking diário recebem às 18h30:',
    '    🥇 10.000 · 🥈 5.000 · 🥉 3.500 Pratas.',
    '  • Consulte sua pontuação com ' + P + 'pontos e o ranking com ' + P + 'rankjogos.',
    '',
    '⏱️ LIMITE DE PARTICIPAÇÃO',
    '  Cada jogador pode iniciar até 30 quizzes a cada 30 minutos.',
    '',
    '💡 Dica: responda com o nome, número, sigla ou abreviação que identifique corretamente a resposta.',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  await sock.sendMessage(jid, { text: linhas }, { quoted: msg });
}

module.exports = { handleQuizHelp };
