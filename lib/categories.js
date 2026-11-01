'use strict';

// The folders screenshots are filed into. `words` are the on-device clues: each one found in
// the screenshot's text adds `weight` to that category's score. Multi-word clues and app names
// are worth more because they're rarely there by chance.
const CATEGORIES = [
  {
    id: 'design',
    label: 'Design',
    folder: 'Design',
    words: [
      ['figma', 3], ['frame', 1], ['auto layout', 3], ['layers', 1.5], ['prototype', 2], ['components', 1.5],
      ['artboard', 3], ['photoshop', 3], ['illustrator', 3], ['canva', 3], ['sketch', 1.5], ['framer', 2],
      ['fill', 0.75], ['stroke', 1], ['opacity', 1.5], ['typography', 2], ['inspect', 1], ['dev mode', 2],
      ['constraints', 1.5], ['variants', 1.5], ['hex', 1], ['corner radius', 3], ['line height', 2],
      ['letter spacing', 2], ['adobe', 2], ['dribbble', 3], ['behance', 3], ['wireframe', 3], ['mockup', 2],
    ],
  },
  {
    id: 'web',
    label: 'Web',
    folder: 'Web',
    words: [
      ['https://', 2], ['http://', 2], ['www.', 2], ['.com', 1], ['.co.uk', 1.5], ['.org', 1], ['.io', 1],
      ['accept cookies', 3], ['cookie', 1.5], ['sign in', 1], ['log in', 1], ['subscribe', 1], ['search', 0.5],
      ['menu', 0.5], ['about us', 2], ['contact us', 2], ['privacy policy', 2], ['read more', 1.5],
      ['chrome', 1.5], ['edge', 0.5], ['firefox', 2], ['safari', 1.5], ['new tab', 2], ['bookmarks', 1.5],
    ],
  },
  {
    id: 'code',
    label: 'Code',
    folder: 'Code',
    words: [
      ['function', 1.5], ['const ', 1.5], ['import ', 1], ['return', 1], ['=>', 1.5], ['console.log', 3],
      ['npm ', 2], ['git ', 1.5], ['error:', 1.5], ['exception', 1.5], ['traceback', 3], ['undefined', 1.5],
      ['visual studio code', 3], ['vs code', 3], ['terminal', 1.5], ['powershell', 2], ['localhost', 2],
      ['github', 2], ['pull request', 2], ['commit', 1], ['def ', 1.5], ['class ', 1], ['</', 1.5],
      ['stack trace', 3], ['null', 0.75], ['async', 1.5], ['await', 1.5],
    ],
  },
  {
    id: 'receipts',
    label: 'Receipts',
    folder: 'Receipts',
    words: [
      ['receipt', 3], ['invoice', 3], ['order number', 3], ['order #', 3], ['order confirmed', 3],
      ['subtotal', 3], ['total', 1], ['vat', 1.5], ['paid', 1.5], ['payment', 1.5], ['delivery', 1],
      ['dispatched', 2], ['refund', 2], ['transaction', 2], ['card ending', 3], ['booking reference', 3],
      ['confirmation', 1.5], ['qty', 2], ['amount', 1], ['£', 1], ['€', 1], ['$', 0.5], ['paypal', 2],
    ],
  },
  {
    id: 'chats',
    label: 'Chats',
    folder: 'Chats',
    words: [
      ['whatsapp', 3], ['messenger', 3], ['imessage', 3], ['slack', 2.5], ['teams', 1.5], ['discord', 3],
      ['telegram', 3], ['signal', 1], ['type a message', 3], ['message', 1], ['typing', 1.5], ['online', 1],
      ['last seen', 3], ['delivered', 1], ['read ', 0.5], ['reply', 1], ['thread', 1], ['reacted', 2],
      ['sent', 0.75], ['today', 0.5], ['yesterday', 1],
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    folder: 'Documents',
    words: [
      ['page ', 1], ['chapter', 2], ['word', 1], ['google docs', 3], ['microsoft word', 3], ['pdf', 2],
      ['notion', 2.5], ['obsidian', 3], ['heading', 1.5], ['table of contents', 3], ['dear ', 1.5],
      ['regards', 2], ['agenda', 2], ['minutes', 1], ['spreadsheet', 2], ['excel', 2], ['slide', 1.5],
      ['powerpoint', 3], ['keynote', 2.5], ['cv', 1.5], ['curriculum vitae', 3], ['cover letter', 3],
    ],
  },
];

// Anything without a strong match lands here. It's a real folder too, so "File it" always works.
const OTHER = { id: 'other', label: 'Other', folder: 'Other', words: [] };

const ALL = [...CATEGORIES, OTHER];

function byId(id) {
  return ALL.find((c) => c.id === id) || OTHER;
}

module.exports = { CATEGORIES, OTHER, ALL, byId };
