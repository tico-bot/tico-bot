"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyTugPull,
  chooseBalancedTeam,
  recordCompletedRoomExit,
  teamQuizQuestion,
  COMPLETED_ROOM_RETENTION_MS,
} = require("./tug-logic");

test("completed tug rooms start two-minute cleanup after every player exits", () => {
  const room = {
    status: "settled",
    players: [
      { uid: "a", team: "A" },
      { uid: "b", team: "B" },
    ],
    exitedUids: [],
  };
  const firstExit = recordCompletedRoomExit(room, "a", 1_000);
  assert.deepEqual(firstExit.exitedUids, ["a"]);
  assert.equal(firstExit.cleanupAfterMs, 0);

  const lastExit = recordCompletedRoomExit({ ...room, ...firstExit }, "b", 1_500);
  assert.deepEqual(lastExit.exitedUids, ["a", "b"]);
  assert.equal(lastExit.cleanupAfterMs, 1_500 + COMPLETED_ROOM_RETENTION_MS);

  const repeatedExit = recordCompletedRoomExit({ ...room, ...firstExit, ...lastExit }, "a", 9_000);
  assert.equal(repeatedExit.cleanupAfterMs, lastExit.cleanupAfterMs);
  assert.throws(() => recordCompletedRoomExit(room, "outsider", 1_000), /not-a-player/);
  assert.throws(() => recordCompletedRoomExit({ ...room, status: "active" }, "a", 1_000), /room-not-settled/);
});

test("tug pulls are restricted to active room members and rate limited", () => {
  const room = {
    status: "active",
    creatorUid: "creator",
    opponentUid: "opponent",
    creatorPulls: 0,
    opponentPulls: 0,
  };
  assert.throws(() => applyTugPull(room, "outsider", 1_000), /not-a-player/);
  const first = applyTugPull(room, "creator", 1_000);
  assert.equal(first.creatorPulls, 1);
  assert.throws(() => applyTugPull({ ...room, ...first }, "creator", 1_100), /pull-too-fast/);
});

test("tug match ends when one side gains an eight-pull lead", () => {
  let room = {
    status: "active",
    creatorUid: "creator",
    opponentUid: "opponent",
    creatorPulls: 0,
    opponentPulls: 0,
    lastPullAtMs: {},
  };
  for (let pull = 0; pull < 8; pull += 1) {
    room = { ...room, ...applyTugPull(room, "creator", 1_000 + pull * 121) };
  }
  assert.equal(room.status, "settled");
  assert.equal(room.winnerUid, "creator");
});

test("2v2 teammates contribute to the same team pull count", () => {
  let room = {
    status: "active",
    mode: "2v2",
    players: [
      { uid: "a1", team: "A" },
      { uid: "a2", team: "A" },
      { uid: "b1", team: "B" },
      { uid: "b2", team: "B" },
    ],
    teamAPulls: 0,
    teamBPulls: 0,
    startedAtMs: 1_000,
    lastPullAtMs: {},
  };
  room = { ...room, ...applyTugPull(room, "a1", 1_120) };
  room = { ...room, ...applyTugPull(room, "a2", 1_120) };
  assert.equal(room.teamAPulls, 2);
  room = { ...room, ...applyTugPull(room, "b1", 1_120) };
  assert.equal(room.teamBPulls, 1);
});

test("automatically assigns the next teammate to the lower-skill team", () => {
  assert.equal(chooseBalancedTeam([
    { uid: "a1", team: "A", skill: 12 },
    { uid: "b1", team: "B", skill: 4 },
  ], 6), "B");
  assert.equal(chooseBalancedTeam([
    { uid: "a1", team: "A", skill: 3 },
    { uid: "b1", team: "B", skill: 3 },
  ], 2), "B");
});

test("batched taps are partially accepted at the rate limit and settle at the winning margin", () => {
  const room = {
    status: "active",
    creatorUid: "creator",
    opponentUid: "opponent",
    creatorPulls: 0,
    opponentPulls: 0,
    startedAtMs: 1_000,
    lastPullAtMs: {},
  };
  let current = { ...room, ...applyTugPull(room, "creator", 1_120, 2) };
  assert.equal(current.acceptedPulls, 1);
  let nextPullAt = 1_360;
  while (current.status === "active") {
    current = {
      ...current,
      ...applyTugPull(current, "creator", nextPullAt, 2),
    };
    nextPullAt += 240;
  }
  assert.equal(current.creatorPulls, 8);
  assert.equal(current.status, "settled");
});

test("team race and blitz use their own score targets", () => {
  const players = [
    { uid: "a1", team: "A" },
    { uid: "a2", team: "A" },
    { uid: "b1", team: "B" },
    { uid: "b2", team: "B" },
  ];
  let race = {
    status: "active",
    mode: "2v2",
    gameId: "teamRace",
    players,
    teamAPulls: 0,
    teamBPulls: 0,
    startedAtMs: 1_000,
    lastPullAtMs: {},
  };
  for (let pull = 0; pull < 24; pull += 1) {
    race = { ...race, ...applyTugPull(race, "a1", 1_120 + pull * 121) };
  }
  assert.equal(race.status, "settled");
  assert.equal(race.winnerTeam, "A");
  assert.equal(race.teamAPulls, 24);

  let blitz = {
    ...race,
    status: "active",
    gameId: "teamBlitz",
    teamAPulls: 0,
    teamBPulls: 0,
    startedAtMs: 1_000,
    lastPullAtMs: {},
  };
  const missedAnswer = applyTugPull(blitz, "a1", 1_120, 1);
  assert.equal(missedAnswer.acceptedPulls, 0);
  assert.equal(missedAnswer.teamAPulls, 0);
  assert.throws(() => applyTugPull(blitz, "a1", 1_120, 5), /invalid-quiz-answer/);
  for (let question = 0; question < 10; question += 1) {
    const correctAnswer = teamQuizQuestion(question).correct + 1;
    blitz = { ...blitz, ...applyTugPull(blitz, "a1", 1_120 + question * 121, correctAnswer) };
  }
  assert.equal(blitz.status, "settled");
  assert.equal(blitz.teamAPulls, 20);
});

test("relay requires teammates to alternate before each side scores", () => {
  let room = {
    status: "active",
    mode: "2v2",
    gameId: "teamRelay",
    players: [
      { uid: "a1", team: "A" },
      { uid: "a2", team: "A" },
      { uid: "b1", team: "B" },
      { uid: "b2", team: "B" },
    ],
    teamAPulls: 0,
    teamBPulls: 0,
    startedAtMs: 1_000,
    lastPullAtMs: {},
  };
  room = { ...room, ...applyTugPull(room, "a1", 1_120) };
  assert.throws(() => applyTugPull(room, "a1", 1_241), /relay-turn/);
  room = { ...room, ...applyTugPull(room, "a2", 1_241) };
  assert.equal(room.teamAPulls, 2);
  assert.equal(room.lastPlayerByTeam.A, "a2");
});