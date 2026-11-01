'use strict';

const fs = require('fs');
const path = require('path');
const { byId } = require('./categories');
const { safeName, buildFileName } = require('./naming');
const { uniquePath, moveBack } = require('./mover');

// Moves a screenshot into its category folder under its new name, and logs it so it can be
// undone. `edits` are the user's changes from the review list (a new name or category).
function fileScreenshot(suggestion, { destination, history, edits = {}, datePrefix = true }) {
  const category = byId(edits.category || suggestion.category);
  const ext = path.extname(suggestion.file);
  const name = edits.description != null
    ? buildFileName({ description: edits.description, date: suggestion.date, ext, datePrefix })
    : suggestion.newName;
  const dir = path.join(destination, category.folder);
  if (!fs.existsSync(suggestion.file)) throw Object.assign(new Error('No longer there'), { code: 'ENOENT' });
  fs.mkdirSync(dir, { recursive: true });
  const to = uniquePath(dir, safeName(name) || path.basename(suggestion.file));
  try {
    fs.renameSync(suggestion.file, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(suggestion.file, to, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(suggestion.file);
  }
  return history.add({
    from: suggestion.file,
    to,
    category: category.id,
    name: path.basename(to, ext),
    engine: suggestion.engine,
    confidence: suggestion.confidence,
    auto: Boolean(edits.auto),
    text: suggestion.text || '',
  });
}

// Puts a filed screenshot back where it was, under its old name.
function undoFiling(entry, history) {
  if (entry.undone) return { ok: false, message: 'Already undone' };
  if (!fs.existsSync(entry.to)) return { ok: false, message: 'Moved or deleted since' };
  const back = moveBack(entry.to, entry.from);
  history.markUndone(entry.id);
  return { ok: true, file: back };
}

module.exports = { fileScreenshot, undoFiling };
