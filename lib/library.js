'use strict';

const fs = require('fs');
const path = require('path');
const { ALL } = require('./categories');
const { isImage } = require('./naming');

function images(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && isImage(d.name) && !d.name.startsWith('.'))
      .map((d) => {
        const file = path.join(dir, d.name);
        return { file, name: path.parse(d.name).name, mtime: fs.statSync(file).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

// Each category folder with how many screenshots are in it.
function folderCounts(destination) {
  return ALL.map((c) => ({ id: c.id, label: c.label, count: images(path.join(destination, c.folder)).length }));
}

// The screenshots in one category folder, newest first.
function folderFiles(destination, categoryId) {
  const cat = ALL.find((c) => c.id === categoryId);
  return cat ? images(path.join(destination, cat.folder)).map((f) => ({ ...f, category: cat.id })) : [];
}

// Screenshots sitting loose at the top of the watched folders, i.e. not filed yet.
function unsorted(sources) {
  return sources.flatMap((dir) => images(dir));
}

module.exports = { images, folderCounts, folderFiles, unsorted };
