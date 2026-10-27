"use strict";

function initializeBalance(profile = {}, initialBalanceCents = 50_000) {
  let balanceCents = Number.isSafeInteger(profile.balanceCents) && profile.balanceCents >= 0
    ? profile.balanceCents
    : initialBalanceCents;
  const hasGameHistory = (profile.gamesPlayed || 0) > 0 || (profile.wins || 0) > 0;
  if (profile.balanceInitialized !== true && balanceCents === 0 && !hasGameHistory) {
    balanceCents = initialBalanceCents;
  }
  return { balanceCents, balanceInitialized: true };
}

function normalizeUsername(username) {
  if (typeof username !== "string") return null;
  const normalized = username.trim().toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(normalized) ? normalized : null;
}

function normalizeBio(bio) {
  if (typeof bio !== "string") return null;
  const normalized = bio.trim();
  return normalized.length <= 160 ? normalized : null;
}

function levelProgress(gamesPlayed) {
  const safeGamesPlayed = Number.isSafeInteger(gamesPlayed) && gamesPlayed >= 0 ? gamesPlayed : 0;
  const gamesTowardNextLevel = safeGamesPlayed % 10;
  const level = Math.floor(safeGamesPlayed / 10) + 1;
  const rewardCents = safeGamesPlayed > 0 && gamesTowardNextLevel === 0 ? (level - 1) * 5_000 : 0;
  return {
    level,
    gamesTowardNextLevel,
    gamesToNextLevel: 10 - gamesTowardNextLevel,
    rewardCents,
  };
}

const DAILY_MISSION_TARGET = 5;
const DAILY_MISSION_REWARD_CENTS = 4_000;
const DAILY_SPORTS_MISSION_REWARD_CENTS = 8_000;
const WEEKLY_MISSION_TARGET = 25;
const WEEKLY_MISSION_REWARD_CENTS = 20_000;

function isoWeekKey(date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((thursday - firstThursday) / 604_800_000);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getMissionProgress(profile = {}, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const dailyPeriod = now.toISOString().slice(0, 10);
  const weeklyPeriod = isoWeekKey(now);
  const dailyProgress = profile.dailyMissionDateUtc === dailyPeriod
    ? Math.min(DAILY_MISSION_TARGET, Number.isSafeInteger(profile.dailyMissionGames) ? profile.dailyMissionGames : 0)
    : 0;
  const weeklyProgress = profile.weeklyMissionWeekUtc === weeklyPeriod
    ? Math.min(WEEKLY_MISSION_TARGET, Number.isSafeInteger(profile.weeklyMissionGames) ? profile.weeklyMissionGames : 0)
    : 0;
  const dailySportsProgress = profile.dailySportsMissionDateUtc === dailyPeriod
    ? Math.min(1, Number.isSafeInteger(profile.dailySportsMissionTickets) ? profile.dailySportsMissionTickets : 0)
    : 0;
  return {
    daily: {
      period: dailyPeriod,
      progress: dailyProgress,
      target: DAILY_MISSION_TARGET,
      rewardCents: DAILY_MISSION_REWARD_CENTS,
      completed: dailyProgress >= DAILY_MISSION_TARGET,
    },
    weekly: {
      period: weeklyPeriod,
      progress: weeklyProgress,
      target: WEEKLY_MISSION_TARGET,
      rewardCents: WEEKLY_MISSION_REWARD_CENTS,
      completed: weeklyProgress >= WEEKLY_MISSION_TARGET,
    },
    dailySports: {
      period: dailyPeriod,
      progress: dailySportsProgress,
      target: 1,
      rewardCents: DAILY_SPORTS_MISSION_REWARD_CENTS,
      completed: dailySportsProgress >= 1,
    },
  };
}

function advanceMissionProgress(profile = {}, nowMs = Date.now()) {
  const current = getMissionProgress(profile, nowMs);
  const dailyProgress = Math.min(DAILY_MISSION_TARGET, current.daily.progress + 1);
  const weeklyProgress = Math.min(WEEKLY_MISSION_TARGET, current.weekly.progress + 1);
  const rewards = [];
  if (!current.daily.completed && dailyProgress === DAILY_MISSION_TARGET) {
    rewards.push({
      id: `mission_daily_${current.daily.period}`,
      description: "Missão diária · 5 partidas concluídas",
      deltaCents: DAILY_MISSION_REWARD_CENTS,
    });
  }
  if (!current.weekly.completed && weeklyProgress === WEEKLY_MISSION_TARGET) {
    rewards.push({
      id: `mission_weekly_${current.weekly.period}`,
      description: "Missão semanal · 25 partidas concluídas",
      deltaCents: WEEKLY_MISSION_REWARD_CENTS,
    });
  }
  const profileFields = {
    dailyMissionDateUtc: current.daily.period,
    dailyMissionGames: dailyProgress,
    weeklyMissionWeekUtc: current.weekly.period,
    weeklyMissionGames: weeklyProgress,
  };
  return {
    profileFields,
    rewards,
    totalRewardCents: rewards.reduce((total, reward) => total + reward.deltaCents, 0),
    progress: {
      daily: { ...current.daily, progress: dailyProgress, completed: dailyProgress >= DAILY_MISSION_TARGET },
      weekly: { ...current.weekly, progress: weeklyProgress, completed: weeklyProgress >= WEEKLY_MISSION_TARGET },
    },
  };
}

function advanceSportsMissionProgress(profile = {}, nowMs = Date.now()) {
  const current = getMissionProgress(profile, nowMs).dailySports;
  const progress = Math.min(current.target, current.progress + 1);
  const rewards = !current.completed && progress >= current.target
    ? [{
      id: `mission_sports_daily_${current.period}`,
      description: "Missão esportiva diária · múltipla com 2 partidas liquidada",
      deltaCents: DAILY_SPORTS_MISSION_REWARD_CENTS,
    }]
    : [];
  return {
    profileFields: {
      dailySportsMissionDateUtc: current.period,
      dailySportsMissionTickets: progress,
    },
    rewards,
    totalRewardCents: rewards.reduce((total, reward) => total + reward.deltaCents, 0),
    progress: { ...current, progress, completed: progress >= current.target },
  };
}

module.exports = {
  advanceMissionProgress,
  advanceSportsMissionProgress,
  getMissionProgress,
  initializeBalance,
  levelProgress,
  normalizeBio,
  normalizeUsername,
};