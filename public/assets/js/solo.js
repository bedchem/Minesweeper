const DEFAULT_GRID_WIDTH = 10;
const DEFAULT_GRID_HEIGHT = 10;
const DEFAULT_MINE_COUNT = 15;
const MIN_SIZE = 5;
const MAX_SIZE = 25;
const SAFE_AREA = 9;

let GRID_WIDTH = DEFAULT_GRID_WIDTH;
let GRID_HEIGHT = DEFAULT_GRID_HEIGHT;
let MINE_COUNT = DEFAULT_MINE_COUNT;

let timerInterval;
let startTime;
let revealedCells = new Set();
let flaggedCells = new Set();
let flagsLeft;
let grid;
let gameActive = false;
let firstClick = true;
let gameTime = 0;

let leftMouseDown = false;
let rightMouseDown = false;

async function saveSoloGameResult(won, time) {
    if (GRID_WIDTH < DEFAULT_GRID_WIDTH || GRID_HEIGHT < DEFAULT_GRID_HEIGHT || MINE_COUNT < DEFAULT_MINE_COUNT) return;
    const user = firebase.auth().currentUser;
    if (!user) return;
    try {
        const token = await user.getIdToken();
        const result = { won, time, width: GRID_WIDTH, height: GRID_HEIGHT, mines: MINE_COUNT };
        const response = await fetch('/api/saveSoloGame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ result })
        });
        if (!response.ok) console.error('Failed to save solo game result:', response.status);
    } catch (err) {
        console.error("Failed to save solo game result:", err);
    }
}

async function getBestTime() {
    if (!isRankedBoard()) return null;
    const user = firebase.auth().currentUser;
    if (!user) return null;
    try {
        let username = user.displayName;
        if (!username && user.email) {
            username = user.email.split('@')[0];
        }
        if (!username) {
            console.warn('No username found for current user');
            return null;
        }
        const res = await fetch(`/api/getStats/${encodeURIComponent(username)}`);
        if (!res.ok) {
            return null;
        }
        const stats = await res.json();
        if (stats.singleplayer && stats.singleplayer.fastestTime) {
            let t = stats.singleplayer.fastestTime;
            if (typeof t === 'string' && t.endsWith('s')) t = t.slice(0, -1);
            t = Number(t);
            if (isFinite(t)) return t;
        }
        return null;
    } catch (err) {
        console.error('Exception:', err);
        return null;
    }
}

function initGame() {
    gameActive = true;
    firstClick = true;
    clearInterval(timerInterval);
    revealedCells = new Set();
    flaggedCells = new Set();
    flagsLeft = MINE_COUNT;

    grid = Array(GRID_HEIGHT).fill().map(() => Array(GRID_WIDTH).fill(0));

    const gridElement = document.getElementById('minesweeperGrid');
    if (!gridElement) return;
    
    gridElement.innerHTML = '';
    
    gridElement.replaceWith(gridElement.cloneNode(true));
    
    const newGridElement = document.getElementById('minesweeperGrid');
    
    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = document.createElement('div');
        row.className = 'gridRow';
        for (let x = 0; x < GRID_WIDTH; x++) {
            const cell = document.createElement('div');
            cell.className = 'gridCell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            row.appendChild(cell);
        }
        newGridElement.appendChild(row);
    }

    const flagCounter = document.getElementById('flagCounter');
    const gameTimer = document.getElementById('gameTimer');
    if (flagCounter) flagCounter.textContent = `Flags left: ${flagsLeft}`;
    if (gameTimer) gameTimer.textContent = 'Time: 0 s';

    const winModal = document.getElementById('soloWinModal');
    const settingsModal = document.getElementById('settingsModal');
    if (winModal) winModal.style.display = 'none';
    if (settingsModal) settingsModal.style.display = 'none';

    installChordHandlers();
}

function generateGrid(safeX, safeY) {
    const protectedArea = new Set();
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const px = safeX + dx;
            const py = safeY + dy;
            if (px >= 0 && px < GRID_WIDTH && py >= 0 && py < GRID_HEIGHT) {
                protectedArea.add(`${px},${py}`);
            }
        }
    }

    let minesPlaced = 0;
    while (minesPlaced < MINE_COUNT) {
        const x = Math.floor(Math.random() * GRID_WIDTH);
        const y = Math.floor(Math.random() * GRID_HEIGHT);
        if (!protectedArea.has(`${x},${y}`) && grid[y][x] !== 'X') {
            grid[y][x] = 'X';
            minesPlaced++;
        }
    }

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (grid[y][x] === 'X') continue;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ny = y + dy, nx = x + dx;
                    if (ny >= 0 && ny < GRID_HEIGHT && nx >= 0 && nx < GRID_WIDTH && grid[ny][nx] === 'X') count++;
                }
            }
            grid[y][x] = count;
        }
    }
}

function handleLeftClick(x, y) {
    if (!gameActive) return;
    const key = `${x},${y}`;
    if (flaggedCells.has(key) || revealedCells.has(key)) return;

    if (firstClick) {
        firstClick = false;
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        generateGrid(x, y);
    }

    if (grid[y][x] === 'X') {
        gameActive = false;
        clearInterval(timerInterval);
        revealFullGrid();
        gameTime = Math.floor((Date.now() - startTime) / 1000);
        showWinModal(gameTime, false);
        saveSoloGameResult(false, null);
        return;
    }

    floodFill(x, y);
    checkWin();
}

function handleRightClick(x, y) {
    if (!gameActive) return;
    const key = `${x},${y}`;
    if (revealedCells.has(key)) return;
    const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
    if (!cell) return;

    if (flaggedCells.has(key)) {
        flaggedCells.delete(key);
        flagsLeft++;
        cell.textContent = '';
        cell.classList.remove('flagged');
    } else {
        if (flagsLeft <= 0) return;
        flaggedCells.add(key);
        flagsLeft--;
        cell.textContent = '🚩';
        cell.classList.add('flagged');
    }

    const flagCounter = document.getElementById('flagCounter');
    if (flagCounter) flagCounter.textContent = `Flags left: ${flagsLeft}`;
}

function floodFill(x, y) {
    const queue = [[x, y]];
    const visited = new Set();

    while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        const key = `${cx},${cy}`;
        if (visited.has(key)) continue;
        if (cx < 0 || cx >= GRID_WIDTH || cy < 0 || cy >= GRID_HEIGHT) continue;
        if (grid[cy][cx] === 'X') continue;
        if (revealedCells.has(key) || flaggedCells.has(key)) continue;

        visited.add(key);
        revealedCells.add(key);

        const cell = document.querySelector(`[data-x="${cx}"][data-y="${cy}"]`);
        if (!cell) continue;

        cell.classList.add('revealed');
        cell.textContent = grid[cy][cx] || '';

        if (grid[cy][cx] === 0) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx !== 0 || dy !== 0) queue.push([cx + dx, cy + dy]);
                }
            }
        }
    }
}

function checkWin() {
    const totalSafe = GRID_WIDTH * GRID_HEIGHT - MINE_COUNT;
    if (revealedCells.size === totalSafe) {
        gameActive = false;
        clearInterval(timerInterval);
        gameTime = Math.floor((Date.now() - startTime) / 1000);
        showWinModal(gameTime, true);
        saveSoloGameResult(true, gameTime);
    }
}

async function showWinModal(timeTaken, won = true) {
    const winTime = document.getElementById('winTime');
    const bestTimeElement = document.getElementById('bestTime');
    const winMessage = document.getElementById('winMessage');
    const soloWinModal = document.getElementById('soloWinModal');

    if (winTime) winTime.textContent = timeTaken;
    if (winMessage) winMessage.textContent = won ? '🎉 WIN!' : '💥 LOST!';
    if (soloWinModal) soloWinModal.style.display = 'flex';

    let bestTime = await getBestTime();
    if (won && isRankedBoard() && (bestTime === null || timeTaken < bestTime)) bestTime = timeTaken;
    if (bestTimeElement) bestTimeElement.textContent = bestTime ?? 'N/A';
}

function isRankedBoard() {
    return GRID_WIDTH === DEFAULT_GRID_WIDTH && GRID_HEIGHT === DEFAULT_GRID_HEIGHT && MINE_COUNT === DEFAULT_MINE_COUNT;
}

function revealFullGrid() {
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
            if (!cell) continue;
            cell.classList.add('revealed');
            if (grid[y][x] === 'X') {
                cell.textContent = 'X';
                cell.classList.add('mine');
            } else {
                cell.textContent = grid[y][x] || '';
            }
        }
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const gameTimer = document.getElementById('gameTimer');
    if (gameTimer) gameTimer.textContent = `Time: ${elapsed} s`;
}

function installChordHandlers() {
    const gridElement = document.getElementById('minesweeperGrid');
    if (!gridElement) return;

    const getNeighbors = (x, y) => {
        const neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) neighbors.push([nx, ny]);
            }
        }
        return neighbors;
    };

    const countFlagsAround = (x, y) => {
        return getNeighbors(x, y).reduce((c, [nx, ny]) => c + (flaggedCells.has(`${nx},${ny}`) ? 1 : 0), 0);
    };

    const chordReveal = (x, y) => {
        if (!gameActive) return;
        const neighbors = getNeighbors(x, y);
        const unflagged = neighbors.filter(([nx, ny]) => !flaggedCells.has(`${nx},${ny}`));

        let mineHit = null;
        for (const [nx, ny] of unflagged) {
            if (grid[ny][nx] === 'X') {
                mineHit = [nx, ny];
                break;
            }
        }

        if (mineHit) {
            gameActive = false;
            clearInterval(timerInterval);
            const [mx, my] = mineHit;
            const cell = document.querySelector(`[data-x="${mx}"][data-y="${my}"]`);
            if (cell) cell.classList.add('mine-hit');
            revealFullGrid();
            gameTime = Math.floor((Date.now() - startTime) / 1000);
            showWinModal(gameTime, false);
            saveSoloGameResult(false, null);
            return;
        }

        unflagged.forEach(([nx, ny]) => {
            const key = `${nx},${ny}`;
            if (!revealedCells.has(key)) {
                if (grid[ny][nx] === 0) {
                    floodFill(nx, ny);
                } else {
                    revealedCells.add(key);
                    const cell = document.querySelector(`[data-x="${nx}"][data-y="${ny}"]`);
                    if (!cell) return;
                    cell.classList.add('revealed');
                    cell.textContent = grid[ny][nx] || '';
                }
            }
        });
        checkWin();
    };

    gridElement.addEventListener('mousedown', e => {
        const cell = e.target.closest('.gridCell');
        if (!cell) return;
        const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
        if (e.button === 0) leftMouseDown = true;
        if (e.button === 2) rightMouseDown = true;

        if (leftMouseDown && rightMouseDown && cell.classList.contains('revealed') && !isNaN(+cell.textContent) && +cell.textContent > 0) {
            getNeighbors(x, y).forEach(([nx, ny]) => {
                const nb = document.querySelector(`[data-x="${nx}"][data-y="${ny}"]`);
                if (nb && !nb.classList.contains('revealed') && !nb.classList.contains('flagged')) nb.classList.add('chord-highlight');
            });
        }
    });

    gridElement.addEventListener('click', e => {
        if (e.button === 0) {
            const cell = e.target.closest('.gridCell');
            if (!cell) return;
            const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
            if (!(leftMouseDown && rightMouseDown)) handleLeftClick(x, y);
        }
    });

gridElement.addEventListener('contextmenu', e => {
    e.preventDefault();
    const cell = e.target.closest('.gridCell');
    if (!cell) return;
    const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);

    document.querySelectorAll('.chord-highlight').forEach(c => c.classList.remove('chord-highlight'));

    if (cell.classList.contains('revealed') && !isNaN(+cell.textContent) && +cell.textContent > 0) {
        const requiredFlags = +cell.textContent;
        const currentFlags = countFlagsAround(x, y);
        
        if (requiredFlags === currentFlags) {
            chordReveal(x, y);
        } else {
            handleRightClick(x, y);
        }
    } else {
        handleRightClick(x, y);
    }
});

    gridElement.addEventListener('mouseup', e => {
        if (e.button === 0) leftMouseDown = false;
        if (e.button === 2) rightMouseDown = false;
        document.querySelectorAll('.chord-highlight').forEach(c => c.classList.remove('chord-highlight'));
    });

    gridElement.addEventListener('mouseleave', () => {
        leftMouseDown = rightMouseDown = false;
        document.querySelectorAll('.chord-highlight').forEach(c => c.classList.remove('chord-highlight'));
    });
}

// --- Settings ---
function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('inputWidth').value = GRID_WIDTH;
    document.getElementById('inputHeight').value = GRID_HEIGHT;
    document.getElementById('inputMines').value = MINE_COUNT;
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

function applySettings() {
    const w = parseInt(document.getElementById('inputWidth').value);
    const h = parseInt(document.getElementById('inputHeight').value);
    const m = parseInt(document.getElementById('inputMines').value);

    if (isNaN(w) || isNaN(h) || isNaN(m)) { showCustomAlert('Put in a number'); return; }
    if (w < MIN_SIZE || w > MAX_SIZE || h < MIN_SIZE || h > MAX_SIZE) { showCustomAlert(`Width/Height: ${MIN_SIZE}–${MAX_SIZE}`); return; }
    if (m < 1) { showCustomAlert('MORE MINESS!'); return; }
    if (m > w * h - SAFE_AREA) { showCustomAlert(`Too many mines (max. ${w * h - SAFE_AREA})`); return; }

    GRID_WIDTH = w; GRID_HEIGHT = h; MINE_COUNT = m;
    flagsLeft = MINE_COUNT;
    closeSettingsModal();
    initGame();
}

function setupModalCloseButtons() {
    const closeWinModal = document.getElementById('closeWinModal');
    if (closeWinModal) closeWinModal.onclick = () => { document.getElementById('soloWinModal').style.display = 'none'; };

    const closeSettingsModalBtn = document.getElementById('closeSettingsModal');
    if (closeSettingsModalBtn) closeSettingsModalBtn.onclick = closeSettingsModal;

    window.onclick = (event) => {
        const winModal = document.getElementById('soloWinModal');
        const settingsModal = document.getElementById('settingsModal');
        if (event.target === winModal) winModal.style.display = 'none';
        if (event.target === settingsModal) settingsModal.style.display = 'none';
    };
}

document.addEventListener('DOMContentLoaded', () => {
    setupModalCloseButtons();

    const restartBtn = document.getElementById('restartButton');
    const settingsBtn = document.getElementById('settingsButton');
    const resetSettingsBtn = document.getElementById('resetSettingsButton');
    const settingsConfirmBtn = document.getElementById('settingsConfirmButton');
    const settingsCancelBtn = document.getElementById('settingsCancelButton');
    const backButton = document.getElementById('backButtonIndex');

    if (restartBtn) restartBtn.onclick = initGame;
    if (settingsBtn) settingsBtn.onclick = openSettingsModal;
    if (resetSettingsBtn) resetSettingsBtn.onclick = () => {
        GRID_WIDTH = DEFAULT_GRID_WIDTH;
        GRID_HEIGHT = DEFAULT_GRID_HEIGHT;
        MINE_COUNT = DEFAULT_MINE_COUNT;
        flagsLeft = MINE_COUNT;
        document.getElementById('inputWidth').value = GRID_WIDTH;
        document.getElementById('inputHeight').value = GRID_HEIGHT;
        document.getElementById('inputMines').value = MINE_COUNT;
        closeSettingsModal();
        initGame();
    };
    if (settingsConfirmBtn) settingsConfirmBtn.onclick = applySettings;
    if (settingsCancelBtn) settingsCancelBtn.onclick = closeSettingsModal;
    if (backButton) backButton.onclick = () => { window.location.href = '/'; };

    initGame();
    displayBestTime(); 
});

async function displayBestTime() {
    const bestTimeElement = document.getElementById('bestTime');
    if (bestTimeElement) {
        try {
            const bestTime = await getBestTime();
            bestTimeElement.textContent = bestTime !== null ? bestTime : 'N/A';
        } catch (err) {
            bestTimeElement.textContent = 'Error';
            console.error('[displayBestTime] Error:', err);
        }
    }
}
