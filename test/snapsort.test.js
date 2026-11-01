'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { classifyText, findBrand, findTitle } = require('../lib/classify');
const { safeName, takenOn, describe, buildFileName, isImage } = require('../lib/naming');
const { analyse } = require('../lib/analyse');
const { Queue } = require('../lib/queue');
const { History } = require('../lib/history');
const { fileScreenshot, undoFiling } = require('../lib/sorter');
const { describeWithClaude } = require('../lib/claude');
const { readText } = require('../lib/ocr');

const TEST_ROOT = path.join(__dirname, '..', 'tmp-tests');
after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

function tempDir() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'run-'));
}

function shot(dir, name = 'Screenshot 2026-10-31 224512.png') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'pixels');
  return file;
}

// ---------- On-device classifying ----------

test('classifyText: a Figma screen is Design, named after the frame', () => {
  const text = ['Figma', 'File Edit View', 'Layers', 'Assets', 'Onboarding flow', 'Auto layout', 'Fill', 'Stroke', 'Corner radius 12'].join('\n');
  const r = classifyText(text);
  assert.equal(r.category, 'design');
  assert.equal(r.app, 'Figma');
  assert.equal(r.title, 'Onboarding flow');
  assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
});

test('classifyText: a receipt is Receipts', () => {
  const r = classifyText('Order confirmed\nOrder number 204-118\nSubtotal £24.00\nVAT £4.80\nTotal paid £28.80');
  assert.equal(r.category, 'receipts');
  assert.equal(r.title, 'Order confirmed');
});

test('classifyText: a chat is Chats and code is Code', () => {
  assert.equal(classifyText('WhatsApp\nMum\nlast seen today at 21:04\nType a message').category, 'chats');
  assert.equal(classifyText('const x = await load()\nconsole.log(x)\nTypeError: undefined is not a function').category, 'code');
});

test('classifyText: little or no text is Other, with low confidence', () => {
  assert.deepEqual([classifyText('').category, classifyText('').confidence], ['other', 0]);
  const r = classifyText('Hello there');
  assert.equal(r.category, 'other');
  assert.ok(r.confidence < 0.5);
});

test('classifyText: a near tie is less sure than a clear winner', () => {
  const clear = classifyText('Figma Auto layout Corner radius Prototype Components');
  const tie = classifyText('Figma prototype\nconst x = 1\nconsole.log(x)');
  assert.ok(tie.confidence < clear.confidence);
});

test('findBrand: named apps first, then a web address', () => {
  assert.equal(findBrand('Shared in Slack'), 'Slack');
  assert.equal(findBrand('https://www.forestandfield.co.uk/shop'), 'forestandfield.co.uk');
  assert.equal(findBrand('nothing here'), null);
});

test('findTitle: skips menus, times and prices', () => {
  assert.equal(findTitle(['File', '10:42', '£12.00', 'Pricing cards v3', 'Share'], null), 'Pricing cards v3');
  assert.equal(findTitle(['OK'], null), '');
});

// ---------- Naming ----------

test('safeName: removes characters Windows forbids', () => {
  assert.equal(safeName('Figma: "Home"/v2?'), 'Figma Home v2');
  assert.equal(safeName('trailing dots...'), 'trailing dots');
});

test('takenOn: prefers the date in the file name', () => {
  assert.equal(takenOn('Screenshot 2026-10-31 224512.png', Date.UTC(2020, 0, 1)), '2026-10-31');
  assert.equal(takenOn('Screenshot_20261030_101010.png', Date.UTC(2020, 0, 1)), '2026-10-30');
  assert.equal(takenOn('Screenshot (12).png', new Date(2026, 4, 2).getTime()), '2026-05-02');
});

test('describe and buildFileName: app, title and date', () => {
  assert.equal(describe({ category: 'design', app: 'Figma', title: 'Onboarding flow' }), 'Figma – Onboarding flow');
  assert.equal(describe({ category: 'receipts', app: null, title: '' }), 'Receipts');
  assert.equal(describe({ category: 'web', app: 'GitHub', title: 'GitHub pull request' }), 'GitHub pull request');
  assert.equal(buildFileName({ description: 'Figma – Onboarding flow', date: '2026-10-31', ext: '.PNG' }), '2026-10-31 Figma – Onboarding flow.png');
  assert.equal(buildFileName({ description: 'Figma', date: '2026-10-31', ext: '.png', datePrefix: false }), 'Figma.png');
});

test('isImage: screenshots only', () => {
  assert.ok(isImage('a.PNG'));
  assert.ok(isImage('b.jpeg'));
  assert.ok(!isImage('c.pdf'));
});

// ---------- Analysing ----------

test('analyse: on-device result with a new name', async () => {
  const file = shot(tempDir());
  const s = await analyse(file, { readText: async () => ['Order confirmed', 'Subtotal £24.00', 'Total paid £28.80', 'VAT £4.80'] });
  assert.equal(s.category, 'receipts');
  assert.equal(s.engine, 'device');
  assert.equal(s.newName, '2026-10-31 Receipts – Order confirmed.png');
});

test('analyse: Claude gets the final say when switched on', async () => {
  const file = shot(tempDir());
  const s = await analyse(file, {
    readText: async () => ['some text'],
    useClaude: true,
    describeImage: async (f, text) => {
      assert.equal(f, file);
      assert.equal(text, 'some text');
      return { category: 'design', app: 'Figma', title: 'Pricing cards', confidence: 0.94 };
    },
  });
  assert.equal(s.engine, 'claude');
  assert.equal(s.newName, '2026-10-31 Figma – Pricing cards.png');
});

test('analyse: falls back to on-device when Claude fails, and says why', async () => {
  const file = shot(tempDir());
  const s = await analyse(file, {
    readText: async () => ['WhatsApp', 'Type a message', 'last seen today'],
    useClaude: true,
    describeImage: async () => { throw new Error('offline'); },
    explainError: () => "Couldn't reach Claude",
  });
  assert.equal(s.engine, 'device');
  assert.equal(s.category, 'chats');
  assert.equal(s.note, "Couldn't reach Claude");
});

test('analyse: an OCR failure still gives a suggestion', async () => {
  const file = shot(tempDir());
  const s = await analyse(file, { readText: async () => { throw new Error('OCR failed: no language'); } });
  assert.equal(s.category, 'other');
  assert.equal(s.confidence, 0);
  assert.match(s.note, /OCR failed/);
});

// ---------- Review list ----------

test('Queue: one entry per file, saved to disk, pruned when files go', () => {
  const dir = tempDir();
  const store = path.join(dir, 'queue.json');
  const a = shot(dir, 'a.png');
  const q = new Queue(store);
  q.put({ file: a, n: 1 });
  q.put({ file: path.join(dir, '.', 'a.png'), n: 2 });
  assert.equal(q.items.length, 1);
  assert.equal(new Queue(store).get(a).n, 2);
  q.put({ file: path.join(dir, 'gone.png') });
  assert.equal(q.prune(), 1);
  q.remove(a);
  assert.equal(new Queue(store).items.length, 0);
});

// ---------- Filing and undo ----------

test('fileScreenshot: moves into the category folder under the new name, then undo puts it back', () => {
  const dir = tempDir();
  const file = shot(dir);
  const history = new History(path.join(dir, 'history.json'));
  const suggestion = { file, category: 'design', engine: 'device', confidence: 0.8, date: '2026-10-31', newName: '2026-10-31 Figma – Onboarding flow.png' };

  const entry = fileScreenshot(suggestion, { destination: dir, history });
  assert.equal(entry.to, path.join(dir, 'Design', '2026-10-31 Figma – Onboarding flow.png'));
  assert.ok(fs.existsSync(entry.to));
  assert.ok(!fs.existsSync(file));
  assert.equal(entry.category, 'design');

  const undone = undoFiling(entry, history);
  assert.ok(undone.ok);
  assert.ok(fs.existsSync(file));
  assert.equal(undoFiling(history.get(entry.id), history).ok, false);
});

test('fileScreenshot: edits from the review list win, and names never clash', () => {
  const dir = tempDir();
  const history = new History(path.join(dir, 'history.json'));
  const base = { category: 'other', engine: 'device', confidence: 0.3, date: '2026-10-31', newName: 'x.png' };
  const edits = { category: 'chats', description: 'WhatsApp – Mum' };
  const one = fileScreenshot({ ...base, file: shot(dir, 'one.png') }, { destination: dir, history, edits });
  const two = fileScreenshot({ ...base, file: shot(dir, 'two.png') }, { destination: dir, history, edits });
  assert.equal(path.basename(one.to), '2026-10-31 WhatsApp – Mum.png');
  assert.equal(path.basename(two.to), '2026-10-31 WhatsApp – Mum (2).png');
  assert.equal(path.basename(path.dirname(two.to)), 'Chats');
});

test('fileScreenshot: a file that has gone says so', () => {
  const dir = tempDir();
  const history = new History(path.join(dir, 'history.json'));
  assert.throws(() => fileScreenshot({ file: path.join(dir, 'nope.png'), category: 'web', newName: 'n.png' }, { destination: dir, history }), /No longer there/);
});

// ---------- Claude ----------

test('describeWithClaude: sends the image and reads the structured answer', async () => {
  let sent;
  const makeClient = (key) => {
    assert.equal(key, 'sk-test');
    return { messages: { create: async (req) => { sent = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"category":"web","app":"bbc.co.uk","title":"Weather for London","confidence":0.91}' }] }; } } };
  };
  const r = await describeWithClaude({ apiKey: 'sk-test', image: { data: Buffer.from('img'), mediaType: 'image/jpeg' }, ocrText: 'BBC Weather', makeClient });
  assert.deepEqual(r, { category: 'web', app: 'bbc.co.uk', title: 'Weather for London', confidence: 0.91 });
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.messages[0].content[0].source.data, Buffer.from('img').toString('base64'));
});

test('describeWithClaude: unknown categories become Other, and refusals throw', async () => {
  const reply = (stop, text) => () => ({ messages: { create: async () => ({ stop_reason: stop, content: [{ type: 'text', text }] }) } });
  const image = { data: Buffer.from('i'), mediaType: 'image/png' };
  const r = await describeWithClaude({ apiKey: 'k', image, makeClient: reply('end_turn', '{"category":"memes","app":"","title":"Cat","confidence":4}') });
  assert.equal(r.category, 'other');
  assert.equal(r.app, null);
  assert.equal(r.confidence, 1);
  await assert.rejects(describeWithClaude({ apiKey: 'k', image, makeClient: reply('refusal', '') }), /declined/);
});

// ---------- OCR ----------

test('readText: reads the text in a real screenshot (Windows only)', { skip: process.platform !== 'win32' }, async () => {
  const lines = await readText(path.join(__dirname, 'fixtures', 'receipt.png'));
  const text = lines.join('\n');
  assert.match(text, /Order confirmed/i);
  assert.equal(classifyText(text).category, 'receipts');
});

test('readText: no OCR away from Windows', async () => {
  assert.deepEqual(await readText('x.png', { platform: 'linux' }), []);
});
