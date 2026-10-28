'use strict';

const { randomInt } = require('node:crypto');

const MINE = -1;

const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ rows: 10, cols: 10, mines: 10 }),
  medium: Object.freeze({ rows: 16, cols: 16, mines: 40 }),
  hard: Object.freeze({ rows: 30, cols: 16, mines: 99 })
});

function neighbors(board, index) {
  const { rows, cols } = board;
  const x = index % cols;
  const y = (index - x) / cols;
  const result = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) result.push(ny * cols + nx);
    }
  }
  return result;
}

function createBoard(rows, cols, mines, safeX, safeY, random = randomInt) {
  const size = rows * cols;
  const values = new Int8Array(size);
  const board = { rows, cols, mines, values };

  const safeIndex = safeY * cols + safeX;
  const protectedCells = new Set([safeIndex, ...neighbors(board, safeIndex)]);
  const candidates = [];
  for (let i = 0; i < size; i++) {
    if (!protectedCells.has(i)) candidates.push(i);
  }
  if (mines > candidates.length) {
    throw new RangeError(`Cannot place ${mines} mines on a ${cols}x${rows} board`);
  }

  for (let i = 0; i < mines; i++) {
    const j = i + random(candidates.length - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    values[candidates[i]] = MINE;
  }

  for (let i = 0; i < size; i++) {
    if (values[i] === MINE) continue;
    values[i] = neighbors(board, i).reduce((count, n) => count + (values[n] === MINE ? 1 : 0), 0);
  }
  return board;
}

function isMine(board, index) {
  return board.values[index] === MINE;
}

function cellValue(board, index) {
  return isMine(board, index) ? 'X' : board.values[index];
}

function toIndex(board, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return -1;
  if (x < 0 || y < 0 || x >= board.cols || y >= board.rows) return -1;
  return y * board.cols + x;
}

function toPoint(board, index) {
  const x = index % board.cols;
  return { x, y: (index - x) / board.cols };
}

function toCell(board, index) {
  return { ...toPoint(board, index), value: cellValue(board, index) };
}

function toGrid(board) {
  const grid = [];
  for (let y = 0; y < board.rows; y++) {
    const row = [];
    for (let x = 0; x < board.cols; x++) row.push(cellValue(board, y * board.cols + x));
    grid.push(row);
  }
  return grid;
}

function floodReveal(board, start, revealed = new Set(), flags = new Set()) {
  if (revealed.has(start) || flags.has(start) || isMine(board, start)) return [];
  const added = [start];
  revealed.add(start);
  for (let i = 0; i < added.length; i++) {
    const current = added[i];
    if (board.values[current] !== 0) continue;
    for (const n of neighbors(board, current)) {
      if (revealed.has(n) || flags.has(n) || isMine(board, n)) continue;
      revealed.add(n);
      added.push(n);
    }
  }
  return added;
}

function safeCellCount(board) {
  return board.rows * board.cols - board.mines;
}

function calculateProgress(board, revealedCount, initialCount) {
  const revealable = safeCellCount(board) - initialCount;
  if (revealable <= 0) return 100;
  return Math.max(0, Math.min(100, Math.floor(((revealedCount - initialCount) / revealable) * 100)));
}

module.exports = {
  DIFFICULTIES,
  calculateProgress,
  cellValue,
  createBoard,
  floodReveal,
  isMine,
  neighbors,
  safeCellCount,
  toCell,
  toGrid,
  toIndex,
  toPoint
};
