/**
 * Transcription Route — uses OpenAI Whisper
 * Handles chunking for long videos (60+ minutes)
 */

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const OpenAI   = require('openai');
const { splitAudioIntoChunks } = require('../utils/chunker');

const WHISPER_MAX_MB = 24; // Whisper limit is 25MB, we use 24 for safety

router.post('/', async (req, res) => {
  const { audioPath, language, openaiKey, sourcePaths, useSourceFiles } = req.body;

  if (!openaiKey) {
    return res.status(400).json({ error: 'OpenAI API key is required.' });
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  try {
    let segments = [];

    if (useSourceFiles && sourcePaths && sourcePaths.length > 0) {
      // Process each source file separately
      for (const srcPath of sourcePaths) {
        const fileSegs = await transcribeFile(openai, srcPath, language);
        segments = segments.concat(fileSegs);
      }
    } else if (audioPath) {
      // Process the exported audio file (may need chunking)
      const stats = fs.statSync(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > WHISPER_MAX_MB) {
        console.log(`[Transcribe] File is ${fileSizeMB.toFixed(1)}MB — chunking into smaller pieces...`);
        const chunks = await splitAudioIntoChunks(audioPath, WHISPER_MAX_MB);
        let timeOffset = 0;

        for (let i = 0; i < chunks.length; i++) {
          console.log(`[Transcribe] Processing chunk ${i + 1}/${chunks.length}...`);
          const chunkSegs = await transcribeFile(openai, chunks[i].path, language, timeOffset);
          segments = segments.concat(chunkSegs);
          timeOffset += chunks[i].durationSec;
          fs.unlinkSync(chunks[i].path); // clean up chunk
        }
      } else {
        segments = await transcribeFile(openai, audioPath, language);
      }
    } else {
      return res.status(400).json({ error: 'No audio path provided.' });
    }

    // Sort by time
    segments.sort((a, b) => a.timeSec - b.timeSec);

    res.json({ segments, count: segments.length });

  } catch (err) {
    console.error('[Transcribe Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function transcribeFile(openai, filePath, language, timeOffset = 0) {
  const fileStream = fs.createReadStream(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');

  const params = {
    file: fileStream,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  };

  // Language hint (improves accuracy for Amharic/Tigrinya)
  if (language && language !== 'auto') {
    params.language = language;
  }

  const response = await openai.audio.transcriptions.create(params);

  // Map to our segment format
  const segments = (response.segments || []).map(seg => ({
    timeSec: seg.start + timeOffset,
    endSec:  seg.end + timeOffset,
    original: seg.text.trim(),
    english: seg.text.trim(), // will be replaced by translation step
    confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : null
  }));

  return segments;
}

module.exports = router;
