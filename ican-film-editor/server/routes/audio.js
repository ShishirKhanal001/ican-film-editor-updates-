/**
 * Audio Route — FFmpeg audio extraction
 * Extracts audio from video files when Premiere's built-in export isn't available
 */

const express = require('express');
const router  = express.Router();
const ffmpeg  = require('fluent-ffmpeg');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// Try to find ffmpeg — bundled first, then system
const ffmpegBin = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (fs.existsSync(ffmpegBin)) {
  ffmpeg.setFfmpegPath(ffmpegBin);
}

router.post('/extract', async (req, res) => {
  const { videoPath, outputFolder, startSec, endSec } = req.body;

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(400).json({ error: 'Video file not found: ' + videoPath });
  }

  const outFolder = outputFolder || os.tmpdir();
  const outFile   = path.join(outFolder, 'ican_audio_' + Date.now() + '.mp3');

  try {
    await extractAudio(videoPath, outFile, startSec, endSec);
    res.json({ success: true, audioPath: outFile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function extractAudio(videoPath, outputPath, startSec, endSec) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioChannels(1)   // mono for smaller file
      .audioFrequency(16000); // 16kHz — optimal for Whisper

    if (startSec != null) cmd = cmd.seekInput(startSec);
    if (endSec != null && startSec != null) cmd = cmd.duration(endSec - startSec);

    cmd
      .on('end', () => { console.log('[Audio] Extraction complete:', outputPath); resolve(outputPath); })
      .on('error', (err) => { console.error('[Audio] FFmpeg error:', err.message); reject(err); })
      .save(outputPath);
  });
}

module.exports = router;
module.exports.extractAudio = extractAudio;
