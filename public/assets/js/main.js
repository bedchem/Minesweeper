
const socket = io({
  autoConnect: false,
  auth: (cb) => {
    const user = firebase.auth().currentUser;
    if (!user) return cb({});
    user.getIdToken().then((token) => cb({ token }), () => cb({}));
  }
});

let username = null;
let myId = null;
let rows = 0;
let cols = 0;
let cellEls = [];
let playerStatus = 'alive';
let spectating = false;
let spectatedPlayerId = null;
let alivePlayers = [];
let spectateTimerInterval = null;
let disconnectModalInterval = null;
let disconnectCountdown = 10;
const playerNames = new Map();
// players the server is waiting for while the game is paused
const pausedFor = new Set();

const gameTimer = {
  startTime: null,
  pauseStart: null,
  pausedDuration: 0,
  penaltySeconds: 0,
  interval: null,
  isPaused: false
};

const LOBBY_ERRORS = {
  'Lobby not found': 'lobby_not_found',
  'Lobby full': 'lobby_full',
  'Name taken': 'name_taken',
  'Game in progress': 'game_in_progress',
  'Lobby closed': 'lobby_closed',
  'You are already in too many lobbies': 'too_many_lobbies'
};

const LOBBY_ERROR_TEXT = {
  lobby_not_found: (code) => (code ? `Lobby ${code} not found` : 'Lobby not found'),
  lobby_full: () => 'Lobby is full',
  name_taken: () => 'Name is already taken in this lobby',
  game_in_progress: () => 'This game has already started',
  lobby_closed: () => 'The lobby was closed',
  too_many_lobbies: () => 'You are already in too many lobbies'
};

const isLobbyCreationPage = /^\/lobbycreation(\.html)?\/?$/.test(window.location.pathname);
const isLobbyPage = window.location.pathname.startsWith('/lobby/');

const validateCode = (code) => /^[A-Z0-9]{4}$/.test(code);
const avatarUrl = (uid) => (uid ? `/avatar/${encodeURIComponent(uid)}` : '/assets/images/icon.png');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function notify(message, type = 'error') {
  if (typeof showCustomAlert === 'function') showCustomAlert(message, type);
  else console.warn(message);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

socket.on('authInitSuccess', ({ name, uid }) => {
  username = name;
  myId = uid;
});

function waitForUsername() {
  if (username) return Promise.resolve(username);
  return new Promise((resolve) => socket.once('authInitSuccess', ({ name }) => resolve(name)));
}

firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    if (!socket.active) socket.connect();
  } else {
    socket.disconnect();
  }
});

// socket.io keeps retrying on its own; tell the player once instead of leaving the page silently waiting
let retryNoticeShown = false;
socket.on('connect', () => {
  retryNoticeShown = false;
});

socket.on('connect_error', (err) => {
  console.error('Socket connection failed:', err.message);
  if (socket.active) {
    if (!retryNoticeShown) notify('Cannot reach the game server, retrying...', 'info');
    retryNoticeShown = true;
    return;
  }
  notify(err.message === 'User data not found'
    ? 'Your account data was not found. Please log in again.'
    : 'Could not connect to the game server. Please reload the page.');
});

socket.on('sessionReplaced', () => notify('This lobby was opened in another tab.', 'info'));

function showLobbyErrorFromUrl(codeError) {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (!error || !codeError) return;
  const code = (params.get('code') || '').toUpperCase();
  const text = Object.hasOwn(LOBBY_ERROR_TEXT, error) ? LOBBY_ERROR_TEXT[error] : null;
  if (text) codeError.textContent = text(validateCode(code) ? code : '');
  window.history.replaceState({}, document.title, window.location.pathname);
}

function renderLobbyBrowser(lobbies) {
  const list = document.getElementById('lobbyList');
  const noLobbiesMessage = document.getElementById('noLobbiesMessage');
  list.replaceChildren();
  noLobbiesMessage.style.display = lobbies.length === 0 ? 'block' : 'none';
  list.style.display = lobbies.length === 0 ? 'none' : 'block';

  for (const lobby of lobbies) {
    const item = el('div', 'lobby-item');
    item.dataset.code = lobby.code;
    item.append(
      el('div', 'lobby-host', `Host: ${lobby.host}`),
      el('div', 'lobby-players', `Players: ${lobby.players}/${lobby.maxPlayers}`),
      el('div', 'lobby-difficulty', `Difficulty: ${lobby.difficulty}`),
      el('div', 'lobby-code', `Code: ${lobby.code}`)
    );
    const join = el('button', 'join-lobby-btn', 'Join');
    join.addEventListener('click', () => {
      window.location.href = `/lobby/${encodeURIComponent(lobby.code)}`;
    });
    item.append(join);
    list.append(item);
  }
}

function initLobbyCreationPage() {
  const codeInput = document.getElementById('lobbyCode');
  const codeError = document.getElementById('codeError');
  const difficultyModal = document.getElementById('difficultyModal');
  const browserModal = document.getElementById('lobbyBrowserModal');
  const playerCountInput = document.getElementById('playerCount');
  const confirmCreate = document.getElementById('confirmCreate');
  // one create at a time: a second create would replace the lobby we are about to be redirected to
  let creating = false;
  const setCreating = (value) => {
    creating = value;
    confirmCreate.disabled = value;
  };

  showLobbyErrorFromUrl(codeError);

  socket.on('lobbyCreated', (code) => {
    window.location.href = `/lobby/${encodeURIComponent(code)}`;
  });
  socket.on('lobbyError', (message) => {
    setCreating(false);
    codeError.textContent = message;
  });
  socket.on('connect_error', () => {
    if (!socket.active) setCreating(false);
  });
  // coming back with the browser's back button restores the page as it was left
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) setCreating(false);
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
    codeError.textContent = '';
  });

  playerCountInput.addEventListener('input', () => {
    const value = parseInt(playerCountInput.value, 10);
    if (Number.isNaN(value)) return;
    playerCountInput.value = Math.min(Number(playerCountInput.max), Math.max(Number(playerCountInput.min), value));
  });

  document.getElementById('browseLobbies').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/lobbies');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderLobbyBrowser(await response.json());
    } catch (error) {
      console.error('Error fetching lobbies:', error);
      const list = document.getElementById('lobbyList');
      document.getElementById('noLobbiesMessage').style.display = 'none';
      list.style.display = 'block';
      list.replaceChildren(el('div', 'error', 'Failed to load lobbies'));
    }
    browserModal.classList.add('visible');
  });

  document.getElementById('closeLobbyBrowser').addEventListener('click', () => browserModal.classList.remove('visible'));
  document.getElementById('createLobby').addEventListener('click', () => difficultyModal.classList.add('visible'));
  document.getElementById('exitmodalD').addEventListener('click', () => difficultyModal.classList.remove('visible'));

  confirmCreate.addEventListener('click', async () => {
    if (creating) return;
    setCreating(true);
    const difficulty = document.getElementById('difficultySelect').value;
    const playerCount = parseInt(playerCountInput.value, 10);
    codeError.textContent = '';
    await waitForUsername();
    socket.emit('createLobby', { difficulty, playerCount });
    difficultyModal.classList.remove('visible');
  });

  document.getElementById('joinLobby').addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!validateCode(code)) {
      codeError.textContent = 'Code must be 4 characters (A-Z, 0-9)';
      return;
    }
    window.location.href = `/lobby/${code}`;
  });
}

function setReadyButton(mode) {
  const readyBtn = document.getElementById('readyUp');
  if (!readyBtn) return;
  readyBtn.disabled = false;
  if (mode === 'reconnect') {
    readyBtn.textContent = 'Reconnect';
    readyBtn.onclick = () => {
      readyBtn.disabled = true;
      socket.emit('requestReconnectGameData');
    };
  } else {
    readyBtn.textContent = 'Ready Up';
    readyBtn.onclick = () => socket.emit('readyUp');
  }
}

function initLobbyPage() {
  const code = window.location.pathname.split('/').pop().toUpperCase();
  setReadyButton('ready');

  const codeDisplay = document.getElementById('lobbyCodeDisplay');
  if (codeDisplay) {
    codeDisplay.textContent = code;
    codeDisplay.addEventListener('click', () => {
      navigator.clipboard?.writeText(code);
      codeDisplay.classList.add('copied');
      setTimeout(() => codeDisplay.classList.remove('copied'), 800);
    });
  }

  if (!validateCode(code)) {
    window.location.href = `/lobbycreation?error=lobby_not_found`;
    return;
  }

  socket.on('connect', () => socket.emit('joinLobby', { code }));
  // the server throttled us (e.g. many reloads); joining again also restarts a reconnect into a running game
  socket.on('lobbyRetry', (ms) => {
    setTimeout(() => {
      if (socket.connected) socket.emit('joinLobby', { code });
    }, Math.max(500, Number(ms) || 2000));
  });

  socket.on('lobbyError', (message) => {
    const error = Object.hasOwn(LOBBY_ERRORS, message) ? LOBBY_ERRORS[message] : null;
    if (!error) return notify(message);
    window.location.href = `/lobbycreation?error=${error}&code=${encodeURIComponent(code)}`;
  });

  socket.on('inGameStatus', (inGame) => {
    if (!inGame) return setReadyButton('ready');
    // lost connection mid game -> jump straight back in
    if (document.getElementById('gameContainer')) socket.emit('requestReconnectGameData');
    else setReadyButton('reconnect');
  });

  socket.on('updateUsers', updatePlayerList);
  socket.on('countdown', handleCountdown);
  socket.on('userLeft', handleUserLeft);
  socket.on('startGame', startGameHandler);
  socket.on('intermediatePodium', handleIntermediatePodium);
  socket.on('gameUpdate', handleGameUpdate);
  socket.on('playerFailed', handlePlayerFailed);
  socket.on('flagUpdate', handleFlagUpdate);
  socket.on('progressUpdate', handleProgressUpdate);
  socket.on('gameOver', handleGameOver);
  socket.on('playerStatusChanged', handlePlayerStatusChanged);
  socket.on('spectateUpdate', handleSpectateUpdate);
  socket.on('gamePaused', handleGamePaused);
  socket.on('gameResumed', handleGameResumed);
  socket.on('playerReconnected', ({ playerId }) => stopWaitingFor(playerId));
  socket.on('playerDisconnected', handlePlayerDisconnected);
  socket.on('reconnectGameData', reconnectGameHandler);
}

function rememberNames(users) {
  for (const user of users) playerNames.set(user.id, user.name);
}

function getPlayerName(playerId) {
  return playerNames.get(playerId) || 'Opponent';
}

function updatePlayerList(users) {
  rememberNames(users);
  const list = document.getElementById('playerList');
  if (list) {
    list.replaceChildren(...users.map((user) => {
      const item = el('li', user.ready ? 'ready' : '');
      item.dataset.id = user.id;
      const avatar = el('img', 'player-avatar');
      avatar.src = avatarUrl(user.uid);
      avatar.alt = 'avatar';
      item.append(avatar, el('span', 'player-name-text', user.name));
      if (user.ready) item.append('✅');
      return item;
    }));
  }
  const statusEl = document.getElementById('lobbyStatus');
  if (statusEl) {
    if (users.length < 2) statusEl.textContent = 'Waiting for players...';
    else if (!users.every((u) => u.ready)) statusEl.textContent = 'All players must ready up!';
    else statusEl.textContent = '';
  }
}

function handleCountdown(seconds) {
  const timer = document.getElementById('lobbyStatus');
  if (!timer) return;
  if (seconds === -1) {
    timer.style.fontSize = '';
    timer.style.color = '';
    timer.textContent = 'All players must ready up!';
    return;
  }
  if (seconds > 0) {
    timer.style.fontSize = '1.5rem';
    timer.style.color = '#add8e6';
    timer.textContent = `Starting in ${seconds}...`;
  }
}

function handleUserLeft(userId) {
  const container = document.querySelector(`.progress-container[data-userid="${CSS.escape(userId)}"]`);
  if (!container) return;
  container.remove();
  document.querySelectorAll('.progress-row').forEach((row) => {
    if (row.children.length === 1) {
      row.style.justifyContent = 'flex-start';
      row.firstElementChild.style.flex = '1 0 100%';
    }
  });
}

function startTimer() {
  stopTimer();
  gameTimer.startTime = Date.now();
  gameTimer.pausedDuration = 0;
  gameTimer.penaltySeconds = 0;
  gameTimer.pauseStart = null;
  gameTimer.isPaused = false;
  gameTimer.interval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

function pauseTimer() {
  if (gameTimer.isPaused || playerStatus !== 'alive') return;
  clearInterval(gameTimer.interval);
  gameTimer.interval = null;
  gameTimer.pauseStart = Date.now();
  gameTimer.isPaused = true;
}

function resumeTimer() {
  if (!gameTimer.isPaused || playerStatus !== 'alive') return;
  if (gameTimer.pauseStart) {
    gameTimer.pausedDuration += Date.now() - gameTimer.pauseStart;
    gameTimer.pauseStart = null;
  }
  gameTimer.isPaused = false;
  clearInterval(gameTimer.interval);
  gameTimer.interval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

function stopTimer() {
  clearInterval(gameTimer.interval);
  gameTimer.interval = null;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const timerEl = document.getElementById('gameTimer');
  if (!timerEl) return;
  let elapsedSeconds = 0;
  if (gameTimer.startTime) {
    const pausedNow = gameTimer.isPaused && gameTimer.pauseStart ? Date.now() - gameTimer.pauseStart : 0;
    elapsedSeconds = Math.max(0, Math.floor((Date.now() - gameTimer.startTime - gameTimer.pausedDuration - pausedNow) / 1000));
  }
  timerEl.textContent = `Time: ${elapsedSeconds}s`;
  if (gameTimer.penaltySeconds > 0) timerEl.append(el('span', 'penalty-display', `+${gameTimer.penaltySeconds}`));
}

function createProgressBars(currentUserId, users) {
  const currentUser = users.find((u) => u.id === currentUserId);
  const players = [currentUser, ...users.filter((u) => u.id !== currentUserId)].filter(Boolean);
  const rowsHtml = [];
  for (let i = 0; i < players.length; i += 2) {
    rowsHtml.push(`
        <div class="progress-row">
          ${players.slice(i, i + 2).map((player) => `
            <div class="progress-container" data-userid="${escapeHtml(player.id)}">
              <div class="progress-label">
                ${player.id === currentUserId ? 'You' : escapeHtml(player.name)}
              </div>
              <progress class="progress-bar" value="0" max="100"></progress>
            </div>
          `).join('')}
        </div>
      `);
  }
  return `<div class="progress-rows-container">${rowsHtml.join('')}</div>`;
}

function createGameContainer(users, flagsLeft) {
  document.getElementById('gameContainer')?.remove();
  const contentBox = document.querySelector('.content-box');
  if (contentBox) contentBox.style.display = 'none';
  document.querySelector('.container').insertAdjacentHTML('beforeend', `
    <div id="gameContainer">
      <div id="header">
        ${createProgressBars(myId, users)}
        <div class="middle-container">
          <div id="gameTimer">Time: 0 s</div>
          <div id="flagCounter">Flags left: ${Number(flagsLeft)}</div>
        </div>
      </div>
      <div id="minesweeperGrid"></div>
    </div>
  `);
  const gridElement = document.getElementById('minesweeperGrid');
  installGridHandlers(gridElement);
  return gridElement;
}

function cellAt(x, y) {
  return cellEls[y]?.[x] ?? null;
}

function revealCellEl({ x, y, value }) {
  const cell = cellAt(x, y);
  if (!cell) return;
  cell.classList.remove('flagged');
  cell.classList.add('revealed');
  cell.textContent = value || '';
  if (value === 'X') cell.classList.add('mine');
}

function setFlag(x, y, flagged) {
  const cell = cellAt(x, y);
  if (!cell || cell.classList.contains('revealed')) return;
  cell.classList.toggle('flagged', flagged);
  cell.textContent = flagged ? '🚩' : '';
}

function renderGrid(gridElement, r, c, cells = [], flags = []) {
  rows = r;
  cols = c;
  cellEls = [];
  const fragment = document.createDocumentFragment();
  for (let y = 0; y < rows; y++) {
    const row = el('div', 'gridRow');
    const rowCells = [];
    for (let x = 0; x < cols; x++) {
      const cell = el('div', 'gridCell');
      cell.dataset.x = x;
      cell.dataset.y = y;
      row.append(cell);
      rowCells.push(cell);
    }
    cellEls.push(rowCells);
    fragment.append(row);
  }
  gridElement.replaceChildren(fragment);
  cells.forEach(revealCellEl);
  flags.forEach(({ x, y }) => setFlag(x, y, true));
}

function installGridHandlers(gridElement) {
  let leftDown = false;
  let rightDown = false;
  const canPlay = () => playerStatus === 'alive' && !spectating && !gameTimer.isPaused;
  const cellOf = (event) => event.target.closest('.gridCell');
  const coords = (cell) => ({ x: Number(cell.dataset.x), y: Number(cell.dataset.y) });
  const clearHighlight = () => gridElement.querySelectorAll('.chord-highlight').forEach((c) => c.classList.remove('chord-highlight'));

  gridElement.addEventListener('click', (event) => {
    const cell = cellOf(event);
    if (!cell || !canPlay() || cell.classList.contains('revealed') || cell.classList.contains('flagged')) return;
    socket.emit('revealCell', coords(cell));
  });

  gridElement.addEventListener('contextmenu', (event) => {
    const cell = cellOf(event);
    if (!cell) return;
    event.preventDefault();
    if (!canPlay()) return;
    socket.emit(cell.classList.contains('revealed') ? 'chordReveal' : 'placeFlag', coords(cell));
  });

  gridElement.addEventListener('mousedown', (event) => {
    const cell = cellOf(event);
    if (!cell) return;
    if (event.button === 0) leftDown = true;
    if (event.button === 2) rightDown = true;
    const number = Number(cell.textContent);
    if (!leftDown || !rightDown || !cell.classList.contains('revealed') || !(number > 0)) return;
    const { x, y } = coords(cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbour = cellAt(x + dx, y + dy);
        if (neighbour && !neighbour.classList.contains('revealed') && !neighbour.classList.contains('flagged')) {
          neighbour.classList.add('chord-highlight');
        }
      }
    }
  });

  gridElement.addEventListener('mouseup', (event) => {
    if (event.button === 0) leftDown = false;
    if (event.button === 2) rightDown = false;
    clearHighlight();
  });

  gridElement.addEventListener('mouseleave', () => {
    leftDown = false;
    rightDown = false;
    clearHighlight();
  });
}

function revealFullGrid(grid) {
  grid.forEach((row, y) => row.forEach((value, x) => revealCellEl({ x, y, value })));
}

function startGameHandler({ rows: r, cols: c, mines, initialRevealed, users }) {
  rememberNames(users);
  resetSpectation();
  playerStatus = 'alive';
  const gridElement = createGameContainer(users, mines);
  renderGrid(gridElement, r, c, initialRevealed);
  startTimer();
}

function handleGameUpdate({ cells }) {
  cells.forEach(revealCellEl);
}

function handlePlayerFailed({ x, y }) {
  playerStatus = 'dead';
  revealCellEl({ x, y, value: 'X' });
  stopTimer();
}

function handleFlagUpdate({ userId, x, y, flagged, flagsLeft }) {
  const isWatched = spectating && spectatedPlayerId === userId;
  if (userId !== myId && !isWatched) return;
  setFlag(x, y, flagged);
  const flagCounter = document.getElementById('flagCounter');
  if (flagCounter) flagCounter.textContent = `Flags left: ${flagsLeft}`;
}

function handleProgressUpdate(usersProgress) {
  const missing = usersProgress.some((user) => !document.querySelector(`.progress-container[data-userid="${CSS.escape(user.id)}"]`));
  if (missing) {
    const container = document.querySelector('.progress-rows-container');
    if (container) container.outerHTML = createProgressBars(myId, usersProgress);
  }
  for (const user of usersProgress) {
    const container = document.querySelector(`.progress-container[data-userid="${CSS.escape(user.id)}"]`);
    const bar = container?.querySelector('.progress-bar');
    if (!bar) continue;
    bar.value = user.progress;
    const label = container.querySelector('.progress-label');
    if (label && user.id !== myId) label.textContent = user.name;
  }
}

function handlePlayerStatusChanged({ playerId, status }) {
  if (playerId === myId) {
    playerStatus = status;
    if (status !== 'alive') stopTimer();
  }
  if (status === 'alive') {
    if (playerId !== myId && !alivePlayers.some((p) => p.id === playerId)) {
      alivePlayers.push({ id: playerId, name: getPlayerName(playerId) });
    }
    return;
  }
  alivePlayers = alivePlayers.filter((player) => player.id !== playerId);
  if (spectating && spectatedPlayerId === playerId) {
    if (alivePlayers.length > 0) {
      spectatedPlayerId = alivePlayers[0].id;
      socket.emit('spectatePlayer', spectatedPlayerId);
    }
  }
}

function handleIntermediatePodium({ playingPlayers }) {
  alivePlayers = playingPlayers.filter((p) => p.id !== myId);
  // a reloaded page shows the Reconnect button first, nothing may cover it
  if (playerStatus === 'alive' || spectating || !document.getElementById('gameContainer')) return;
  const modal = document.getElementById('intermediatePodiumModal');
  if (!modal || modal.classList.contains('visible')) return;
  modal.classList.add('visible');
  document.getElementById('closeintermediatePodiumModal').onclick = () => {
    modal.classList.remove('visible');
    addSpectateButton();
  };
  const spectateBtn = document.getElementById('spectatePlayers');
  spectateBtn.style.display = alivePlayers.length > 0 ? 'block' : 'none';
  spectateBtn.onclick = () => {
    modal.classList.remove('visible');
    showSpectatePlayersModal();
  };
}

function handleSpectateUpdate({ rows: r, cols: c, cells, flags, time, flagsLeft }) {
  const gridElement = document.getElementById('minesweeperGrid');
  if (!gridElement) return;
  clearInterval(spectateTimerInterval);
  renderGrid(gridElement, r, c, cells, flags);
  const timerEl = document.getElementById('gameTimer');
  if (timerEl) {
    let currentTime = time || 0;
    timerEl.textContent = `Time: ${currentTime} s`;
    spectateTimerInterval = setInterval(() => {
      currentTime++;
      timerEl.textContent = `Time: ${currentTime} s`;
    }, 1000);
  }
  const flagCounter = document.getElementById('flagCounter');
  if (flagCounter && flagsLeft !== undefined) flagCounter.textContent = `Flags left: ${flagsLeft}`;
}

function handleGameOver({ results, grid }) {
  playerStatus = 'over';
  pausedFor.clear();
  stopTimer();
  clearInterval(spectateTimerInterval);
  hideDisconnectModal();
  revealFullGrid(grid);
  resetSpectation();
  const intermediateModal = document.getElementById('intermediatePodiumModal');
  if (intermediateModal) intermediateModal.classList.remove('visible');
  const spectateModal = document.getElementById('spectatePlayersModal');
  if (spectateModal) spectateModal.style.display = 'none';

  const modal = document.getElementById('gameOverModal');
  if (!modal) return;
  document.getElementById('gameOverMessage').innerHTML = createPodiumDisplay(results);
  modal.style.display = 'flex';
  document.getElementById('rematchButton').onclick = () => {
    window.location.href = window.location.pathname;
  };
  document.getElementById('mainMenuButton').onclick = () => {
    window.location.href = '/lobbycreation';
  };
}

function handleGamePaused({ playerId, timeout }) {
  pausedFor.add(playerId);
  pauseTimer();
  // a reloaded page shows the Reconnect button first, the modal must not cover it
  if (document.getElementById('gameContainer')) showDisconnectModal(timeout);
}

function handleGameResumed() {
  pausedFor.clear();
  resumeTimer();
  hideDisconnectModal();
}

// someone the game waited for is back or forfeited; the game itself resumes only on gameResumed
function stopWaitingFor(playerId) {
  if (!pausedFor.delete(playerId)) return;
  if (pausedFor.size === 0) hideDisconnectModal();
  else updateDisconnectTitle();
}

function handlePlayerDisconnected({ playerId, timeout }) {
  if (!timeout) return;
  console.log(`${getPlayerName(playerId)} did not reconnect in time`);
  stopWaitingFor(playerId);
}

function reconnectGameHandler(data) {
  rememberNames(data.users);
  resetSpectation();
  playerStatus = data.isDead ? 'dead' : 'alive';

  const gridElement = createGameContainer(data.users, data.mines - data.flags.length);
  renderGrid(gridElement, data.rows, data.cols, data.cells, data.flags);

  clearInterval(gameTimer.interval);
  gameTimer.interval = null;
  gameTimer.startTime = Date.now() - data.elapsedMs;
  gameTimer.pausedDuration = 0;
  gameTimer.penaltySeconds = Math.round((data.penalty || 0) / 1000);
  gameTimer.isPaused = Boolean(data.isPaused) && !data.isDead;
  gameTimer.pauseStart = gameTimer.isPaused ? Date.now() : null;
  if (!data.isDead && !gameTimer.isPaused) gameTimer.interval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();

  if (data.isDead) {
    alivePlayers = data.users.filter((user) => user.status === 'alive' && user.id !== myId);
    if (alivePlayers.length > 0) {
      const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      spectatedPlayerId = target.id;
      spectating = true;
      socket.emit('spectatePlayer', target.id);
      setTimeout(showSpectatePlayersModal, 500);
    }
  } else if (data.penalty > 0) {
    showPenaltyAnimation(myId, data.penalty);
  }
}

function showDisconnectModal(timeout) {
  hideDisconnectModal();
  const modal = el('div', 'modal');
  modal.id = 'disconnectModal';
  const content = el('div', 'modal-content');
  const countdown = el('span', '', String(timeout));
  countdown.id = 'disconnectCountdown';
  const waiting = el('p');
  waiting.append('Waiting ', countdown, ' seconds...');
  const title = el('h2');
  title.id = 'disconnectTitle';
  content.append(title, waiting, el('p', '', 'Game is paused'));
  modal.append(content);
  document.body.append(modal);
  updateDisconnectTitle();

  disconnectCountdown = timeout;
  updateDisconnectCountdown();
  // only counts down; the server decides when the game goes on (gameResumed)
  disconnectModalInterval = setInterval(() => {
    if (disconnectCountdown > 0) disconnectCountdown--;
    updateDisconnectCountdown();
  }, 1000);
}

function updateDisconnectTitle() {
  const title = document.getElementById('disconnectTitle');
  if (title) title.textContent = `${[...pausedFor].map(getPlayerName).join(', ')} disconnected`;
}

function updateDisconnectCountdown() {
  const countdownEl = document.getElementById('disconnectCountdown');
  if (!countdownEl) return;
  countdownEl.textContent = disconnectCountdown;
  if (disconnectCountdown <= 3) {
    countdownEl.style.color = 'red';
    countdownEl.style.fontWeight = 'bold';
    countdownEl.style.animation = 'pulse 0.5s infinite';
  }
}

function hideDisconnectModal() {
  clearInterval(disconnectModalInterval);
  disconnectModalInterval = null;
  document.getElementById('disconnectModal')?.remove();
}

function showPenaltyAnimation(playerId, penalty) {
  const progressContainer = document.querySelector(`.progress-container[data-userid="${CSS.escape(playerId)}"]`);
  if (!progressContainer) return;
  const penaltyEl = el('div', 'penalty-animation', `+${penalty / 1000}`);
  penaltyEl.style.color = 'red';
  penaltyEl.style.animation = 'floatUp 1s forwards';
  progressContainer.append(penaltyEl);
  setTimeout(() => penaltyEl.remove(), 1000);
}

function showSpectatePlayersModal() {
  const modal = document.getElementById('spectatePlayersModal');
  const list = document.getElementById('spectatePlayersList');
  if (!modal || !list) return;
  document.getElementById('closeSpectateModal').onclick = () => {
    modal.style.display = 'none';
  };
  if (alivePlayers.length === 0) {
    list.replaceChildren(el('div', 'no-players', 'No active players to spectate'));
  } else {
    list.replaceChildren(...alivePlayers.map((player) => {
      const item = el('div', 'spectate-item');
      item.dataset.id = player.id;
      item.append(el('div', '', player.name), el('div', 'spectate-stats'));
      item.addEventListener('click', () => {
        spectatedPlayerId = player.id;
        spectating = true;
        modal.style.display = 'none';
        document.getElementById('intermediatePodiumModal')?.classList.remove('visible');
        socket.emit('spectatePlayer', player.id);
        addSpectateButton();
      });
      return item;
    }));
  }
  modal.style.display = 'flex';
}

function addSpectateButton() {
  if (document.getElementById('spectateButton')) return;
  const gameContainer = document.getElementById('gameContainer');
  if (!gameContainer) return;
  const spectateBtn = el('button', 'spectate-button', 'Spectate');
  spectateBtn.id = 'spectateButton';
  spectateBtn.addEventListener('click', showSpectatePlayersModal);
  gameContainer.insertBefore(spectateBtn, document.getElementById('minesweeperGrid'));
}

function resetSpectation() {
  spectating = false;
  spectatedPlayerId = null;
  alivePlayers = [];
  clearInterval(spectateTimerInterval);
  document.getElementById('spectateButton')?.remove();
}

function createPodiumDisplay(results) {
  const winners = results.filter((r) => r.status === 'winner').sort((a, b) => a.time - b.time);
  const losers = results.filter((r) => r.status !== 'winner').sort((a, b) => b.progress - a.progress);
  const sorted = [...winners, ...losers].map((player, index) => ({ ...player, rank: index + 1 }));
  const [first, ...others] = sorted;
  const left = [];
  const right = [];
  others.forEach((player, index) => (index % 2 === 0 ? right.push(player) : left.unshift(player)));
  const tiers = [...left.map((p) => createPodiumTier(p)), first ? createPodiumTier(first) : '', ...right.map((p) => createPodiumTier(p))];
  return `<div class="podium-container"><div class="podium-row">${tiers.join('')}</div></div>`;
}

function createPodiumTier(player) {
  const tierClass = ['first', 'second', 'third'][player.rank - 1] || 'other';
  return `
    <div class="podium-tier ${tierClass} ${player.id === myId ? 'current-player' : ''}">
      <div class="tier-rank">#${Number(player.rank)}</div>
      <div class="player-info">
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-stats">
          <span>${Number(player.progress)}%</span>
          <br>
          <span>${Number(player.time)} s</span>
          ${player.penalty ? `<span class="penalty">+${Number(player.penalty)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function init() {
  const backButtonIndex = document.getElementById('backButtonIndex');
  if (backButtonIndex) backButtonIndex.onclick = () => { window.location.href = '/'; };
  if (isLobbyCreationPage) initLobbyCreationPage();
  if (isLobbyPage) initLobbyPage();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
