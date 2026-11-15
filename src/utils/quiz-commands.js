'use strict';

const QUIZ_COMMANDS = new Set([
  'quiz',
  'quizhelp',
  'quizfut',
  'quizfutebol',
  'quizctec',
  'quizgeo',
  'quizmat',
  'quizhis',
  'quizbsq',
  'quizanime',
  'quiztiktok',
  'quizmoda',
]);

function identificarQuizDesconhecido(cmdWord, prefixes = []) {
  const raw = String(cmdWord || '').trim().split(/\s+/)[0].toLowerCase();
  const prefix = prefixes.find(item => raw.startsWith(String(item).toLowerCase() + 'quiz'));
  if (!prefix) return null;

  const comando = raw.slice(String(prefix).length);
  if (QUIZ_COMMANDS.has(comando)) return null;

  return { prefix: String(prefix), comando };
}

module.exports = {
  QUIZ_COMMANDS,
  identificarQuizDesconhecido,
};
