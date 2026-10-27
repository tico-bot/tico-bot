"use strict";

const CLAN_POLICIES = Object.freeze(["public", "private", "approval"]);
const CLAN_ROLES = Object.freeze(["owner", "admin", "member"]);
const REPORT_CATEGORIES = Object.freeze([
  "cheating",
  "harassment",
  "spam",
  "inappropriate_content",
  "other",
]);
const REPORT_STATUSES = Object.freeze(["open", "reviewing", "resolved", "dismissed"]);

const REPORT_TRANSITIONS = Object.freeze({
  open: Object.freeze(["reviewing", "dismissed"]),
  reviewing: Object.freeze(["open", "resolved", "dismissed"]),
  resolved: Object.freeze([]),
  dismissed: Object.freeze([]),
});

const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "first_game", metric: "played", target: 1 }),
  Object.freeze({ id: "games_played_10", metric: "played", target: 10 }),
  Object.freeze({ id: "games_played_100", metric: "played", target: 100 }),
  Object.freeze({ id: "first_win", metric: "won", target: 1 }),
  Object.freeze({ id: "games_won_10", metric: "won", target: 10 }),
  Object.freeze({ id: "games_won_100", metric: "won", target: 100 }),
]);

const WEEKLY_EVENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    eventKey: "play_any_game",
    title: "Maratona de minijogos",
    description: "Conclua 10 minijogos de qualquer modo.",
    target: 10,
    rewardCents: 5_000,
  }),
  Object.freeze({
    eventKey: "play_duels",
    title: "Semana dos duelos",
    description: "Conclua 5 partidas 1v1.",
    target: 5,
    rewardCents: 5_000,
  }),
  Object.freeze({
    eventKey: "play_teams",
    title: "Desafio em equipe",
    description: "Conclua 4 partidas em equipe.",
    target: 4,
    rewardCents: 5_000,
  }),
  Object.freeze({
    eventKey: "play_solo",
    title: "Jornada solo",
    description: "Conclua 8 partidas solo.",
    target: 8,
    rewardCents: 5_000,
  }),
]);

const MAX_CLAN_NAME_LENGTH = 32;
const MIN_CLAN_NAME_LENGTH = 3;
const MAX_CLAN_DESCRIPTION_LENGTH = 500;
const MAX_REPORT_DETAILS_LENGTH = 2_000;
const MIN_REPORT_DETAILS_LENGTH = 10;
const MAX_TARGET_ID_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function codePointLength(value) {
  return [...value].length;
}

function normalizeClanName(name) {
  if (typeof name !== "string") return null;
  const normalized = name.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    codePointLength(normalized) < MIN_CLAN_NAME_LENGTH
    || codePointLength(normalized) > MAX_CLAN_NAME_LENGTH
    || !/^[\p{L}\p{N} _.'’-]+$/u.test(normalized)
    || !/[\p{L}\p{N}]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeClanDescription(description) {
  if (description === undefined || description === null) return "";
  if (typeof description !== "string") return null;
  const normalized = description.normalize("NFC").trim();
  if (codePointLength(normalized) > MAX_CLAN_DESCRIPTION_LENGTH || CONTROL_CHARACTERS.test(normalized)) {
    return null;
  }
  return normalized;
}

function isClanPolicy(policy) {
  return CLAN_POLICIES.includes(policy);
}

function validateClan(input = {}) {
  const errors = [];
  const name = normalizeClanName(input.name);
  const description = normalizeClanDescription(input.description);
  const policy = input.policy;

  if (name === null) errors.push("invalid-name");
  if (description === null) errors.push("invalid-description");
  if (!isClanPolicy(policy)) errors.push("invalid-policy");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors, value: { name, description, policy } };
}

function isClanRole(role) {
  return CLAN_ROLES.includes(role);
}

function canAddClanMember({ memberCount, capacity, role = "member" } = {}) {
  if (!isClanRole(role)) return { allowed: false, reason: "invalid-role" };
  if (!Number.isSafeInteger(memberCount) || memberCount < 0) {
    return { allowed: false, reason: "invalid-member-count" };
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    return { allowed: false, reason: "invalid-capacity" };
  }
  if (memberCount >= capacity) return { allowed: false, reason: "capacity-reached" };
  return { allowed: true, reason: null };
}

function canChangeClanMemberRole({ actorRole, targetRole, nextRole, ownerCount = 1 } = {}) {
  if (!isClanRole(actorRole) || !isClanRole(targetRole) || !isClanRole(nextRole)) {
    return { allowed: false, reason: "invalid-role" };
  }
  if (!Number.isSafeInteger(ownerCount) || ownerCount < 1) {
    return { allowed: false, reason: "invalid-owner-count" };
  }
  if (targetRole === nextRole) return { allowed: true, reason: null };
  if (actorRole !== "owner" && actorRole !== "admin") {
    return { allowed: false, reason: "insufficient-role" };
  }
  if (actorRole === "admin" && (targetRole === "owner" || nextRole === "owner")) {
    return { allowed: false, reason: "owner-only" };
  }
  if (targetRole === "owner" && ownerCount <= 1) {
    return { allowed: false, reason: "last-owner" };
  }
  return { allowed: true, reason: null };
}

function normalizeReportTargetId(targetUid) {
  if (typeof targetUid !== "string") return null;
  const normalized = targetUid.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_TARGET_ID_LENGTH
    || normalized.includes("/")
    || CONTROL_CHARACTERS.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeReportDetails(details) {
  if (typeof details !== "string") return null;
  const normalized = details.normalize("NFC").trim();
  if (
    codePointLength(normalized) < MIN_REPORT_DETAILS_LENGTH
    || codePointLength(normalized) > MAX_REPORT_DETAILS_LENGTH
    || CONTROL_CHARACTERS.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function validateReport(input = {}) {
  const errors = [];
  const category = typeof input.category === "string" ? input.category.trim().toLowerCase() : null;
  const details = normalizeReportDetails(input.details);
  const targetUid = normalizeReportTargetId(input.targetUid);
  const reporterUid = normalizeReportTargetId(input.reporterUid);

  if (!REPORT_CATEGORIES.includes(category)) errors.push("invalid-category");
  if (details === null) errors.push("invalid-details");
  if (targetUid === null) errors.push("invalid-target");
  if (reporterUid === null) errors.push("invalid-reporter");
  if (targetUid !== null && reporterUid !== null && targetUid === reporterUid) {
    errors.push("self-report");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors, value: { category, details, targetUid, reporterUid } };
}

function canTransitionReport(currentStatus, nextStatus) {
  if (!REPORT_STATUSES.includes(currentStatus) || !REPORT_STATUSES.includes(nextStatus)) {
    return { allowed: false, reason: "invalid-status" };
  }
  if (!REPORT_TRANSITIONS[currentStatus].includes(nextStatus)) {
    return { allowed: false, reason: "transition-not-allowed" };
  }
  return { allowed: true, reason: null };
}

function validSettlement(record) {
  return record !== null
    && typeof record === "object"
    && !Array.isArray(record)
    && record.status === "settled"
    && typeof record.gameId === "string"
    && record.gameId.trim().length > 0
    && ["won", "lost", "tie", "draw"].includes(record.outcome)
    && Number.isSafeInteger(record.netCents);
}

function aggregateGameStats(settlementRecords = []) {
  if (!Array.isArray(settlementRecords)) return {};
  const totals = new Map();

  for (const record of settlementRecords) {
    if (!validSettlement(record)) continue;
    const gameId = record.gameId.trim();
    const stats = totals.get(gameId) || { played: 0, won: 0, lost: 0, tied: 0, netCents: 0 };
    const netCents = stats.netCents + record.netCents;
    if (!Number.isSafeInteger(netCents)) continue;

    stats.played += 1;
    if (record.outcome === "won") stats.won += 1;
    else if (record.outcome === "lost") stats.lost += 1;
    else stats.tied += 1;
    stats.netCents = netCents;
    totals.set(gameId, stats);
  }

  return Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function parseInstant(instant) {
  if (instant instanceof Date) return Number.isFinite(instant.getTime()) ? new Date(instant.getTime()) : null;
  if (typeof instant === "number" && Number.isSafeInteger(instant)) {
    const date = new Date(instant);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof instant === "string" && instant.trim() !== "") {
    const timestamp = Date.parse(instant);
    if (Number.isFinite(timestamp)) return new Date(timestamp);
  }
  return null;
}

function isoWeekKey(instant) {
  const date = parseInstant(instant);
  if (!date) return null;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((thursday - firstThursday) / 604_800_000);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weeklyEventId(eventKey, weekKey) {
  if (
    typeof eventKey !== "string"
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(eventKey)
    || typeof weekKey !== "string"
    || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(weekKey)
  ) {
    return null;
  }
  return `weekly_${weekKey}_${eventKey}`;
}

function weeklyEventIdentity(eventKey, instant) {
  const weekKey = isoWeekKey(instant);
  const id = weekKey === null ? null : weeklyEventId(eventKey, weekKey);
  return id === null ? null : { id, eventKey, weekKey };
}

function weeklyEventForDate(instant) {
  const weekKey = isoWeekKey(instant);
  if (weekKey === null) return null;
  const weekNumber = Number(weekKey.slice(-2));
  const definition = WEEKLY_EVENT_DEFINITIONS[weekNumber % WEEKLY_EVENT_DEFINITIONS.length];
  const id = weeklyEventId(definition.eventKey, weekKey);
  return id === null ? null : { ...definition, id, weekKey };
}

function qualifiesForWeeklyEvent(gameId, eventKey) {
  if (typeof gameId !== "string") return false;
  if (eventKey === "play_any_game") return true;
  if (eventKey === "play_duels") return gameId === "rps" || gameId.startsWith("duel");
  if (eventKey === "play_teams") return ["tug", "teamRace", "teamRelay", "teamBlitz"].includes(gameId);
  if (eventKey === "play_solo") {
    return gameId !== "rps" && !gameId.startsWith("duel")
      && !["tug", "teamRace", "teamRelay", "teamBlitz"].includes(gameId);
  }
  return false;
}

function canViewPlayerProfile(viewerUid, ownerUid, visibility, isAcceptedFriend) {
  return viewerUid === ownerUid || visibility !== "private" || isAcceptedFriend === true;
}

function advanceWeeklyEvent({
  eventKey,
  weekKey,
  progress = 0,
  increment = 1,
  target,
  rewardCents = 0,
  rewardedEventIds = [],
} = {}) {
  const id = weeklyEventId(eventKey, weekKey);
  if (
    id === null
    || !Number.isSafeInteger(progress) || progress < 0
    || !Number.isSafeInteger(increment) || increment < 0
    || !Number.isSafeInteger(target) || target < 1
    || !Number.isSafeInteger(rewardCents) || rewardCents < 0
    || !Array.isArray(rewardedEventIds)
  ) {
    return { valid: false, id, progress: 0, completed: false, rewardCents: 0 };
  }

  const nextProgress = Math.min(target, progress + increment);
  const completed = nextProgress >= target;
  const rewardDue = completed && !rewardedEventIds.includes(id);
  return {
    valid: true,
    id,
    progress: nextProgress,
    target,
    completed,
    rewardCents: rewardDue ? rewardCents : 0,
    rewardDue,
  };
}

function deriveAchievementProgress(settlementRecords = []) {
  const statsByGame = aggregateGameStats(settlementRecords);
  const totals = Object.values(statsByGame).reduce((aggregate, stats) => ({
    played: aggregate.played + stats.played,
    won: aggregate.won + stats.won,
    lost: aggregate.lost + stats.lost,
    tied: aggregate.tied + stats.tied,
    netCents: aggregate.netCents + stats.netCents,
  }), { played: 0, won: 0, lost: 0, tied: 0, netCents: 0 });

  return ACHIEVEMENT_DEFINITIONS.map(({ id, metric, target }) => {
    const progress = Math.min(target, totals[metric]);
    return { id, progress, target, unlocked: progress >= target };
  });
}

module.exports = {
  ACHIEVEMENT_DEFINITIONS,
  CLAN_POLICIES,
  CLAN_ROLES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  advanceWeeklyEvent,
  aggregateGameStats,
  canAddClanMember,
  canChangeClanMemberRole,
  canViewPlayerProfile,
  canTransitionReport,
  deriveAchievementProgress,
  isoWeekKey,
  isClanPolicy,
  isClanRole,
  normalizeClanDescription,
  normalizeClanName,
  normalizeReportDetails,
  normalizeReportTargetId,
  validateClan,
  validateReport,
  weeklyEventId,
  weeklyEventForDate,
  weeklyEventIdentity,
  qualifiesForWeeklyEvent,
};
