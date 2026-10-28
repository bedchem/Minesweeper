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

const UNSAFE_CHARS = new RegExp(
  '[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]]
    .map(([from, to]) => `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`)
    .join('') + ']',
  'g'
);

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_CHARS, '').trim().slice(0, maxLength);
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
