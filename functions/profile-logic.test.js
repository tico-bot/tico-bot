"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  advanceMissionProgress,
  advanceSportsMissionProgress,
  getMissionProgress,
  initializeBalance,
  levelProgress,
  normalizeBio,
  normalizeUsername,
} = require("./profile-logic");

test("new profiles receive R$500 and migration grants it once to empty legacy profiles", () => {
  assert.deepEqual(initializeBalance(), { balanceCents: 50_000, balanceInitialized: true });
  assert.deepEqual(initializeBalance({ balanceCents: 0, gamesPlayed: 0, wins: 0 }), {
    balanceCents: 50_000,
    balanceInitialized: true,
  });
});

test("existing balances and previously used zero balances are not topped up", () => {
  assert.deepEqual(initializeBalance({ balanceCents: 17_500, gamesPlayed: 0 }), {
    balanceCents: 17_500,
    balanceInitialized: true,
  });
  assert.deepEqual(initializeBalance({ balanceCents: 0, gamesPlayed: 8, wins: 2 }), {
    balanceCents: 0,
    balanceInitialized: true,
  });
  assert.deepEqual(initializeBalance({ balanceCents: 0, balanceInitialized: true }), {
    balanceCents: 0,
    balanceInitialized: true,
  });
});

test("usernames are unique-key compatible and case-insensitive", () => {
  assert.equal(normalizeUsername("  Zeca_Player9 "), "zeca_player9");
  assert.equal(normalizeUsername("ab"), null);
  assert.equal(normalizeUsername("nome com espaço"), null);
  assert.equal(normalizeUsername("nome!"), null);
});

test("bios are trimmed and limited to 160 characters", () => {
  assert.equal(normalizeBio("  Olá, eu sou Zeca!  "), "Olá, eu sou Zeca!");
  assert.equal(normalizeBio("a".repeat(160)), "a".repeat(160));
  assert.equal(normalizeBio("a".repeat(161)), null);
  assert.equal(normalizeBio(null), null);
});

test("level reward is granted once at each ten settled games", () => {
  assert.deepEqual(levelProgress(0), {
    level: 1,
    gamesTowardNextLevel: 0,
    gamesToNextLevel: 10,
    rewardCents: 0,
  });
  assert.deepEqual(levelProgress(9), {
    level: 1,
    gamesTowardNextLevel: 9,
    gamesToNextLevel: 1,
    rewardCents: 0,
  });
  assert.deepEqual(levelProgress(10), {
    level: 2,
    gamesTowardNextLevel: 0,
    gamesToNextLevel: 10,
    rewardCents: 5_000,
  });
  assert.deepEqual(levelProgress(20), {
    level: 3,
    gamesTowardNextLevel: 0,
    gamesToNextLevel: 10,
    rewardCents: 10_000,
  });
});

test("daily and weekly missions progress on settled games and reward once", () => {
  const start = Date.UTC(2026, 8, 30, 12);
  let profile = {};
  for (let game = 0; game < 4; game += 1) {
    const progress = advanceMissionProgress(profile, start);
    assert.equal(progress.totalRewardCents, 0);
    profile = { ...profile, ...progress.profileFields };
  }
  const dailyCompletion = advanceMissionProgress(profile, start);
  assert.equal(dailyCompletion.totalRewardCents, 4_000);
  assert.equal(dailyCompletion.progress.daily.completed, true);
  profile = { ...profile, ...dailyCompletion.profileFields };
  assert.equal(advanceMissionProgress(profile, start).totalRewardCents, 0);

  for (let game = 0; game < 19; game += 1) {
    const progress = advanceMissionProgress(profile, start);
    profile = { ...profile, ...progress.profileFields };
  }
  const weeklyCompletion = advanceMissionProgress(profile, start);
  assert.equal(weeklyCompletion.totalRewardCents, 20_000);
  assert.equal(weeklyCompletion.progress.weekly.completed, true);
  assert.deepEqual(getMissionProgress(profile, start + 7 * 24 * 60 * 60 * 1_000).daily, {
    period: "2026-10-07",
    progress: 0,
    target: 5,
    rewardCents: 4_000,
    completed: false,
  });
});

test("sports daily mission rewards one settled multiple per UTC day", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const first = advanceSportsMissionProgress({}, now);
  assert.equal(first.progress.completed, true);
  assert.equal(first.totalRewardCents, 8_000);
  const profile = { ...first.profileFields };
  const repeated = advanceSportsMissionProgress(profile, now);
  assert.equal(repeated.totalRewardCents, 0);
  assert.equal(advanceSportsMissionProgress(profile, now + 86_400_000).totalRewardCents, 8_000);
});