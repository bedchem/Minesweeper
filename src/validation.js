'use strict';

const { randomInt } = require('node:crypto');

const USERNAME_MIN = 3;
const USERNAME_MAX = 12;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,12}$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOBBY_CODE_PATTERN = /^[A-Z0-9]{4}$/;
const ROLES = Object.freeze(['user', 'moderator', 'admin']);

function isValidUsername(value) {
  return typeof value === 'string' && USERNAME_PATTERN.test(value);
}

function isValidUid(value) {
  return typeof value === 'string' && UID_PATTERN.test(value);
}

function normalizeLobbyCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return LOBBY_CODE_PATTERN.test(code) ? code : null;
}

function sanitizeUsername(value) {
  const cleaned = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, USERNAME_MAX);
  return cleaned.length >= USERNAME_MIN ? cleaned : `user${randomInt(100000, 1000000)}`;
}

// control, format (zero-width, bidi), line/paragraph separators and the "blank" Hangul/Braille fillers.
// ZWJ, ZWNJ and the emoji tag characters stay: emoji sequences, subdivision flags and some scripts need them,
// and they can't reorder text.
const UNSAFE_CHARS = /(?![\u200C\u200D\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u2800\u3164\uFFA0]/gu;
const INVISIBLE_ONLY = /^[\s\u200C\u200D\u{E0020}-\u{E007F}]*$/u;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.replace(UNSAFE_CHARS, '').trim().slice(0, maxLength);
  return INVISIBLE_ONLY.test(text) ? '' : text;
}

function toInt(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) ? number : null;
}

function parseTimeRange(value) {
  if (value === undefined || value === 'all' || value === '') return null;
  const days = toInt(value);
  return days !== null && days >= 1 && days <= 3650 ? days : null;
}

module.exports = {
  ROLES,
  USERNAME_MAX,
  USERNAME_MIN,
  cleanText,
  isValidUid,
  isValidUsername,
  normalizeLobbyCode,
  parseTimeRange,
  sanitizeUsername,
  toInt
};
