'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, nativeTheme, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Config } = require('./lib/config');
const { History } = require('./lib/history');
const { Queue } = require('./lib/queue');
const { Watcher } = require('./lib/watcher');
const { Updater } = require('./lib/updater');
const { analyse } = require('./lib/analyse');
const { fileScreenshot, undoFiling } = require('./lib/sorter');
const { readText, isAvailable: ocrAvailable } = require('./lib/ocr');
const { describeWithClaude, explainError, MODELS } = require('./lib/claude');
const { folderCounts, folderFiles, unsorted } = require('./lib/library');
const { ALL } = require('./lib/categories');

const APP_ID = 'uk.co.tomlowndes.snapsort';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (!app.requestSingleInstanceLock()) app.quit();

const DATA_DIR = path.join(app.getPath('appData'), 'snapsort');
const SCREENSHOTS = path.join(app.getPath('pictures'), 'Screenshots');
// Mica (the frosted Windows 11 backdrop) needs Windows 11 22H2 or later. Older Windows gets
// a solid sidebar instead.
const MICA = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

const config = new Config(path.join(DATA_DIR, 'config.json'), SCREENSHOTS);
const history = new History(path.join(DATA_DIR, 'history.json'), config.data.historyDays);
const queue = new Queue(path.join(DATA_DIR, 'queue.json'));
queue.prune();

let win = null;
let tray = null;
let busy = { running: false, done: 0, total: 0 };

// ---------- Helpers ----------

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function refresh() {
  send('state-changed');
  updateTray();
}

function notify(title, body, onClick) {
  if (config.data.notifications === 'off' || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

function apiKey() {
  const stored = config.data.apiKey;
  if (!stored) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
}

function useClaude() {
  return config.data.reader === 'claude' && Boolean(apiKey());
}

// Shrinks a screenshot before it goes to Claude: smaller uploads, same answer.
function imageForClaude(file) {
  let img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  const longest = Math.max(width, height);
  if (longest > 1568) img = img.resize(width >= height ? { width: 1568 } : { height: 1568 });
  return { data: img.toJPEG(85), mediaType: 'image/jpeg' };
}

function analyseFile(file) {
  return analyse(file, {
    readText,
    useClaude: useClaude(),
    datePrefix: config.data.datePrefix,
    explainError,
    describeImage: (f, text) => describeWithClaude({
      apiKey: apiKey(),
      model: MODELS[config.data.claudeModel] || MODELS.best,
      image: imageForClaude(f),
      ocrText: text,
    }),
  });
}

// Screenshots are read one at a time, so a burst of captures doesn't start a burst of
// OCR processes.
let chain = Promise.resolve();
function enqueue(task) {
  chain = chain.then(task, task);
  return chain;
}

// ---------- New screenshots ----------

async function handleNew(file) {
  if (queue.has(file)) return;
  let suggestion;
  try {
    suggestion = await analyseFile(file);
  } catch (err) {
    console.error('[snapsort] analyse', err);
    return;
  }
  const sure = suggestion.confidence >= config.threshold();
  if (config.data.autoFile && sure) {
    try {
      const entry = fileScreenshot(suggestion, { destination: config.data.destination, history, edits: { auto: true }, datePrefix: config.data.datePrefix });
      send('filed', entry);
      if (!win || !win.isVisible()) notify(`Filed to ${label(entry.category)}`, entry.name, () => showPage('recent'));
      refresh();
      return;
    } catch (err) {
      suggestion.note = err.code === 'ENOENT' ? 'No longer there' : 'Couldn’t move it. It may be open in another app.';
    }
  }
  queue.put(suggestion);
  if (!win || !win.isVisible()) notify('A screenshot to check', suggestion.description, () => showPage('review'));
  refresh();
}

function label(categoryId) {
  return (ALL.find((c) => c.id === categoryId) || ALL[ALL.length - 1]).label;
}

const watcher = new Watcher({
  onNew: (file) => enqueue(() => handleNew(file)),
  onError: (err) => console.error('[snapsort] watch', err),
});

function startWatching() {
  for (const dir of config.data.sources) fs.mkdirSync(dir, { recursive: true });
  watcher.start(config.data.sources);
}

// Reads every screenshot already sitting in the watched folders and puts them all in the
// review list, so nothing old is moved without a look first.
async function sortExisting() {
  if (busy.running) return;
  const files = unsorted(config.data.sources).map((f) => f.file).filter((f) => !queue.has(f));
  busy = { running: true, done: 0, total: files.length };
  send('progress', busy);
  for (const file of files) {
    await enqueue(async () => {
      try {
        queue.put(await analyseFile(file));
      } catch (err) {
        console.error('[snapsort] sort existing', err);
      }
    });
    busy.done += 1;
    send('progress', busy);
  }
  busy = { running: false, done: 0, total: 0 };
  send('progress', busy);
  refresh();
}

// ---------- State for the window ----------

function today(entry) {
  return new Date(entry.time).toDateString() === new Date().toDateString();
}

function state() {
  const filed = history.entries.filter((e) => !e.undone);
  return {
    review: queue.items,
    recent: filed.slice(0, 200),
    folders: folderCounts(config.data.destination),
    unsortedCount: unsorted(config.data.sources).filter((f) => !queue.has(f.file)).length,
    stats: { today: filed.filter(today).length, auto: filed.filter((e) => e.auto).length, total: filed.length },
    settings: { ...config.data, apiKey: undefined, hasApiKey: Boolean(apiKey()) },
    paused: watcher.paused,
    ocr: ocrAvailable(),
    busy,
    update: { status: updater.status, version: updater.version, current: app.getVersion() },
    platform: process.platform,
    mica: MICA,
  };
}

// ---------- Thumbnails ----------

const thumbs = new Map();
async function thumbnail(file) {
  let key;
  try {
    key = `${file}|${fs.statSync(file).mtimeMs}`;
  } catch {
    return null;
  }
  if (thumbs.has(key)) return thumbs.get(key);
  let img;
  try {
    img = await nativeImage.createThumbnailFromPath(file, { width: 640, height: 400 });
  } catch {
    img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) img = img.resize({ width: 640 });
  }
  const url = img && !img.isEmpty() ? img.toDataURL() : null;
  if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value);
  thumbs.set(key, url);
  return url;
}

// ---------- Window and tray ----------

function showPage(page) {
  if (!win) return;
  win.show();
  win.focus();
  send('show-page', page);
}

function titleBarColours() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 52 };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    title: 'Snapsort',
    icon: ICON,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? titleBarColours() : false,
    ...(MICA ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' } : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#28282b' : '#f3f3f5' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  win.on('close', (e) => {
    // Closing hides the window; Snapsort keeps watching from the tray.
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  nativeTheme.on('updated', () => {
    if (process.platform === 'win32' && !win.isDestroyed()) win.setTitleBarOverlay(titleBarColours());
  });
}

function updateTray() {
  if (!tray) return;
  const waiting = queue.items.length;
  tray.setToolTip(waiting ? `Snapsort: ${waiting} to review` : 'Snapsort');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: waiting ? `Review ${waiting} screenshot${waiting === 1 ? '' : 's'}` : 'Open Snapsort', click: () => showPage(waiting ? 'review' : 'recent') },
    { label: watcher.paused ? 'Resume watching' : 'Pause watching', click: () => { watcher.paused ? watcher.resume() : watcher.pause(); refresh(); } },
    { label: 'Sort existing screenshots', click: () => { showPage('review'); sortExisting(); } },
    { type: 'separator' },
    updater.status === 'ready'
      ? { label: `Restart to update (${updater.version})`, click: () => updater.installNow() }
      : { label: 'Check for updates', click: () => updater.check(true) },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(process.platform === 'win32' ? ICON : path.join(__dirname, 'assets', 'tray.png')));
  tray.on('click', () => showPage(queue.items.length ? 'review' : 'recent'));
  updateTray();
}

const updater = new Updater({
  app,
  notify: (title, body) => notify(title, body),
  isEnabled: () => config.data.autoUpdate,
  onChange: refresh,
});

function setLoginItem(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

// ---------- IPC ----------

ipcMain.handle('get-state', () => state());
ipcMain.handle('thumb', (_e, file) => thumbnail(file));
ipcMain.handle('folder-files', (_e, id) => folderFiles(config.data.destination, id));

// Files one screenshot from the review list, with any changes made in the inspector.
ipcMain.handle('file', (_e, file, edits = {}) => {
  const suggestion = queue.get(file);
  if (!suggestion) return { ok: false, message: 'Not in the review list' };
  try {
    const entry = fileScreenshot(suggestion, { destination: config.data.destination, history, edits, datePrefix: config.data.datePrefix });
    queue.remove(file);
    refresh();
    return { ok: true, entry };
  } catch (err) {
    if (err.code === 'ENOENT') queue.remove(file);
    refresh();
    return { ok: false, message: err.code === 'ENOENT' ? 'No longer there' : 'Couldn’t move it. It may be open in another app.' };
  }
});

ipcMain.handle('file-all', () => {
  const results = queue.items.slice().map((s) => {
    try {
      fileScreenshot(s, { destination: config.data.destination, history, datePrefix: config.data.datePrefix });
      queue.remove(s.file);
      return true;
    } catch {
      return false;
    }
  });
  refresh();
  return { filed: results.filter(Boolean).length, failed: results.filter((r) => !r).length };
});

// "Leave" takes it off the list and leaves the file where it is.
ipcMain.handle('leave', (_e, file) => {
  queue.remove(file);
  refresh();
  return true;
});

ipcMain.handle('undo', (_e, id) => {
  const entry = history.get(id);
  if (!entry) return { ok: false, message: 'Not found' };
  const result = undoFiling(entry, history);
  refresh();
  return result;
});

ipcMain.handle('reread', (_e, file) => enqueue(async () => {
  const s = await analyseFile(file);
  queue.put(s);
  refresh();
  return s;
}));

ipcMain.handle('sort-existing', () => { sortExisting(); return true; });
ipcMain.handle('set-paused', (_e, paused) => { paused ? watcher.pause() : watcher.resume(); refresh(); return state(); });
ipcMain.handle('show-in-folder', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('open-file', (_e, file) => shell.openPath(file));
ipcMain.handle('open-folder', (_e, id) => {
  const cat = ALL.find((c) => c.id === id);
  return shell.openPath(cat ? path.join(config.data.destination, cat.folder) : config.data.destination);
});
ipcMain.handle('pick-folder', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('save-settings', (_e, changes) => {
  const next = { ...changes };
  if ('apiKey' in next) {
    const key = (next.apiKey || '').trim();
    next.apiKey = key && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : null;
  }
  const watchChanged = next.sources && JSON.stringify(next.sources) !== JSON.stringify(config.data.sources);
  Object.assign(config.data, next);
  config.save();
  if (watchChanged) startWatching();
  if ('startWithWindows' in next) setLoginItem(config.data.startWithWindows);
  if ('theme' in next) nativeTheme.themeSource = config.data.theme;
  refresh();
  return state();
});

ipcMain.handle('test-key', async (_e, key) => {
  try {
    const tiny = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    await describeWithClaude({ apiKey: key.trim(), model: MODELS.cheapest, image: { data: tiny.toPNG(), mediaType: 'image/png' } });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: explainError(err) };
  }
});

ipcMain.handle('check-updates', () => { updater.check(true); return true; });
ipcMain.handle('install-update', () => updater.installNow());

// ---------- Start up ----------

app.whenReady().then(() => {
  nativeTheme.themeSource = config.data.theme;
  createWindow();
  createTray();
  startWatching();
  setLoginItem(config.data.startWithWindows);
  updater.start();
});

app.on('second-instance', () => showPage(queue.items.length ? 'review' : 'recent'));

app.on('before-quit', () => {
  app.isQuitting = true;
  watcher.stop();
  updater.stop();
  config.save();
});
