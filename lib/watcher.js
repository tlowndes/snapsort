'use strict';

const path = require('path');
const chokidar = require('chokidar');
const { isImage } = require('./naming');

// Watches the top level of the screenshot folders and reports each new image once it has
// finished saving. Files already there when the app starts are left for "Sort existing".
class Watcher {
  constructor({ onNew, onError }) {
    this.onNew = onNew;
    this.onError = onError || (() => {});
    this.fsWatcher = null;
    this.paused = false;
  }

  start(folders) {
    this.stop();
    const live = folders.filter(Boolean);
    if (!live.length) return;
    this.fsWatcher = chokidar.watch(live, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 },
      ignored: (p, stats) => Boolean(stats && stats.isFile() && !isImage(p)) || path.basename(p).startsWith('.'),
    });
    this.fsWatcher.on('add', (file) => {
      const dir = path.resolve(path.dirname(file)).toLowerCase();
      const topLevel = live.some((f) => path.resolve(f).toLowerCase() === dir);
      if (!this.paused && topLevel && isImage(file)) this.onNew(file);
    });
    this.fsWatcher.on('error', (err) => this.onError(err));
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  stop() {
    if (this.fsWatcher) this.fsWatcher.close();
    this.fsWatcher = null;
  }
}

module.exports = { Watcher };
