/**
 * Audio Chunker — splits large audio files for Whisper's 25MB limit
 * Critical for Lucy TV's 60+ minute shows
 */

const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const ffmpegBin  = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
const ffprobeBin = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
if (fs.existsSync(ffmpegBin))  ffmpeg.setFfmpegPath(ffmpegBin);
if (fs.existsSync(ffprobeBin)) ffmpeg.setFfprobePath(ffprobeBin);

/**
 * Splits an audio file into chunks under maxMB size.
 * Returns array of { path, durationSec }
 */
async function splitAudioIntoChunks(audioPath, maxMB = 24, workDir = null) {
  const stats  = fs.statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);
  const totalDurationSec = await getAudioDuration(audioPath);

  // How many seconds fit in maxMB?
  // At 128kbps mono 16kHz MP3: ~60MB/hour → ~1MB/min
  // But we'll compute from actual size for accuracy
  const secPerMB    = totalDurationSec / sizeMB;
  const chunkSec    = Math.floor(secPerMB * maxMB * 0.9); // 10% safety margin
  const numChunks   = Math.ceil(totalDurationSec / chunkSec);

  console.log(`[Chunker] ${sizeMB.toFixed(1)}MB, ${(totalDurationSec/60).toFixed(1)}min → ${numChunks} chunks of ~${(chunkSec/60).toFixed(1)}min each`);

  const chunks = [];
  const tmpDir = workDir || os.tmpdir();

  for (let i = 0; i < numChunks; i++) {
    const startSec = i * chunkSec;
    const outPath  = path.join(tmpDir, `ican_chunk_${Date.now()}_${i}.mp3`);

    await extractChunk(audioPath, outPath, startSec, chunkSec);
    chunks.push({ path: outPath, durationSec: chunkSec, startSec });
  }

  return chunks;
}

function extractChunk(inputPath, outputPath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startSec)
      .duration(durationSec)
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

function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration || 0);
    });
  });
}

module.exports = { splitAudioIntoChunks };
