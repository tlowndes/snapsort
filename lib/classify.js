'use strict';

const { CATEGORIES, OTHER } = require('./categories');

// Apps and sites worth naming a screenshot after. The first one found wins, so the more
// specific names come first ("Google Docs" before "Google").
const BRANDS = [
  ['figma', 'Figma'], ['canva', 'Canva'], ['framer', 'Framer'], ['photoshop', 'Photoshop'],
  ['illustrator', 'Illustrator'], ['dribbble', 'Dribbble'], ['behance', 'Behance'],
  ['visual studio code', 'VS Code'], ['vs code', 'VS Code'], ['github', 'GitHub'],
  ['whatsapp', 'WhatsApp'], ['messenger', 'Messenger'], ['imessage', 'iMessage'], ['slack', 'Slack'],
  ['discord', 'Discord'], ['telegram', 'Telegram'], ['microsoft teams', 'Teams'],
  ['google docs', 'Google Docs'], ['notion', 'Notion'], ['obsidian', 'Obsidian'],
  ['microsoft word', 'Word'], ['excel', 'Excel'], ['powerpoint', 'PowerPoint'],
  ['amazon', 'Amazon'], ['paypal', 'PayPal'], ['ebay', 'eBay'], ['deliveroo', 'Deliveroo'],
  ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['spotify', 'Spotify'],
];

// Words from app chrome (menus, toolbars) that make poor titles on their own.
const CHROME = new Set([
  'file', 'edit', 'view', 'help', 'share', 'present', 'search', 'menu', 'home', 'sign in', 'log in',
  'settings', 'back', 'next', 'cancel', 'ok', 'done', 'save', 'close', 'more', 'new tab', 'untitled',
  'layers', 'assets', 'design', 'prototype', 'inspect', 'comments', 'type a message', 'reply',
]);

function countOf(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1 && count < 3) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

// Scores each category by the clue words in the text. Returns them best first.
function scoreCategories(text) {
  const lower = ` ${text.toLowerCase()} `;
  return CATEGORIES.map((c) => ({
    id: c.id,
    score: c.words.reduce((sum, [word, weight]) => sum + countOf(lower, word) * weight, 0),
  })).sort((a, b) => b.score - a.score);
}

function findBrand(text) {
  const lower = text.toLowerCase();
  const hit = BRANDS.find(([needle]) => lower.includes(needle));
  if (hit) return hit[1];
  // A web address is the next best name: "bbc.co.uk", "apple.com".
  const domain = lower.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.uk|com|org|net|io|dev|app|design|uk))\b/);
  return domain ? domain[1] : null;
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Picks the line that reads most like a heading: a few real words, mostly letters, near the top,
// and not a menu item, a time or a price.
function findTitle(lines, brand) {
  const brandLower = (brand || '').toLowerCase();
  let best = null;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\s+/g, ' ').trim();
    const lower = line.toLowerCase();
    const words = line.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 8 || line.length < 6 || line.length > 60) return;
    if (CHROME.has(lower) || lower === brandLower) return;
    // A menu bar read as one line: "File Edit View Help".
    if (words.every((w) => CHROME.has(w.toLowerCase()))) return;
    if (/\d{1,2}:\d{2}/.test(line) || /[£€$]\s?\d/.test(line) || /https?:|www\./i.test(line)) return;
    const letters = (line.match(/[a-z]/gi) || []).length;
    if (letters / line.length < 0.7) return;
    const allCaps = line === line.toUpperCase();
    const score = 10 - Math.min(index, 8) + Math.min(words.length, 5) - (allCaps ? 3 : 0);
    if (!best || score > best.score) best = { line, score };
  });
  if (!best) return '';
  const title = best.line.replace(/[.:;,]+$/, '');
  return capitalise(title.length > 48 ? `${title.slice(0, 48).replace(/\s+\S*$/, '')}` : title);
}

// Works out what a screenshot is from its text alone. Confidence is 0–1: strong clues for one
// category and few for the rest score high; a near tie or very little text scores low, so the
// screenshot waits in the review list instead of being filed.
function classifyText(text) {
  const clean = (text || '').trim();
  const lines = clean.split(/\r?\n/);
  const brand = findBrand(clean);
  const title = findTitle(lines, brand);
  const [top, second] = scoreCategories(clean);

  if (!top || top.score < 2) {
    return { category: OTHER.id, app: brand, title, confidence: clean.length ? 0.2 : 0, scores: [] };
  }
  const strength = Math.min(1, top.score / 8);
  const margin = top.score / (top.score + (second ? second.score : 0));
  const confidence = Math.round(strength * margin * 100) / 100;
  return { category: top.id, app: brand, title, confidence, scores: [top, second].filter(Boolean) };
}

module.exports = { classifyText, scoreCategories, findBrand, findTitle };
