'use strict';

const fs = require('fs');
const path = require('path');

// Screenshots waiting in the review list, saved to disk so they survive a restart.
// One entry per file, newest first.
class Queue {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2));
  }

  key(file) {
    return path.resolve(file).toLowerCase();
  }

  has(file) {
    return this.items.some((i) => this.key(i.file) === this.key(file));
  }

  get(file) {
    return this.items.find((i) => this.key(i.file) === this.key(file)) || null;
  }

  // Adds a suggestion, or replaces the one already there for the same file.
  put(item) {
    this.items = [item, ...this.items.filter((i) => this.key(i.file) !== this.key(item.file))];
    this.save();
    return item;
  }

  remove(file) {
    const before = this.items.length;
    this.items = this.items.filter((i) => this.key(i.file) !== this.key(file));
    if (this.items.length !== before) this.save();
  }

  // Drops entries whose file has gone (deleted or moved by hand). Returns how many went.
  prune(exists = fs.existsSync) {
    const before = this.items.length;
    this.items = this.items.filter((i) => exists(i.file));
    if (this.items.length !== before) this.save();
    return before - this.items.length;
  }
}

module.exports = { Queue };
