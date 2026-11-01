'use strict';

const { CATEGORIES, OTHER } = require('./categories');

const MODELS = {
  best: 'claude-opus-5-5',
  cheapest: 'claude-haiku-5-5',
};

const CATEGORY_IDS = [...CATEGORIES, OTHER].map((c) => c.id);

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORY_IDS },
    app: { type: 'string', description: 'The app or website shown, e.g. "Figma" or "bbc.co.uk". Empty if unclear.' },
    title: { type: 'string', description: 'A short, specific title for what the screenshot shows, 2 to 6 words, sentence case.' },
    confidence: { type: 'number', description: 'How sure you are of the category, from 0 to 1.' },
  },
  required: ['category', 'app', 'title', 'confidence'],
  additionalProperties: false,
};

const SYSTEM = [
  'You name and file screenshots for a designer.',
  'Look at the screenshot and decide which folder it belongs in:',
  ...[...CATEGORIES, OTHER].map((c) => `- ${c.id}: ${c.label}`),
  'Give the app or website it shows, and a short title a person would recognise later,',
  'such as "Onboarding flow", "Order confirmed" or "Build error". Use UK spelling.',
  'Never put personal details such as phone numbers, addresses or card numbers in the title.',
].join('\n');

function loadSdk() {
  // Loaded on first use, so the app starts fast and the on-device mode never needs it.
  return require('@anthropic-ai/sdk');
}

// Asks Claude what a screenshot shows. `image` is { data: Buffer, mediaType }. The OCR text
// is passed too, as it helps with small print. Resolves to { category, app, title, confidence }.
async function describeWithClaude({ apiKey, model = MODELS.best, image, ocrText = '', makeClient }) {
  const Anthropic = makeClient ? null : loadSdk();
  const client = makeClient ? makeClient(apiKey) : new Anthropic({ apiKey, maxRetries: 2, timeout: 60 * 1000 });
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') } },
        { type: 'text', text: ocrText ? `Text found in the screenshot:\n${ocrText.slice(0, 4000)}` : 'No text was found in the screenshot.' },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to describe this screenshot');
  const text = response.content.find((b) => b.type === 'text');
  if (!text) throw new Error('Claude sent back no answer');
  const parsed = JSON.parse(text.text);
  return {
    category: CATEGORY_IDS.includes(parsed.category) ? parsed.category : OTHER.id,
    app: (parsed.app || '').trim() || null,
    title: (parsed.title || '').trim(),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

// Plain-English reason for a failed call, for the screenshot's card in the review list.
function explainError(err, Anthropic = safeSdk()) {
  if (Anthropic) {
    if (err instanceof Anthropic.AuthenticationError) return 'Your Claude API key was turned down. Check it in Settings.';
    if (err instanceof Anthropic.RateLimitError) return 'Claude is busy. Read on-device instead for now.';
    if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Read on-device instead.";
    if (err instanceof Anthropic.APIError) return `Claude had a problem (${err.status}). Read on-device instead.`;
  }
  return err.message;
}

function safeSdk() {
  try {
    return loadSdk();
  } catch {
    return null;
  }
}

module.exports = { describeWithClaude, explainError, MODELS, SCHEMA };
