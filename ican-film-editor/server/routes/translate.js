/**
 * Translation Route
 * Providers: Claude (Anthropic) | Groq (FREE) | Gemini (Google) | Ollama (free local LLM)
 * All handle Amharic + Tigrinya accurately.
 */

const express   = require('express');
const router    = express.Router();

const BATCH_SIZE = 30;

router.post('/', async (req, res) => {
  const {
    segments, targetLang,
    anthropicKey, googleKey,  // googleKey = legacy alias for anthropicKey
    geminiKey, groqKey,
    provider,                 // 'anthropic' | 'groq' | 'gemini' | 'ollama'
    ollamaModel, ollamaUrl
  } = req.body;

  if (!segments || !segments.length) {
    return res.status(400).json({ error: 'No segments to translate.' });
  }

  const resolvedProvider = provider || (groqKey ? 'groq' : geminiKey ? 'gemini' : 'anthropic');
  const lang = targetLang || 'English';

  try {
    let translated;

    if (resolvedProvider === 'groq') {
      if (!groqKey) return res.status(400).json({ error: 'Groq API key required.' });
      translated = await translateWithGroq(groqKey, segments, lang);

    } else if (resolvedProvider === 'gemini') {
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
  return `You are a professional translator specializing in Ethiopian and Eritrean languages (Amharic አማርኛ and Tigrinya ትግርኛ).

TASK: Translate each text segment below to ${targetLang}.
These are from a video interview/discussion transcript. The speakers are discussing real topics — listen for the actual meaning.

CRITICAL RULES:
- These segments contain Amharic (አማርኛ) or Tigrinya (ትግርኛ) text in Ge'ez script (ገእዝ)
- Translate the MEANING, not transliterate the sounds
- If a segment contains garbled/corrupted text that makes no sense, return "[unclear]" — do NOT invent fake translations
- If a segment is already in ${targetLang}, return it unchanged
- Preserve names of people, places, organizations, and brands as-is
- Return ONLY a valid JSON array of strings, one per input, same order
- No explanation, no markdown, no code blocks — just the raw JSON array

INPUT SEGMENTS (${texts.length} total):
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

// ---- Groq — uses best available multilingual model ----
// Llama 4 Scout and Kimi K2 are far better at Amharic/Tigrinya than Llama 3.3
const GROQ_TRANSLATE_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',  // Best multilingual
  'qwen/qwen3-32b',                              // Strong multilingual
  'llama-3.3-70b-versatile',                      // Fallback
  'llama3-70b-8192'                               // Last resort
];
const GROQ_BATCH_SIZE = 15; // Smaller batches = better translation quality for non-Latin scripts

async function translateWithGroq(apiKey, segments, targetLang) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  const result = [...segments];

  // Find a working model
  let workingModelName = GROQ_TRANSLATE_MODELS[0];
  for (const modelName of GROQ_TRANSLATE_MODELS) {
    try {
      await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        max_tokens: 10
      });
      workingModelName = modelName;
      console.log(`[Translate/Groq] Using model: ${workingModelName}`);
      break;
    } catch (e) {
      console.log(`[Translate/Groq] Model ${modelName} failed: ${e.message.substring(0, 80)}`);
    }
  }

  for (let i = 0; i < segments.length; i += GROQ_BATCH_SIZE) {
    const batch = segments.slice(i, i + GROQ_BATCH_SIZE);
    const texts = batch.map(s => s.original);
    console.log(`[Translate/Groq] Batch ${Math.floor(i/GROQ_BATCH_SIZE)+1}/${Math.ceil(segments.length/GROQ_BATCH_SIZE)}`);

    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await client.chat.completions.create({
          model:    workingModelName,
          messages: [
            { role: 'system', content: 'You are an expert Amharic/Tigrinya to English translator. You MUST return a JSON array of translated strings. Never invent content — if text is garbled, return "[unclear]".' },
            { role: 'user', content: buildPrompt(texts, targetLang) }
          ],
          max_tokens: 4096,
          temperature: 0.1  // Lower temperature = more accurate translations
        });
        break;
      } catch (e) {
        retries--;
        if ((e.message.includes('429') || e.message.includes('rate_limit')) && retries > 0) {
          console.log(`[Translate/Groq] Rate limited — waiting 8s (${retries} retries left)...`);
          await new Promise(r => setTimeout(r, 8000));
        } else {
          throw e;
        }
      }
    }

    const translations = safeParseArray(response.choices[0].message.content, texts);
    applyTranslations(result, batch, translations, i);

    // Delay between batches for rate limits
    if (i + GROQ_BATCH_SIZE < segments.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return result;
}

// ---- Gemini (Google) ----
// Try multiple models in order: gemini-2.0-flash-lite (highest free limits) → gemini-2.0-flash → gemini-1.5-flash
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];

async function translateWithGemini(apiKey, segments, targetLang) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const result = [...segments];

  // Find a working model
  let workingModel = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const testModel = genAI.getGenerativeModel({ model: modelName });
      await testModel.generateContent('Say "ok"');
      workingModel = testModel;
      console.log(`[Translate/Gemini] Using model: ${modelName}`);
      break;
    } catch (e) {
      console.log(`[Translate/Gemini] Model ${modelName} unavailable: ${e.message.substring(0, 80)}`);
      continue;
    }
  }

  if (!workingModel) {
    throw new Error('All Gemini models failed — your free tier quota may be exhausted. Switch to Ollama (free local) in Settings, or enable billing on Google AI Studio.');
  }

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const texts = batch.map(s => s.original);
    console.log(`[Translate/Gemini] Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(segments.length/BATCH_SIZE)}`);

    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await workingModel.generateContent(buildPrompt(texts, targetLang));
        break;
      } catch (e) {
        retries--;
        if (e.message.includes('429') && retries > 0) {
          console.log(`[Translate/Gemini] Rate limited — waiting 10s (${retries} retries left)...`);
          await new Promise(r => setTimeout(r, 10000));
        } else {
          throw e;
        }
      }
    }

    const translations = safeParseArray(response.response.text(), texts);
    applyTranslations(result, batch, translations, i);

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < segments.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
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
