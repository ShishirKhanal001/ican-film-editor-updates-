/**
 * AI Analysis Route
 * Providers: Claude (Anthropic) | Groq (FREE) | Gemini (Google) | Ollama (free local LLM)
 * Analyzes transcript for: summary, highlights, fillers, reel suggestions
 */

const express = require('express');
const router  = express.Router();

router.post('/', async (req, res) => {
  const {
    segments, options,
    anthropicKey,
    geminiKey, groqKey,
    provider,       // 'anthropic' | 'groq' | 'gemini' | 'ollama'
    ollamaModel, ollamaUrl
  } = req.body;

  if (!segments || !segments.length) {
    return res.status(400).json({ error: 'No transcript segments provided.' });
  }

  const resolvedProvider = provider || (groqKey ? 'groq' : geminiKey ? 'gemini' : 'anthropic');

  // Build transcript text + prompt
  const transcriptText = segments
    .map(s => `[${formatTime(s.timeSec)}-${formatTime(s.endSec || s.timeSec + 3)}] ${s.english}`)
    .join('\n');

  const totalDuration = segments.length > 0
    ? (segments[segments.length - 1].endSec || segments[segments.length - 1].timeSec)
    : 0;

  const taskList = [];
  if (options.summary)    taskList.push('1. SUMMARY: A 2-3 sentence summary of the entire content');
  if (options.highlights) taskList.push('2. HIGHLIGHTS: The most engaging/catchy/important moments');
  if (options.fillers)    taskList.push('3. FILLERS: Filler words, long pauses, repeated phrases to remove');
  if (options.reels)      taskList.push(`4. REELS: The best ${options.reelCount || 2} clips for vertical social media Reels/TikTok/Shorts. EACH REEL MUST BE 60-90 SECONDS LONG (minimum 60 seconds, maximum 90 seconds). Pick moments with a complete story arc.`);

  const prompt = `You are a professional video editor's AI assistant analyzing a timestamped transcript.

TRANSCRIPT:
${transcriptText}

TOTAL DURATION: ${formatTime(totalDuration)}

Provide the following:
${taskList.join('\n')}

Respond ONLY with a valid JSON object (no markdown, no extra text):
{
  "summary": "string (if requested, else omit)",
  "highlights": [{ "startSec": number, "endSec": number, "text": "quoted text", "reason": "why engaging" }],
  "fillers": [{ "startSec": number, "endSec": number, "text": "filler text", "type": "filler word|pause|repetition|off-topic" }],
  "reels": [{ "startSec": number, "endSec": number, "title": "catchy title", "reason": "why great reel" }]
}

RULES:
- All times in seconds matching transcript timestamps
- Empty arrays [] for items not requested
- REELS MUST be 60-90 seconds each (endSec - startSec must be >= 60 and <= 90). This is mandatory.
- Reels should be self-contained stories/moments that work without context
- Highlights should be the most engaging, emotional, or impactful moments (10-30 seconds each)
- Fillers: "um", "uh", repeated sentences, very long silent gaps, off-topic rambling`;

  try {
    let rawResponse;

    if (resolvedProvider === 'groq') {
      if (!groqKey) return res.status(400).json({ error: 'Groq API key required.' });
      rawResponse = await analyzeWithGroq(groqKey, prompt);

    } else if (resolvedProvider === 'gemini') {
      if (!geminiKey) return res.status(400).json({ error: 'Google Gemini API key required.' });
      rawResponse = await analyzeWithGemini(geminiKey, prompt);

    } else if (resolvedProvider === 'ollama') {
      const url   = ollamaUrl  || 'http://localhost:11434';
      const model = ollamaModel || 'llama3.2';
      rawResponse = await analyzeWithOllama(url, model, prompt);

    } else {
      if (!anthropicKey) return res.status(400).json({ error: 'Anthropic (Claude) API key required.' });
      rawResponse = await analyzeWithClaude(anthropicKey, prompt);
    }

    // Parse JSON (handle markdown code blocks)
    let analysisData;
    try {
      const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawResponse];
      const cleaned   = (jsonMatch[1] || rawResponse).trim();
      analysisData = JSON.parse(cleaned);
    } catch {
      console.error('[Analyze] Parse error. Raw:', rawResponse.substring(0, 300));
      throw new Error('AI returned unexpected format — please try again.');
    }

    // Clamp times to actual transcript range
    const clamp = v => Math.max(0, Math.min(totalDuration, v || 0));
    if (analysisData.highlights) {
      analysisData.highlights = analysisData.highlights.map(h => ({ ...h, startSec: clamp(h.startSec), endSec: clamp(h.endSec) }));
    }
    if (analysisData.fillers) {
      analysisData.fillers = analysisData.fillers.map(f => ({ ...f, startSec: clamp(f.startSec), endSec: clamp(f.endSec) }));
    }
    if (analysisData.reels) {
      analysisData.reels = analysisData.reels
        .map((r, i) => {
          let start = clamp(r.startSec);
          let end   = clamp(r.endSec);
          const duration = end - start;
          // Enforce minimum 60 seconds — extend end if too short
          if (duration < 60) {
            end = Math.min(totalDuration, start + 60);
            // If still too short (near end of video), shift start back
            if (end - start < 60) {
              start = Math.max(0, end - 60);
            }
          }
          // Cap at 90 seconds
          if (end - start > 90) {
            end = start + 90;
          }
          return { ...r, startSec: start, endSec: end, title: r.title || `Reel ${i + 1}` };
        })
        .slice(0, options.reelCount || 10);
    }

    console.log(`[Analyze/${resolvedProvider}] Done.`);
    res.json(analysisData);

  } catch (err) {
    console.error('[Analyze Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Claude ----
async function analyzeWithClaude(apiKey, prompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });
  console.log('[Analyze/Claude] Sending...');
  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    messages:   [{ role: 'user', content: prompt }]
  });
  return message.content[0].text.trim();
}

// ---- Groq — tries best available multilingual model ----
const GROQ_ANALYZE_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'llama-3.3-70b-versatile',
  'llama3-70b-8192'
];

async function analyzeWithGroq(apiKey, prompt) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });

  for (const modelName of GROQ_ANALYZE_MODELS) {
    try {
      console.log(`[Analyze/Groq] Trying model: ${modelName}...`);
      const response = await client.chat.completions.create({
        model:       modelName,
        messages:    [
          { role: 'system', content: 'You are a professional video editor AI. Respond ONLY with valid JSON. No markdown, no code blocks.' },
          { role: 'user', content: prompt }
        ],
        max_tokens:  4096,
        temperature: 0.2
      });
      console.log(`[Analyze/Groq] Success with ${modelName}`);
      return response.choices[0].message.content.trim();
    } catch (e) {
      console.log(`[Analyze/Groq] ${modelName} failed: ${e.message.substring(0, 80)}`);
      if (!e.message.includes('429') && !e.message.includes('rate_limit') && !e.message.includes('model_not_found')) {
        throw e;
      }
    }
  }
  throw new Error('All Groq models failed — check your API key or try again later.');
}

// ---- Gemini ----
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];

async function analyzeWithGemini(apiKey, prompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      console.log(`[Analyze/Gemini] Trying model: ${modelName}...`);
      const response = await model.generateContent(prompt);
      console.log(`[Analyze/Gemini] Success with ${modelName}`);
      return response.response.text().trim();
    } catch (e) {
      console.log(`[Analyze/Gemini] ${modelName} failed: ${e.message.substring(0, 80)}`);
      if (!e.message.includes('429') && !e.message.includes('404') && !e.message.includes('not found')) {
        throw e; // Non-model/quota error — don't retry
      }
    }
  }
  throw new Error('All Gemini models failed — your free quota may be exhausted. Switch to Ollama (free local) in Settings, or enable billing on Google AI Studio.');
}

// ---- Ollama ----
async function analyzeWithOllama(ollamaUrl, modelName, prompt) {
  const fetch = require('node-fetch');
  console.log(`[Analyze/Ollama:${modelName}] Sending...`);

  try {
    await fetch(`${ollamaUrl}/api/tags`, { timeout: 3000 });
  } catch {
    throw new Error(`Ollama is not running at ${ollamaUrl}. Install from ollama.com and run: ollama pull ${modelName}`);
  }

  const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    modelName,
      messages: [{ role: 'user', content: prompt }],
      stream:   false
    })
  });

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function formatTime(secs) {
  if (!secs && secs !== 0) return '00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

module.exports = router;
