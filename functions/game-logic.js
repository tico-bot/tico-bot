"use strict";

const { randomInt } = require("node:crypto");

const SLOT_SYMBOLS = ["7", "BAR", "STAR", "DIAMOND", "CHERRY", "LEMON", "BELL", "CLOVER"];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function validateWager(amountCents, maxWagerCents) {
  return Number.isSafeInteger(amountCents)
    && amountCents >= 100
    && amountCents <= maxWagerCents;
}

function spinSlots(wagerCents, secureRandomInt = randomInt) {
  const reels = Array.from({ length: 3 }, () => SLOT_SYMBOLS[secureRandomInt(SLOT_SYMBOLS.length)]);
  const counts = reels.reduce((map, symbol) => map.set(symbol, (map.get(symbol) || 0) + 1), new Map());
  const matching = Math.max(...counts.values());
  const multiplier = matching === 3 ? 20 : matching === 2 ? 2 : 0;
  return { reels, payoutCents: wagerCents * multiplier, multiplier };
}

function coinFlipResult(selection, wagerCents, secureRandomInt = randomInt) {
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER) || !["heads", "tails"].includes(selection)) {
    throw new RangeError("Invalid coin-flip wager.");
  }
  const outcome = secureRandomInt(2) === 0 ? "heads" : "tails";
  const won = outcome === selection;
  return {
    displayText: `${outcome === "heads" ? "Cara" : "Coroa"} · ${won ? "Acertou" : "Errou"}`,
    outcome,
    won,
    payoutCents: won ? Math.floor(wagerCents * 190 / 100) : 0,
    multiplier: won ? 190 : 0,
  };
}

function diceGuessResult(selection, wagerCents, secureRandomInt = randomInt) {
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER)
      || !/^[1-6]$/.test(String(selection))) {
    throw new RangeError("Invalid dice wager.");
  }
  const roll = secureRandomInt(6) + 1;
  const won = roll === Number(selection);
  return {
    displayText: `Saiu ${roll} · ${won ? "Acertou" : "Errou"}`,
    roll,
    won,
    payoutCents: won ? Math.floor(wagerCents * 550 / 100) : 0,
    multiplier: won ? 550 : 0,
  };
}

function parityDiceResult(selection, wagerCents, secureRandomInt = randomInt) {
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER) || !["even", "odd"].includes(selection)) {
    throw new RangeError("Invalid parity wager.");
  }
  const roll = secureRandomInt(6) + 1;
  const outcome = roll % 2 === 0 ? "even" : "odd";
  const won = outcome === selection;
  return {
    displayText: `Dado ${roll} · ${won ? "Acertou" : "Errou"}`,
    roll,
    outcome,
    won,
    payoutCents: won ? Math.floor(wagerCents * 190 / 100) : 0,
    multiplier: won ? 190 : 0,
  };
}

function minesCashoutPayout(wagerCents, mineCount, safePicks, rtpBps = 9_800) {
  const boardSize = 25;
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER)
      || !Number.isInteger(mineCount) || mineCount < 1 || mineCount >= boardSize
      || !Number.isInteger(safePicks) || safePicks < 1 || safePicks > boardSize - mineCount
      || !Number.isInteger(rtpBps) || rtpBps < 1 || rtpBps > 10_000) {
    throw new RangeError("Invalid mines cash-out.");
  }

  let allOutcomes = 1n;
  let safeOutcomes = 1n;
  for (let pick = 0; pick < safePicks; pick += 1) {
    allOutcomes *= BigInt(boardSize - pick);
    safeOutcomes *= BigInt(boardSize - mineCount - pick);
  }
  return {
    payoutCents: Number(BigInt(wagerCents) * BigInt(rtpBps) * allOutcomes / (10_000n * safeOutcomes)),
    multiplierBps: Number(BigInt(rtpBps) * allOutcomes / safeOutcomes),
  };
}

function createMinefield(mineCount, secureRandomInt = randomInt) {
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount >= 25) {
    throw new RangeError("Invalid mine count.");
  }
  const cells = Array.from({ length: 25 }, (_value, index) => index);
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomInt(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError("Invalid random value.");
    }
    [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
  }
  return cells.slice(0, mineCount).sort((left, right) => left - right);
}

function scratchCardResult(wagerCents, secureRandomInt = randomInt) {
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Invalid scratch-card wager.");
  }
  const draw = secureRandomInt(1_000);
  const prize = draw < 5
    ? { displayText: "Três estrelas · prêmio máximo", multiplier: 2_000 }
    : draw < 100
      ? { displayText: "Três sinos · prêmio", multiplier: 400 }
      : draw < 320
        ? { displayText: "Três cerejas · prêmio", multiplier: 200 }
        : { displayText: "Não premiada", multiplier: 0 };
  return {
    ...prize,
    payoutCents: Math.floor(wagerCents * prize.multiplier / 100),
  };
}

function footballShotResult(selection, wagerCents, secureRandomInt = randomInt) {
  const corners = ["left", "center", "right"];
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER) || !corners.includes(selection)) {
    throw new RangeError("Invalid football wager.");
  }
  const goalkeeper = corners[secureRandomInt(corners.length)];
  const won = selection !== goalkeeper;
  const labels = { left: "Esquerda", center: "Centro", right: "Direita" };
  return {
    displayText: `Chute ${labels[selection]} · goleiro ${labels[goalkeeper]} · ${won ? "GOL" : "DEFENDEU"}`,
    shot: selection,
    goalkeeper,
    won,
    payoutCents: won ? Math.floor(wagerCents * 140 / 100) : 0,
    multiplier: won ? 140 : 0,
  };
}

function rockPaperScissorsResult(selection, wagerCents, secureRandomInt = randomInt) {
  const choices = ["rock", "paper", "scissors"];
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER) || !choices.includes(selection)) {
    throw new RangeError("Invalid rock-paper-scissors wager.");
  }
  const opponent = choices[secureRandomInt(choices.length)];
  const tied = selection === opponent;
  const won = !tied && (
    (selection === "rock" && opponent === "scissors")
    || (selection === "paper" && opponent === "rock")
    || (selection === "scissors" && opponent === "paper")
  );
  const multiplier = won ? 185 : tied ? 100 : 0;
  const labels = { rock: "Pedra", paper: "Papel", scissors: "Tesoura" };
  return {
    displayText: `${labels[selection]} × ${labels[opponent]} · ${won ? "Vitória" : tied ? "Empate" : "Derrota"}`,
    opponent,
    won,
    payoutCents: won ? Math.floor(wagerCents * multiplier / 100) : tied ? wagerCents : 0,
    multiplier,
  };
}

function resolveRockPaperScissors(firstChoice, secondChoice) {
  const choices = ["rock", "paper", "scissors"];
  if (!choices.includes(firstChoice) || !choices.includes(secondChoice)) {
    throw new RangeError("Invalid rock-paper-scissors choice.");
  }
  if (firstChoice === secondChoice) return { winnerChoice: "", outcome: "draw" };
  const firstWins = (firstChoice === "rock" && secondChoice === "scissors")
    || (firstChoice === "paper" && secondChoice === "rock")
    || (firstChoice === "scissors" && secondChoice === "paper");
  return { winnerChoice: firstWins ? firstChoice : secondChoice, outcome: "win" };
}

function resolveOnlineDuel(gameId, firstChoice, secondChoice, secureRandomInt = randomInt, challengeSeed = "") {
  if (gameId === "rps") {
    const result = resolveRockPaperScissors(firstChoice, secondChoice);
    return { winnerIndex: result.outcome === "draw" ? -1 : result.winnerChoice === firstChoice ? 0 : 1, result };
  }
  if (gameId === "duelParity") {
    const firstChoices = String(firstChoice).split(",");
    const secondChoices = String(secondChoice).split(",");
    if (firstChoices.length === 1) firstChoices.push(...Array(4).fill(firstChoices[0]));
    if (secondChoices.length === 1) secondChoices.push(...Array(4).fill(secondChoices[0]));
    if (firstChoices.length !== 5 || secondChoices.length !== 5
        || [...firstChoices, ...secondChoices].some((choice) => !["even", "odd"].includes(choice))) {
      throw new RangeError("Submit five valid parity guesses.");
    }
    let firstScore = 0;
    let secondScore = 0;
    for (let round = 0; round < 5; round += 1) {
      const outcome = (secureRandomInt(6) + 1) % 2 === 0 ? "even" : "odd";
      const firstCorrect = firstChoices[round] === outcome;
      const secondCorrect = secondChoices[round] === outcome;
      if (firstCorrect !== secondCorrect) {
        if (firstCorrect) firstScore += 1;
        else secondScore += 1;
      }
    }
    const winnerIndex = firstScore === secondScore ? -1 : firstScore > secondScore ? 0 : 1;
    return {
      winnerIndex,
      result: { displayText: `Melhor de 5 · ${firstScore} a ${secondScore}` },
    };
  }
  if (gameId === "duelCoin") {
    const firstChoices = String(firstChoice).split(",");
    const secondChoices = String(secondChoice).split(",");
    if (firstChoices.length === 1) firstChoices.push(...Array(4).fill(firstChoices[0]));
    if (secondChoices.length === 1) secondChoices.push(...Array(4).fill(secondChoices[0]));
    if (firstChoices.length !== 5 || secondChoices.length !== 5
        || [...firstChoices, ...secondChoices].some((choice) => !["heads", "tails"].includes(choice))) {
      throw new RangeError("Submit five valid coin guesses.");
    }
    let firstScore = 0;
    let secondScore = 0;
    for (let round = 0; round < 5; round += 1) {
      const outcome = secureRandomInt(2) === 0 ? "heads" : "tails";
      const firstCorrect = firstChoices[round] === outcome;
      const secondCorrect = secondChoices[round] === outcome;
      if (firstCorrect !== secondCorrect) {
        if (firstCorrect) firstScore += 1;
        else secondScore += 1;
      }
    }
    const winnerIndex = firstScore === secondScore ? -1 : firstScore > secondScore ? 0 : 1;
    return {
      winnerIndex,
      result: { displayText: `Melhor de 5 · ${firstScore} a ${secondScore}` },
    };
  }
  if (gameId === "duelQuiz") {
    const questionIndexes = duelQuizQuestionIndexes(challengeSeed);
    const firstAnswers = String(firstChoice).split(",");
    const secondAnswers = String(secondChoice).split(",");
    if ([...firstAnswers, ...secondAnswers].some((answer) => !/^[0-3]$/.test(answer))
        || firstAnswers.length !== questionIndexes.length
        || secondAnswers.length !== questionIndexes.length) {
      throw new RangeError("Submit five valid quiz answers.");
    }
    const scoreAnswers = (answers) => answers.reduce((score, answer, index) => (
      score + (Number(answer) === QUIZ_QUESTIONS[questionIndexes[index]].correct ? 1 : 0)
    ), 0);
    const firstScore = scoreAnswers(firstAnswers);
    const secondScore = scoreAnswers(secondAnswers);
    return {
      winnerIndex: firstScore === secondScore ? -1 : firstScore > secondScore ? 0 : 1,
      result: { displayText: `Quiz · ${firstScore}/5 a ${secondScore}/5` },
    };
  }
  if (gameId === "duelTarget") {
    const firstGuesses = String(firstChoice).split(",");
    const secondGuesses = String(secondChoice).split(",");
    if ([...firstGuesses, ...secondGuesses].some((guess) => !/^[0-9]$/.test(guess))
        || firstGuesses.length !== 5 || secondGuesses.length !== 5) {
      throw new RangeError("Submit five target guesses from zero to nine.");
    }
    let firstScore = 0;
    let secondScore = 0;
    for (let round = 0; round < 5; round += 1) {
      const target = secureRandomInt(10);
      const firstDistance = Math.abs(Number(firstGuesses[round]) - target);
      const secondDistance = Math.abs(Number(secondGuesses[round]) - target);
      if (firstDistance < secondDistance) firstScore += 1;
      else if (secondDistance < firstDistance) secondScore += 1;
    }
    return {
      winnerIndex: firstScore === secondScore ? -1 : firstScore > secondScore ? 0 : 1,
      result: { displayText: `Mira · ${firstScore}/5 a ${secondScore}/5` },
    };
  }
  if (gameId === "duelMemory") {
    const firstPattern = String(firstChoice);
    const secondPattern = String(secondChoice);
    if (!/^[0-3]{7}$/.test(firstPattern) || !/^[0-3]{7}$/.test(secondPattern)
        || !/^[a-f0-9-]{8,64}$/i.test(challengeSeed)) {
      throw new RangeError("Submit a valid seven-step memory sequence.");
    }
    const pattern = generateMemoryPattern(challengeSeed);
    const firstScore = firstPattern.split("").reduce((score, value, index) => score + (value === pattern[index] ? 1 : 0), 0);
    const secondScore = secondPattern.split("").reduce((score, value, index) => score + (value === pattern[index] ? 1 : 0), 0);
    return {
      winnerIndex: firstScore === secondScore ? -1 : firstScore > secondScore ? 0 : 1,
      result: { displayText: `Memória · ${firstScore}/7 a ${secondScore}/7` },
    };
  }
  throw new RangeError("Invalid duel game.");
}

const QUIZ_QUESTIONS = [
  { question: "Quantos lados tem um hexágono?", answers: ["5", "6", "7", "8"], correct: 1 },
  { question: "Qual planeta é conhecido como planeta vermelho?", answers: ["Vênus", "Marte", "Júpiter", "Mercúrio"], correct: 1 },
  { question: "Quanto é 9 × 7?", answers: ["56", "63", "72", "81"], correct: 1 },
  { question: "Qual é o maior oceano da Terra?", answers: ["Atlântico", "Índico", "Pacífico", "Ártico"], correct: 2 },
  { question: "Quantos minutos há em duas horas?", answers: ["100", "110", "120", "140"], correct: 2 },
  { question: "Qual destes animais é um mamífero?", answers: ["Tubarão", "Golfinho", "Polvo", "Truta"], correct: 1 },
  { question: "Qual é a raiz quadrada de 144?", answers: ["10", "11", "12", "14"], correct: 2 },
  { question: "Em que direção o Sol nasce?", answers: ["Norte", "Sul", "Leste", "Oeste"], correct: 2 },
];

function seededRandom(seed) {
  const normalized = String(seed).replace(/[^0-9a-f]/gi, "").slice(0, 8);
  let state = (Number.parseInt(normalized || "1", 16) % 2_147_483_646) + 1;
  return (max) => {
    state = (state * 16_807) % 2_147_483_647;
    return state % max;
  };
}

function duelQuizQuestionIndexes(seed) {
  const secureRandomInt = seededRandom(seed);
  const indexes = Array.from({ length: QUIZ_QUESTIONS.length }, (_value, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomInt(index + 1);
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes.slice(0, 5);
}

function generateMemoryPattern(seed) {
  const secureRandomInt = seededRandom(seed);
  return Array.from({ length: 7 }, () => secureRandomInt(4).toString()).join("");
}

function parseChallenge(selection, wagerCents, gameId) {
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER) || typeof selection !== "string") {
    throw new RangeError(`Invalid ${gameId} challenge.`);
  }
  const separator = selection.indexOf(":");
  const seed = separator > 0 ? selection.slice(0, separator) : "";
  const moves = separator > 0 ? selection.slice(separator + 1) : "";
  if (!/^[a-f0-9-]{8,64}$/i.test(seed) || moves.length > 100) {
    throw new RangeError(`Invalid ${gameId} challenge.`);
  }
  return { seed, moves, random: seededRandom(seed) };
}

function memoryChallengeResult(selection, wagerCents) {
  const challenge = parseChallenge(selection, wagerCents, "memory");
  const pattern = generateMemoryPattern(challenge.seed);
  const entered = challenge.moves.replace(/,/g, "");
  if (!/^[0-3]{1,7}$/.test(entered)) throw new RangeError("Invalid memory sequence.");
  let correct = 0;
  while (correct < Math.min(pattern.length, entered.length) && pattern[correct] === entered[correct]) correct += 1;
  const payoutBps = correct < 4 ? 0 : (correct - 3) * 5_000;
  const payoutCents = Math.floor(wagerCents * payoutBps / 10_000);
  return {
    displayText: `Sequência: ${pattern.split("").join(" · ")} · ${correct}/7 corretas`,
    score: correct,
    payoutCents,
    multiplier: payoutBps / 100,
  };
}

function quizChallengeResult(selection, wagerCents) {
  const challenge = parseChallenge(selection, wagerCents, "quiz");
  const questionIndexes = Array.from({ length: 5 }, (_value, index) => index);
  for (let index = questionIndexes.length - 1; index > 0; index -= 1) {
    const swapIndex = challenge.random(index + 1);
    [questionIndexes[index], questionIndexes[swapIndex]] = [questionIndexes[swapIndex], questionIndexes[index]];
  }
  const answers = challenge.moves.split("");
  if (answers.length !== 5 || answers.some((answer) => !/^[0-3]$/.test(answer))) {
    throw new RangeError("Answer all five quiz questions.");
  }
  const score = answers.reduce((total, answer, index) => (
    total + (Number(answer) === QUIZ_QUESTIONS[questionIndexes[index]].correct ? 1 : 0)
  ), 0);
  const multiplier = [0, 0, 0, 1, 1.5, 2][score];
  return {
    displayText: `Quiz: ${score}/5 corretas`,
    score,
    payoutCents: Math.floor(wagerCents * multiplier),
    multiplier: Math.round(multiplier * 100),
    questionIndexes,
  };
}

function codebreakerChallengeResult(selection, wagerCents) {
  const challenge = parseChallenge(selection, wagerCents, "codebreaker");
  const secret = [];
  while (secret.length < 4) {
    const digit = challenge.random(10);
    if (!secret.includes(digit)) secret.push(digit);
  }
  const guesses = challenge.moves.split(",").filter(Boolean);
  if (guesses.length < 1 || guesses.length > 8 || guesses.some((guess) => !/^\d{4}$/.test(guess))) {
    throw new RangeError("Submit between one and eight four-digit guesses.");
  }
  let solvedAt = -1;
  for (let index = 0; index < guesses.length; index += 1) {
    if ([...guesses[index]].every((digit, position) => Number(digit) === secret[position])) {
      solvedAt = index;
      break;
    }
  }
  const multiplier = solvedAt < 0 ? 0 : Math.max(100, 800 - solvedAt * 100);
  return {
    displayText: `Código ${secret.join("")} · ${solvedAt < 0 ? "não descoberto" : `descoberto na tentativa ${solvedAt + 1}`}`,
    score: solvedAt < 0 ? 0 : 8 - solvedAt,
    payoutCents: Math.floor(wagerCents * multiplier / 100),
    multiplier,
  };
}

function mazeChallengeResult(selection, wagerCents) {
  const challenge = parseChallenge(selection, wagerCents, "maze");
  const layouts = [
    new Set([1, 3, 6, 8, 11, 13, 16, 18, 21, 23]),
    new Set([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19]),
    new Set([5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 22]),
  ];
  const walls = layouts[challenge.random(layouts.length)];
  const path = challenge.moves.split(",").filter(Boolean).map(Number);
  if (path.length < 1 || path.length > 25 || path.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 24)) {
    throw new RangeError("Invalid maze path.");
  }
  const uniquePath = path.every((cell, index) => path.indexOf(cell) === index);
  const adjacent = path.every((cell, index) => index === 0
    ? cell === 0
    : Math.abs(cell % 5 - path[index - 1] % 5) + Math.abs(Math.floor(cell / 5) - Math.floor(path[index - 1] / 5)) === 1);
  const clear = path.every((cell) => !walls.has(cell));
  const reachedExit = path[path.length - 1] === 24;
  const solved = uniquePath && adjacent && clear && reachedExit;
  const optimalLength = 9;
  const multiplier = solved ? Math.max(100, 150 - Math.max(0, path.length - optimalLength) * 10) : 0;
  return {
    displayText: solved ? `Labirinto concluído em ${path.length} passos` : "Caminho bloqueado ou saída não alcançada",
    score: solved ? Math.max(0, optimalLength + 1 - path.length) : 0,
    payoutCents: Math.floor(wagerCents * multiplier / 100),
    multiplier,
    walls: [...walls],
  };
}

function rouletteResult(betType, selection, number, wagerCents) {
  if (!Number.isInteger(number) || number < 0 || number > 36) {
    throw new RangeError("Roulette number must be between 0 and 36.");
  }
  if (!validateWager(wagerCents, Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Invalid roulette wager.");
  }

  let won = false;
  let multiplier = 0;
  if (betType === "color" && ["red", "black"].includes(selection)) {
    const color = number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black";
    won = color === selection;
    multiplier = 2;
  } else if (betType === "parity" && ["even", "odd"].includes(selection)) {
    won = number !== 0 && (number % 2 === 0 ? "even" : "odd") === selection;
    multiplier = 2;
  } else if (betType === "range" && ["low", "high"].includes(selection)) {
    won = number !== 0 && (selection === "low" ? number <= 18 : number >= 19);
    multiplier = 2;
  } else if (betType === "dozen" && [1, 2, 3].includes(Number(selection))) {
    const dozen = Number(selection);
    won = number !== 0 && Math.ceil(number / 12) === dozen;
    multiplier = 3;
  } else if (betType === "number" && Number.isInteger(Number(selection)) && Number(selection) >= 0 && Number(selection) <= 36) {
    won = number === Number(selection);
    multiplier = 36;
  } else {
    throw new RangeError("Invalid roulette bet.");
  }

  const color = number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black";
  return { number, color, won, payoutCents: won ? wagerCents * multiplier : 0, multiplier };
}

function createShuffledDeck(secureRandomInt = randomInt) {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function blackjackHandValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      total += 11;
      aces += 1;
    } else {
      total += ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

function isBlackjack(cards) {
  return cards.length === 2 && blackjackHandValue(cards).total === 21;
}

function settleBlackjack(playerCards, dealerCards, wagerCents, playerBusted = false) {
  const player = blackjackHandValue(playerCards).total;
  const dealer = blackjackHandValue(dealerCards).total;
  const playerNatural = isBlackjack(playerCards);
  const dealerNatural = isBlackjack(dealerCards);
  if (playerBusted || player > 21) return { outcome: "bust", payoutCents: 0 };
  if (playerNatural && dealerNatural) return { outcome: "push", payoutCents: wagerCents };
  if (playerNatural) return { outcome: "blackjack", payoutCents: Math.floor(wagerCents * 2.5) };
  if (dealerNatural) return { outcome: "dealer_blackjack", payoutCents: 0 };
  if (dealer > 21 || player > dealer) return { outcome: "win", payoutCents: wagerCents * 2 };
  if (player === dealer) return { outcome: "push", payoutCents: wagerCents };
  return { outcome: "lose", payoutCents: 0 };
}

function crashPointBasisPoints(secureRandomInt = randomInt) {
  const random = secureRandomInt(1_000_000);
  return Math.max(100, Math.min(1_000_000, Math.floor(99_000_000 / (1_000_000 - random))));
}

function crashMultiplierBasisPoints(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 100;
  return Math.min(1_000_000, Math.floor(100 * Math.exp(elapsedMs / 5_000)));
}

module.exports = {
  SLOT_SYMBOLS,
  blackjackHandValue,
  coinFlipResult,
  createMinefield,
  crashMultiplierBasisPoints,
  crashPointBasisPoints,
  createShuffledDeck,
  diceGuessResult,
  footballShotResult,
  isBlackjack,
  minesCashoutPayout,
  parityDiceResult,
  memoryChallengeResult,
  quizChallengeResult,
  codebreakerChallengeResult,
  mazeChallengeResult,
  generateMemoryPattern,
  QUIZ_QUESTIONS,
  duelQuizQuestionIndexes,
  resolveRockPaperScissors,
  resolveOnlineDuel,
  rockPaperScissorsResult,
  rouletteResult,
  scratchCardResult,
  settleBlackjack,
  spinSlots,
  validateWager,
};