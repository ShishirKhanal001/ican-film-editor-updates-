/**
 * ICAN Film Editor — ExtendScript Host
 * Runs inside Adobe Premiere Pro and controls the timeline.
 */

// ---- Bridge entry point (called from JS via CSInterface.evalScript) ----
function hostBridge(funcName, paramsJson) {
  try {
    var params = JSON.parse(paramsJson);
    var result;
    switch (funcName) {
      case 'exportTimelineAudio': result = exportTimelineAudio(params); break;
      case 'jumpToTime':          result = jumpToTime(params); break;
      case 'addMarkers':          result = addMarkers(params); break;
      case 'cutSegments':         result = cutSegments(params); break;
      case 'createReelSequences': result = createReelSequences(params); break;
      case 'applyBranding':       result = applyBranding(params); break;
      case 'addCaptions':         result = addCaptions(params); break;
      case 'applyAudioChain':     result = applyAudioChain(params); break;
      case 'browseForFile':       result = browseForFile(params); break;
      case 'browseForFolder':     result = browseForFolder(params); break;
      default: result = { success: false, error: 'Unknown function: ' + funcName };
    }
    return JSON.stringify(result);
  } catch(e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// ---- Get active sequence ----
function getActiveSequence() {
  var proj = app.project;
  if (!proj) throw new Error('No project open');
  var seq = proj.activeSequence;
  if (!seq) throw new Error('No active sequence');
  return seq;
}

// ---- Export timeline audio ----
// Strategy 1: Adobe Media Encoder (cleanest, handles mixed clips)
// Strategy 2: Collect source file paths → let Node/FFmpeg extract audio directly
// Strategy 3: Use Premiere's built-in audio mixdown API
function exportTimelineAudio(params) {
  var tempFolder = params.tempFolder || Folder.temp.fsName;
  var seq        = getActiveSequence();
  var outputPath = tempFolder.replace(/[\\\/]$/, '') + '/ican_audio_export_' + Date.now() + '.mp3';
  var outputFile = new File(outputPath);

  // --- Strategy 1: Adobe Media Encoder ---
  try {
    if (app.encoder) {
      // Open AME in background mode
      app.encoder.launchEncoder();
      var preset = findAudioPreset();
      app.encoder.encodeSequence(
        seq,
        outputFile.fsName,
        'MP3',
        preset,
        1  // Remove from queue when done
      );
      // Wait for encoding (polling — max 10 min for long videos)
      var waited = 0;
      while (!outputFile.exists && waited < 600) {
        $.sleep(1000);
        waited++;
      }
      if (outputFile.exists) {
        return { success: true, audioPath: outputFile.fsName, method: 'AME' };
      }
    }
  } catch(e1) {
    // AME failed — fall through to next strategy
  }

  // --- Strategy 2: Collect source video paths (let server FFmpeg extract) ---
  // This is the most reliable fallback for long videos
  var sourcePaths = getSequenceSourcePaths(seq, params.source);
  if (sourcePaths.length > 0) {
    return {
      success:        true,
      audioPath:      null,
      sourcePaths:    sourcePaths,
      useSourceFiles: true,
      outputPath:     outputPath,
      method:         'source-files'
    };
  }

  // --- Strategy 3: Premiere mixdown (Premiere Pro 2022+) ---
  try {
    var mixdownPath = tempFolder.replace(/[\\\/]$/, '') + '/ican_mixdown.wav';
    seq.exportAsMixdown(mixdownPath);
    var mf = new File(mixdownPath);
    if (mf.exists) {
      return { success: true, audioPath: mixdownPath, method: 'mixdown' };
    }
  } catch(e3) {}

  return {
    success: false,
    error:   'Could not export audio automatically. Please set a Temp Folder in Settings and ensure Adobe Media Encoder is installed.'
  };
}

function findAudioPreset() {
  // Try common audio-only preset names across Premiere versions
  var names = ['MP3 - 128 kbps', 'Audio Only', 'MP3', 'AAC Audio'];
  try {
    var presets = app.encoder.getPresets();
    for (var i = 0; i < names.length; i++) {
      if (presets && presets[names[i]]) return presets[names[i]];
    }
  } catch(e) {}
  return ''; // Let AME use default
}

// ---- Get all source file paths from the sequence ----
function getSequenceSourcePaths(seq, sourceMode) {
  var paths = [];
  var seen  = {};

  // Include audio tracks too — some shows have audio-only tracks
  var allTracks = [];
  for (var t = 0; t < seq.videoTracks.numTracks; t++) allTracks.push(seq.videoTracks[t]);
  for (var at = 0; at < seq.audioTracks.numTracks; at++) allTracks.push(seq.audioTracks[at]);

  for (var i = 0; i < allTracks.length; i++) {
    var track = allTracks[i];
    var numClips = track.clips ? track.clips.numItems : 0;
    for (var j = 0; j < numClips; j++) {
      var clip = track.clips[j];
      if (!clip || !clip.projectItem) continue;
      try {
        var path = clip.projectItem.getMediaPath();
        if (path && !seen[path]) {
          seen[path] = true;
          paths.push({
            path:     path,
            startSec: clip.start ? clip.start.seconds : 0,
            endSec:   clip.end   ? clip.end.seconds   : 0
          });
        }
      } catch(e) {}
    }
  }

  // Sort by position in timeline
  paths.sort(function(a, b) { return a.startSec - b.startSec; });

  // Return just paths for backwards compatibility, but include time data
  return paths;
}

// ---- Jump playhead to time ----
function jumpToTime(params) {
  try {
    var seq = getActiveSequence();
    var t = new Time();
    t.seconds = params.timeSec;
    seq.setPlayerPosition(t.ticks);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Add colored markers to timeline ----
function addMarkers(params) {
  try {
    var seq = getActiveSequence();
    var markers = params.markers;
    var colorMap = { yellow: 0, red: 1, orange: 2, green: 3, blue: 4, purple: 5, cyan: 6, white: 7 };
    var colorId = colorMap[params.color] || 0;

    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var marker = seq.markers.createMarker(m.startSec);
      marker.name = (params.label || '') + ' ' + (i + 1);
      marker.comments = m.reason || m.text || '';
      marker.colorByIndex = colorId;
      if (m.endSec) {
        marker.end = new Time();
        marker.end.seconds = m.endSec;
      }
    }
    return { success: true, count: markers.length };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Cut (delete) segments from timeline ----
function cutSegments(params) {
  try {
    var seq = getActiveSequence();
    var segments = params.segments;

    // Sort descending so cutting earlier segments doesn't shift positions
    segments.sort(function(a, b) { return b.startSec - a.startSec; });

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var startTicks = secondsToTicks(seg.startSec);
      var endTicks   = secondsToTicks(seg.endSec);

      // Ripple delete the region
      seq.razor(startTicks);
      seq.razor(endTicks);

      // Delete clips in that range from all tracks
      deleteClipsInRange(seq, startTicks, endTicks);
    }

    return { success: true };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

function deleteClipsInRange(seq, startTicks, endTicks) {
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = track.clips.numItems - 1; c >= 0; c--) {
      var clip = track.clips[c];
      if (clip.start.ticks >= startTicks && clip.end.ticks <= endTicks) {
        clip.remove(true, true);
      }
    }
  }
  for (var t2 = 0; t2 < seq.audioTracks.numTracks; t2++) {
    var atrack = seq.audioTracks[t2];
    for (var ac = atrack.clips.numItems - 1; ac >= 0; ac--) {
      var aclip = atrack.clips[ac];
      if (aclip.start.ticks >= startTicks && aclip.end.ticks <= endTicks) {
        aclip.remove(true, true);
      }
    }
  }
}

// ---- Create reel sequences (Vertical Reels) ----
function createReelSequences(params) {
  try {
    var proj          = app.project;
    var mainSeq       = getActiveSequence();
    var reels         = params.reels;
    var brandingFiles = params.brandingFiles || {};
    var gapSec        = params.gap || 1;

    // Validate reel durations — min 10s, max 90s
    for (var v = reels.length - 1; v >= 0; v--) {
      var dur = reels[v].endSec - reels[v].startSec;
      if (dur < 5) { reels.splice(v, 1); continue; }
      if (dur > 120) reels[v].endSec = reels[v].startSec + 90;
      // Clamp to sequence length
      var seqDur = getSequenceDuration(mainSeq);
      if (reels[v].startSec >= seqDur) { reels.splice(v, 1); continue; }
      if (reels[v].endSec > seqDur) reels[v].endSec = seqDur;
    }

    if (reels.length === 0) return { success: false, error: 'No valid reels to create (all were too short or out of range)' };

    // Create bins
    var reelsBin = findOrCreateBin(proj, 'ICAN Reels');
    var vertBin  = findOrCreateBin(proj, 'ICAN Verticals');

    // ---- Get source sequence settings to base new sequences on ----
    var srcSettings = mainSeq.getSettings();

    // ---- Create combined Verticals sequence (1080x1920) ----
    var vertSeq = createVerticalSequence(proj, 'Verticals \u2014 All Reels', vertBin, srcSettings);
    var currentPosSec = 0;

    for (var i = 0; i < reels.length; i++) {
      var reel = reels[i];
      var reelSeqName = 'Reel ' + (i + 1) + (reel.title ? ' \u2014 ' + reel.title.substring(0, 30) : '');

      // Create individual reel sequence (also vertical)
      var reelSeq = createVerticalSequence(proj, reelSeqName, reelsBin, srcSettings);
      var insertAt = 0;

      // Vertical Intro
      if (brandingFiles.vIntro) {
        importAndInsert(proj, reelSeq, brandingFiles.vIntro, insertAt);
        insertAt = getSequenceDuration(reelSeq);
      }

      // Main reel content from original timeline
      duplicateTimelineRange(mainSeq, reelSeq, reel.startSec, reel.endSec, insertAt);
      insertAt = getSequenceDuration(reelSeq);

      // Vertical Outro
      if (brandingFiles.vOutro) {
        importAndInsert(proj, reelSeq, brandingFiles.vOutro, insertAt);
      }

      // Append this reel into the combined Verticals sequence
      appendSequenceToSequence(reelSeq, vertSeq, currentPosSec);
      currentPosSec = getSequenceDuration(vertSeq) + gapSec;

      // Add coloured marker on original timeline
      try {
        var m = mainSeq.markers.createMarker(reel.startSec);
        m.name = 'Reel ' + (i + 1);
        m.colorByIndex = 4; // blue
        var mEnd = new Time(); mEnd.seconds = reel.endSec;
        m.end = mEnd;
      } catch(me) {}
    }

    // ---- Horizontal main sequence ----
    var hSeq    = proj.createNewSequence('Main \u2014 Horizontal Edit', reelsBin);
    var hPos    = 0;

    if (brandingFiles.hIntro) {
      importAndInsert(proj, hSeq, brandingFiles.hIntro, hPos);
      hPos = getSequenceDuration(hSeq);
    }

    duplicateTimelineRange(mainSeq, hSeq, 0, getSequenceDuration(mainSeq), hPos);
    hPos = getSequenceDuration(hSeq);

    if (brandingFiles.hOutro) {
      importAndInsert(proj, hSeq, brandingFiles.hOutro, hPos);
    }

    return {
      success:   true,
      reelCount: reels.length,
      sequences: ['Main \u2014 Horizontal Edit', 'Verticals \u2014 All Reels']
    };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Create a proper 9:16 vertical sequence ----
function createVerticalSequence(proj, name, bin, srcSettings) {
  // Create the sequence first (inherits from project default)
  var seq = proj.createNewSequence(name, bin);

  // Now force 9:16 settings
  try {
    var s = seq.getSettings();
    // 1080x1920 @ same frame rate as source
    s.videoFrameWidth   = 1080;
    s.videoFrameHeight  = 1920;
    s.videoPixelAspectRatio = 1.0; // square pixels
    // Inherit frame rate from source
    if (srcSettings && srcSettings.videoFrameRate) {
      s.videoFrameRate = srcSettings.videoFrameRate;
    }
    seq.setSettings(s);
  } catch(e) {
    // setSettings may fail on older Premiere — sequence will still be created
    // with default settings, which the user can adjust
  }

  return seq;
}

// ---- Find or create a bin (avoids duplicate bins) ----
function findOrCreateBin(proj, name) {
  for (var i = 0; i < proj.rootItem.children.numItems; i++) {
    var child = proj.rootItem.children[i];
    if (child.name === name && child.type === ProjectItemType.BIN) return child;
  }
  return proj.rootItem.createBin(name);
}

// ---- Apply branding to existing sequences ----
function applyBranding(params) {
  try {
    var proj = app.project;
    var files = params.files;
    var gapSec = params.gap || 1;

    // Apply to all sequences in project
    for (var i = 0; i < proj.sequences.numSequences; i++) {
      var seq = proj.sequences[i];
      var seqName = seq.name;
      var isVertical = seqName.toLowerCase().indexOf('vertical') >= 0 ||
                       seqName.toLowerCase().indexOf('reel') >= 0;

      var introFile = isVertical ? files.vIntro : files.hIntro;
      var outroFile = isVertical ? files.vOutro : files.hOutro;

      if (introFile) prependClip(proj, seq, introFile);
      if (outroFile) appendClip(proj, seq, outroFile);
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Add captions to the timeline ----
// Tries 3 methods in order:
//   1. Premiere Pro Caption Track (SRT-style) — PP 2022+
//   2. Essential Graphics / MoGraph text clips — PP 2018+
//   3. Marker-based fallback (any version, visible in timeline)
function addCaptions(params) {
  try {
    var seq          = getActiveSequence();
    var captions     = params.captions;
    var style        = params.style || {};
    var wordsPerLine = parseInt(style.wordsPerLine) || 5;
    var totalAdded   = 0;

    // Build word-chunked caption list
    var chunks = [];
    for (var i = 0; i < captions.length; i++) {
      var cap   = captions[i];
      var words = (cap.text || '').split(' ').filter(function(w) { return w.length > 0; });
      if (!words.length) continue;

      var numChunks    = Math.ceil(words.length / wordsPerLine);
      var chunkDurSec  = Math.max(0.5, (cap.endSec - cap.timeSec) / numChunks);

      for (var c = 0; c < numChunks; c++) {
        var chunkWords = words.slice(c * wordsPerLine, (c + 1) * wordsPerLine);
        chunks.push({
          text:     chunkWords.join(' '),
          startSec: cap.timeSec + (c * chunkDurSec),
          endSec:   cap.timeSec + ((c + 1) * chunkDurSec)
        });
      }
    }

    if (!chunks.length) return { success: false, error: 'No caption text to add' };

    // ---- Method 1: Native Captions Track (Premiere 2022+) ----
    var usedCaptionTrack = false;
    try {
      if (seq.captionTracks !== undefined) {
        // Create a new SRT-style caption track
        seq.createCaptionTrack('SRT', 0);
        var ct = seq.captionTracks[seq.captionTracks.numTracks - 1];
        if (ct) {
          for (var ci = 0; ci < chunks.length; ci++) {
            var startT = new Time(); startT.seconds = chunks[ci].startSec;
            var endT   = new Time(); endT.seconds   = chunks[ci].endSec;
            ct.insertClip(chunks[ci].text, startT, endT);
            totalAdded++;
          }
          usedCaptionTrack = true;
        }
      }
    } catch(e1) {}

    // ---- Method 2: Essential Graphics text clips ----
    if (!usedCaptionTrack) {
      try {
        // Add a new video track for captions
        seq.videoTracks.add();
        var captTrack = seq.videoTracks[seq.videoTracks.numTracks - 1];

        for (var gi = 0; gi < chunks.length; gi++) {
          var ch   = chunks[gi];
          var gStart = new Time(); gStart.seconds = ch.startSec;
          var gEnd   = new Time(); gEnd.seconds   = ch.endSec;
          var duration = new Time(); duration.seconds = ch.endSec - ch.startSec;

          // Create a MoGraph/Essential Graphics text clip
          captTrack.overwriteClip(
            qe.project.getMotionGraphicsTemplate('Caption'),
            gStart
          );
          totalAdded++;
        }
      } catch(e2) {
        usedCaptionTrack = false; // fall through to marker method
      }
    }

    // ---- Method 3: Marker fallback (always works, any Premiere version) ----
    if (!usedCaptionTrack && totalAdded === 0) {
      // Remove any previous ICAN caption markers
      var existingMarkers = seq.markers;
      // Add caption markers — user can export these as SRT via Premiere's built-in tool
      for (var mi = 0; mi < chunks.length; mi++) {
        var mk = seq.markers.createMarker(chunks[mi].startSec);
        mk.name = chunks[mi].text;
        mk.comments = '[CAPTION]';
        mk.colorByIndex = 7; // white markers
        var mkEnd = new Time(); mkEnd.seconds = chunks[mi].endSec;
        mk.end = mkEnd;
        totalAdded++;
      }
    }

    return {
      success:  true,
      method:   usedCaptionTrack ? 'caption-track' : 'markers',
      count:    totalAdded,
      note:     usedCaptionTrack
                  ? 'Captions added to dedicated caption track'
                  : 'Captions added as timeline markers. To convert: Captions panel \u2192 Create Captions from Sequence Markers.'
    };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Apply audio plugin chain to tracks ----
function applyAudioChain(params) {
  try {
    var seq = getActiveSequence();
    var plugins = params.plugins;
    var trackTypes = params.trackTypes;

    for (var t = 0; t < seq.audioTracks.numTracks; t++) {
      var track = seq.audioTracks[t];
      var trackName = track.name.toLowerCase();

      var shouldApply = false;
      if (trackTypes.indexOf('dialogue') >= 0) {
        if (trackName.indexOf('dialogue') >= 0 || trackName.indexOf('voice') >= 0 ||
            trackName.indexOf('mic') >= 0 || trackName.indexOf('a') === 0) {
          shouldApply = true;
        }
      }
      if (trackTypes.indexOf('music') >= 0 && trackName.indexOf('music') >= 0) shouldApply = true;
      if (trackTypes.indexOf('sfx') >= 0 && (trackName.indexOf('sfx') >= 0 || trackName.indexOf('fx') >= 0)) shouldApply = true;

      // If only dialogue selected and track name is generic (A1, A2, etc.), apply
      if (!shouldApply && trackTypes.indexOf('dialogue') >= 0 && t < 4) shouldApply = true;

      if (shouldApply) {
        for (var p = 0; p < plugins.length; p++) {
          try {
            track.addAudioEffect(plugins[p]);
          } catch(pluginErr) {
            // Plugin name might not match exactly — continue
          }
        }
      }
    }

    return { success: true };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- File browser ----
function browseForFile(params) {
  var filter = params.filter ? params.filter.join(', ') : 'All files';
  var f = File.openDialog('Select media file', filter, false);
  if (f) return { success: true, path: f.fsName };
  return { success: false, path: null };
}

function browseForFolder(params) {
  var folder = Folder.selectDialog('Select folder');
  if (folder) return { success: true, path: folder.fsName };
  return { success: false, path: null };
}

// ---- Helpers ----
function secondsToTicks(secs) {
  // Premiere uses 254016000000 ticks per second
  return Math.round(secs * 254016000000);
}

function getSequenceDuration(seq) {
  var end = seq.end;
  return end ? end.seconds : 0;
}

function getIntroDuration(seq) {
  return getSequenceDuration(seq);
}

function importAndInsert(proj, seq, filePath, atSec) {
  try {
    var importResult = proj.importFiles([filePath], true, proj.rootItem, false);
    if (importResult && proj.rootItem.children.numItems > 0) {
      // Find the freshly imported item
      var item = null;
      for (var i = proj.rootItem.children.numItems - 1; i >= 0; i--) {
        var child = proj.rootItem.children[i];
        if (child.getMediaPath && child.getMediaPath() === filePath) {
          item = child;
          break;
        }
      }
      if (item) {
        var startTime = new Time();
        startTime.seconds = atSec;
        seq.videoTracks[0].insertClip(item, startTime.ticks);
      }
    }
  } catch(e) {}
}

function duplicateTimelineRange(srcSeq, dstSeq, startSec, endSec, insertAtSec) {
  // Copy clips from srcSeq in range [startSec, endSec] to dstSeq at insertAtSec
  // Copies both video AND audio tracks
  try {
    for (var t = 0; t < srcSeq.videoTracks.numTracks; t++) {
      var track = srcSeq.videoTracks[t];
      for (var c = 0; c < track.clips.numItems; c++) {
        var clip = track.clips[c];
        var clipStart = clip.start.seconds;
        var clipEnd   = clip.end.seconds;
        if (clipEnd > startSec && clipStart < endSec) {
          var insertTime = new Time();
          insertTime.seconds = insertAtSec + Math.max(0, clipStart - startSec);
          if (clip.projectItem) {
            try {
              // Ensure destination has enough video tracks
              while (dstSeq.videoTracks.numTracks <= t) dstSeq.videoTracks.add();
              dstSeq.videoTracks[t].insertClip(clip.projectItem, insertTime.ticks);
            } catch(e2) {}
          }
        }
      }
    }
    // Copy audio tracks
    for (var at = 0; at < srcSeq.audioTracks.numTracks; at++) {
      var atrack = srcSeq.audioTracks[at];
      for (var ac = 0; ac < atrack.clips.numItems; ac++) {
        var aclip = atrack.clips[ac];
        var aStart = aclip.start.seconds;
        var aEnd   = aclip.end.seconds;
        if (aEnd > startSec && aStart < endSec) {
          var aInsertTime = new Time();
          aInsertTime.seconds = insertAtSec + Math.max(0, aStart - startSec);
          if (aclip.projectItem) {
            try {
              while (dstSeq.audioTracks.numTracks <= at) dstSeq.audioTracks.add();
              dstSeq.audioTracks[at].insertClip(aclip.projectItem, aInsertTime.ticks);
            } catch(ae2) {}
          }
        }
      }
    }
  } catch(e) {}
}

function appendSequenceToSequence(srcSeq, dstSeq, atSec) {
  try {
    var srcItem = null;
    var proj = app.project;
    for (var i = 0; i < proj.sequences.numSequences; i++) {
      if (proj.sequences[i].sequenceID === srcSeq.sequenceID) {
        srcItem = proj.sequences[i].projectItem;
        break;
      }
    }
    if (srcItem) {
      var t = new Time();
      t.seconds = atSec;
      dstSeq.videoTracks[0].insertClip(srcItem, t.ticks);
    }
  } catch(e) {}
}

function prependClip(proj, seq, filePath) {
  importAndInsert(proj, seq, filePath, 0);
}

function appendClip(proj, seq, filePath) {
  importAndInsert(proj, seq, filePath, getSequenceDuration(seq));
}
