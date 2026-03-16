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
const os       = require('os');
const ffmpegFluent = require('fluent-ffmpeg');
const { splitAudioIntoChunks } = require('../utils/chunker');

// Point fluent-ffmpeg at our bundled binaries
const ffmpegBin  = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
const ffprobeBin = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
if (fs.existsSync(ffmpegBin))  ffmpegFluent.setFfmpegPath(ffmpegBin);
if (fs.existsSync(ffprobeBin)) ffmpegFluent.setFfprobePath(ffprobeBin);

function extractAudioFromVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpegFluent(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

const WHISPER_MAX_MB = 24;

router.post('/', async (req, res) => {
  const { audioPath, language, openaiKey, groqKey, transcribeProvider, sourcePaths, useSourceFiles, projectFolder } = req.body;

  // Use project folder for temp files so everything stays next to the project
  const workDir = (() => {
    if (projectFolder) {
      const dir = path.join(projectFolder, 'ICAN Temp');
      try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); return dir; } catch(e) {}
    }
    return os.tmpdir();
  })();

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
      for (const src of sourcePaths) {
        const srcPath = typeof src === 'object' ? src.path : src;
        // Extract audio from video file to a small MP3, then transcribe
        const tmpAudio = path.join(workDir, `ican_src_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
        try {
          console.log(`[Transcribe] Extracting audio from: ${path.basename(srcPath)}`);
          await extractAudioFromVideo(srcPath, tmpAudio);
          const stats = fs.statSync(tmpAudio);
          const sizeMB = stats.size / (1024 * 1024);
          let fileSegs;
          if (sizeMB > WHISPER_MAX_MB) {
            const chunks = await splitAudioIntoChunks(tmpAudio, WHISPER_MAX_MB, workDir);
            let timeOffset = typeof src === 'object' ? (src.startSec || 0) : 0;
            for (const chunk of chunks) {
              const cs = await transcribeFile(client, modelName, chunk.path, language, timeOffset, provider);
              segments = segments.concat(cs);
              timeOffset += chunk.durationSec;
              fs.unlinkSync(chunk.path);
            }
          } else {
            const startOffset = typeof src === 'object' ? (src.startSec || 0) : 0;
            fileSegs = await transcribeFile(client, modelName, tmpAudio, language, startOffset, provider);
            segments = segments.concat(fileSegs);
          }
        } finally {
          if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
        }
      }
    } else if (audioPath) {
      const stats = fs.statSync(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > WHISPER_MAX_MB) {
        console.log(`[Transcribe] File is ${fileSizeMB.toFixed(1)}MB — chunking...`);
        if (global.icanProgress) global.icanProgress = { stage: 'chunking', detail: 'Splitting audio into chunks...', percent: 10 };
        const chunks = await splitAudioIntoChunks(audioPath, WHISPER_MAX_MB, workDir);
        let timeOffset = 0;
        for (let i = 0; i < chunks.length; i++) {
          const pct = Math.round(10 + (80 * (i / chunks.length)));
          console.log(`[Transcribe] Chunk ${i + 1}/${chunks.length}...`);
          if (global.icanProgress) global.icanProgress = { stage: 'transcribing', detail: `Transcribing chunk ${i + 1} of ${chunks.length}...`, percent: pct };
          const chunkSegs = await transcribeFile(client, modelName, chunks[i].path, language, timeOffset, provider);
          segments = segments.concat(chunkSegs);
          timeOffset += chunks[i].durationSec;
          fs.unlinkSync(chunks[i].path);
        }
      } else {
        segments = await transcribeFile(client, modelName, audioPath, language, 0, provider);
      }
    } else {
      return res.status(400).json({ error: 'No audio path provided.' });
    }

    segments.sort((a, b) => a.timeSec - b.timeSec);
    res.json({ segments, count: segments.length, provider });

  } catch (err) {
    // Log full error details to server terminal for diagnosis
    console.error('[Transcribe Error] raw message:', err.message);
    console.error('[Transcribe Error] error code:', err.code);
    console.error('[Transcribe Error] status:', err.status);
    if (err.response) console.error('[Transcribe Error] response body:', JSON.stringify(err.response.data || err.response));

    let msg = err.message;
    const rawDetails = ` [raw: ${err.code || err.status || err.message}]`;

    if (msg === 'Connection error.' || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
      msg = `Cannot reach api.groq.com${rawDetails} — Windows Firewall may be blocking node.exe. See console for details.`;
    } else if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid API key')) {
      msg = `Invalid Groq API key (401)${rawDetails} — open Settings and re-enter your key (starts with gsk_).`;
    } else {
      msg = msg + rawDetails;
    }
    res.status(500).json({ error: msg });
  }
});

// Languages supported by Groq's Whisper deployment
const GROQ_SUPPORTED_LANGS = new Set([
  'kn','ka','uz','ha','it','id','da','pa','am','fr','ml','cy','mn','gl','sn','jv',
  'de','br','hy','sq','so','af','tg','fo','sk','te','az','sd','gu','tl','ba','sv',
  'he','no','hr','lo','sa','lt','sw','ln','ru','hu','ta','km','be','ps','tk','zh',
  'pl','cs','ur','fa','is','ht','su','en','ca','ar','ro','bn','bs','yo','mt','nl',
  'vi','bg','ne','si','as','ko','ja','et','mk','oc','my','mg','haw','la','sr','kk',
  'yi','tt','yue','pt','uk','ms','th','lb','bo','tr','hi','el','mi','lv','eu','es',
  'fi','mr','nn','sl'
]);

// Map unsupported language codes to their closest supported alternative
const LANG_FALLBACK = {
  'ti': 'am',   // Tigrinya → Amharic (closest Ethiopian/Eritrean language Groq supports)
};

function resolveLanguageForProvider(language, provider) {
  if (!language || language === 'auto') {
    // NEVER let Groq auto-detect — it can guess wrong and reject the request.
    // Default to Amharic which is the primary use case.
    if (provider === 'groq') return 'am';
    return undefined; // OpenAI handles auto-detect fine
  }
  if (provider === 'groq' && !GROQ_SUPPORTED_LANGS.has(language)) {
    const fallback = LANG_FALLBACK[language] || 'am';
    console.log(`[Transcribe] Language "${language}" not supported by Groq — using "${fallback}" instead`);
    return fallback;
  }
  return language;
}

// Whisper prompt hints — dramatically improves accuracy for non-Latin scripts.
// The prompt tells Whisper what kind of content to expect, reducing hallucination.
const WHISPER_PROMPTS = {
  'am': 'ይህ በአማርኛ የሆነ ቃለ መጠይቅ ወይም ውይይት ነው። This is an interview or discussion in Amharic.',
  'ti': 'እዚ ብትግርኛ ዝኾነ ቃለ መሕተት ወይ ዘተ እዩ። This is an interview or discussion in Tigrinya.',
};

async function transcribeFile(client, model, filePath, language, timeOffset = 0, provider = 'groq') {
  const resolvedLang = resolveLanguageForProvider(language, provider);

  const params = {
    file:             fs.createReadStream(filePath),
    model,
    response_format:  'verbose_json',
    timestamp_granularities: ['segment']
  };
  if (resolvedLang) params.language = resolvedLang;

  // Add prompt hint to reduce hallucination on Amharic/Tigrinya
  const promptHint = WHISPER_PROMPTS[resolvedLang] || WHISPER_PROMPTS[language];
  if (promptHint) {
    params.prompt = promptHint;
    console.log(`[Transcribe] Using prompt hint for language=${resolvedLang}`);
  }

  // Set temperature to 0 for most accurate/deterministic output
  params.temperature = 0;

  console.log(`[Transcribe] Sending to ${provider} with language=${resolvedLang || 'auto'}`);
  const response = await client.audio.transcriptions.create(params);

  // Filter out low-confidence hallucinated segments
  return (response.segments || [])
    .filter(seg => {
      // Whisper segments with very low log probability are usually hallucinations
      // avg_logprob < -1.0 is suspicious, < -1.5 is almost certainly garbage
      if (seg.avg_logprob && seg.avg_logprob < -1.5) {
        console.log(`[Transcribe] Filtering hallucinated segment (logprob=${seg.avg_logprob.toFixed(2)}): "${seg.text.substring(0, 50)}..."`);
        return false;
      }
      // Also filter empty or very short segments
      if (!seg.text || seg.text.trim().length < 2) return false;
      // Filter segments that are clearly non-target-language garbage (random Unicode blocks)
      const garbageRatio = (seg.text.match(/[\u0370-\u03FF\u10A0-\u10FF\u1780-\u17FF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0400-\u04FF]/g) || []).length / seg.text.length;
      if (garbageRatio > 0.3 && resolvedLang === 'am') {
        console.log(`[Transcribe] Filtering non-Amharic garbage segment: "${seg.text.substring(0, 50)}..."`);
        return false;
      }
      return true;
    })
    .map(seg => ({
      timeSec:    seg.start + timeOffset,
      endSec:     seg.end   + timeOffset,
      original:   seg.text.trim(),
      english:    seg.text.trim(),
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : null
    }));
}

module.exports = router;
