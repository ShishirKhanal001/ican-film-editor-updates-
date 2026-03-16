/**
 * Translation Route
 * Providers: Claude (Anthropic) | Gemini (Google) | Ollama (free local LLM)
 * All three handle Amharic + Tigrinya accurately.
 */

const express   = require('express');
const router    = express.Router();

const BATCH_SIZE = 30;

router.post('/', async (req, res) => {
  const {
    segments, targetLang,
    anthropicKey, googleKey,  // googleKey = legacy alias for anthropicKey
    geminiKey,
    provider,                 // 'anthropic' | 'gemini' | 'ollama'
    ollamaModel, ollamaUrl
  } = req.body;

  if (!segments || !segments.length) {
    return res.status(400).json({ error: 'No segments to translate.' });
  }

  const resolvedProvider = provider || (geminiKey ? 'gemini' : 'anthropic');
  const lang = targetLang || 'English';

  try {
    let translated;

    if (resolvedProvider === 'gemini') {
      if (!geminiKey) return res.status(400).json({ error: 'Google Gemini API key required.' });
      translated = await translateWithGemini(geminiKey, segments, lang);

    } else if (resolvedProvider === 'ollama') {
      const url   = ollamaUrl  || 'http://localhost:11434';
      const model = ollamaModel || 'llama3.2';
      translated = await translateWithOllama(url, model, segments, lang);

    } else {
      // Default: Anthropic Claude
      const apiKey = anthropicKey || googleKey;
      if (!apiKey) return res.status(400).json({ error: 'Anthropic API key required.' });
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      translated = await translateWithClaude(client, segments, lang);
    }

    res.json({ segments: translated, count: translated.length });
  } catch (err) {
    console.error('[Translate Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Shared translation prompt ----
function buildPrompt(texts, targetLang) {
  return `You are a professional translator specializing in Ethiopian and Eritrean languages.

Translate each text segment to ${targetLang}.
These are from a video transcript — may contain Amharic (አማርኛ), Tigrinya (ትግርኛ), or mixed languages.

Rules:
- Translate naturally and conversationally, not word-for-word
- Preserve names of people, places, and brands as-is
- If a segment is already in ${targetLang}, return it unchanged
- If inaudible or noise (e.g. "[inaudible]"), return as-is
- Return ONLY a valid JSON array of strings, one per input, same order
- No explanation, no markdown, just the JSON array

Segments:
${JSON.stringify(texts)}`;
}

function applyTranslations(result, batch, translations, offset) {
  for (let j = 0; j < batch.length; j++) {
    result[offset + j] = {
      ...result[offset + j],
      english: (translations[j] || batch[j].original || '').trim()
    };
  }
}

function safeParseArray(rawText, fallback) {
  try {
    const cleaned = rawText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return fallback;
}

// ---- Claude (Anthropic) ----
async function translateWithClaude(client, segments, targetLang) {
  const result = [...segments];
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const texts = batch.map(s => s.original);
    console.log(`[Translate/Claude] Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(segments.length/BATCH_SIZE)}`);
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: buildPrompt(texts, targetLang) }]
    });
    const translations = safeParseArray(msg.content[0].text, texts);
    applyTranslations(result, batch, translations, i);
  }
  return result;
}

// ---- Gemini (Google) ----
async function translateWithGemini(apiKey, segments, targetLang) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = [...segments];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const texts = batch.map(s => s.original);
    console.log(`[Translate/Gemini] Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(segments.length/BATCH_SIZE)}`);
    const response = await model.generateContent(buildPrompt(texts, targetLang));
    const translations = safeParseArray(response.response.text(), texts);
    applyTranslations(result, batch, translations, i);
  }
  return result;
}

// ---- Ollama (local free LLM) ----
async function translateWithOllama(ollamaUrl, modelName, segments, targetLang) {
  const fetch  = require('node-fetch');
  const result = [...segments];

  // First check Ollama is running
  try {
    const health = await fetch(`${ollamaUrl}/api/tags`, { timeout: 3000 });
    if (!health.ok) throw new Error('Ollama not responding');
  } catch {
    throw new Error(`Ollama is not running at ${ollamaUrl}. Download it free from ollama.com and run: ollama pull ${modelName}`);
  }

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const texts = batch.map(s => s.original);
    console.log(`[Translate/Ollama:${modelName}] Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(segments.length/BATCH_SIZE)}`);

    const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    modelName,
        messages: [{ role: 'user', content: buildPrompt(texts, targetLang) }],
        stream:   false
      })
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    const translations = safeParseArray(data.choices[0].message.content, texts);
    applyTranslations(result, batch, translations, i);
  }
  return result;
}

module.exports = router;
