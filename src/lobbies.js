'use strict';

const { randomInt } = require('node:crypto');
const ms = require('./minesweeper');
const { RateLimiter } = require('./activityLog');
const { cleanText, normalizeLobbyCode, toInt } = require('./validation');

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CHAT_HISTORY = 50;
const CHAT_MAX_LENGTH = 300;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

const ERR = Object.freeze({
  notFound: 'Lobby not found',
  full: 'Lobby full',
  inProgress: 'Game in progress',
  closed: 'Lobby closed',
  busy: 'Server busy'
});

class LobbyManager {
  constructor({ io, userStore, activity, logger = console, timings }) {
    this.io = io;
    this.userStore = userStore;
    this.activity = activity;
    this.logger = logger;
    this.timings = timings;
    this.lobbies = new Map();
  }

  #socketOf(member) {
    return member?.socketId ? this.io.sockets.sockets.get(member.socketId) ?? null : null;
  }

  #emitToPlayer(lobby, uid, event, payload) {
    this.#socketOf(lobby.members.get(uid))?.emit(event, payload);
  }

  #emitToPlayerAndSpectators(lobby, uid, event, payload) {
    this.#emitToPlayer(lobby, uid, event, payload);
    for (const [socketId, target] of lobby.game?.spectators ?? []) {
      if (target === uid) this.io.to(socketId).emit(event, payload);
    }
  }

  #usersForClient(lobby) {
    return [...lobby.members.values()].map(m => ({ id: m.uid, uid: m.uid, name: m.name, ready: m.ready }));
  }

  #broadcastUsers(lobby) {
    this.io.to(lobby.code).emit('updateUsers', this.#usersForClient(lobby));
  }

  #generateCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!this.lobbies.has(code)) return code;
    }
    return null;
  }

  #elapsedMs(game, ps, now = Date.now()) {
    if (ps.startTime === null) return 0;
    const end = ps.endTime ?? now;
    const pausedNow = ps.endTime === null && game.pausedAt !== null ? now - game.pausedAt : 0;
    return Math.max(0, end - ps.startTime - ps.pausedMs - pausedNow);
  }

  #pointList(board, indices) {
    return [...indices].map(i => ms.toPoint(board, i));
  }

  #cellList(board, indices) {
    return [...indices].map(i => ms.toCell(board, i));
  }

  createLobby(host, { difficulty, playerCount }) {
    const maxPlayers = toInt(playerCount);
    if (maxPlayers === null || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
      return { error: `Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}` };
    }
    if (this.lobbies.size >= this.timings.maxLobbies) return { error: ERR.busy };
    const code = this.#generateCode();
    if (!code) return { error: ERR.busy };

    const lobby = {
      code,
      hostUid: host.uid,
      hostName: host.name,
      difficulty: Object.hasOwn(ms.DIFFICULTIES, difficulty) ? difficulty : 'easy',
      maxPlayers,
      status: 'waiting',
      createdAt: Date.now(),
      members: new Map(),
      countdown: null,
      cleanupTimer: null,
      game: null,
      chat: []
    };
    this.lobbies.set(code, lobby);
    this.#scheduleCleanup(lobby);
    this.activity.add(host.name, `Lobby "${code}" erstellt`);
    return { code };
  }

  #scheduleCleanup(lobby) {
    clearTimeout(lobby.cleanupTimer);
    lobby.cleanupTimer = setTimeout(() => {
      lobby.cleanupTimer = null;
      const anyoneConnected = [...lobby.members.values()].some(m => m.connected);
      if (!anyoneConnected && lobby.status !== 'playing') this.#deleteLobby(lobby);
    }, this.timings.lobbyClearMs);
  }

  #deleteLobby(lobby) {
    clearInterval(lobby.countdown);
    clearTimeout(lobby.cleanupTimer);
    for (const ps of lobby.game?.players.values() ?? []) clearTimeout(ps.disconnectTimer);
    for (const member of lobby.members.values()) {
      const socket = this.#socketOf(member);
      if (socket?.data.lobbyCode === lobby.code) socket.data.lobbyCode = null;
    }
    this.io.socketsLeave([lobby.code, `chat:${lobby.code}`]);
    this.lobbies.delete(lobby.code);
  }

  closeLobby(code) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return false;
    this.io.to(lobby.code).emit('lobbyError', ERR.closed);
    this.#deleteLobby(lobby);
    this.activity.add('admin', `Lobby "${code}" geschlossen`);
    return true;
  }

  joinLobby(socket, rawCode) {
    const code = normalizeLobbyCode(rawCode);
    const lobby = code ? this.lobbies.get(code) : null;
    if (!lobby) return socket.emit('lobbyError', ERR.notFound);

    if (socket.data.lobbyCode && socket.data.lobbyCode !== code) this.leave(socket);

    const { uid, name } = socket.data;
    let member = lobby.members.get(uid);

    if (member) {
      if (member.socketId && member.socketId !== socket.id) {
        // reload or second tab, newest connection wins
        const old = this.#socketOf(member);
        member.socketId = socket.id;
        if (old) {
          old.data.lobbyCode = null;
          old.emit('sessionReplaced');
          old.disconnect(true);
        }
      }
      member.socketId = socket.id;
      member.connected = true;
      member.name = name;
    } else {
      if (lobby.status === 'playing') return socket.emit('lobbyError', ERR.inProgress);
      if (lobby.members.size >= lobby.maxPlayers) return socket.emit('lobbyError', ERR.full);
      member = { uid, name, socketId: socket.id, ready: false, connected: true };
      lobby.members.set(uid, member);
      if (lobby.status === 'starting') this.#cancelCountdown(lobby);
    }

    if (lobby.status === 'completed') this.#resetLobby(lobby);

    clearTimeout(lobby.cleanupTimer);
    lobby.cleanupTimer = null;
    socket.join(code);
    socket.data.lobbyCode = code;
    this.#broadcastUsers(lobby);

    if (lobby.status === 'playing' && lobby.game.players.has(uid)) socket.emit('inGameStatus', true);
  }

  #resetLobby(lobby) {
    lobby.status = 'waiting';
    lobby.game = null;
    for (const member of lobby.members.values()) member.ready = false;
  }

  leave(socket) {
    const code = socket.data.lobbyCode;
    socket.data.lobbyCode = null;
    const lobby = code ? this.lobbies.get(code) : null;
    if (!lobby) return;
    socket.leave(code);
    lobby.game?.spectators.delete(socket.id);

    const member = lobby.members.get(socket.data.uid);
    if (!member || member.socketId !== socket.id) return;

    const ps = lobby.status === 'playing' ? lobby.game.players.get(member.uid) : null;
    if (ps) {
      member.connected = false;
      member.socketId = null;
      if (ps.status === 'alive') this.#startReconnectWindow(lobby, ps);
      if (![...lobby.members.values()].some(m => m.connected)) this.#scheduleCleanup(lobby);
      return;
    }

    lobby.members.delete(member.uid);
    if (lobby.status === 'starting') this.#cancelCountdown(lobby);
    if (lobby.hostUid === member.uid) {
      const next = lobby.members.values().next().value;
      if (next) {
        lobby.hostUid = next.uid;
        lobby.hostName = next.name;
      }
    }
    if (lobby.members.size === 0) {
      this.#scheduleCleanup(lobby);
    } else {
      this.#broadcastUsers(lobby);
      this.io.to(lobby.code).emit('userLeft', member.uid);
    }
  }

  toggleReady(socket) {
    const lobby = this.lobbies.get(socket.data.lobbyCode);
    const member = lobby?.members.get(socket.data.uid);
    if (!member || member.socketId !== socket.id) return;
    if (lobby.status !== 'waiting' && lobby.status !== 'starting') return;

    member.ready = !member.ready;
    this.#broadcastUsers(lobby);

    if (!member.ready && lobby.status === 'starting') {
      this.#cancelCountdown(lobby);
      return;
    }
    const members = [...lobby.members.values()];
    if (lobby.status === 'waiting' && members.length >= MIN_PLAYERS && members.every(m => m.ready && m.connected)) {
      this.#startCountdown(lobby);
    }
  }

  #cancelCountdown(lobby) {
    clearInterval(lobby.countdown);
    lobby.countdown = null;
    lobby.status = 'waiting';
    this.io.to(lobby.code).emit('countdown', -1);
  }

  #startCountdown(lobby) {
    lobby.status = 'starting';
    let remaining = 3;
    this.io.to(lobby.code).emit('countdown', remaining);
    lobby.countdown = setInterval(() => {
      remaining--;
      this.io.to(lobby.code).emit('countdown', remaining);
      if (remaining <= 0) {
        clearInterval(lobby.countdown);
        lobby.countdown = null;
        this.#safe(() => this.#startGame(lobby));
      }
    }, this.timings.countdownTickMs);
  }

  #startGame(lobby) {
    if (lobby.status !== 'starting' || !this.lobbies.has(lobby.code)) return;
    const { rows, cols, mines } = ms.DIFFICULTIES[lobby.difficulty];
    const startX = randomInt(cols);
    const startY = randomInt(rows);
    const board = ms.createBoard(rows, cols, mines, startX, startY);
    const initial = ms.floodReveal(board, startY * cols + startX);
    const now = Date.now();

    const players = new Map();
    for (const member of lobby.members.values()) {
      member.ready = false;
      players.set(member.uid, {
        uid: member.uid,
        name: member.name,
        revealed: new Set(initial),
        flags: new Set(),
        initialCount: initial.length,
        status: 'alive',
        progress: 0,
        startTime: now,
        endTime: null,
        pausedMs: 0,
        penaltyMs: 0,
        disconnectTimer: null
      });
    }

    lobby.status = 'playing';
    lobby.game = { board, players, pausedAt: null, waitingFor: new Set(), spectators: new Map() };

    this.io.to(lobby.code).emit('startGame', {
      rows,
      cols,
      mines,
      initialRevealed: this.#cellList(board, initial),
      users: [...players.values()].map(p => ({ id: p.uid, name: p.name }))
    });
  }

  #activePlayer(socket) {
    const lobby = this.lobbies.get(socket.data.lobbyCode);
    if (!lobby || lobby.status !== 'playing' || lobby.game.pausedAt !== null) return null;
    const member = lobby.members.get(socket.data.uid);
    const ps = lobby.game.players.get(socket.data.uid);
    if (!member || member.socketId !== socket.id || !ps || ps.status !== 'alive') return null;
    return { lobby, game: lobby.game, board: lobby.game.board, ps };
  }

  revealCell(socket, { x, y } = {}) {
    const ctx = this.#activePlayer(socket);
    if (!ctx) return;
    const index = ms.toIndex(ctx.board, x, y);
    if (index < 0 || ctx.ps.revealed.has(index) || ctx.ps.flags.has(index)) return;

    if (ms.isMine(ctx.board, index)) return this.#playerDied(ctx, index);
    const added = ms.floodReveal(ctx.board, index, ctx.ps.revealed, ctx.ps.flags);
    this.#afterReveal(ctx, added);
  }

  chordReveal(socket, { x, y } = {}) {
    const ctx = this.#activePlayer(socket);
    if (!ctx) return;
    const { board, ps } = ctx;
    const index = ms.toIndex(board, x, y);
    if (index < 0 || !ps.revealed.has(index)) return;
    const value = board.values[index];
    if (value <= 0) return;

    const around = ms.neighbors(board, index);
    if (around.filter(n => ps.flags.has(n)).length !== value) return;
    const targets = around.filter(n => !ps.flags.has(n) && !ps.revealed.has(n));
    const mine = targets.find(n => ms.isMine(board, n));
    if (mine !== undefined) return this.#playerDied(ctx, mine);

    const added = targets.flatMap(n => ms.floodReveal(board, n, ps.revealed, ps.flags));
    this.#afterReveal(ctx, added);
  }

  placeFlag(socket, { x, y } = {}) {
    const ctx = this.#activePlayer(socket);
    if (!ctx) return;
    const { lobby, board, ps } = ctx;
    const index = ms.toIndex(board, x, y);
    if (index < 0 || ps.revealed.has(index)) return;

    let flagged;
    if (ps.flags.has(index)) {
      ps.flags.delete(index);
      flagged = false;
    } else {
      if (ps.flags.size >= board.mines) return;
      ps.flags.add(index);
      flagged = true;
    }
    this.#emitToPlayerAndSpectators(lobby, ps.uid, 'flagUpdate', {
      userId: ps.uid,
      x,
      y,
      flagged,
      flagsLeft: board.mines - ps.flags.size
    });
  }

  #afterReveal({ lobby, board, ps }, added) {
    if (added.length === 0) return;
    ps.progress = ms.calculateProgress(board, ps.revealed.size, ps.initialCount);
    this.#emitToPlayerAndSpectators(lobby, ps.uid, 'gameUpdate', { cells: this.#cellList(board, added) });
    this.#broadcastProgress(lobby);

    if (ps.revealed.size === ms.safeCellCount(board)) {
      ps.status = 'finished';
      ps.progress = 100;
      ps.endTime = Date.now();
      this.io.to(lobby.code).emit('playerStatusChanged', { playerId: ps.uid, status: 'finished' });
      this.#checkCompletion(lobby);
    }
  }

  #playerDied({ lobby, board, ps }, mineIndex) {
    ps.status = 'dead';
    ps.endTime = Date.now();
    this.#emitToPlayer(lobby, ps.uid, 'playerFailed', ms.toPoint(board, mineIndex));
    this.io.to(lobby.code).emit('playerStatusChanged', { playerId: ps.uid, status: 'dead' });
    this.#checkCompletion(lobby);
  }

  #broadcastProgress(lobby) {
    if (!lobby.game) return;
    const progress = [...lobby.game.players.values()].map(p => ({ id: p.uid, name: p.name, progress: p.progress }));
    this.io.to(lobby.code).emit('progressUpdate', progress);
  }

  spectate(socket, targetId) {
    const lobby = this.lobbies.get(socket.data.lobbyCode);
    if (!lobby || lobby.status !== 'playing') return;
    const { game } = lobby;
    const viewer = game.players.get(socket.data.uid);
    if (viewer && viewer.status === 'alive') return;
    const target = typeof targetId === 'string' ? game.players.get(targetId) : null;
    if (!target || target.status !== 'alive') return;

    game.spectators.set(socket.id, target.uid);
    socket.emit('spectateUpdate', {
      rows: game.board.rows,
      cols: game.board.cols,
      cells: this.#cellList(game.board, target.revealed),
      flags: this.#pointList(game.board, target.flags),
      time: Math.floor(this.#elapsedMs(game, target) / 1000),
      flagsLeft: game.board.mines - target.flags.size
    });
  }

  #startReconnectWindow(lobby, ps) {
    const { game } = lobby;
    clearTimeout(ps.disconnectTimer);
    game.waitingFor.add(ps.uid);
    if (game.pausedAt === null) game.pausedAt = Date.now();
    this.io.to(lobby.code).emit('gamePaused', {
      playerId: ps.uid,
      timeout: Math.round(this.timings.reconnectTimeoutMs / 1000)
    });
    ps.disconnectTimer = setTimeout(() => this.#safe(() => this.#forfeit(lobby, ps)), this.timings.reconnectTimeoutMs);
  }

  #resume(lobby) {
    const { game } = lobby;
    if (game.pausedAt === null) return false;
    const paused = Date.now() - game.pausedAt;
    for (const ps of game.players.values()) {
      if (ps.endTime === null) ps.pausedMs += paused;
    }
    game.pausedAt = null;
    return true;
  }

  #forfeit(lobby, ps) {
    ps.disconnectTimer = null;
    if (lobby.status !== 'playing' || lobby.game.players.get(ps.uid) !== ps) return;
    const { game } = lobby;
    game.waitingFor.delete(ps.uid);
    if (ps.status === 'alive') ps.status = 'disconnected';
    if (game.waitingFor.size === 0) this.#resume(lobby);
    this.io.to(lobby.code).emit('playerDisconnected', { playerId: ps.uid, timeout: true });
    this.io.to(lobby.code).emit('playerStatusChanged', { playerId: ps.uid, status: 'disconnected' });
    this.#checkCompletion(lobby);
  }

  requestReconnect(socket) {
    const lobby = this.lobbies.get(socket.data.lobbyCode);
    if (!lobby || lobby.status !== 'playing') return;
    const member = lobby.members.get(socket.data.uid);
    const ps = lobby.game.players.get(socket.data.uid);
    if (!member || member.socketId !== socket.id || !ps) return;
    const { game } = lobby;

    clearTimeout(ps.disconnectTimer);
    ps.disconnectTimer = null;
    game.waitingFor.delete(ps.uid);
    if (ps.status === 'disconnected') {
      ps.status = 'alive';
      this.io.to(lobby.code).emit('playerStatusChanged', { playerId: ps.uid, status: 'alive' });
    }
    const alive = ps.status === 'alive';
    if (alive) ps.penaltyMs += this.timings.reconnectPenaltyMs;
    const resumed = game.waitingFor.size === 0 && this.#resume(lobby);

    socket.emit('reconnectGameData', {
      rows: game.board.rows,
      cols: game.board.cols,
      mines: game.board.mines,
      cells: this.#cellList(game.board, ps.revealed),
      flags: this.#pointList(game.board, ps.flags),
      users: [...game.players.values()].map(p => ({ id: p.uid, name: p.name, status: p.status })),
      elapsedMs: this.#elapsedMs(game, ps),
      penalty: ps.penaltyMs,
      isPaused: game.pausedAt !== null,
      isDead: !alive
    });
    if (resumed) {
      this.io.to(lobby.code).emit('gameResumed', {
        reconnectedPlayerId: ps.uid,
        penalty: alive ? this.timings.reconnectPenaltyMs / 1000 : 0
      });
    }
    this.#broadcastProgress(lobby);
    if (!alive) this.#checkCompletion(lobby);
  }

  #checkCompletion(lobby) {
    if (lobby.status !== 'playing') return;
    const players = [...lobby.game.players.values()];
    if (players.every(p => p.status !== 'alive')) return this.#endGame(lobby);

    this.io.to(lobby.code).emit('intermediatePodium', {
      finishedPlayers: players
        .filter(p => p.status === 'finished')
        .map(p => ({ id: p.uid, name: p.name, status: 'winner', time: Math.floor(this.#elapsedMs(lobby.game, p) / 1000), progress: p.progress })),
      playingPlayers: players.filter(p => p.status === 'alive').map(p => ({ id: p.uid, name: p.name }))
    });
  }

  #endGame(lobby) {
    const { game } = lobby;
    const now = Date.now();
    this.#resume(lobby);

    const results = [...game.players.values()].map(ps => {
      clearTimeout(ps.disconnectTimer);
      ps.disconnectTimer = null;
      const baseTime = Math.floor(this.#elapsedMs(game, ps, now) / 1000);
      const penalty = Math.floor(ps.penaltyMs / 1000);
      return {
        id: ps.uid,
        name: ps.name,
        boardStatus: ps.status,
        time: baseTime + penalty,
        totalTime: baseTime + penalty,
        baseTime,
        penalty,
        progress: ps.progress
      };
    });

    // best progress wins, time breaks ties, leavers can't win
    const eligible = results.filter(r => r.boardStatus !== 'disconnected');
    const winners = new Set();
    if (eligible.length > 0) {
      const bestProgress = Math.max(...eligible.map(r => r.progress));
      const top = eligible.filter(r => r.progress === bestProgress);
      const bestTime = Math.min(...top.map(r => r.time));
      for (const r of top) if (r.time === bestTime) winners.add(r.id);
    }
    const finalResults = results.map(r => ({ ...r, won: winners.has(r.id), status: winners.has(r.id) ? 'winner' : 'loser' }));

    lobby.status = 'completed';
    game.spectators.clear();
    this.io.to(lobby.code).emit('gameOver', { results: finalResults, grid: ms.toGrid(game.board) });

    const timestamp = new Date(now).toISOString();
    for (const r of finalResults) {
      this.userStore
        .addGameResult(r.id, {
          type: 'multiplayer',
          difficulty: lobby.difficulty,
          players: finalResults.length,
          timestamp,
          won: r.won,
          time: r.time,
          progress: r.progress
        })
        .catch(err => this.logger.error(`Failed to save game result for ${r.id}:`, err));
    }
    const winnerNames = finalResults.filter(r => r.won).map(r => r.name).join(', ') || '–';
    this.activity.add(winnerNames, `Spiel in Lobby "${lobby.code}" gewonnen`);

    for (const member of [...lobby.members.values()]) {
      if (!member.connected) lobby.members.delete(member.uid);
    }
    if (lobby.members.size === 0) this.#scheduleCleanup(lobby);
    else this.#broadcastUsers(lobby);
  }

  chatJoin(socket, rawCode) {
    const code = normalizeLobbyCode(rawCode);
    const lobby = code ? this.lobbies.get(code) : null;
    if (!lobby) return;
    if (socket.data.chatCode && socket.data.chatCode !== code) socket.leave(`chat:${socket.data.chatCode}`);
    const rejoin = socket.data.chatCode === code;
    socket.data.chatCode = code;
    socket.join(`chat:${code}`);
    for (const message of lobby.chat) socket.emit('lobbyChatMessage', message);
    socket.emit('lobbyChatJoined');
    if (!rejoin) this.#systemMessage(socket, code, `${socket.data.name} joined.`);
  }

  chatMessage(socket, payload = {}) {
    const code = socket.data.chatCode;
    const lobby = code ? this.lobbies.get(code) : null;
    if (!lobby) return;
    const message = cleanText(payload.message, CHAT_MAX_LENGTH);
    if (!message) return;
    socket.data.chatLimiter ??= new RateLimiter(5, 5000);
    if (!socket.data.chatLimiter.allow()) return socket.emit('lobbyChatError', 'You are sending messages too fast');

    const entry = { username: socket.data.name, uid: socket.data.uid, message, timestamp: Date.now() };
    lobby.chat.push(entry);
    if (lobby.chat.length > CHAT_HISTORY) lobby.chat.shift();
    this.io.to(`chat:${code}`).emit('lobbyChatMessage', entry);
  }

  #systemMessage(socket, code, message) {
    socket.to(`chat:${code}`).emit('lobbyChatMessage', { type: 'system', message, timestamp: Date.now() });
  }

  chatLeave(socket) {
    const code = socket.data.chatCode;
    if (!code) return;
    socket.data.chatCode = null;
    if (this.lobbies.has(code)) this.#systemMessage(socket, code, `${socket.data.name} left.`);
  }

  summaries() {
    return [...this.lobbies.values()].map(l => ({
      code: l.code,
      players: l.members.size,
      maxPlayers: l.maxPlayers,
      difficulty: l.difficulty,
      status: l.status,
      host: l.hostName
    }));
  }

  #safe(fn) {
    try {
      fn();
    } catch (err) {
      this.logger.error('Lobby error:', err);
    }
  }
}

function registerLobbyHandlers(socket, manager) {
  const lobbyLimiter = new RateLimiter(3, 10_000);
  const moveLimiter = new RateLimiter(40, 1000);

  const on = (event, handler, limiter = null) => {
    socket.on(event, (...args) => {
      socket.data.lastActivity = Date.now();
      if (limiter && !limiter.allow()) return;
      try {
        handler(...args);
      } catch (err) {
        manager.logger.error(`Error in "${event}" handler:`, err);
      }
    });
  };

  on('createLobby', payload => {
    const result = manager.createLobby(socket.data, payload ?? {});
    if (result.error) socket.emit('lobbyError', result.error);
    else socket.emit('lobbyCreated', result.code);
  }, lobbyLimiter);
  on('joinLobby', payload => manager.joinLobby(socket, payload?.code), lobbyLimiter);
  on('readyUp', () => manager.toggleReady(socket), moveLimiter);
  on('requestReconnectGameData', () => manager.requestReconnect(socket), lobbyLimiter);
  on('revealCell', payload => manager.revealCell(socket, payload ?? {}), moveLimiter);
  on('chordReveal', payload => manager.chordReveal(socket, payload ?? {}), moveLimiter);
  on('placeFlag', payload => manager.placeFlag(socket, payload ?? {}), moveLimiter);
  on('spectatePlayer', targetId => manager.spectate(socket, targetId), moveLimiter);
  on('lobbyChatJoin', payload => manager.chatJoin(socket, payload?.lobby), lobbyLimiter);
  on('lobbyChatMessage', payload => manager.chatMessage(socket, payload ?? {}));

  socket.on('disconnect', () => {
    try {
      manager.chatLeave(socket);
      manager.leave(socket);
    } catch (err) {
      manager.logger.error('Error while handling disconnect:', err);
    }
  });
}

module.exports = { LobbyManager, registerLobbyHandlers, ERR };
