'use strict';

const fs = require('fs');
const path = require('path');

// How sure a suggestion has to be before it's filed without asking.
const THRESHOLDS = { careful: 0.85, balanced: 0.7, relaxed: 0.55 };

function defaults(screenshotsDir) {
  return {
    sources: [screenshotsDir],
    destination: screenshotsDir,
    reader: 'device', // 'device' (Windows OCR) or 'claude'
    claudeModel: 'best', // 'best' or 'cheapest'
    apiKey: null, // encrypted with Electron safeStorage, base64
    autoFile: true,
    sureness: 'balanced',
    datePrefix: true,
    notifications: 'each', // 'each' or 'off'
    startWithWindows: true,
    autoUpdate: true,
    historyDays: 90,
    theme: 'system', // 'system', 'light' or 'dark'
    setupDone: false,
  };
}

// Reads and writes config.json. A missing or broken file falls back to the defaults.
class Config {
  constructor(filePath, screenshotsDir) {
    this.filePath = filePath;
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      saved = {};
    }
    this.data = { ...defaults(screenshotsDir), ...saved };
  }

  threshold() {
    return THRESHOLDS[this.data.sureness] || THRESHOLDS.balanced;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Config, THRESHOLDS, defaults };
