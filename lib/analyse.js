'use strict';

const fs = require('fs');
const path = require('path');
const { classifyText } = require('./classify');
const { takenOn, describe, buildFileName } = require('./naming');

// Works out a suggestion for one screenshot: what it is, how sure we are, and its new name.
// Reads the text on the device first. If Claude is switched on, Claude gets the final say and
// the on-device answer is kept as a fallback for when Claude can't be reached.
async function analyse(file, { readText, describeImage, useClaude = false, datePrefix = true, explainError = (e) => e.message }) {
  const stat = fs.statSync(file);
  let lines = [];
  let note = null;
  try {
    lines = await readText(file);
  } catch (err) {
    note = err.message;
  }
  const text = lines.join('\n');
  let result = { ...classifyText(text), engine: 'device' };

  if (useClaude && describeImage) {
    try {
      result = { ...(await describeImage(file, text)), engine: 'claude' };
    } catch (err) {
      note = explainError(err);
    }
  }

  const date = takenOn(file, stat.mtimeMs);
  const description = describe(result);
  return {
    file,
    category: result.category,
    app: result.app || null,
    title: result.title || '',
    confidence: result.confidence,
    engine: result.engine,
    date,
    description,
    newName: buildFileName({ description, date, ext: path.extname(file), datePrefix }),
    note,
    // Kept so the screenshot can be found by searching for words in it.
    text: text.slice(0, 2000),
    found: new Date().toISOString(),
  };
}

module.exports = { analyse };
