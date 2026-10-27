"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyStreakMessage, dateUtc, flameLevel } = require("./chat-logic");

test("direct streak advances only after both people send that UTC day", () => {
  const first = applyStreakMessage(
    { participantUids: ["a", "b"], streakDays: 0 },
    "a",
    "2026-09-30",
  );
  assert.equal(first.streakDays, 0);

  const qualified = applyStreakMessage(
    { participantUids: ["a", "b"], ...first },
    "b",
    "2026-09-30",
  );
  assert.equal(qualified.streakDays, 1);
  assert.equal(qualified.streakLevel, 1);
});

test("group streak increments once daily after every member participates", () => {
  const members = ["a", "b", "c"];
  const first = applyStreakMessage({ participantUids: members }, "a", "2026-09-30");
  const second = applyStreakMessage({ participantUids: members, ...first }, "b", "2026-09-30");
  assert.equal(second.streakDays, 0);
  const qualified = applyStreakMessage({ participantUids: members, ...second }, "c", "2026-09-30");
  assert.equal(qualified.streakDays, 1);
  const laterMessage = applyStreakMessage({ participantUids: members, ...qualified }, "c", "2026-09-30");
  assert.equal(laterMessage.streakDays, 1);
});

test("streak resumes on the next day and resets after a missed day", () => {
  const resumed = applyStreakMessage({
    participantUids: ["a", "b"],
    streakDays: 4,
    streakLastQualifiedDate: "2026-09-30",
  }, "a", "2026-10-01");
  const resumedQualified = applyStreakMessage({ participantUids: ["a", "b"], ...resumed }, "b", "2026-10-01");
  assert.equal(resumedQualified.streakDays, 5);

  const reset = applyStreakMessage({
    participantUids: ["a", "b"],
    streakDays: 5,
    streakLastQualifiedDate: "2026-09-30",
  }, "a", "2026-10-02");
  const resetQualified = applyStreakMessage({ participantUids: ["a", "b"], ...reset }, "b", "2026-10-02");
  assert.equal(resetQualified.streakDays, 1);
});

test("flame levels evolve at the defined milestones and dates are UTC", () => {
  assert.deepEqual([0, 1, 3, 7, 14, 30].map(flameLevel), [0, 1, 2, 3, 4, 5]);
  assert.equal(dateUtc(Date.parse("2026-09-30T23:30:00-03:00")), "2026-10-01");
});
