"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  combinedOddsBps,
  estimateMatchMarkets,
  fixtureWinner,
  parseFootballDataMatches,
  parseFixtures,
  parseMatchOdds,
  parseWinnerOdds,
  settleSportsSelection,
  sportsPayoutCents,
} = require("./sports-logic");

test("parses fixture identity, teams, status, and kickoff", () => {
  const fixtures = parseFixtures({
    response: [{
      fixture: { id: 123, date: "2026-10-01T19:00:00+00:00", status: { short: "NS" } },
      teams: { home: { name: "Time A" }, away: { name: "Time B" } },
      league: { name: "Liga Exemplo" },
      goals: { home: null, away: null },
    }],
  });
  assert.equal(fixtures[0].fixtureId, 123);
  assert.equal(fixtures[0].homeTeam, "Time A");
  assert.equal(fixtures[0].status, "NS");
});

test("extracts real 1X2, goals and both-teams-score odds", () => {
  const odds = parseWinnerOdds({
    response: [{
      fixture: { id: 123 },
      bookmakers: [{ bets: [{
        id: 1,
        name: "Match Winner",
        values: [{ value: "Home", odd: "1.75" }, { value: "Draw", odd: "3.2" }, { value: "Away", odd: "4.5" }],
      }] }],
    }],
  }, 123, "Time A", "Time B");
  assert.deepEqual(odds, { homeOddsBps: 17_500, awayOddsBps: 45_000 });
  const markets = parseMatchOdds({
    response: [{
      fixture: { id: 123 },
      bookmakers: [{ name: "Bookmaker", bets: [
        { id: 1, name: "Match Winner", values: [
          { value: "Home", odd: "1.75" }, { value: "Draw", odd: "3.2" }, { value: "Away", odd: "4.5" },
        ] },
        { id: 5, name: "Goals Over/Under", values: [
          { value: "Over 2.5", odd: "1.9" }, { value: "Under 2.5", odd: "1.8" },
        ] },
        { id: 8, name: "Both Teams Score", values: [
          { value: "Yes", odd: "1.65" }, { value: "No", odd: "2.1" },
        ] },
      ] }],
    }],
  }, 123, "Time A", "Time B");
  assert.deepEqual(markets.map((option) => option.selectionId), [
    "home", "draw", "away", "over_2_5", "under_2_5", "yes", "no",
  ]);
  assert.equal(markets[3].oddsBps, 19_000);
});

test("settles only final match results; draws are not a win", () => {
  assert.equal(fixtureWinner({ status: "NS" }), null);
  assert.equal(fixtureWinner({ status: "FT", homeGoals: 2, awayGoals: 1 }), "home");
  assert.equal(fixtureWinner({ status: "AET", homeGoals: 1, awayGoals: 2 }), "away");
  assert.equal(fixtureWinner({ status: "FT", homeGoals: 0, awayGoals: 0 }), "draw");
});

test("calculates moneyline payout in integer cents", () => {
  assert.equal(sportsPayoutCents(1_000, 17_500), 1_750);
  assert.equal(combinedOddsBps([{ oddsBps: 20_000 }, { oddsBps: 15_000 }]), 30_000);
  assert.equal(sportsPayoutCents(1_000, 30_000), 3_000);
  assert.throws(() => sportsPayoutCents(1_000, 10_000_001), RangeError);
});

test("settles result, goals and both-teams-score selections from final scores", () => {
  const fixture = { status: "FT", homeGoals: 2, awayGoals: 1 };
  assert.equal(settleSportsSelection(fixture, { marketId: "match_winner", selectionId: "draw" }), "lost");
  assert.equal(settleSportsSelection(fixture, { marketId: "total_goals", selectionId: "over_2_5", line: 2.5 }), "won");
  assert.equal(settleSportsSelection(fixture, { marketId: "both_teams_score", selectionId: "yes" }), "won");
  assert.equal(settleSportsSelection({ ...fixture, status: "NS" }, { marketId: "match_winner", selectionId: "home" }), null);
});

test("parses football-data fixtures and maps scheduled and completed statuses", () => {
  const fixtures = parseFootballDataMatches({ matches: [
    {
      id: 73001,
      utcDate: "2026-10-01T19:00:00Z",
      status: "TIMED",
      competition: { name: "Brasileirão" },
      homeTeam: { name: "Time A" },
      awayTeam: { name: "Time B" },
      score: { fullTime: { home: null, away: null } },
    },
    {
      id: 73002,
      utcDate: "2026-09-28T19:00:00Z",
      status: "FINISHED",
      competition: { name: "Brasileirão" },
      homeTeam: { name: "Time A" },
      awayTeam: { name: "Time B" },
      score: { fullTime: { home: 2, away: 1 } },
    },
  ] });
  assert.equal(fixtures[0].status, "NS");
  assert.equal(fixtures[0].fixtureId, 73001);
  assert.equal(fixtures[1].status, "FT");
  assert.equal(fixtures[1].homeGoals, 2);
});

test("estimates usable, reproducible markets from real finished scores", () => {
  const fixture = {
    fixtureId: 73003,
    kickoffMs: Date.UTC(2026, 9, 1),
    status: "NS",
    homeTeam: "Time A",
    awayTeam: "Time B",
    league: "Brasileirão",
  };
  const history = [
    { fixtureId: 1, kickoffMs: Date.UTC(2026, 8, 20), status: "FT", homeTeam: "Time A", awayTeam: "Time C", homeGoals: 3, awayGoals: 0 },
    { fixtureId: 2, kickoffMs: Date.UTC(2026, 8, 21), status: "FT", homeTeam: "Time D", awayTeam: "Time A", homeGoals: 0, awayGoals: 2 },
    { fixtureId: 3, kickoffMs: Date.UTC(2026, 8, 22), status: "FT", homeTeam: "Time B", awayTeam: "Time C", homeGoals: 0, awayGoals: 2 },
    { fixtureId: 4, kickoffMs: Date.UTC(2026, 8, 23), status: "FT", homeTeam: "Time D", awayTeam: "Time B", homeGoals: 1, awayGoals: 0 },
  ];
  const first = estimateMatchMarkets(fixture, history);
  const second = estimateMatchMarkets(fixture, history);
  assert.deepEqual(first, second);
  assert.equal(first.length, 13);
  assert.ok(first.every((market) => market.oddsBps > 10_000 && market.oddsBps <= 1_000_000));
  assert.ok(first.every((market) => market.bookmaker === "Estimativa estatística ZECA"));
  assert.ok(first.some((market) => market.selectionId === "draw"));
  assert.ok(first.some((market) => market.selectionId === "over_2_5"));
  assert.ok(first.some((market) => market.selectionId === "yes"));
});