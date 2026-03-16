/**
 * AI Analysis Route
 * Providers: Claude (Anthropic) | Gemini (Google) | Ollama (free local LLM)
 * Analyzes transcript for: summary, highlights, fillers, reel suggestions
 */

const express = require('express');
const router  = express.Router();

router.post('/', async (req, res) => {
  const {
    segments, options,
    anthropicKey,
    geminiKey,
    provider,       // 'anthropic' | 'gemini' | 'ollama'
    ollamaModel, ollamaUrl
  } = req.body;

  if (!segments || !segments.length) {
    return res.status(400).json({ error: 'No transcript segments provided.' });
  }

  const resolvedProvider = provider || (geminiKey ? 'gemini' : 'anthropic');

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
  if (options.reels)      taskList.push(`4. REELS: The best ${options.reelCount || 2} clips (15-90 seconds) for vertical social media Reels/TikTok/Shorts`);

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
- Reels should be self-contained stories that work without context
- Fillers: "um", "uh", repeated sentences, very long gaps`;

  try {
    let rawResponse;

    if (resolvedProvider === 'gemini') {
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
        .map((r, i) => ({ ...r, startSec: clamp(r.startSec), endSec: clamp(r.endSec), title: r.title || `Reel ${i + 1}` }))
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

// ---- Gemini ----
async function analyzeWithGemini(apiKey, prompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-1.5-pro' });
  console.log('[Analyze/Gemini] Sending...');
  const response = await model.generateContent(prompt);
  return response.response.text().trim();
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
