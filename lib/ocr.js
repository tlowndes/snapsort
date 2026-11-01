'use strict';

const path = require('path');
const { execFile } = require('child_process');

// In the installed app, the script is unpacked next to app.asar, because PowerShell can't
// read files inside the archive.
const SCRIPT = path.join(__dirname, 'ocr.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function isAvailable(platform = process.platform) {
  return platform === 'win32';
}

// Reads the text in a screenshot using Windows' own OCR. Resolves to the lines of text, top
// to bottom. Elsewhere (the Linux tests) there's no OCR, so it resolves to no lines.
function readText(file, { run = execFile, platform = process.platform, timeoutMs = 30000 } = {}) {
  if (!isAvailable(platform)) return Promise.resolve([]);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Path', file];
  return new Promise((resolve, reject) => {
    run('powershell.exe', args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`OCR failed: ${(stderr || err.message).toString().trim().split('\n')[0]}`));
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout).trim() || '{"lines":[]}');
        resolve((parsed.lines || []).map(String));
      } catch {
        reject(new Error('OCR returned something unreadable'));
      }
    });
  });
}

module.exports = { readText, isAvailable, SCRIPT };
