"use strict";

function dateUtc(timestampMs) {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function previousDateUtc(date) {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`) - 24 * 60 * 60 * 1000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function flameLevel(streakDays) {
  if (streakDays >= 30) return 5;
  if (streakDays >= 14) return 4;
  if (streakDays >= 7) return 3;
  if (streakDays >= 3) return 2;
  if (streakDays >= 1) return 1;
  return 0;
}

function applyStreakMessage(chat, senderUid, today) {
  const members = [...new Set(chat.participantUids || [])].sort();
  if (!members.includes(senderUid)) throw new Error("sender-not-member");

  const yesterday = previousDateUtc(today);
  let streakDays = Number.isSafeInteger(chat.streakDays) ? chat.streakDays : 0;
  let lastQualifiedDate = chat.streakLastQualifiedDate || "";
  if (lastQualifiedDate && lastQualifiedDate < yesterday) {
    streakDays = 0;
    lastQualifiedDate = "";
  }

  const participantsToday = new Set(
    chat.streakActivityDate === today ? chat.streakParticipantsToday || [] : [],
  );
  participantsToday.add(senderUid);

  if (members.every((memberUid) => participantsToday.has(memberUid)) && lastQualifiedDate !== today) {
    streakDays = lastQualifiedDate === yesterday ? streakDays + 1 : 1;
    lastQualifiedDate = today;
  }

  return {
    streakDays,
    streakLevel: flameLevel(streakDays),
    streakLastQualifiedDate: lastQualifiedDate,
    streakActivityDate: today,
    streakParticipantsToday: [...participantsToday].sort(),
  };
}

module.exports = { applyStreakMessage, dateUtc, flameLevel };
