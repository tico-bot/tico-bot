"use strict";

const PULL_COOLDOWN_MS = 120;
const WINNING_PULL_MARGIN = 8;
const MAX_PULLS_PER_BATCH = 8;
const TEAM_RACE_TARGET = 24;
const TEAM_RELAY_TARGET = 12;
const TEAM_BLITZ_TARGET = 20;
const COMPLETED_ROOM_RETENTION_MS = 2 * 60 * 1_000;
const TEAM_QUIZ_QUESTIONS = [
  { question: "Quanto é 12 × 8?", answers: ["86", "96", "108", "112"], correct: 1 },
  { question: "Qual é a capital do Japão?", answers: ["Seul", "Pequim", "Tóquio", "Bangkok"], correct: 2 },
  { question: "Quantos lados tem um octógono?", answers: ["6", "7", "8", "9"], correct: 2 },
  { question: "Qual gás as plantas absorvem?", answers: ["Oxigênio", "Hélio", "Nitrogênio", "Dióxido de carbono"], correct: 3 },
  { question: "Qual é o maior mamífero do mundo?", answers: ["Elefante", "Baleia-azul", "Girafa", "Hipopótamo"], correct: 1 },
  { question: "Quantos minutos há em uma hora e meia?", answers: ["80", "90", "100", "120"], correct: 1 },
  { question: "Qual destes é um metal precioso?", answers: ["Quartzo", "Granito", "Ouro", "Carvão"], correct: 2 },
  { question: "Em qual continente fica o Egito?", answers: ["África", "Europa", "Ásia", "Oceania"], correct: 0 },
];

function teamQuizQuestion(index) {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("Invalid team quiz question.");
  return TEAM_QUIZ_QUESTIONS[index % TEAM_QUIZ_QUESTIONS.length];
}

function playersInRoom(room) {
  if (Array.isArray(room?.players)) return room.players;
  return [
    { uid: room?.creatorUid, team: "A" },
    ...(room?.opponentUid ? [{ uid: room.opponentUid, team: "B" }] : []),
  ];
}

function chooseBalancedTeam(players, playerSkill = 1) {
  const totals = players.reduce((result, player) => {
    const team = player.team === "B" ? "B" : "A";
    result[team] += Number.isFinite(player.skill) ? player.skill : 1;
    result[`${team}Count`] += 1;
    return result;
  }, { A: 0, B: 0, ACount: 0, BCount: 0 });
  if (totals.A < totals.B) return "A";
  if (totals.B < totals.A) return "B";
  if (totals.ACount < totals.BCount) return "A";
  if (totals.BCount < totals.ACount) return "B";
  return playerSkill % 2 === 0 ? "B" : "A";
}

function recordCompletedRoomExit(room, uid, nowMs) {
  if (!room || room.status !== "settled") throw new Error("room-not-settled");
  const players = playersInRoom(room);
  if (!players.some((player) => player.uid === uid)) throw new Error("not-a-player");
  const exitedUids = [...new Set([...(room.exitedUids || []), uid])];
  const everyoneExited = players.length > 0 && players.every((player) => exitedUids.includes(player.uid));
  return {
    exitedUids,
    cleanupAfterMs: everyoneExited
      ? room.cleanupAfterMs || nowMs + COMPLETED_ROOM_RETENTION_MS
      : 0,
  };
}

function applyTugPull(room, uid, nowMs, pullCount = 1) {
  if (!room || room.status !== "active") throw new Error("room-not-active");
  const player = playersInRoom(room).find((member) => member.uid === uid);
  if (!player || !["A", "B"].includes(player.team)) throw new Error("not-a-player");
  if (!Number.isInteger(pullCount) || pullCount < 1 || pullCount > MAX_PULLS_PER_BATCH) {
    throw new Error("invalid-pull-count");
  }
  const gameId = room.gameId || "tug";
  if (gameId === "teamBlitz" && pullCount > 4) throw new Error("invalid-quiz-answer");
  const lastPullAtMs = room.lastPullAtMs?.[uid] ?? room.startedAtMs ?? nowMs - PULL_COOLDOWN_MS;
  const allowedPulls = Math.floor((nowMs - lastPullAtMs) / PULL_COOLDOWN_MS);
  if (allowedPulls < 1) throw new Error("pull-too-fast");

  const teamAPulls = room.teamAPulls ?? room.creatorPulls ?? 0;
  const teamBPulls = room.teamBPulls ?? room.opponentPulls ?? 0;
  const lead = teamAPulls - teamBPulls;
  const lastPlayerByTeam = { ...(room.lastPlayerByTeam || {}) };
  if (gameId === "teamRelay" && lastPlayerByTeam[player.team] === uid) {
    throw new Error("relay-turn");
  }
  const pullsToWin = gameId === "teamRace"
    ? TEAM_RACE_TARGET - (player.team === "A" ? teamAPulls : teamBPulls)
    : gameId === "teamRelay"
      ? TEAM_RELAY_TARGET - (player.team === "A" ? teamAPulls : teamBPulls)
      : gameId === "teamBlitz"
        ? TEAM_BLITZ_TARGET - (player.team === "A" ? teamAPulls : teamBPulls)
        : player.team === "A" ? WINNING_PULL_MARGIN - lead : WINNING_PULL_MARGIN + lead;
  const answerCorrect = gameId === "teamBlitz"
    ? pullCount - 1 === teamQuizQuestion(Math.floor((teamAPulls + teamBPulls) / 2)).correct
    : false;
  const appliedPulls = gameId === "teamBlitz"
    ? answerCorrect ? 1 : 0
    : Math.min(pullCount, allowedPulls, pullsToWin);
  const scoringPulls = gameId === "teamBlitz" ? appliedPulls * 2 : appliedPulls;
  const nextTeamAPulls = teamAPulls + (player.team === "A" ? scoringPulls : 0);
  const nextTeamBPulls = teamBPulls + (player.team === "B" ? scoringPulls : 0);
  const nextLead = nextTeamAPulls - nextTeamBPulls;
  const winnerTeam = gameId === "teamRace" || gameId === "teamRelay" || gameId === "teamBlitz"
    ? nextTeamAPulls >= (gameId === "teamRace" ? TEAM_RACE_TARGET : gameId === "teamRelay" ? TEAM_RELAY_TARGET : TEAM_BLITZ_TARGET)
      ? "A"
      : nextTeamBPulls >= (gameId === "teamRace" ? TEAM_RACE_TARGET : gameId === "teamRelay" ? TEAM_RELAY_TARGET : TEAM_BLITZ_TARGET)
        ? "B"
        : ""
    : nextLead >= WINNING_PULL_MARGIN ? "A" : nextLead <= -WINNING_PULL_MARGIN ? "B" : "";
  const winner = winnerTeam ? playersInRoom(room).find((member) => member.team === winnerTeam) : null;
  if (appliedPulls > 0 && gameId === "teamRelay") lastPlayerByTeam[player.team] = uid;
  return {
    teamAPulls: nextTeamAPulls,
    teamBPulls: nextTeamBPulls,
    creatorPulls: nextTeamAPulls,
    opponentPulls: nextTeamBPulls,
    winnerTeam,
    winnerUid: winner?.uid || "",
    acceptedPulls: appliedPulls,
    lastPlayerByTeam,
    status: winnerTeam ? "settled" : "active",
    lastPullAtMs: { ...(room.lastPullAtMs || {}), [uid]: nowMs },
  };
}

module.exports = {
  COMPLETED_ROOM_RETENTION_MS,
  MAX_PULLS_PER_BATCH,
  PULL_COOLDOWN_MS,
  WINNING_PULL_MARGIN,
  applyTugPull,
  chooseBalancedTeam,
  recordCompletedRoomExit,
  teamQuizQuestion,
};