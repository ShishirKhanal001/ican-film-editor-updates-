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
      case 'getProjectFolder':    result = getProjectFolder(params); break;
      case 'importPPTranscript':  result = importPPTranscript(params); break;
      case 'getAudioTrackInfo':   result = getAudioTrackInfo(params); break;
      case 'applyTrackMixerPlugins': result = applyTrackMixerPlugins(params); break;
      case 'addRangeMarkers':     result = addRangeMarkers(params); break;
      case 'setInOutPoints':     result = setInOutPoints(params); break;
      case 'duplicateTimelineRange': result = duplicateTimelineRange(params); break;
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
  // If user manually provided an audio file path, use it directly
  if (params.manualAudioPath) {
    var mf = new File(params.manualAudioPath);
    if (mf.exists) {
      return { success: true, audioPath: mf.fsName, method: 'manual' };
    }
    return { success: false, error: 'File not found: ' + params.manualAudioPath };
  }

  // Use user-set temp folder, or the Premiere project folder, or system temp
  var tempFolder = params.tempFolder;
  if (!tempFolder || tempFolder === '') {
    try {
      var projFile = new File(app.project.path);
      tempFolder = projFile.parent.fsName + '/ICAN Temp';
      var tmpDir = new Folder(tempFolder);
      if (!tmpDir.exists) tmpDir.create();
    } catch(e) {
      tempFolder = Folder.temp.fsName;
    }
  }

  var seq = getActiveSequence();
  var base = tempFolder.replace(/[\\\/]+$/, '');
  var outputPath = base + '/ican_' + Date.now() + '.mp3';

  // --- Strategy 1: exportAsMixdown (Premiere Pro 2022+) ---
  // Synchronous, exports full timeline audio mix. No AME dialog.
  try {
    var wavFile = new File(base + '/ican_' + Date.now() + '.wav');
    seq.exportAsMixdown(wavFile.fsName);
    if (wavFile.exists) {
      return { success: true, audioPath: wavFile.fsName, method: 'mixdown' };
    }
  } catch(e1) {}

  // --- Strategy 2: AME queue (returns immediately — JS side polls for file) ---
  // Don't call launchEncoder() — just queue and let AME run in background.
  // AME may open its window briefly; it will export and close automatically.
  try {
    var outFile = new File(outputPath);
    app.encoder.encodeSequence(
      seq,
      outFile.fsName,
      '',   // default preset (audio)
      1,    // remove from queue when done
      1     // start immediately
    );
    // Return right away — JS will poll the server for file existence
    return {
      success:    true,
      pending:    true,
      audioPath:  outFile.fsName,
      method:     'AME-background'
    };
  } catch(e2) {}

  // --- Fallback: manual export ---
  return {
    success:           false,
    needsManualExport: true,
    error:             'All auto-export methods failed. Please export audio manually from Premiere Pro.'
  };
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

// ---- Set in/out points for range preview ----
function setInOutPoints(params) {
  try {
    var seq = getActiveSequence();
    var inTime = new Time();
    inTime.seconds = params.inSec;
    var outTime = new Time();
    outTime.seconds = params.outSec;
    seq.setInPoint(inTime.ticks);
    seq.setOutPoint(outTime.ticks);
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
  // Remove any clip that overlaps the range (not just fully contained)
  // After razor cuts, the clip between razors should be exactly in range
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = track.clips.numItems - 1; c >= 0; c--) {
      var clip = track.clips[c];
      // Clip overlaps range if it doesn't end before start AND doesn't start after end
      var clipStart = parseInt(clip.start.ticks, 10);
      var clipEnd   = parseInt(clip.end.ticks, 10);
      var rangeStart = parseInt(startTicks, 10);
      var rangeEnd   = parseInt(endTicks, 10);
      if (clipEnd > rangeStart && clipStart < rangeEnd) {
        clip.remove(true, true);
      }
    }
  }
  for (var t2 = 0; t2 < seq.audioTracks.numTracks; t2++) {
    var atrack = seq.audioTracks[t2];
    for (var ac = atrack.clips.numItems - 1; ac >= 0; ac--) {
      var aclip = atrack.clips[ac];
      var aClipStart = parseInt(aclip.start.ticks, 10);
      var aClipEnd   = parseInt(aclip.end.ticks, 10);
      var aRangeStart = parseInt(startTicks, 10);
      var aRangeEnd   = parseInt(endTicks, 10);
      if (aClipEnd > aRangeStart && aClipStart < aRangeEnd) {
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
// Uses timeline markers which work on ALL Premiere versions.
// User can convert markers to captions via: Captions panel → Create Captions from Sequence Markers
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

    // Clear previous ICAN caption markers first
    try {
      var existingMarkers = seq.markers;
      var toRemove = [];
      for (var ri = existingMarkers.numMarkers - 1; ri >= 0; ri--) {
        var em = existingMarkers[ri];
        if (em && em.comments === '[CAPTION]') toRemove.push(em);
      }
      for (var rj = 0; rj < toRemove.length; rj++) {
        toRemove[rj].remove();
      }
    } catch(cleanErr) {}

    // Add caption markers — colour-coded by style preset
    var colorMap = { clean: 7, shadow: 7, box: 6, highlight: 2 }; // white, cyan, orange
    var colorId  = colorMap[style.preset] || 7;

    for (var mi = 0; mi < chunks.length; mi++) {
      var mk = seq.markers.createMarker(chunks[mi].startSec);
      mk.name = chunks[mi].text;
      mk.comments = '[CAPTION]';
      mk.colorByIndex = colorId;
      try {
        var mkEnd = new Time();
        mkEnd.seconds = chunks[mi].endSec;
        mk.end = mkEnd;
      } catch(endErr) {}
      totalAdded++;
    }

    return {
      success:  true,
      method:   'markers',
      count:    totalAdded,
      note:     'Captions added as ' + totalAdded + ' timeline markers. To make them visible: Captions panel → Create Captions from Sequence Markers.'
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
  var filter;
  if (params && params.filter) {
    // If filter is an array of extensions (e.g. ['mp4','mov']), build a display string
    if (typeof params.filter === 'object' && params.filter.join) {
      filter = 'Media Files:*.' + params.filter.join(';*.');
    } else {
      // String filter like "Audio Files:*.mp3;*.wav"
      filter = params.filter;
    }
  }
  var f = File.openDialog('Select file', filter);
  if (f) return { success: true, path: f.fsName };
  return { success: false, path: null };
}

function browseForFolder(params) {
  var folder = Folder.selectDialog('Select folder');
  if (folder) return { success: true, path: folder.fsName };
  return { success: false, path: null };
}

function getProjectFolder(params) {
  try {
    var projFile = new File(app.project.path);
    var folder   = projFile.parent.fsName;
    var tempPath = folder + '\\ICAN Temp';
    var tempDir  = new Folder(tempPath);
    if (!tempDir.exists) tempDir.create();
    return { success: true, projectFolder: folder, tempPath: tempPath };
  } catch(e) {
    return { success: false, projectFolder: '', tempPath: '' };
  }
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

// ---- Import Premiere Pro's built-in transcript ----
// Reads markers from the sequence that were created by Premiere's transcription tool.
// Falls back to reading captions if available.
function importPPTranscript(params) {
  try {
    var seq = getActiveSequence();
    var segments = [];

    // Read all markers from the sequence
    var markers = seq.markers;
    if (markers && markers.numMarkers > 0) {
      for (var i = 0; i < markers.numMarkers; i++) {
        var m = markers[i];
        if (m.comments === '[CAPTION]') continue; // Skip our own caption markers
        var startSec = m.start ? m.start.seconds : 0;
        var endSec = m.end ? m.end.seconds : (startSec + 3);
        if (m.name && m.name.trim().length > 0) {
          segments.push({
            timeSec: startSec,
            endSec: endSec,
            original: m.name,
            english: m.name
          });
        }
      }
    }

    // Also check for caption tracks if available
    try {
      if (seq.captionTracks && seq.captionTracks.numTracks > 0) {
        for (var ct = 0; ct < seq.captionTracks.numTracks; ct++) {
          var track = seq.captionTracks[ct];
          if (track.clips) {
            for (var cc = 0; cc < track.clips.numItems; cc++) {
              var clip = track.clips[cc];
              segments.push({
                timeSec: clip.start ? clip.start.seconds : 0,
                endSec: clip.end ? clip.end.seconds : 0,
                original: clip.name || '',
                english: clip.name || ''
              });
            }
          }
        }
      }
    } catch(capErr) {}

    segments.sort(function(a, b) { return a.timeSec - b.timeSec; });

    return { success: true, segments: segments, count: segments.length };
  } catch(e) {
    return { success: false, error: e.toString(), segments: [] };
  }
}

// ---- Get audio track info for track mixer UI ----
function getAudioTrackInfo(params) {
  try {
    var seq = getActiveSequence();
    var tracks = [];
    for (var t = 0; t < seq.audioTracks.numTracks; t++) {
      var track = seq.audioTracks[t];
      tracks.push({
        index: t,
        name: track.name || ('A' + (t + 1)),
        muted: track.isMuted ? track.isMuted() : false
      });
    }
    // Also get master/mix track info
    tracks.push({
      index: -1,
      name: 'Mix (Master)',
      muted: false
    });
    return { success: true, tracks: tracks };
  } catch(e) {
    return { success: false, error: e.toString(), tracks: [] };
  }
}

// ---- Apply audio plugins to track mixer ----
function applyTrackMixerPlugins(params) {
  try {
    var seq = getActiveSequence();
    var assignments = params.assignments; // [{trackIndex: 0, plugins: ['name1', 'name2']}, ...]
    var applied = 0;
    var errors = [];

    for (var a = 0; a < assignments.length; a++) {
      var assignment = assignments[a];
      var trackIdx = assignment.trackIndex;
      if (trackIdx < 0 || trackIdx >= seq.audioTracks.numTracks) continue;

      var track = seq.audioTracks[trackIdx];
      var plugins = assignment.plugins;

      for (var p = 0; p < plugins.length; p++) {
        try {
          // addAudioEffect adds to the track mixer, not individual clips
          track.addAudioEffect(plugins[p]);
          applied++;
        } catch(plugErr) {
          errors.push('Track ' + track.name + ': "' + plugins[p] + '" not found');
        }
      }
    }

    return {
      success: true,
      applied: applied,
      errors: errors.length > 0 ? errors.join('; ') : null
    };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Add range markers (for highlights with in/out points) ----
function addRangeMarkers(params) {
  try {
    var seq = getActiveSequence();
    var items = params.items; // [{startSec, endSec, name, color}]
    var colorMap = { yellow: 0, red: 1, orange: 2, green: 3, blue: 4, purple: 5, cyan: 6, white: 7 };
    var added = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var marker = seq.markers.createMarker(item.startSec);
      marker.name = item.name || ('Highlight ' + (i + 1));
      marker.comments = item.reason || '';
      marker.colorByIndex = colorMap[item.color] || 0;

      // Set marker duration to cover the full range (in → out)
      try {
        var endTime = new Time();
        endTime.seconds = item.endSec;
        marker.end = endTime;
      } catch(endErr) {}

      added++;
    }

    return { success: true, count: added };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}
