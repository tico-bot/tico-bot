"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  blackjackHandValue,
  coinFlipResult,
  crashMultiplierBasisPoints,
  crashPointBasisPoints,
  createShuffledDeck,
  createMinefield,
  diceGuessResult,
  footballShotResult,
  rouletteResult,
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
  settleBlackjack,
  minesCashoutPayout,
  parityDiceResult,
  scratchCardResult,
  spinSlots,
  validateWager,
} = require("./game-logic");

test("wagers reject fractions, zero, negatives, and values over limit", () => {
  assert.equal(validateWager(1_000, 100_000), true);
  assert.equal(validateWager(0, 100_000), false);
  assert.equal(validateWager(-100, 100_000), false);
  assert.equal(validateWager(100.5, 100_000), false);
  assert.equal(validateWager(100_001, 100_000), false);
});

test("slots settle triples, pairs, and misses with server payout table", () => {
  const sequence = [0, 0, 0];
  const triple = spinSlots(1_000, () => sequence.shift());
  assert.equal(triple.multiplier, 20);
  assert.equal(triple.payoutCents, 20_000);

  const pairSequence = [1, 1, 2];
  const pair = spinSlots(1_000, () => pairSequence.shift());
  assert.equal(pair.multiplier, 2);
  assert.equal(pair.payoutCents, 2_000);

  const missSequence = [0, 1, 2];
  assert.equal(spinSlots(1_000, () => missSequence.shift()).payoutCents, 0);
});

test("roulette handles zero and all supported bet families", () => {
  assert.equal(rouletteResult("color", "red", 0, 1_000).payoutCents, 0);
  assert.equal(rouletteResult("parity", "even", 2, 1_000).payoutCents, 2_000);
  assert.equal(rouletteResult("range", "high", 19, 1_000).payoutCents, 2_000);
  assert.equal(rouletteResult("dozen", 3, 36, 1_000).payoutCents, 3_000);
  assert.equal(rouletteResult("number", 0, 0, 1_000).payoutCents, 36_000);
  assert.throws(() => rouletteResult("number", 37, 1, 1_000), RangeError);
});

test("blackjack counts aces correctly and settles naturals and pushes", () => {
  assert.deepEqual(blackjackHandValue([{ rank: "A" }, { rank: "9" }]), { total: 20, soft: true });
  assert.deepEqual(blackjackHandValue([{ rank: "A" }, { rank: "9" }, { rank: "5" }]), { total: 15, soft: false });
  assert.deepEqual(settleBlackjack([{ rank: "A" }, { rank: "K" }], [{ rank: "10" }, { rank: "7" }], 1_000), {
    outcome: "blackjack",
    payoutCents: 2_500,
  });
  assert.deepEqual(settleBlackjack([{ rank: "10" }, { rank: "8" }], [{ rank: "10" }, { rank: "8" }], 1_000), {
    outcome: "push",
    payoutCents: 1_000,
  });
});

test("blackjack deck has 52 unique cards", () => {
  const deck = createShuffledDeck((max) => max - 1);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => `${card.rank}${card.suit}`)).size, 52);
});

test("crash curve starts at 1.00x, grows, and stays capped", () => {
  assert.equal(crashMultiplierBasisPoints(0), 100);
  assert.ok(crashMultiplierBasisPoints(5_000) > 100);
  assert.equal(crashMultiplierBasisPoints(100_000), 1_000_000);
  assert.equal(crashPointBasisPoints(() => 0), 100);
  assert.equal(crashPointBasisPoints(() => 999_999), 1_000_000);
});

test("coin flip, exact dice and parity settle the server-selected outcomes", () => {
  assert.equal(coinFlipResult("heads", 1_000, () => 0).payoutCents, 1_900);
  assert.equal(coinFlipResult("heads", 1_000, () => 1).payoutCents, 0);
  assert.equal(diceGuessResult("6", 1_000, () => 5).payoutCents, 5_500);
  assert.equal(diceGuessResult("2", 1_000, () => 5).payoutCents, 0);
  assert.equal(parityDiceResult("odd", 1_000, () => 0).payoutCents, 1_900);
  assert.equal(parityDiceResult("even", 1_000, () => 0).payoutCents, 0);
});

test("scratch cards pay only their predefined winning outcomes", () => {
  assert.equal(scratchCardResult(1_000, () => 0).payoutCents, 20_000);
  assert.equal(scratchCardResult(1_000, () => 5).payoutCents, 4_000);
  assert.equal(scratchCardResult(1_000, () => 100).payoutCents, 2_000);
  assert.equal(scratchCardResult(1_000, () => 320).payoutCents, 0);
  assert.throws(() => scratchCardResult(0), RangeError);
});

test("mines cash-out uses the 5x5 safe-pick probability at 98% RTP", () => {
  assert.deepEqual(minesCashoutPayout(400, 1, 1), {
    payoutCents: 408,
    multiplierBps: 10_208,
  });
  assert.ok(minesCashoutPayout(400, 5, 1).payoutCents > 400);
  assert.ok(minesCashoutPayout(400, 5, 2).payoutCents > minesCashoutPayout(400, 5, 1).payoutCents);
  assert.deepEqual(minesCashoutPayout(1_000_000, 1, 24), {
    payoutCents: 24_500_000,
    multiplierBps: 245_000,
  });
  assert.throws(() => minesCashoutPayout(400, 0, 1), RangeError);
  assert.throws(() => minesCashoutPayout(400, 24, 2), RangeError);
});

test("mines field contains the configured number of unique cells", () => {
  const mines = createMinefield(8, () => 0);
  assert.equal(mines.length, 8);
  assert.equal(new Set(mines).size, 8);
  assert.ok(mines.every((cell) => cell >= 0 && cell < 25));
  assert.throws(() => createMinefield(25), RangeError);
});

test("football shots score past the server-selected goalkeeper and pay 1.40x", () => {
  const goal = footballShotResult("left", 1_000, () => 1);
  assert.equal(goal.goalkeeper, "center");
  assert.equal(goal.won, true);
  assert.equal(goal.payoutCents, 1_400);

  const saved = footballShotResult("right", 1_000, () => 2);
  assert.equal(saved.won, false);
  assert.equal(saved.payoutCents, 0);
  assert.throws(() => footballShotResult("top", 1_000, () => 0), RangeError);
});

test("rock-paper-scissors settles wins, draws, and invalid selections", () => {
  assert.equal(rockPaperScissorsResult("paper", 1_000, () => 0).payoutCents, 1_850);
  assert.equal(rockPaperScissorsResult("rock", 1_000, () => 0).payoutCents, 1_000);
  assert.equal(rockPaperScissorsResult("scissors", 1_000, () => 0).payoutCents, 0);
  assert.throws(() => rockPaperScissorsResult("lizard", 1_000, () => 0), RangeError);
});

test("online rock-paper-scissors resolves server-submitted choices deterministically", () => {
  assert.deepEqual(resolveRockPaperScissors("rock", "scissors"), { winnerChoice: "rock", outcome: "win" });
  assert.deepEqual(resolveRockPaperScissors("paper", "rock"), { winnerChoice: "paper", outcome: "win" });
  assert.deepEqual(resolveRockPaperScissors("scissors", "paper"), { winnerChoice: "scissors", outcome: "win" });
  assert.deepEqual(resolveRockPaperScissors("rock", "rock"), { winnerChoice: "", outcome: "draw" });
  assert.throws(() => resolveRockPaperScissors("lizard", "paper"), RangeError);
});

test("online duel variants resolve five scored rounds on the server", () => {
  const parRolls = [1, 1, 1, 1, 1];
  assert.equal(resolveOnlineDuel(
    "duelParity", "even,even,even,even,even", "odd,odd,odd,odd,odd", () => parRolls.shift(),
  ).winnerIndex, 0);
  const coinRolls = [1, 1, 1, 1, 1];
  assert.equal(resolveOnlineDuel(
    "duelCoin", "heads,heads,heads,heads,heads", "tails,tails,tails,tails,tails", () => coinRolls.shift(),
  ).winnerIndex, 1);
  const drawRolls = [0, 0, 1, 0, 1];
  assert.equal(resolveOnlineDuel(
    "duelParity", "even,even,even,even,even", "even,odd,odd,odd,odd", () => drawRolls.shift(),
  ).winnerIndex, -1);
  assert.equal(resolveOnlineDuel("duelParity", "even", "odd", () => 1).winnerIndex, 0);
  const memorySeed = "12345678-1234-1234-1234-123456789012";
  const sequence = generateMemoryPattern(memorySeed);
  const partial = sequence.slice(0, 3) + [...sequence.slice(3)].map((digit) => String((Number(digit) + 1) % 4)).join("");
  assert.equal(resolveOnlineDuel("duelMemory", sequence, partial, undefined, memorySeed).winnerIndex, 0);
  assert.throws(() => resolveOnlineDuel("duelMemory", "bad", "bad", undefined, memorySeed), RangeError);

  const quizSeed = "87654321-1234-1234-1234-123456789012";
  const quizIndexes = duelQuizQuestionIndexes(quizSeed);
  const correctAnswers = quizIndexes.map((index) => QUIZ_QUESTIONS[index].correct).join(",");
  const wrongAnswers = quizIndexes.map((index) => (QUIZ_QUESTIONS[index].correct + 1) % 4).join(",");
  assert.equal(resolveOnlineDuel("duelQuiz", correctAnswers, wrongAnswers, undefined, quizSeed).winnerIndex, 0);
  assert.throws(() => resolveOnlineDuel("duelQuiz", "0,1", "2,3", undefined, quizSeed), RangeError);

  const targetRolls = Array(5).fill(5);
  assert.equal(resolveOnlineDuel("duelTarget", "5,5,5,5,5", "0,0,0,0,0", () => targetRolls.shift()).winnerIndex, 0);
  assert.throws(() => resolveOnlineDuel("duelTarget", "1,2", "3,4", () => 5), RangeError);
});

test("multi-action solo challenges score the submitted play instead of trusting client scores", () => {
  const seed = "12345678-1234-1234-1234-123456789012";
  const memoryPreview = memoryChallengeResult(`${seed}:0000000`, 1_000);
  const pattern = memoryPreview.displayText.match(/Sequência: ([0-3](?: · [0-3]){6})/)[1].replaceAll(" · ", "");
  const memoryWin = memoryChallengeResult(`${seed}:${pattern}`, 1_000);
  assert.equal(memoryWin.score, 7);
  assert.equal(memoryWin.payoutCents, 2_000);
  assert.throws(() => memoryChallengeResult(`${seed}:bad`, 1_000), RangeError);

  const quizPreview = quizChallengeResult(`${seed}:00000`, 1_000);
  const perfectAnswers = quizPreview.questionIndexes
    .map((index) => String(QUIZ_QUESTIONS[index].correct))
    .join("");
  const quizWin = quizChallengeResult(`${seed}:${perfectAnswers}`, 1_000);
  assert.equal(quizWin.score, 5);
  assert.equal(quizWin.payoutCents, 2_000);
  assert.throws(() => quizChallengeResult(`${seed}:00`, 1_000), RangeError);

  const code = codebreakerChallengeResult(`${seed}:0000`, 1_000).displayText.match(/Código (\d{4})/)[1];
  const codeWin = codebreakerChallengeResult(`${seed}:${code}`, 1_000);
  assert.equal(codeWin.score, 8);
  assert.equal(codeWin.payoutCents, 8_000);
  assert.equal(codebreakerChallengeResult(`${seed}:1111`, 1_000).payoutCents, 0);
  assert.throws(() => codebreakerChallengeResult(`${seed}:123`, 1_000), RangeError);
});

test("maze challenge validates legal connected paths and grants higher prizes for shorter paths", () => {
  const paths = [
    "0,1,6,11,16,17,18,23,24",
    "0,5,10,15,20,21,22,23,24",
    "0,1,2,3,4,9,14,19,24",
  ];
  let completed;
  for (let index = 1; index < 200 && !completed; index += 1) {
    const seed = index.toString(16).padStart(8, "0");
    completed = paths.map((path) => mazeChallengeResult(`${seed}:${path}`, 1_000))
      .find((result) => result.payoutCents > 0);
  }
  assert.ok(completed);
  assert.equal(completed.payoutCents, 1_500);
  assert.equal(mazeChallengeResult("00000001:0,1,2", 1_000).payoutCents, 0);
  assert.equal(mazeChallengeResult("00000001:0,5,10,15,20,21,22,23,24,19", 1_000).payoutCents, 0);
  assert.throws(() => mazeChallengeResult("00000001:0,1,26", 1_000), RangeError);
});
