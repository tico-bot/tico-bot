"use strict";

function parseFixtures(payload) {
  if (!Array.isArray(payload?.response)) return [];
  return payload.response.map((entry) => {
    const fixture = entry?.fixture || {};
    const teams = entry?.teams || {};
    const league = entry?.league || {};
    const fixtureId = Number(fixture.id);
    const kickoffMs = Date.parse(fixture.date);
    if (!Number.isSafeInteger(fixtureId) || !Number.isFinite(kickoffMs)
        || typeof teams.home?.name !== "string" || typeof teams.away?.name !== "string") return null;
    return {
      fixtureId,
      kickoffMs,
      status: typeof fixture.status?.short === "string" ? fixture.status.short : "",
      homeTeam: teams.home.name,
      awayTeam: teams.away.name,
      league: typeof league.name === "string" ? league.name : "Futebol",
      homeGoals: Number.isInteger(entry.goals?.home) ? entry.goals.home : null,
      awayGoals: Number.isInteger(entry.goals?.away) ? entry.goals.away : null,
    };
  }).filter(Boolean);
}

function parseFootballDataMatches(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : payload?.id ? [payload] : [];
  const statuses = {
    SCHEDULED: "NS",
    TIMED: "NS",
    IN_PLAY: "LIVE",
    PAUSED: "LIVE",
    FINISHED: "FT",
    EXTRA_TIME: "AET",
    PENALTY_SHOOTOUT: "PEN",
    AWARDED: "FT",
  };
  return matches.map((match) => {
    const fixtureId = Number(match?.id);
    const kickoffMs = Date.parse(match?.utcDate);
    if (!Number.isSafeInteger(fixtureId) || !Number.isFinite(kickoffMs)
        || typeof match.homeTeam?.name !== "string" || typeof match.awayTeam?.name !== "string") return null;
    return {
      fixtureId,
      kickoffMs,
      status: statuses[match.status] || "",
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      league: typeof match.competition?.name === "string" ? match.competition.name : "Futebol",
      homeGoals: Number.isInteger(match.score?.fullTime?.home) ? match.score.fullTime.home : null,
      awayGoals: Number.isInteger(match.score?.fullTime?.away) ? match.score.fullTime.away : null,
    };
  }).filter(Boolean);
}

function poissonDistribution(lambda, maximumGoals = 10) {
  const probabilities = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximumGoals; goals += 1) {
    probabilities.push(probabilities[goals - 1] * lambda / goals);
  }
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  return probabilities.map((probability) => probability / total);
}

function estimateMatchMarkets(fixture, history = []) {
  const finished = history.filter((match) => fixtureWinner(match) !== null);
  const average = (values, fallback) => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
  const homeMean = average(finished.map((match) => match.homeGoals), 1.5);
  const awayMean = average(finished.map((match) => match.awayGoals), 1.15);
  const teamMean = (homeMean + awayMean) / 2;
  const teamStats = (team) => {
    const recent = finished
      .filter((match) => match.homeTeam === team || match.awayTeam === team)
      .sort((left, right) => right.kickoffMs - left.kickoffMs)
      .slice(0, 12);
    let scored = 0;
    let conceded = 0;
    for (const match of recent) {
      const isHome = match.homeTeam === team;
      scored += isHome ? match.homeGoals : match.awayGoals;
      conceded += isHome ? match.awayGoals : match.homeGoals;
    }
    const priorMatches = 5;
    return {
      attack: (scored + teamMean * priorMatches) / (recent.length + priorMatches),
      defense: (conceded + teamMean * priorMatches) / (recent.length + priorMatches),
    };
  };
  const homeStats = teamStats(fixture.homeTeam);
  const awayStats = teamStats(fixture.awayTeam);
  const expectedHomeGoals = Math.min(4.5, Math.max(0.2, homeMean * homeStats.attack * awayStats.defense / (teamMean * teamMean)));
  const expectedAwayGoals = Math.min(4.5, Math.max(0.2, awayMean * awayStats.attack * homeStats.defense / (teamMean * teamMean)));
  const homeProbabilities = poissonDistribution(expectedHomeGoals);
  const awayProbabilities = poissonDistribution(expectedAwayGoals);
  const scoreProbabilities = [];
  for (let homeGoals = 0; homeGoals < homeProbabilities.length; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals < awayProbabilities.length; awayGoals += 1) {
      scoreProbabilities.push({
        homeGoals,
        awayGoals,
        probability: homeProbabilities[homeGoals] * awayProbabilities[awayGoals],
      });
    }
  }
  const outcomeProbabilities = { home: 0, draw: 0, away: 0, bothYes: 0, bothNo: 0 };
  for (const score of scoreProbabilities) {
    if (score.homeGoals > score.awayGoals) outcomeProbabilities.home += score.probability;
    else if (score.homeGoals === score.awayGoals) outcomeProbabilities.draw += score.probability;
    else outcomeProbabilities.away += score.probability;
    if (score.homeGoals > 0 && score.awayGoals > 0) outcomeProbabilities.bothYes += score.probability;
  }
  outcomeProbabilities.bothNo = 1 - outcomeProbabilities.bothYes;

  const oddsFor = (probability) => Math.min(1_000_000, Math.max(10_001, Math.round(0.92 / probability * 10_000)));
  const market = (marketId, marketName, selectionId, selectionName, probability, line = null) => ({
    marketId,
    marketName,
    selectionId,
    selectionName,
    line,
    oddsBps: oddsFor(probability),
    bookmaker: "Estimativa estatística ZECA",
  });
  const markets = [
    market("match_winner", "Resultado 1X2", "home", fixture.homeTeam, outcomeProbabilities.home),
    market("match_winner", "Resultado 1X2", "draw", "Empate", outcomeProbabilities.draw),
    market("match_winner", "Resultado 1X2", "away", fixture.awayTeam, outcomeProbabilities.away),
  ];
  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    const overProbability = scoreProbabilities
      .filter((score) => score.homeGoals + score.awayGoals > line)
      .reduce((sum, score) => sum + score.probability, 0);
    const underProbability = 1 - overProbability;
    const lineId = String(line).replace(".", "_");
    markets.push(
      market("total_goals", "Total de gols", `over_${lineId}`, `Mais de ${line} gols`, overProbability, line),
      market("total_goals", "Total de gols", `under_${lineId}`, `Menos de ${line} gols`, underProbability, line),
    );
  }
  markets.push(
    market("both_teams_score", "Ambas marcam", "yes", "Sim", outcomeProbabilities.bothYes),
    market("both_teams_score", "Ambas marcam", "no", "Não", outcomeProbabilities.bothNo),
  );
  return markets;
}

function parseMatchOdds(payload, fixtureId, homeTeam, awayTeam) {
  const fixtureOdds = (payload?.response || []).find((entry) => Number(entry?.fixture?.id) === fixtureId);
  const markets = new Map();
  for (const bookmaker of fixtureOdds?.bookmakers || []) {
    for (const bet of bookmaker?.bets || []) {
      const betName = String(bet.name || "").toLowerCase();
      const betId = Number(bet.id);
      const marketId = betId === 1 || ["match winner", "1x2", "fulltime result"].includes(betName)
        ? "match_winner"
        : betId === 5 || betName.includes("over/under") || betName.includes("goals over")
          ? "total_goals"
          : betId === 8 || betName.includes("both teams score")
            ? "both_teams_score"
            : "";
      if (!marketId || markets.has(marketId)) continue;

      const options = [];
      for (const value of bet.values || []) {
        const label = String(value.value || "").trim();
        const odds = Number(value.odd);
        if (!Number.isFinite(odds) || odds <= 1) continue;
        let selectionId = "";
        let selectionName = label;
        let line = null;
        if (marketId === "match_winner") {
          const normalized = label.toLowerCase();
          if (["home", homeTeam.toLowerCase()].includes(normalized)) selectionId = "home";
          else if (["draw", "tie", "x"].includes(normalized)) selectionId = "draw";
          else if (["away", awayTeam.toLowerCase()].includes(normalized)) selectionId = "away";
          selectionName = selectionId === "home" ? homeTeam : selectionId === "away" ? awayTeam : "Empate";
        } else if (marketId === "total_goals") {
          const total = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
          if (!total) continue;
          line = Number(total[2]);
          if (!Number.isFinite(line) || !Number.isInteger(line * 2)) continue;
          const side = total[1].toLowerCase();
          selectionId = `${side}_${String(line).replace(".", "_")}`;
          selectionName = `${side === "over" ? "Mais de" : "Menos de"} ${line} gols`;
        } else {
          const normalized = label.toLowerCase();
          if (["yes", "sim"].includes(normalized)) selectionId = "yes";
          else if (["no", "não", "nao"].includes(normalized)) selectionId = "no";
          selectionName = selectionId === "yes" ? "Ambas marcam · Sim" : "Ambas marcam · Não";
        }
        if (selectionId) {
          options.push({
            marketId,
            marketName: marketId === "match_winner" ? "Resultado 1X2"
              : marketId === "total_goals" ? "Total de gols" : "Ambas marcam",
            selectionId,
            selectionName,
            line,
            oddsBps: Math.round(odds * 10_000),
            bookmaker: String(bookmaker.name || ""),
          });
        }
      }
      if (options.length > 0) markets.set(marketId, options);
    }
  }
  return [...markets.values()].flat();
}

function parseWinnerOdds(payload, fixtureId, homeTeam, awayTeam) {
  const options = parseMatchOdds(payload, fixtureId, homeTeam, awayTeam);
  const home = options.find((option) => option.marketId === "match_winner" && option.selectionId === "home");
  const away = options.find((option) => option.marketId === "match_winner" && option.selectionId === "away");
  return home && away ? { homeOddsBps: home.oddsBps, awayOddsBps: away.oddsBps } : null;
}

function fixtureWinner(fixture) {
  if (!fixture || !["FT", "AET", "PEN"].includes(fixture.status)
      || !Number.isInteger(fixture.homeGoals) || !Number.isInteger(fixture.awayGoals)) return null;
  if (fixture.homeGoals === fixture.awayGoals) return "draw";
  return fixture.homeGoals > fixture.awayGoals ? "home" : "away";
}

function sportsPayoutCents(wagerCents, oddsBps) {
  if (!Number.isSafeInteger(wagerCents) || wagerCents < 100
      || !Number.isSafeInteger(oddsBps) || oddsBps <= 10_000 || oddsBps > 10_000_000) {
    throw new RangeError("Invalid sports wager.");
  }
  return Number(BigInt(wagerCents) * BigInt(oddsBps) / 10_000n);
}

function combinedOddsBps(legs) {
  if (!Array.isArray(legs) || legs.length < 1 || legs.length > 10) throw new RangeError("Invalid accumulator.");
  let odds = 10_000n;
  for (const leg of legs) {
    if (!Number.isSafeInteger(leg.oddsBps) || leg.oddsBps <= 10_000 || leg.oddsBps > 1_000_000) {
      throw new RangeError("Invalid sports odds.");
    }
    odds = odds * BigInt(leg.oddsBps) / 10_000n;
    if (odds > 10_000_000n) throw new RangeError("Accumulator odds exceed the limit.");
  }
  return Number(odds);
}

function settleSportsSelection(fixture, leg) {
  const result = fixtureWinner(fixture);
  if (!result) return null;
  if (leg.marketId === "match_winner") return result === leg.selectionId ? "won" : "lost";
  if (leg.marketId === "total_goals") {
    const line = Number(leg.line);
    if (!Number.isFinite(line) || !Number.isInteger(line * 2)) throw new RangeError("Invalid goal line.");
    const total = fixture.homeGoals + fixture.awayGoals;
    if (total === line) return "void";
    return (leg.selectionId.startsWith("over_") ? total > line : total < line) ? "won" : "lost";
  }
  if (leg.marketId === "both_teams_score") {
    const bothScored = fixture.homeGoals > 0 && fixture.awayGoals > 0;
    return (leg.selectionId === "yes") === bothScored ? "won" : "lost";
  }
  throw new RangeError("Unsupported sports market.");
}

module.exports = {
  combinedOddsBps,
  estimateMatchMarkets,
  fixtureWinner,
  parseFootballDataMatches,
  parseFixtures,
  parseMatchOdds,
  parseWinnerOdds,
  settleSportsSelection,
  sportsPayoutCents,
};