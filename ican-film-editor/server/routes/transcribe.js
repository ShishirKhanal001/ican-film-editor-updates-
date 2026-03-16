/**
 * Transcription Route
 * Providers:
 *   openai  — OpenAI Whisper API (paid, ~$0.006/min)
 *   groq    — Groq Whisper API (FREE, same model, faster)
 *
 * Groq free tier: unlimited on free plan, no credit card needed.
 * Sign up at groq.com → API Keys → Create key.
 */

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const { splitAudioIntoChunks } = require('../utils/chunker');

const WHISPER_MAX_MB = 24;

router.post('/', async (req, res) => {
  const { audioPath, language, openaiKey, groqKey, transcribeProvider, sourcePaths, useSourceFiles } = req.body;

  // Determine which provider to use
  const provider = transcribeProvider || (groqKey ? 'groq' : 'openai');

  const apiKey = provider === 'groq' ? groqKey : openaiKey;
  if (!apiKey) {
    const name = provider === 'groq' ? 'Groq (free)' : 'OpenAI';
    return res.status(400).json({ error: `${name} API key is required for transcription.` });
  }

  // Both OpenAI and Groq use the same SDK — Groq just uses a different baseURL
  const OpenAI = require('openai');
  const client = provider === 'groq'
    ? new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })
    : new OpenAI({ apiKey });

  const modelName = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

  console.log(`[Transcribe] Using ${provider === 'groq' ? 'Groq (FREE)' : 'OpenAI'} Whisper — model: ${modelName}`);

  try {
    let segments = [];

    if (useSourceFiles && sourcePaths && sourcePaths.length > 0) {
      for (const srcPath of sourcePaths) {
        const fileSegs = await transcribeFile(client, modelName, srcPath, language);
        segments = segments.concat(fileSegs);
      }
    } else if (audioPath) {
      const stats = fs.statSync(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > WHISPER_MAX_MB) {
        console.log(`[Transcribe] File is ${fileSizeMB.toFixed(1)}MB — chunking...`);
        const chunks = await splitAudioIntoChunks(audioPath, WHISPER_MAX_MB);
        let timeOffset = 0;
        for (let i = 0; i < chunks.length; i++) {
          console.log(`[Transcribe] Chunk ${i + 1}/${chunks.length}...`);
          const chunkSegs = await transcribeFile(client, modelName, chunks[i].path, language, timeOffset);
          segments = segments.concat(chunkSegs);
          timeOffset += chunks[i].durationSec;
          fs.unlinkSync(chunks[i].path);
        }
      } else {
        segments = await transcribeFile(client, modelName, audioPath, language);
      }
    } else {
      return res.status(400).json({ error: 'No audio path provided.' });
    }

    segments.sort((a, b) => a.timeSec - b.timeSec);
    res.json({ segments, count: segments.length, provider });

  } catch (err) {
    console.error('[Transcribe Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function transcribeFile(client, model, filePath, language, timeOffset = 0) {
  const params = {
    file:             fs.createReadStream(filePath),
    model,
    response_format:  'verbose_json',
    timestamp_granularities: ['segment']
  };
  if (language && language !== 'auto') params.language = language;

  const response = await client.audio.transcriptions.create(params);

  return (response.segments || []).map(seg => ({
    timeSec:    seg.start + timeOffset,
    endSec:     seg.end   + timeOffset,
    original:   seg.text.trim(),
    english:    seg.text.trim(),
    confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : null
  }));
}

module.exports = router;
