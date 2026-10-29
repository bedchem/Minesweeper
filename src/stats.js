'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const RANKED_SOLO = Object.freeze({ width: 10, height: 10, mines: 15 });
const RANKED_SOLO_DIFFICULTY = `${RANKED_SOLO.width}x${RANKED_SOLO.height}, ${RANKED_SOLO.mines} mines`;

const hasTime = game => typeof game.time === 'number' && Number.isFinite(game.time);
const isRankedSoloWin = game =>
  game.type === 'singleplayer' && game.won && hasTime(game) && game.difficulty === RANKED_SOLO_DIFFICULTY;

function filterByTimeRange(history, days, now = Date.now()) {
  if (!days) return history;
  const cutoff = now - days * DAY_MS;
  return history.filter(game => Date.parse(game.timestamp) >= cutoff);
}

function minTime(games) {
  let best = null;
  for (const game of games) if (best === null || game.time < best) best = game.time;
  return best;
}

function summarize(games) {
  if (games.length === 0) {
    return { gamesPlayed: 0, wins: 0, losses: 0, winRate: '0%', avgTime: 'N/A', bestTime: 'N/A' };
  }
  const wins = games.filter(g => g.won);
  const timedWins = wins.filter(hasTime);
  const best = minTime(timedWins);
  return {
    gamesPlayed: games.length,
    wins: wins.length,
    losses: games.length - wins.length,
    winRate: `${((wins.length / games.length) * 100).toFixed(1)}%`,
    avgTime: timedWins.length > 0
      ? `${(timedWins.reduce((sum, g) => sum + g.time, 0) / timedWins.length).toFixed(2)}s`
      : 'N/A',
    bestTime: best === null ? 'N/A' : `${best}s`
  };
}

function computeStats(history) {
  const multiplayer = history
    .filter(g => g.type === 'multiplayer')
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const singleplayer = history.filter(g => g.type === 'singleplayer');

  const mp = summarize(multiplayer);
  const sp = summarize(singleplayer);
  const combined = summarize(history);

  let currentWinStreak = 0;
  let bestWinStreak = 0;
  for (const game of multiplayer) {
    currentWinStreak = game.won ? currentWinStreak + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
  }

  const fastest = minTime(singleplayer.filter(isRankedSoloWin));
  const days = new Set(
    history.map(g => (typeof g.timestamp === 'string' ? g.timestamp.slice(0, 10) : null)).filter(Boolean)
  );

  return {
    multiplayer: {
      currentWinStreak,
      bestWinStreak,
      winRate: mp.winRate,
      averageTime: mp.avgTime,
      leaderboardPosition: 'N/A',
      gamesPlayed: mp.gamesPlayed,
      wins: mp.wins,
      losses: mp.losses
    },
    singleplayer: {
      fastestTime: fastest === null ? 'N/A' : `${fastest}s`,
      averageTime: sp.avgTime,
      leaderboardPosition: 'N/A',
      gamesPlayed: sp.gamesPlayed,
      minesHit: sp.losses,
      completedGames: sp.wins,
      failedGames: sp.losses
    },
    combined: {
      totalGamesPlayed: combined.gamesPlayed,
      overallWinRate: combined.winRate,
      bestTimeAnyMode: combined.bestTime,
      averageTime: combined.avgTime,
      totalMinesHit: mp.losses + sp.losses,
      totalWins: combined.wins,
      daysPlayed: days.size
    }
  };
}

function buildLeaderboard(users, type, days, now = Date.now()) {
  const entries = [];
  for (const user of users) {
    const history = filterByTimeRange(user.gameHistory ?? [], days, now);
    if (type === 'multiplayer') {
      const wins = history.filter(g => g.type === 'multiplayer' && g.won).length;
      if (wins > 0) entries.push({ uid: user.uid, username: user.username, value: wins });
    } else {
      const best = minTime(history.filter(isRankedSoloWin));
      if (best !== null) entries.push({ uid: user.uid, username: user.username, value: best });
    }
  }
  const direction = type === 'multiplayer' ? -1 : 1;
  entries.sort((a, b) => direction * (a.value - b.value) || a.username.localeCompare(b.username));
  return entries.map((entry, index) => ({ rank: index + 1, ...entry }));
}

function computeGlobalStats(users) {
  let totalPlayers = 0;
  let totalGamesPlayed = 0;
  let totalWins = 0;
  let totalTime = 0;
  for (const user of users) {
    totalPlayers++;
    const history = user.gameHistory ?? [];
    totalGamesPlayed += history.length;
    for (const game of history) {
      if (game.won && hasTime(game)) {
        totalWins++;
        totalTime += game.time;
      }
    }
  }
  return {
    totalPlayers,
    totalGamesPlayed,
    averageTime: totalWins > 0 ? (totalTime / totalWins).toFixed(0) : 0
  };
}

module.exports = {
  RANKED_SOLO,
  RANKED_SOLO_DIFFICULTY,
  buildLeaderboard,
  computeGlobalStats,
  computeStats,
  filterByTimeRange
};
