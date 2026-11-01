'use strict';

const api = window.snapsort;
const $ = (id) => document.getElementById(id);

const CATEGORIES = [
  ['design', 'Design'], ['web', 'Web'], ['code', 'Code'], ['receipts', 'Receipts'],
  ['chats', 'Chats'], ['documents', 'Documents'], ['other', 'Other'],
];
const LABEL = Object.fromEntries(CATEGORIES);

const ICONS = {
  tray: '<path d="M4 13l2-8h12l2 8M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M4 13h5l1 2h4l1-2h5"/>',
  check: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  chev: '<path d="M8 10l4-4 4 4M8 14l4 4 4-4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[name]}</svg>`;

const ui = {
  state: null,
  view: 'review', // 'review', 'recent' or 'folder:<id>'
  layout: localStorage.getItem('layout') || 'grid',
  selected: null, // file path (review/folder) or history id (recent)
  folderItems: [],
  query: '',
  edits: {}, // per-file changes made in the inspector, kept until filed
  toastTimer: null,
};

// ---------- Small helpers ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
}

function ext(p) {
  const m = String(p).match(/\.[^.\\/]+$/);
  return m ? m[0].toLowerCase() : '';
}

// Grid and list show names without the leading date; it's in the inspector.
function display(name) {
  return String(name).replace(/^\d{4}-\d{2}-\d{2}\s+/, '');
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function when(iso) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return `Today, ${t}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${t}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${t}`;
}

function shortPath(p) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join(' › ');
}

function sureClass(c) {
  return c >= 0.7 ? '' : c >= 0.45 ? 'mid' : 'low';
}

// Fills every <img data-thumb="path"> with a thumbnail from the main process.
async function loadThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-thumb]')) {
    const file = img.dataset.thumb;
    img.removeAttribute('data-thumb');
    api.thumb(file).then((url) => { if (url) img.src = url; });
  }
}

// ---------- What each view shows ----------

function itemsFor(view) {
  const s = ui.state;
  if (view === 'review') {
    return s.review.map((r) => ({
      key: r.file, file: r.file, name: (ui.edits[r.file] && ui.edits[r.file].description) || r.description, category: r.category,
      meta: `${Math.round(r.confidence * 100)}% sure`, low: r.confidence < 0.45, text: r.text, raw: r,
    }));
  }
  if (view === 'recent') {
    return s.recent.map((e) => ({
      key: e.id, file: e.to, name: display(e.name || baseName(e.to)), category: e.category,
      meta: when(e.time).replace(/^Today, /, ''), text: e.text, raw: e,
    }));
  }
  return ui.folderItems.map((f) => ({ key: f.file, file: f.file, name: display(f.name), category: f.category, meta: when(f.mtime), text: '', raw: f }));
}

function visibleItems() {
  const q = ui.query.trim().toLowerCase();
  const all = itemsFor(ui.view);
  if (!q) return all;
  return all.filter((i) => `${i.name} ${i.text || ''}`.toLowerCase().includes(q));
}

function selectedItem() {
  return visibleItems().find((i) => i.key === ui.selected) || null;
}

// ---------- Rendering ----------

function render() {
  if (!ui.state) return;
  renderSidebar();
  renderBar();
  renderBanner();
  renderTiles();
  renderInspector();
}

function renderSidebar() {
  const s = ui.state;
  document.body.classList.toggle('mica', Boolean(s.mica));
  const review = $('count-review');
  review.textContent = s.review.length || '';
  review.classList.toggle('badge', s.review.length > 0);
  $('count-recent').textContent = s.stats.today || '';

  $('folders').innerHTML = s.folders.map((f) => `
    <button class="item" data-view="folder:${f.id}"><span class="dot cat-${f.id}"></span>${esc(f.label)}<span class="n">${f.count || ''}</span></button>`).join('');
  for (const el of document.querySelectorAll('#nav .item')) el.classList.toggle('on', el.dataset.view === ui.view);

  const paused = s.paused;
  $('status').classList.toggle('paused', paused);
  $('pause-toggle').classList.toggle('off', paused);
  $('pause-toggle').setAttribute('aria-checked', String(!paused));
  $('status-title').textContent = paused ? 'Paused' : 'Watching';
  $('status-sub').textContent = shortPath(s.settings.sources[0] || '');
  $('update-dot').textContent = s.update.status === 'ready' ? ' ' : '';
}

function renderBar() {
  const items = visibleItems();
  const action = $('primary-action');
  let title;
  if (ui.view === 'review') title = 'To review';
  else if (ui.view === 'recent') title = 'Recently filed';
  else title = LABEL[ui.view.slice(7)] || 'Folder';
  $('view-title').textContent = title;
  $('view-sub').textContent = plural(items.length, 'screenshot');

  if (ui.view === 'review') {
    action.hidden = false;
    action.textContent = ui.state.review.length ? 'File all' : 'Sort existing';
    action.disabled = ui.state.busy.running || (!ui.state.review.length && !ui.state.unsortedCount);
  } else if (ui.view.startsWith('folder:')) {
    action.hidden = false;
    action.disabled = false;
    action.textContent = 'Open folder';
  } else {
    action.hidden = true;
  }
  for (const b of document.querySelectorAll('[data-layout]')) b.classList.toggle('on', b.dataset.layout === ui.layout);
}

function renderBanner() {
  const banner = $('banner');
  const s = ui.state;
  if (s.busy.running) {
    banner.hidden = false;
    banner.innerHTML = `${icon('search')}Reading ${s.busy.done + 1 > s.busy.total ? s.busy.total : s.busy.done + 1} of ${s.busy.total}…<span>You can keep working.</span><div class="progress"><i id="progress-bar"></i></div>`;
    $('progress-bar').style.width = `${s.busy.total ? (s.busy.done / s.busy.total) * 100 : 0}%`;
    return;
  }
  if (ui.view === 'review' && s.review.length) {
    banner.hidden = false;
    banner.innerHTML = `${icon('info')}Snapsort wasn't sure enough to file these on its own.<span>Check the names, then file them.</span>`;
    return;
  }
  if (ui.view === 'review' && !s.ocr && s.settings.reader === 'device') {
    banner.hidden = false;
    banner.innerHTML = `${icon('info')}On-device reading needs Windows.<span>Switch to Claude in Settings to try it here.</span>`;
    return;
  }
  banner.hidden = true;
}

function renderTiles() {
  const tiles = $('tiles');
  const items = visibleItems();
  tiles.className = `tiles ${ui.layout}`;
  if (!items.find((i) => i.key === ui.selected)) ui.selected = items[0] ? items[0].key : null;

  tiles.innerHTML = items.map((i) => `
    <button class="tile ${i.key === ui.selected ? 'sel' : ''}" data-key="${esc(i.key)}">
      <img class="th" data-thumb="${esc(i.file)}" alt="">
      <div class="nm" title="${esc(i.name)}">${esc(i.name)}</div>
      <div class="mt"><span class="c cat-${i.category}"></span>${esc(LABEL[i.category] || 'Other')}<span class="s ${i.low ? 'low' : ''}">${esc(i.meta)}</span></div>
    </button>`).join('');
  tiles.hidden = items.length === 0;
  loadThumbs(tiles);
  renderEmpty(items.length === 0);
}

function renderEmpty(show) {
  const empty = $('empty');
  empty.hidden = !show;
  if (!show) return;
  const s = ui.state;
  if (ui.query) {
    empty.innerHTML = `<div class="empty-art">${icon('search')}</div><h2>No matches</h2><p>Nothing here has “${esc(ui.query)}” in its name or text.</p>`;
  } else if (ui.view === 'review') {
    const more = s.unsortedCount
      ? `<p>${plural(s.unsortedCount, 'older screenshot is', 'older screenshots are')} still loose in ${esc(shortPath(s.settings.sources[0]))}.</p><button class="btn primary" data-act="sort-existing">Sort existing screenshots</button>`
      : '<p>New screenshots are named and filed as you take them. Anything Snapsort isn’t sure about waits here.</p>';
    empty.innerHTML = `<div class="empty-art">${icon('check')}</div><h2>All caught up</h2>${more}`;
  } else if (ui.view === 'recent') {
    empty.innerHTML = `<div class="empty-art">${icon('clock')}</div><h2>Nothing filed yet</h2><p>Take a screenshot (Win + Shift + S, then save, or Win + Print Screen) and it’ll show up here.</p>`;
  } else {
    empty.innerHTML = `<div class="empty-art">${icon('folder')}</div><h2>This folder’s empty</h2><p>Screenshots filed as ${esc(LABEL[ui.view.slice(7)])} will appear here.</p>`;
  }
}

function renderInspector() {
  const body = $('insp-body');
  const item = selectedItem();
  if (!item) {
    body.innerHTML = '<div class="insp-empty">Select a screenshot<br>to see its details.</div>';
    return;
  }
  if (ui.view === 'review') body.innerHTML = reviewInspector(item.raw);
  else if (ui.view === 'recent') body.innerHTML = recentInspector(item.raw);
  else body.innerHTML = folderInspector(item.raw);
  loadThumbs(body);
  const sure = $('sure-bar');
  if (sure) sure.style.width = `${Math.round((item.raw.confidence || 0) * 100)}%`;
}

function categoryPicker(selected) {
  return `<div class="pop"><span class="dot cat-${selected}" id="cat-dot"></span>
    <select id="cat-select" aria-label="Folder">${CATEGORIES.map(([id, label]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${label}</option>`).join('')}</select>
    ${icon('chev', 'chev')}</div>`;
}

function reviewInspector(r) {
  const edit = ui.edits[r.file] || {};
  const description = edit.description ?? r.description;
  const category = edit.category || r.category;
  const datePrefix = ui.state.settings.datePrefix;
  return `
    <img class="prev" data-thumb="${esc(r.file)}" data-zoom="${esc(r.file)}" alt="Preview">
    <div><label class="lbl" for="name-input">Name</label>
      <div class="field"><input id="name-input" value="${esc(description)}" spellcheck="true"><span class="ext">${esc(ext(r.file))}</span></div>
      ${datePrefix ? `<div class="hint-small">Saved as ${esc(r.date)} ${esc(description)}${esc(ext(r.file))}</div>` : ''}</div>
    <div><span class="lbl">Folder</span>${categoryPicker(category)}</div>
    <dl class="kv">
      <dt>Read by</dt><dd>${r.engine === 'claude' ? 'Claude' : 'On-device'}</dd>
      <dt>Sure</dt><dd>${Math.round(r.confidence * 100)}%</dd>
      <dd class="full"><div class="meter"><i id="sure-bar" class="${sureClass(r.confidence)}"></i></div></dd>
      <dt>Taken</dt><dd>${esc(r.date)}</dd>
      <dt>Was</dt><dd title="${esc(r.file)}">${esc(baseName(r.file))}</dd>
    </dl>
    ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    ${r.text ? `<div><span class="lbl">Text found</span><div class="txt">${esc(r.text.replace(/\s*\n\s*/g, ' · '))}</div></div>` : ''}
    <div class="acts">
      <button class="btn" data-act="leave">Leave</button>
      <button class="btn primary" data-act="file">File</button>
      <button class="link-btn wide" data-act="reread">${ui.state.settings.reader === 'claude' && ui.state.settings.hasApiKey ? 'Read again with Claude' : 'Read again'}</button>
    </div>
    <div class="keys"><span><kbd>Enter</kbd>File</span><span><kbd>Del</kbd>Leave</span><span><kbd>F2</kbd>Rename</span></div>`;
}

function recentInspector(e) {
  return `
    <img class="prev" data-thumb="${esc(e.to)}" data-zoom="${esc(e.to)}" alt="Preview">
    <div><span class="lbl">Name</span><div>${esc(e.name || baseName(e.to))}</div></div>
    <dl class="kv">
      <dt>Filed to</dt><dd><span class="dot cat-${e.category}"></span> ${esc(LABEL[e.category] || 'Other')}</dd>
      <dt>When</dt><dd>${esc(when(e.time))}</dd>
      <dt>How</dt><dd>${e.auto ? 'Automatically' : 'From review'}</dd>
      <dt>Read by</dt><dd>${e.engine === 'claude' ? 'Claude' : 'On-device'}</dd>
      <dt>Was</dt><dd title="${esc(e.from)}">${esc(baseName(e.from))}</dd>
    </dl>
    ${e.text ? `<div><span class="lbl">Text found</span><div class="txt">${esc(e.text.replace(/\s*\n\s*/g, ' · '))}</div></div>` : ''}
    <div class="acts">
      <button class="btn" data-act="show">Show in folder</button>
      <button class="btn" data-act="open">Open</button>
      <button class="btn wide danger" data-act="undo">Put it back</button>
    </div>`;
}

function folderInspector(f) {
  return `
    <img class="prev" data-thumb="${esc(f.file)}" data-zoom="${esc(f.file)}" alt="Preview">
    <div><span class="lbl">Name</span><div>${esc(f.name)}</div></div>
    <dl class="kv"><dt>Modified</dt><dd>${esc(when(f.mtime))}</dd><dt>Folder</dt><dd>${esc(LABEL[f.category])}</dd></dl>
    <div class="acts"><button class="btn" data-act="show">Show in folder</button><button class="btn primary" data-act="open">Open</button></div>`;
}

// ---------- Actions ----------

async function refresh() {
  ui.state = await api.getState();
  if (ui.view.startsWith('folder:')) ui.folderItems = await api.folderFiles(ui.view.slice(7));
  render();
  if (!ui.state.settings.setupDone) openWelcome();
}

async function go(view) {
  ui.view = view;
  ui.selected = null;
  ui.query = '';
  $('search').value = '';
  if (view.startsWith('folder:')) ui.folderItems = await api.folderFiles(view.slice(7));
  render();
  $('scroll').scrollTop = 0;
}

function select(key) {
  ui.selected = key;
  for (const t of document.querySelectorAll('.tile')) t.classList.toggle('sel', t.dataset.key === key);
  renderInspector();
  const el = document.querySelector('.tile.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function moveSelection(step) {
  const items = visibleItems();
  if (!items.length) return;
  const i = Math.max(0, items.findIndex((x) => x.key === ui.selected));
  let cols = 1;
  if (ui.layout === 'grid' && Math.abs(step) > 1) {
    const tiles = document.querySelectorAll('.tile');
    const top = tiles[0] ? tiles[0].offsetTop : 0;
    cols = [...tiles].filter((t) => t.offsetTop === top).length || 1;
    step = Math.sign(step) * cols;
  }
  const next = items[Math.min(items.length - 1, Math.max(0, i + step))];
  select(next.key);
}

async function fileSelected() {
  const item = selectedItem();
  if (!item || ui.view !== 'review') return;
  const items = visibleItems();
  const nextKey = (items[items.findIndex((x) => x.key === item.key) + 1] || {}).key;
  const result = await api.file(item.file, ui.edits[item.file] || {});
  if (result.ok) {
    delete ui.edits[item.file];
    ui.selected = nextKey || null;
    showToast(result.entry);
  } else {
    alertNote(result.message);
  }
  await refresh();
}

async function leaveSelected() {
  const item = selectedItem();
  if (!item || ui.view !== 'review') return;
  const items = visibleItems();
  ui.selected = (items[items.findIndex((x) => x.key === item.key) + 1] || {}).key || null;
  await api.leave(item.file);
  await refresh();
}

function alertNote(message) {
  const body = $('insp-body');
  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = message;
  body.prepend(note);
}

function showToast(entry) {
  const toast = $('toast');
  $('toast-title').textContent = `Filed to ${LABEL[entry.category] || 'Other'}`;
  $('toast-sub').textContent = display(entry.name);
  $('toast-thumb').removeAttribute('src');
  api.thumb(entry.to).then((url) => { if (url) $('toast-thumb').src = url; });
  toast.dataset.id = entry.id;
  toast.hidden = false;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

function zoom(file) {
  const layer = document.createElement('div');
  layer.className = 'zoom';
  layer.innerHTML = '<img alt="">';
  api.thumb(file).then((url) => { if (url) layer.querySelector('img').src = url; });
  layer.addEventListener('click', () => layer.remove());
  document.body.append(layer);
}

// ---------- Sheets: settings and first run ----------

function openSheet(html, onReady) {
  $('sheet').innerHTML = html;
  $('scrim').hidden = false;
  if (onReady) onReady($('sheet'));
}

function closeSheet() {
  $('scrim').hidden = true;
  $('sheet').innerHTML = '';
}

let welcomeShown = false;
function openWelcome() {
  if (welcomeShown) return;
  welcomeShown = true;
  const s = ui.state.settings;
  let reader = s.reader;
  openSheet(`
    <div class="app-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/></svg></div>
    <h2 class="sec">Welcome to Snapsort</h2>
    <p class="lead">Snapsort names your screenshots by what’s in them and files them into folders: Design, Web, Code, Receipts, Chats and Documents. Anything it isn’t sure about waits for you to check.</p>
    <div class="sec"><h3>Watching</h3><div class="rows"><div class="row"><div class="rt"><b>${esc(shortPath(s.sources[0]))}</b><span>${esc(s.sources[0])}</span></div><button class="btn" data-sheet="pick-source">Change</button></div></div></div>
    <div class="sec"><h3>How should it read screenshots?</h3>
      <div class="choice">
        <button data-reader="device" class="${reader === 'device' ? 'on' : ''}"><b>On this PC</b><span>Free and private. Reads the text with Windows’ own OCR.</span></button>
        <button data-reader="claude" class="${reader === 'claude' ? 'on' : ''}"><b>With Claude</b><span>Sharper names from the whole image. Needs your API key; about half a penny a screenshot.</span></button>
      </div>
      <div class="rows" id="welcome-key" ${reader === 'claude' ? '' : 'hidden'}><div class="row"><div class="rt"><b>Claude API key</b><span>Stored encrypted on this PC.</span></div><div class="field"><input id="welcome-key-input" type="password" placeholder="sk-ant-…"></div></div></div>
    </div>
    <div class="sheet-foot"><button class="btn" data-sheet="sort-existing-later">Start</button><button class="btn primary" data-sheet="start-and-sort">Start and sort what’s there</button></div>`,
  (sheet) => {
    sheet.addEventListener('click', (e) => {
      const r = e.target.closest('[data-reader]');
      if (!r) return;
      reader = r.dataset.reader;
      for (const b of sheet.querySelectorAll('[data-reader]')) b.classList.toggle('on', b === r);
      $('welcome-key').hidden = reader !== 'claude';
    });
    sheet.dataset.kind = 'welcome';
    sheet.getReader = () => reader;
  });
}

function settingsRow(title, sub, control) {
  return `<div class="row"><div class="rt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${control}</div>`;
}

function toggle(id, on) {
  return `<button class="toggle ${on ? '' : 'off'}" role="switch" aria-checked="${on}" data-setting="${id}"></button>`;
}

function seg(id, value, options) {
  return `<div class="seg wide" data-seg="${id}">${options.map(([v, l]) => `<button data-value="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function openSettings() {
  const s = ui.state.settings;
  const u = ui.state.update;
  const updateText = { ready: `Version ${u.version} is ready`, downloading: `Downloading ${u.version}…`, checking: 'Checking…', 'up-to-date': 'Up to date', unavailable: 'Only in the installed app', error: 'Couldn’t check', idle: '' }[u.status] || '';
  openSheet(`
    <div class="sheet-head"><h2>Settings</h2><button class="btn" data-sheet="close" aria-label="Close">${icon('close')}</button></div>
    <div class="sec"><h3>Folders</h3><div class="rows">
      ${settingsRow('Watch', esc(s.sources[0]), '<button class="btn" data-sheet="pick-source">Change</button>')}
      ${settingsRow('File into', esc(s.destination), '<button class="btn" data-sheet="pick-dest">Change</button>')}
    </div></div>
    <div class="sec"><h3>Reading</h3><div class="rows">
      ${settingsRow('Read screenshots', 'Claude falls back to on-device if it can’t be reached.', seg('reader', s.reader, [['device', 'On this PC'], ['claude', 'With Claude']]))}
      ${settingsRow('Claude API key', s.hasApiKey ? 'Saved and encrypted on this PC.' : 'From console.anthropic.com. Stored encrypted.', `<div class="field"><input id="key-input" type="password" placeholder="${s.hasApiKey ? '••••••••••••' : 'sk-ant-…'}"></div>`)}
      ${settingsRow('Claude model', 'Best gives the sharpest names. Cheapest is a fraction of the cost.', seg('claudeModel', s.claudeModel, [['best', 'Best'], ['cheapest', 'Cheapest']]))}
      <div class="row" id="key-result" hidden></div>
    </div></div>
    <div class="sec"><h3>Filing</h3><div class="rows">
      ${settingsRow('File automatically', 'When Snapsort is sure. Everything else waits in To review.', toggle('autoFile', s.autoFile))}
      ${settingsRow('How sure', 'Careful sends more to review.', seg('sureness', s.sureness, [['careful', 'Careful'], ['balanced', 'Balanced'], ['relaxed', 'Relaxed']]))}
      ${settingsRow('Start names with the date', '2026-10-31 Figma – Onboarding flow', toggle('datePrefix', s.datePrefix))}
    </div></div>
    <div class="sec"><h3>General</h3><div class="rows">
      ${settingsRow('Open when Windows starts', 'Starts in the tray.', toggle('startWithWindows', s.startWithWindows))}
      ${settingsRow('Notifications', 'When the window is hidden.', seg('notifications', s.notifications, [['each', 'On'], ['off', 'Off']]))}
      ${settingsRow('Appearance', '', seg('theme', s.theme, [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]))}
      ${settingsRow('Update automatically', `Version ${esc(u.current)}${updateText ? ` · ${esc(updateText)}` : ''}`, u.status === 'ready' ? '<button class="btn primary" data-sheet="install-update">Restart</button>' : toggle('autoUpdate', s.autoUpdate))}
    </div></div>
    <div class="sheet-foot"><button class="btn" data-sheet="check-updates">Check for updates</button><button class="btn primary" data-sheet="close">Done</button></div>`,
  (sheet) => { sheet.dataset.kind = 'settings'; });
}

async function saveSetting(changes) {
  ui.state = await api.saveSettings(changes);
  render();
}

async function handleSheetClick(e) {
  const sheet = $('sheet');
  const t = e.target.closest('[data-sheet], [data-setting], [data-seg] button');
  if (!t) return;
  if (t.dataset.setting) {
    const id = t.dataset.setting;
    const on = t.classList.contains('off');
    t.classList.toggle('off', !on);
    t.setAttribute('aria-checked', String(on));
    await saveSetting({ [id]: on });
    return;
  }
  const segEl = t.closest('[data-seg]');
  if (segEl) {
    for (const b of segEl.querySelectorAll('button')) b.classList.toggle('on', b === t);
    await saveSetting({ [segEl.dataset.seg]: t.dataset.value });
    return;
  }
  switch (t.dataset.sheet) {
    case 'close': closeSheet(); break;
    case 'pick-source': {
      const dir = await api.pickFolder('Choose the folder your screenshots are saved to');
      if (dir) { await saveSetting({ sources: [dir] }); sheet.dataset.kind === 'settings' ? openSettings() : (welcomeShown = false, openWelcome()); }
      break;
    }
    case 'pick-dest': {
      const dir = await api.pickFolder('Choose where filed screenshots go');
      if (dir) { await saveSetting({ destination: dir }); openSettings(); }
      break;
    }
    case 'check-updates': await api.checkUpdates(); break;
    case 'install-update': await api.installUpdate(); break;
    case 'sort-existing-later':
    case 'start-and-sort': {
      const changes = { setupDone: true, reader: sheet.getReader() };
      const key = $('welcome-key-input') && $('welcome-key-input').value.trim();
      if (key) changes.apiKey = key;
      await saveSetting(changes);
      closeSheet();
      if (t.dataset.sheet === 'start-and-sort') { await go('review'); api.sortExisting(); }
      break;
    }
    default: break;
  }
}

async function handleKeyChange(input) {
  const key = input.value.trim();
  if (!key) return;
  const result = $('key-result');
  result.hidden = false;
  result.innerHTML = '<span class="rt">Checking the key…</span>';
  const test = await api.testKey(key);
  if (test.ok) {
    await saveSetting({ apiKey: key, reader: 'claude' });
    openSettings();
    $('key-result').hidden = false;
    $('key-result').innerHTML = '<span class="ok-text">Key works. Snapsort will read with Claude.</span>';
  } else {
    result.innerHTML = `<span class="bad-text">${esc(test.message)}</span>`;
  }
}

// ---------- Events ----------

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('#nav [data-view]');
  if (nav) { go(nav.dataset.view); return; }
  const tile = e.target.closest('.tile');
  if (tile) { select(tile.dataset.key); return; }
  const zoomEl = e.target.closest('[data-zoom]');
  if (zoomEl) { zoom(zoomEl.dataset.zoom); return; }
  const layout = e.target.closest('[data-layout]');
  if (layout) { ui.layout = layout.dataset.layout; localStorage.setItem('layout', ui.layout); render(); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const item = selectedItem();
  switch (act.dataset.act) {
    case 'file': fileSelected(); break;
    case 'leave': leaveSelected(); break;
    case 'reread': act.disabled = true; act.textContent = 'Reading…'; delete ui.edits[item.file]; await api.reread(item.file); refresh(); break;
    case 'undo': {
      const r = await api.undo(item.raw.id);
      if (!r.ok) alertNote(r.message);
      refresh();
      break;
    }
    case 'show': api.showInFolder(item.file); break;
    case 'open': api.openFile(item.file); break;
    case 'sort-existing': api.sortExisting(); break;
    default: break;
  }
});

$('primary-action').addEventListener('click', async () => {
  if (ui.view === 'review') {
    if (ui.state.review.length) {
      const n = ui.state.review.length;
      const r = await api.fileAll();
      if (r.filed && r.filed < n) alertNote(`Filed ${r.filed}. ${plural(r.failed, 'couldn’t', 'couldn’t')} be moved.`);
    } else {
      api.sortExisting();
    }
    refresh();
  } else if (ui.view.startsWith('folder:')) {
    api.openFolder(ui.view.slice(7));
  }
});

$('pause-toggle').addEventListener('click', async () => {
  ui.state = await api.setPaused(!ui.state.paused);
  render();
});

$('open-settings').addEventListener('click', openSettings);

$('search').addEventListener('input', (e) => {
  ui.query = e.target.value;
  renderBar();
  renderTiles();
  renderInspector();
});

// Name and folder edits in the inspector are kept per file until it's filed.
document.addEventListener('input', (e) => {
  const item = selectedItem();
  if (!item || ui.view !== 'review') return;
  if (e.target.id === 'name-input') {
    ui.edits[item.file] = { ...ui.edits[item.file], description: e.target.value };
    const hint = e.target.closest('div').parentElement.querySelector('.hint-small');
    if (hint) hint.textContent = `Saved as ${item.raw.date} ${e.target.value}${ext(item.file)}`;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'key-input') { handleKeyChange(e.target); return; }
  const item = selectedItem();
  if (!item || ui.view !== 'review' || e.target.id !== 'cat-select') return;
  ui.edits[item.file] = { ...ui.edits[item.file], category: e.target.value };
  $('cat-dot').className = `dot cat-${e.target.value}`;
});

$('sheet').addEventListener('click', handleSheetClick);
$('scrim').addEventListener('click', (e) => { if (e.target === $('scrim') && $('sheet').dataset.kind === 'settings') closeSheet(); });

$('toast-undo').addEventListener('click', async () => {
  const id = $('toast').dataset.id;
  $('toast').hidden = true;
  await api.undo(id);
  refresh();
});

document.addEventListener('keydown', (e) => {
  if (!$('scrim').hidden) {
    if (e.key === 'Escape' && $('sheet').dataset.kind === 'settings') closeSheet();
    return;
  }
  const zoomLayer = document.querySelector('.zoom');
  if (zoomLayer) { if (e.key === 'Escape' || e.key === ' ') { zoomLayer.remove(); e.preventDefault(); } return; }
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { $('search').focus(); e.preventDefault(); return; }
  if (e.key === 'Enter' && (!typing || document.activeElement.id === 'name-input')) { fileSelected(); e.preventDefault(); return; }
  if (e.key === 'Escape' && typing) { document.activeElement.blur(); return; }
  if (typing) return;
  if (e.key === 'F2') { const n = $('name-input'); if (n) { n.focus(); n.select(); } e.preventDefault(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { leaveSelected(); e.preventDefault(); }
  else if (e.key === ' ') { const item = selectedItem(); if (item) zoom(item.file); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { moveSelection(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { moveSelection(-1); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { moveSelection(ui.layout === 'grid' ? 2 : 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { moveSelection(ui.layout === 'grid' ? -2 : -1); e.preventDefault(); }
});

api.onStateChanged(() => refresh());
api.onFiled((entry) => showToast(entry));
api.onProgress((busy) => { if (ui.state) { ui.state.busy = busy; renderBanner(); renderBar(); if (!busy.running) refresh(); } });
api.onShowPage((page) => go(page));

refresh();
