"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACHIEVEMENT_DEFINITIONS,
  advanceWeeklyEvent,
  aggregateGameStats,
  canAddClanMember,
  canChangeClanMemberRole,
  canViewPlayerProfile,
  canTransitionReport,
  deriveAchievementProgress,
  isoWeekKey,
  normalizeClanDescription,
  normalizeClanName,
  normalizeReportDetails,
  normalizeReportTargetId,
  validateClan,
  validateReport,
  qualifiesForWeeklyEvent,
  weeklyEventId,
  weeklyEventForDate,
  weeklyEventIdentity,
} = require("./social-logic");

test("validates and normalizes clan name, description, and policy", () => {
  assert.deepEqual(validateClan({ name: "  Zecá   Clube ", description: "  Jogamos juntos. ", policy: "approval" }), {
    valid: true,
    errors: [],
    value: { name: "Zecá Clube", description: "Jogamos juntos.", policy: "approval" },
  });

  test("private profiles are visible only to their owner and accepted friends", () => {
    assert.equal(canViewPlayerProfile("a", "a", "private", false), true);
    assert.equal(canViewPlayerProfile("b", "a", "private", true), true);
    assert.equal(canViewPlayerProfile("b", "a", "private", false), false);
    assert.equal(canViewPlayerProfile("b", "a", "public", false), true);
  });
  assert.equal(normalizeClanName("ab"), null);
  assert.equal(normalizeClanName("Clan<script>"), null);
  assert.equal(normalizeClanDescription("ok\u0000no"), null);
  assert.equal(normalizeClanDescription(undefined), "");
  assert.deepEqual(validateClan({ name: "  ", description: 123, policy: "friends" }), {
    valid: false,
    errors: ["invalid-name", "invalid-description", "invalid-policy"],
  });
});

test("checks membership capacity and prevents role escalation by admins or members", () => {
  assert.deepEqual(canAddClanMember({ memberCount: 3, capacity: 4 }), { allowed: true, reason: null });
  assert.equal(canAddClanMember({ memberCount: 4, capacity: 4 }).reason, "capacity-reached");
  assert.equal(canAddClanMember({ memberCount: 1, capacity: 4, role: "owner" }).allowed, true);
  assert.equal(canAddClanMember({ memberCount: -1, capacity: 4 }).allowed, false);

  assert.equal(canChangeClanMemberRole({ actorRole: "member", targetRole: "member", nextRole: "admin" }).allowed, false);
  assert.equal(canChangeClanMemberRole({ actorRole: "admin", targetRole: "member", nextRole: "owner" }).reason, "owner-only");
  assert.equal(canChangeClanMemberRole({ actorRole: "owner", targetRole: "owner", nextRole: "member", ownerCount: 1 }).reason, "last-owner");
  assert.equal(canChangeClanMemberRole({ actorRole: "owner", targetRole: "member", nextRole: "admin" }).allowed, true);
});

test("validates report category, details, target, and disallows self-reporting", () => {
  assert.deepEqual(validateReport({
    category: " HARASSMENT ",
    details: "Repeated abusive messages in chat.",
    targetUid: "user-2",
    reporterUid: "user-1",
  }), {
    valid: true,
    errors: [],
    value: {
      category: "harassment",
      details: "Repeated abusive messages in chat.",
      targetUid: "user-2",
      reporterUid: "user-1",
    },
  });
  assert.equal(normalizeReportDetails("short"), null);
  assert.equal(normalizeReportTargetId(" \t "), null);
  assert.equal(normalizeReportTargetId("user/child"), null);
  assert.deepEqual(validateReport({
    category: "other",
    details: "They did it",
    targetUid: "same",
    reporterUid: "same",
  }).errors, ["self-report"]);
});

test("permits only intentional report status transitions", () => {
  assert.equal(canTransitionReport("open", "reviewing").allowed, true);
  assert.equal(canTransitionReport("reviewing", "resolved").allowed, true);
  assert.equal(canTransitionReport("reviewing", "open").allowed, true);
  assert.equal(canTransitionReport("open", "resolved").allowed, false);
  assert.equal(canTransitionReport("resolved", "reviewing").allowed, false);
  assert.equal(canTransitionReport("blocked", "resolved").reason, "invalid-status");
});

test("aggregates only settled outcomes and net cents, ignoring score-like client fields", () => {
  const records = [
    { gameId: "rps", status: "settled", outcome: "won", netCents: 500, playerScore: 999 },
    { gameId: "rps", status: "settled", outcome: "lost", netCents: -100 },
    { gameId: "rps", status: "settled", outcome: "draw", netCents: 0 },
    { gameId: "cards", status: "pending", outcome: "won", netCents: 900 },
    { gameId: "cards", status: "settled", outcome: "won", netCents: 25, playerScore: 0 },
    { gameId: "rps", status: "settled", outcome: "won", netCents: 1.5 },
  ];
  assert.deepEqual(aggregateGameStats(records), {
    cards: { played: 1, won: 1, lost: 0, tied: 0, netCents: 25 },
    rps: { played: 3, won: 1, lost: 1, tied: 1, netCents: 400 },
  });
  assert.deepEqual(aggregateGameStats(null), {});
});

test("creates stable UTC weekly identities and awards completion rewards once", () => {
  assert.equal(isoWeekKey(Date.UTC(2026, 0, 1)), "2026-W01");
  assert.equal(isoWeekKey("not a date"), null);
  assert.deepEqual(weeklyEventIdentity("spring-cup", Date.UTC(2026, 9, 2)), {
    id: "weekly_2026-W40_spring-cup",
    eventKey: "spring-cup",
    weekKey: "2026-W40",
  });
  assert.equal(weeklyEventId("bad key", "2026-W40"), null);

  const completion = advanceWeeklyEvent({
    eventKey: "spring-cup",
    weekKey: "2026-W40",
    progress: 2,
    increment: 1,
    target: 3,
    rewardCents: 1_000,
  });
  assert.deepEqual(completion, {
    valid: true,
    id: "weekly_2026-W40_spring-cup",
    progress: 3,
    target: 3,
    completed: true,
    rewardCents: 1_000,
    rewardDue: true,
  });
  assert.equal(advanceWeeklyEvent({
    eventKey: "spring-cup",
    weekKey: "2026-W40",
    progress: 3,
    target: 3,
    rewardCents: 1_000,
  }).rewardCents, 1_000);
  assert.equal(advanceWeeklyEvent({
    eventKey: "spring-cup",
    weekKey: "2026-W40",
    progress: 2,
    target: 3,
    rewardCents: 1_000,
    rewardedEventIds: ["weekly_2026-W40_spring-cup"],
  }).rewardDue, false);
});

test("rotates thematic weekly challenges and accepts only matching minigames", () => {
  const duels = weeklyEventForDate("2025-01-01T12:00:00Z");
  assert.equal(duels.eventKey, "play_duels");
  assert.equal(qualifiesForWeeklyEvent("duelParity", duels.eventKey), true);
  assert.equal(qualifiesForWeeklyEvent("memorySequence", duels.eventKey), false);

  const teams = weeklyEventForDate("2025-01-06T12:00:00Z");
  assert.equal(teams.eventKey, "play_teams");
  assert.equal(qualifiesForWeeklyEvent("teamRelay", teams.eventKey), true);
  assert.equal(qualifiesForWeeklyEvent("rps", teams.eventKey), false);

  const solo = weeklyEventForDate("2025-01-13T12:00:00Z");
  assert.equal(solo.eventKey, "play_solo");
  assert.equal(qualifiesForWeeklyEvent("mazeRunner", solo.eventKey), true);
  assert.equal(qualifiesForWeeklyEvent("duelTarget", solo.eventKey), false);
});

test("derives achievement progress only from settled server outcome records", () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    gameId: index % 2 === 0 ? "rps" : "cards",
    status: "settled",
    outcome: index < 3 ? "won" : "lost",
    netCents: 0,
    score: 1_000_000,
  }));
  records.push({ gameId: "rps", status: "pending", outcome: "won", netCents: 0 });

  const achievements = deriveAchievementProgress(records);
  assert.equal(achievements.length, ACHIEVEMENT_DEFINITIONS.length);
  assert.deepEqual(achievements.find(({ id }) => id === "games_played_10"), {
    id: "games_played_10",
    progress: 10,
    target: 10,
    unlocked: true,
  });
  assert.deepEqual(achievements.find(({ id }) => id === "games_won_10"), {
    id: "games_won_10",
    progress: 3,
    target: 10,
    unlocked: false,
  });
});
