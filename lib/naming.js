'use strict';

const path = require('path');
const { byId } = require('./categories');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const MAX_NAME = 90;

function isImage(fileName) {
  return IMAGE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

// Takes out characters Windows won't allow in a file name, and tidies the spacing.
function safeName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (cleaned.length <= MAX_NAME) return cleaned;
  return cleaned.slice(0, MAX_NAME).replace(/\s+\S*$/, '').replace(/[. –-]+$/, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Screenshot tools often put the date in the name ("Screenshot 2026-10-31 224512.png",
// "Screenshot_20261031_224512.png"). That's when it was really taken, so it wins over the
// file's modified time, which changes if the file is copied.
function takenOn(fileName, mtime) {
  const m = path.basename(fileName).match(/(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)/);
  if (m) {
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (date.getMonth() === Number(m[2]) - 1) return isoDay(date);
  }
  return isoDay(new Date(mtime));
}

// "Figma – Onboarding flow", "Receipts – Amazon order", or just "Figma".
function describe({ category, app, title }) {
  const lead = app || byId(category).label;
  if (!title || title.toLowerCase() === lead.toLowerCase()) return lead;
  if (title.toLowerCase().startsWith(lead.toLowerCase())) return title;
  return `${lead} – ${title}`;
}

// The full new file name, keeping the original extension:
// "2026-10-31 Figma – Onboarding flow.png".
function buildFileName({ description, date, ext, datePrefix = true }) {
  const body = safeName(description) || 'Screenshot';
  return `${datePrefix && date ? `${date} ` : ''}${body}${ext.toLowerCase()}`;
}

module.exports = { IMAGE_EXTENSIONS, isImage, safeName, takenOn, describe, buildFileName, isoDay };
