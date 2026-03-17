/* ================================================
   ICAN Film Editor — Main Panel Logic
   ================================================ */

const SERVER_PORT = () => getSetting('serverPort') || 3737;
const SERVER_URL = () => `http://localhost:${SERVER_PORT()}`;

// ---- State ----
let state = {
  transcriptData: null,       // [{time, timeSec, english, original}, ...]
  analysisData: null,         // {summary, highlights, fillers, reels}
  reelCount: 2,
  brandingFiles: { hIntro: null, hOutro: null, vIntro: null, vOutro: null },
  settings: {},
  viewMode: 'english',        // english | original | both
  projectFolder: null          // cached project folder path
};

// Helper to get project folder (cached from last transcribe or load)
function getProjectFolder() {
  return state.projectFolder || '';
}

// ---- Provider UI toggles ----
function updateProviderUI(provider) {
  document.getElementById('groqAiRow').style.display    = provider === 'groq'      ? 'block' : 'none';
  document.getElementById('claudeKeyRow').style.display = provider === 'anthropic' ? 'flex' : 'none';
  document.getElementById('geminiKeyRow').style.display = provider === 'gemini'    ? 'flex' : 'none';
  document.getElementById('ollamaRow').style.display    = provider === 'ollama'    ? 'block' : 'none';
}

function updateTranscribeProviderUI(provider) {
  document.getElementById('groqKeyRow').style.display   = provider === 'groq'   ? 'flex' : 'none';
  document.getElementById('openaiKeyRow').style.display = provider === 'openai' ? 'flex' : 'none';
}

document.getElementById('aiProvider').addEventListener('change', function() {
  updateProviderUI(this.value);
});

document.getElementById('transcribeProvider').addEventListener('change', function() {
  updateTranscribeProviderUI(this.value);
});

// ---- Load settings from localStorage ----
function loadSettings() {
  try {
    state.settings = JSON.parse(localStorage.getItem('icanSettings') || '{}');
    if (state.settings.openaiKey)          document.getElementById('openaiKey').value          = state.settings.openaiKey;
    if (state.settings.groqKey)            document.getElementById('groqKey').value            = state.settings.groqKey;
    if (state.settings.anthropicKey)       document.getElementById('anthropicKey').value       = state.settings.anthropicKey;
    if (state.settings.geminiKey)          document.getElementById('geminiKey').value          = state.settings.geminiKey;
    if (state.settings.tempFolder)         document.getElementById('tempFolder').value         = state.settings.tempFolder;
    if (state.settings.serverPort)         document.getElementById('serverPort').value         = state.settings.serverPort;
    if (state.settings.aiProvider)         document.getElementById('aiProvider').value         = state.settings.aiProvider;
    if (state.settings.transcribeProvider) document.getElementById('transcribeProvider').value = state.settings.transcribeProvider;
    if (state.settings.ollamaModel)        document.getElementById('ollamaModel').value        = state.settings.ollamaModel;
    if (state.settings.ollamaUrl)          document.getElementById('ollamaUrl').value          = state.settings.ollamaUrl;
    updateProviderUI(state.settings.aiProvider || 'anthropic');
    updateTranscribeProviderUI(state.settings.transcribeProvider || 'groq');

    // Per-brand branding files
    const brand = state.settings.activeBrand || 'ican';
    const brandFiles = (state.settings.brandingByBrand || {})[brand];
    if (brandFiles) { state.brandingFiles = brandFiles; updateBrandingUI(); }

    // Apply saved brand theme
    applyBrandTheme(brand);
    const sel = document.getElementById('brandSelect');
    if (sel) sel.value = brand;
  } catch(e) {}
}

function getSetting(key) {
  return state.settings[key];
}

function saveSettings() {
  const existing = state.settings;
  state.settings = {
    ...existing,
    openaiKey:          document.getElementById('openaiKey').value.trim(),
    groqKey:            document.getElementById('groqKey').value.trim(),
    anthropicKey:       document.getElementById('anthropicKey').value.trim(),
    geminiKey:          document.getElementById('geminiKey').value.trim(),
    tempFolder:         document.getElementById('tempFolder').value.trim(),
    serverPort:         document.getElementById('serverPort').value.trim(),
    aiProvider:         document.getElementById('aiProvider').value,
    transcribeProvider: document.getElementById('transcribeProvider').value,
    ollamaModel:        document.getElementById('ollamaModel').value,
    ollamaUrl:          document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
  };
  localStorage.setItem('icanSettings', JSON.stringify(state.settings));
  updateApiStatusDots();
  setStatus('Settings saved.', 'success');
  closeModal('settingsModal');
}

// ---- Status Bar ----
function setStatus(msg, type = 'idle') {
  const bar = document.getElementById('statusBar');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  bar.className = 'status-bar ' + type;
  text.textContent = msg;
  const icons = { idle: '●', working: '◌', success: '●', error: '●' };
  icon.textContent = icons[type] || '●';
  const colors = { idle: '#999', working: '#f39c12', success: '#27ae60', error: '#c0392b' };
  icon.style.color = colors[type] || '#999';
}

// ---- Progress Bar ----
function showProgress(pct, label) {
  const container = document.getElementById('progressContainer');
  const fill = document.getElementById('progressFill');
  const lbl = document.getElementById('progressLabel');
  container.style.display = 'block';
  fill.style.width = pct + '%';
  lbl.textContent = label;
}

function hideProgress() {
  document.getElementById('progressContainer').style.display = 'none';
  document.getElementById('progressFill').style.width = '0%';
}

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---- TRANSCRIBE ----
document.getElementById('btnTranscribe').addEventListener('click', async () => {
  const settings = state.settings;
  const txProvider = settings.transcribeProvider || 'groq';
  if (txProvider === 'groq' && !settings.groqKey) {
    setStatus('Groq API key missing — open Settings.', 'error');
    return;
  }
  if (txProvider === 'openai' && !settings.openaiKey) {
    setStatus('OpenAI API key missing — open Settings.', 'error');
    return;
  }

  setStatus('Extracting audio from timeline...', 'working');
  showProgress(10, 'Extracting audio...');

  try {
    // 1. Tell ExtendScript to export the audio
    const exportResult = await callExtendScript('exportTimelineAudio', {
      tempFolder: settings.tempFolder || '',
      source: document.getElementById('audioSource').value
    });

    if (!exportResult.success) {
      if (exportResult.needsManualExport) {
        hideProgress();
        showManualAudioSection(true);
        setStatus('Auto-export failed — export MP3 from Premiere manually (see below). Detail: ' + (exportResult.error || ''), 'error');
        return;
      }
      throw new Error(exportResult.error || 'Audio export failed');
    }

    // AME queued but file not ready yet — poll up to 20s then fall back to manual
    if (exportResult.pending && exportResult.audioPath) {
      setStatus('Checking if AME exported the file...', 'working');
      let found = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const chk = await fetch(`${SERVER_URL()}/check-file?path=${encodeURIComponent(exportResult.audioPath)}`);
          const data = await chk.json();
          if (data.exists) { found = true; break; }
        } catch(e) {}
      }
      if (!found) {
        hideProgress();
        showManualAudioSection(true);
        setStatus('Auto-export not available — export MP3 from Premiere manually (see below)', 'error');
        return;
      }
    }

    await runTranscription(exportResult.audioPath, exportResult.sourcePaths, exportResult.useSourceFiles);

  } catch(err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
    hideProgress();
  }
});

// ---- Shared transcription + translation function ----
async function runTranscription(audioPath, sourcePaths, useSourceFiles) {
  const settings = state.settings;
  showProgress(25, 'Sending to Whisper AI for transcription...');
  setStatus('Transcribing audio (this may take a few minutes for long videos)...', 'working');

  try {
    // Get the Premiere project folder so temp files stay next to the project
    let projectFolder = '';
    try {
      const pf = await callExtendScript('getProjectFolder', {});
      if (pf && pf.projectFolder) projectFolder = pf.projectFolder;
      state.projectFolder = projectFolder; // cache for save buttons
    } catch(e) {}

    const lang = document.getElementById('sourceLang').value;

    // Start polling for progress updates while transcription runs
    let progressPoll = setInterval(async () => {
      try {
        const pr = await fetch(`${SERVER_URL()}/progress`, { signal: AbortSignal.timeout(2000) });
        const pg = await pr.json();
        if (pg.stage === 'transcribing' || pg.stage === 'chunking') {
          showProgress(pg.percent, pg.detail);
          setStatus(pg.detail, 'working');
        }
      } catch(e) {}
    }, 2000);

    let transcribeData;
    try {
      // 15 minute timeout — large files (72 min / 5 chunks) can take several minutes
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

      const transcribeRes = await fetch(`${SERVER_URL()}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          audioPath,
          sourcePaths,
          useSourceFiles,
          projectFolder,
          language:           lang === 'auto' ? null : lang,
          transcribeProvider: settings.transcribeProvider || 'groq',
          groqKey:            settings.groqKey,
          openaiKey:          settings.openaiKey
        })
      });

      clearTimeout(timeoutId);
      if (!transcribeRes.ok) throw new Error(await transcribeRes.text());
      transcribeData = await transcribeRes.json();
    } finally {
      clearInterval(progressPoll);
    }

    showProgress(65, 'Translating to English...');
    setStatus('Translating...', 'working');

    const targetLangCode = document.getElementById('targetLang').value;
    const targetLangNames = { en: 'English', fr: 'French', es: 'Spanish', ar: 'Arabic' };
    const targetLang = targetLangNames[targetLangCode] || targetLangCode;
    // 15 minute timeout for translation too (37 batches can be slow)
    const txController = new AbortController();
    const txTimeoutId = setTimeout(() => txController.abort(), 15 * 60 * 1000);

    const translateRes = await fetch(`${SERVER_URL()}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: txController.signal,
      body: JSON.stringify({
        segments:     transcribeData.segments,
        targetLang,
        provider:     settings.aiProvider || 'groq',
        anthropicKey: settings.anthropicKey,
        groqKey:      settings.groqKey,
        geminiKey:    settings.geminiKey,
        ollamaModel:  settings.ollamaModel,
        ollamaUrl:    settings.ollamaUrl
      })
    });

    clearTimeout(txTimeoutId);
    if (!translateRes.ok) throw new Error(await translateRes.text());
    const translateData = await translateRes.json();

    showProgress(100, 'Done!');
    state.transcriptData = translateData.segments;
    sessionStorage.setItem('icanLastTranscript', JSON.stringify(state.transcriptData));

    renderScript(state.transcriptData);
    scheduleAutoSave();
    document.getElementById('scriptSection').style.display = 'block';
    document.getElementById('analyzeNotice').style.display = 'none';
    document.getElementById('analyzePanel').style.display = 'block';
    document.getElementById('captionsNotice').style.display = 'none';
    document.getElementById('captionsPanel').style.display = 'block';

    setStatus(`Transcription complete — ${state.transcriptData.length} segments`, 'success');
    hideProgress();

  } catch(err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
    hideProgress();
  }
}

// ---- RENDER SCRIPT ----
function renderScript(segments) {
  const container = document.getElementById('scriptContainer');
  container.innerHTML = '';
  segments.forEach((seg, idx) => {
    const line = document.createElement('div');
    line.className = 'script-line';
    line.dataset.index = idx;
    line.dataset.time = seg.timeSec;

    const timeEl = document.createElement('span');
    timeEl.className = 'script-time';
    timeEl.textContent = formatTime(seg.timeSec);

    const block = document.createElement('div');
    block.className = 'script-text-block';

    const engInput = document.createElement('input');
    engInput.className = 'script-english';
    engInput.value = seg.english || '';
    engInput.type = 'text';
    engInput.addEventListener('change', (e) => {
      state.transcriptData[idx].english = e.target.value;
    });

    const origEl = document.createElement('div');
    origEl.className = 'script-original';
    origEl.textContent = seg.original || '';

    block.appendChild(engInput);
    if (seg.original && seg.original !== seg.english) block.appendChild(origEl);

    line.appendChild(timeEl);
    line.appendChild(block);
    container.appendChild(line);

    // Click to jump in timeline
    line.addEventListener('click', (e) => {
      if (e.target === engInput) return;
      document.querySelectorAll('.script-line').forEach(l => l.classList.remove('active'));
      line.classList.add('active');
      callExtendScript('jumpToTime', { timeSec: seg.timeSec });
    });
  });

  applyViewMode();
}

function applyViewMode() {
  const mode = state.viewMode;
  document.querySelectorAll('.script-original').forEach(el => {
    el.style.display = (mode === 'original' || mode === 'both') ? 'block' : 'none';
  });
  document.querySelectorAll('.script-english').forEach(el => {
    el.style.display = (mode === 'english' || mode === 'both') ? 'block' : 'none';
  });
}

// Toggle buttons
['English','Original','Both'].forEach(label => {
  document.getElementById('toggle' + label).addEventListener('click', function() {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    state.viewMode = label.toLowerCase();
    applyViewMode();
  });
});

// Script TXT export
document.getElementById('btnExportScript').addEventListener('click', () => {
  if (!state.transcriptData) return;
  const lines = state.transcriptData.map(s => `[${formatTime(s.timeSec)}] ${s.english}`).join('\n');
  downloadText(lines, 'transcript.txt', 'text/plain');
});

// SRT export (proper subtitle file for social media / YouTube)
document.getElementById('btnExportSrt').addEventListener('click', () => {
  if (!state.transcriptData) return;
  const srt = state.transcriptData.map((s, i) => {
    const start = secondsToSrtTime(s.timeSec);
    const end   = secondsToSrtTime(s.endSec || s.timeSec + 3);
    return `${i + 1}\n${start} --> ${end}\n${s.english}\n`;
  }).join('\n');
  downloadText(srt, 'transcript.srt', 'text/plain');
  setStatus('SRT subtitle file exported', 'success');
});

function secondsToSrtTime(secs) {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function downloadText(content, filename, mimeType) {
  // CEP panels block Blob URLs — save via the server instead
  fetch(`${SERVER_URL()}/save-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, filename, projectFolder: getProjectFolder() })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      setStatus(`Saved: ${data.path}`, 'success');
    } else {
      // Fallback: try Blob URL (works in browser preview)
      try {
        const blob = new Blob([content], { type: mimeType });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus(`Exported ${filename}`, 'success');
      } catch(e2) {
        setStatus('Save failed: ' + (data.error || e2.message), 'error');
      }
    }
  })
  .catch(() => {
    // Fallback: try Blob URL
    try {
      const blob = new Blob([content], { type: mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(`Exported ${filename}`, 'success');
    } catch(e) {
      setStatus('Save failed — server offline', 'error');
    }
  });
}

document.getElementById('btnCopyScript').addEventListener('click', () => {
  if (!state.transcriptData) return;
  const lines = state.transcriptData.map(s => `[${formatTime(s.timeSec)}] ${s.english}`).join('\n');
  // CEP panels may block navigator.clipboard — use fallback methods
  try {
    // Method 1: execCommand (works in CEP)
    const textarea = document.createElement('textarea');
    textarea.value = lines;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setStatus('Script copied to clipboard ✓', 'success');
  } catch(e) {
    // Method 2: navigator.clipboard (works in browser)
    if (navigator.clipboard) {
      navigator.clipboard.writeText(lines).then(() => {
        setStatus('Script copied to clipboard ✓', 'success');
      }).catch(() => {
        setStatus('Copy failed — try selecting text manually', 'error');
      });
    } else {
      setStatus('Copy not supported in this environment', 'error');
    }
  }
});

// Transcript search
document.getElementById('searchScript').addEventListener('input', function() {
  const query = this.value.trim().toLowerCase();
  document.querySelectorAll('.script-line').forEach(line => {
    const engEl  = line.querySelector('.script-english');
    const origEl = line.querySelector('.script-original');
    const text   = ((engEl ? engEl.value : '') + ' ' + (origEl ? origEl.textContent : '')).toLowerCase();

    if (!query || text.includes(query)) {
      line.classList.remove('hidden');
      // Highlight match in english input
      if (query && engEl) {
        const val = engEl.value;
        const idx = val.toLowerCase().indexOf(query);
        if (idx >= 0) line.style.borderLeft = '3px solid var(--accent)';
        else line.style.borderLeft = '';
      } else {
        line.style.borderLeft = '';
      }
    } else {
      line.classList.add('hidden');
    }
  });
  const visible = document.querySelectorAll('.script-line:not(.hidden)').length;
  const total   = document.querySelectorAll('.script-line').length;
  if (query) setStatus(`${visible} of ${total} segments match "${query}"`, 'idle');
  else setStatus('Ready', 'idle');
});

// ---- ANALYZE ----
let reelCount = 2;
document.getElementById('reelMinus').addEventListener('click', () => {
  if (reelCount > 1) { reelCount--; document.getElementById('reelCount').textContent = reelCount; }
});
document.getElementById('reelPlus').addEventListener('click', () => {
  if (reelCount < 10) { reelCount++; document.getElementById('reelCount').textContent = reelCount; }
});

document.getElementById('btnAnalyze').addEventListener('click', async () => {
  if (!state.transcriptData) return;
  const settings = state.settings;
  const aiProv = settings.aiProvider || 'groq';

  // Check the correct provider key — not just anthropicKey
  if (aiProv === 'groq' && !settings.groqKey) {
    setStatus('Groq API key missing — open Settings.', 'error');
    return;
  }
  if (aiProv === 'anthropic' && !settings.anthropicKey) {
    setStatus('Claude API key missing — open Settings.', 'error');
    return;
  }
  if (aiProv === 'gemini' && !settings.geminiKey) {
    setStatus('Gemini API key missing — open Settings.', 'error');
    return;
  }
  // Ollama needs no key (local)

  const providerName = aiProv === 'groq' ? 'Groq' : aiProv === 'anthropic' ? 'Claude' : aiProv === 'gemini' ? 'Gemini' : 'Ollama';
  setStatus('Running AI analysis...', 'working');
  showProgress(30, `${providerName} is analyzing your script...`);

  try {
    const opts = {
      summary: document.getElementById('optSummary').checked,
      highlights: document.getElementById('optHighlights').checked,
      fillers: document.getElementById('optFillers').checked,
      reels: document.getElementById('optReels').checked,
      reelCount
    };

    const res = await fetch(`${SERVER_URL()}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments:     state.transcriptData,
        options:      opts,
        provider:     settings.aiProvider || 'groq',
        anthropicKey: settings.anthropicKey,
        groqKey:      settings.groqKey,
        geminiKey:    settings.geminiKey,
        ollamaModel:  settings.ollamaModel,
        ollamaUrl:    settings.ollamaUrl
      })
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    state.analysisData = data;

    showProgress(100, 'Analysis complete');
    renderAnalysisResults(data, opts);
    document.getElementById('analysisResults').style.display = 'block';
    setStatus('Analysis complete', 'success');
    hideProgress();

  } catch(err) {
    setStatus('Analysis error: ' + err.message, 'error');
    hideProgress();
  }
});

function renderAnalysisResults(data, opts) {
  // Summary
  if (opts.summary && data.summary) {
    document.getElementById('summaryBlock').style.display = 'block';
    document.getElementById('summaryText').textContent = data.summary;
  }

  // Highlights
  if (opts.highlights && data.highlights) {
    document.getElementById('highlightsBlock').style.display = 'block';
    const list = document.getElementById('highlightsList');
    list.innerHTML = '';
    data.highlights.forEach(h => {
      list.appendChild(createResultItem(h.startSec, h.endSec, h.text, h.reason, false));
    });
  }

  // Fillers
  if (opts.fillers && data.fillers) {
    document.getElementById('fillersBlock').style.display = 'block';
    const list = document.getElementById('fillersList');
    list.innerHTML = '';
    data.fillers.forEach(f => {
      list.appendChild(createResultItem(f.startSec, f.endSec, f.text, f.type, true));
    });
  }

  // Reels
  if (opts.reels && data.reels) {
    document.getElementById('reelsBlock').style.display = 'block';
    const list = document.getElementById('reelsList');
    list.innerHTML = '';
    data.reels.forEach((r, i) => {
      list.appendChild(createResultItem(r.startSec, r.endSec, `Reel ${i+1}: ${r.title}`, r.reason, false, `${Math.round(r.endSec - r.startSec)}s`));
    });
  }
}

function createResultItem(startSec, endSec, text, subtext, hasCheckbox, badge) {
  const item = document.createElement('div');
  item.className = 'result-item';
  item.dataset.start = startSec;
  item.dataset.end = endSec;

  if (hasCheckbox) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'result-item-check';
    cb.checked = true;
    item.appendChild(cb);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'result-item-time';
  timeEl.textContent = `${formatTime(startSec)} → ${formatTime(endSec)}`;
  item.appendChild(timeEl);

  const textBlock = document.createElement('div');
  textBlock.className = 'result-item-text';
  textBlock.innerHTML = `<strong>${text}</strong>${subtext ? `<br><em style="font-size:10px;color:#888">${subtext}</em>` : ''}`;
  item.appendChild(textBlock);

  if (badge) {
    const b = document.createElement('span');
    b.className = 'result-item-badge';
    b.textContent = badge;
    item.appendChild(b);
  }

  item.addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') return;
    callExtendScript('jumpToTime', { timeSec: startSec });
  });

  return item;
}

// Mark highlights with range markers (in/out points)
document.getElementById('markHighlights').addEventListener('click', async () => {
  if (!state.analysisData?.highlights) return;
  const items = state.analysisData.highlights.map((h, i) => ({
    startSec: h.startSec,
    endSec: h.endSec,
    name: h.text ? h.text.substring(0, 40) : ('Highlight ' + (i + 1)),
    reason: h.reason || '',
    color: 'yellow'
  }));
  const result = await callExtendScript('addRangeMarkers', { items });
  setStatus(result.success ? `${result.count} highlights marked with in/out points` : 'Error: ' + result.error, result.success ? 'success' : 'error');
});

// Select all fillers
document.getElementById('selectAllFillers').addEventListener('click', () => {
  document.querySelectorAll('#fillersList .result-item-check').forEach(cb => cb.checked = true);
});

// Cut selected fillers
document.getElementById('cutSelectedFillers').addEventListener('click', async () => {
  const fillers = [];
  document.querySelectorAll('#fillersList .result-item').forEach(item => {
    const cb = item.querySelector('.result-item-check');
    if (cb?.checked) fillers.push({ startSec: +item.dataset.start, endSec: +item.dataset.end });
  });
  if (!fillers.length) return;
  setStatus(`Cutting ${fillers.length} filler segments...`, 'working');
  const result = await callExtendScript('cutSegments', { segments: fillers });
  setStatus(result.success ? `Cut ${fillers.length} fillers` : 'Cut failed: ' + result.error, result.success ? 'success' : 'error');
});

// Create reels
document.getElementById('btnCreateReels').addEventListener('click', async () => {
  if (!state.analysisData?.reels) return;
  setStatus('Creating reel sequences...', 'working');
  showProgress(20, 'Building reel timelines...');

  const brandingFiles = state.brandingFiles;
  const result = await callExtendScript('createReelSequences', {
    reels: state.analysisData.reels,
    brandingFiles,
    gap: parseFloat(document.getElementById('brandGap')?.value || '1')
  });

  hideProgress();
  if (result.success) {
    setStatus(`Created ${state.analysisData.reels.length} reel sequences`, 'success');
  } else {
    setStatus('Reel creation failed: ' + result.error, 'error');
  }
});

// ---- BRANDING ----
function updateBrandingUI() {
  const slots = { hIntro: 'hIntroName', hOutro: 'hOutroName', vIntro: 'vIntroName', vOutro: 'vOutroName' };
  Object.entries(slots).forEach(([key, elId]) => {
    const el = document.getElementById(elId);
    const val = state.brandingFiles[key];
    if (val) {
      el.textContent = val.split(/[\\/]/).pop();
      el.classList.add('has-file');
    } else {
      el.textContent = 'No file selected';
      el.classList.remove('has-file');
    }
  });
}

document.querySelectorAll('[data-slot]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const slot = btn.dataset.slot;
    const result = await callExtendScript('browseForFile', { filter: ['mp4','mov','mxf','avi'] });
    if (result.path) {
      state.brandingFiles[slot] = result.path;
      updateBrandingUI();
    }
  });
});

document.getElementById('btnSaveBrandPreset').addEventListener('click', () => {
  state.settings.brandingFiles = state.brandingFiles;
  localStorage.setItem('icanSettings', JSON.stringify(state.settings));
  setStatus('Branding preset saved', 'success');
});

document.getElementById('btnApplyBranding').addEventListener('click', async () => {
  setStatus('Applying branding to sequences...', 'working');
  const result = await callExtendScript('applyBranding', {
    files: state.brandingFiles,
    gap: parseFloat(document.getElementById('brandGap').value || '1')
  });
  setStatus(result.success ? 'Branding applied!' : 'Error: ' + result.error, result.success ? 'success' : 'error');
});

// ---- CAPTIONS ----
document.getElementById('captionFontSize').addEventListener('input', function() {
  document.getElementById('captionFontSizeVal').textContent = this.value + 'px';
});

document.getElementById('btnAddCaptions').addEventListener('click', async () => {
  if (!state.transcriptData) return;
  setStatus('Adding captions to timeline...', 'working');

  const langChoice = document.getElementById('captionLang').value;
  const captionData = state.transcriptData.map(s => ({
    timeSec: s.timeSec,
    endSec: s.endSec || (s.timeSec + 3),
    text: langChoice === 'en' ? s.english : s.original
  }));

  const style = {
    preset: document.getElementById('captionPreset').value,
    fontSize: document.getElementById('captionFontSize').value,
    position: document.getElementById('captionPosition').value,
    wordsPerLine: parseInt(document.getElementById('captionWordsPerLine').value)
  };

  const result = await callExtendScript('addCaptions', { captions: captionData, style });
  setStatus(result.success ? 'Captions added!' : 'Caption error: ' + result.error, result.success ? 'success' : 'error');
});

// ---- OLD AUDIO CHAIN removed — replaced by Track Mixer system below ----

// ---- SETTINGS MODAL ----
document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('settingsModal').style.display = 'flex';
});
document.getElementById('closeSettings').addEventListener('click', () => closeModal('settingsModal'));
document.getElementById('saveSettings').addEventListener('click', saveSettings);
document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('settingsModal');
});

document.getElementById('browseTempFolder').addEventListener('click', async () => {
  const result = await callExtendScript('browseForFolder', {});
  if (result.path) document.getElementById('tempFolder').value = result.path;
});

// ---- MANUAL AUDIO IMPORT ----
function showManualAudioSection() {
  // Section is always visible — nothing to toggle
}


document.getElementById('btnBrowseAudio').addEventListener('click', async () => {
  const result = await callExtendScript('browseForFile', { filter: 'Audio Files:*.mp3;*.wav;*.aac;*.m4a;*.flac' });
  if (result && result.path) document.getElementById('manualAudioPath').value = result.path;
});

document.getElementById('btnTranscribeManual').addEventListener('click', async () => {
  const audioPath = document.getElementById('manualAudioPath').value.trim();
  if (!audioPath) { setStatus('Please select an audio file first.', 'error'); return; }
  const settings = state.settings;
  const txProvider = settings.transcribeProvider || 'groq';
  if (txProvider === 'groq' && !settings.groqKey) { setStatus('Groq API key missing — open Settings.', 'error'); return; }
  if (txProvider === 'openai' && !settings.openaiKey) { setStatus('OpenAI API key missing — open Settings.', 'error'); return; }
  await runTranscription(audioPath, null, false);
});

// ---- Import from Premiere Pro Transcript ----
document.getElementById('btnImportPPTranscript').addEventListener('click', async () => {
  setStatus('Importing Premiere Pro transcript...', 'working');
  const result = await callExtendScript('importPPTranscript', {});
  if (result.success && result.segments && result.segments.length > 0) {
    state.transcriptData = result.segments;
    renderScript(state.transcriptData);
    document.getElementById('scriptSection').style.display = 'block';
    document.getElementById('analyzeNotice').style.display = 'none';
    document.getElementById('analyzePanel').style.display = 'block';
    document.getElementById('captionsNotice').style.display = 'none';
    document.getElementById('captionsPanel').style.display = 'block';
    setStatus(`Imported ${result.count} segments from Premiere Pro`, 'success');
  } else if (result.count === 0) {
    setStatus('No transcript found in Premiere Pro. Use Text > Transcribe Sequence first.', 'error');
  } else {
    setStatus('Import error: ' + (result.error || 'unknown'), 'error');
  }
});

// ---- AUDIO TAB: Track Mixer ----

// Built-in Premiere Pro audio effects for search autocomplete
const AUDIO_PLUGINS = [
  // Amplitude
  'Amplify', 'Channel Mixer', 'DeEsser', 'Dynamics', 'Hard Limiter',
  'Multiband Compressor', 'Normalize', 'Single-band Compressor', 'Tube-modeled Compressor',
  // Delay and Echo
  'Analog Delay', 'Delay', 'Echo',
  // Filter and EQ
  'Bass', 'Treble', 'FFT Filter', 'Graphic Equalizer (10 Bands)',
  'Graphic Equalizer (20 Bands)', 'Graphic Equalizer (30 Bands)',
  'Notch Filter', 'Parametric Equalizer', 'Scientific Filter',
  // Modulation
  'Chorus', 'Flanger', 'Phaser',
  // Noise Reduction
  'Adaptive Noise Reduction', 'Automatic Click Remover', 'DeHummer',
  'DeNoise', 'Hiss Reduction', 'Noise Reduction',
  // Reverb
  'Convolution Reverb', 'Reverb', 'Studio Reverb', 'Surround Reverb',
  // Special
  'Distortion', 'Guitar Suite', 'Mastering', 'Vocal Enhancer',
  // Stereo Imagery
  'Center Channel Extractor', 'Stereo Expander',
  // Time and Pitch
  'Automatic Pitch Correction', 'Manual Pitch Correction',
  'Pitch Shifter', 'Stretch and Pitch',
  // Volume
  'Balance', 'Channel Volume', 'Volume',
  // Common third-party
  'Waves NS1', 'Waves RVox', 'Waves C1', 'iZotope RX', 'FabFilter Pro-Q'
];

let audioTrackState = []; // [{index, name, plugins: ['name1', 'name2']}]

document.getElementById('btnLoadTracks').addEventListener('click', async () => {
  setStatus('Loading audio tracks...', 'working');
  const result = await callExtendScript('getAudioTrackInfo', {});
  if (!result.success) { setStatus('Error: ' + result.error, 'error'); return; }

  audioTrackState = result.tracks.map(t => ({
    index: t.index,
    name: t.name,
    plugins: []
  }));

  // Load saved presets for these tracks
  const savedPreset = state.settings.audioTrackPresets || {};
  audioTrackState.forEach(t => {
    if (savedPreset[t.name]) t.plugins = [...savedPreset[t.name]];
  });

  renderTrackMixer();
  updateTrackTargetSelect();
  setStatus(`Loaded ${result.tracks.length} audio tracks`, 'success');
});

function renderTrackMixer() {
  const container = document.getElementById('trackMixerContainer');
  container.innerHTML = '';

  if (audioTrackState.length === 0) {
    container.innerHTML = '<div class="mixer-empty-state">Click "Load Tracks" to see your audio tracks</div>';
    return;
  }

  audioTrackState.forEach((track, ti) => {
    const strip = document.createElement('div');
    strip.className = 'mixer-strip';

    // Header
    const header = document.createElement('div');
    header.className = 'mixer-strip-header';
    header.innerHTML = `
      <span class="mixer-strip-name" title="${track.name}">${track.name}</span>
      <span class="mixer-strip-count">${track.plugins.length} fx</span>
    `;
    strip.appendChild(header);

    // Plugin slots
    const slotsDiv = document.createElement('div');
    slotsDiv.className = 'mixer-strip-slots';

    track.plugins.forEach((pluginName, pi) => {
      const slot = document.createElement('div');
      slot.className = 'mixer-slot';
      slot.title = pluginName;
      slot.innerHTML = `
        <span class="mixer-slot-label">${pluginName}</span>
        <button class="mixer-slot-remove" data-track="${ti}" data-plugin="${pi}">✕</button>
      `;
      slot.querySelector('.mixer-slot-remove').addEventListener('click', function() {
        audioTrackState[+this.dataset.track].plugins.splice(+this.dataset.plugin, 1);
        renderTrackMixer();
      });
      slotsDiv.appendChild(slot);
    });

    // Empty slot placeholders (min 3 visible)
    const emptyCount = Math.max(0, 3 - track.plugins.length);
    for (let i = 0; i < emptyCount; i++) {
      const empty = document.createElement('div');
      empty.className = 'mixer-slot-empty';
      empty.textContent = '\u2014';
      slotsDiv.appendChild(empty);
    }
    strip.appendChild(slotsDiv);

    // Add button at bottom
    const addDiv = document.createElement('div');
    addDiv.className = 'mixer-strip-add';
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'Add plugin to ' + track.name;
    addBtn.addEventListener('click', () => {
      document.getElementById('pluginTargetTrack').value = String(ti);
      const searchInput = document.getElementById('pluginSearch');
      searchInput.focus();
      searchInput.value = '';
      showPluginDropdown('');
    });
    addDiv.appendChild(addBtn);
    strip.appendChild(addDiv);

    container.appendChild(strip);
  });
}

function updateTrackTargetSelect() {
  const sel = document.getElementById('pluginTargetTrack');
  sel.innerHTML = '<option value="all">All Tracks</option>';
  audioTrackState.forEach((t, i) => {
    sel.innerHTML += `<option value="${i}">${t.name}</option>`;
  });
}

document.getElementById('btnAddPluginToTrack').addEventListener('click', () => {
  const pluginName = document.getElementById('pluginSearch').value.trim();
  if (!pluginName) { setStatus('Enter a plugin name first', 'error'); return; }
  const target = document.getElementById('pluginTargetTrack').value;

  if (target === 'all') {
    audioTrackState.forEach(t => t.plugins.push(pluginName));
  } else {
    audioTrackState[+target].plugins.push(pluginName);
  }
  document.getElementById('pluginSearch').value = '';
  document.getElementById('pluginDropdown').style.display = 'none';
  renderTrackMixer();
  setStatus(`Added "${pluginName}"`, 'success');
});

// Save audio preset
document.getElementById('btnSaveAudioPreset').addEventListener('click', () => {
  const presets = {};
  audioTrackState.forEach(t => { presets[t.name] = t.plugins; });
  state.settings.audioTrackPresets = presets;
  localStorage.setItem('icanSettings', JSON.stringify(state.settings));
  setStatus('Audio preset saved', 'success');
});

// Apply to track mixer in Premiere
document.getElementById('btnApplyAudio').addEventListener('click', async () => {
  if (!audioTrackState.length) { setStatus('Load tracks first', 'error'); return; }
  setStatus('Applying plugins to track mixer...', 'working');

  const assignments = audioTrackState
    .filter(t => t.index >= 0 && t.plugins.length > 0)
    .map(t => ({ trackIndex: t.index, plugins: t.plugins }));

  if (!assignments.length) { setStatus('No plugins to apply', 'error'); return; }

  const result = await callExtendScript('applyTrackMixerPlugins', { assignments });
  if (result.success) {
    let msg = `Applied ${result.applied} plugins to track mixer`;
    if (result.errors) msg += ` (warnings: ${result.errors})`;
    setStatus(msg, 'success');
  } else {
    setStatus('Error: ' + result.error, 'error');
  }
});

// ---- PLUGIN SEARCH AUTOCOMPLETE ----
const pluginSearchInput = document.getElementById('pluginSearch');
const pluginDropdown = document.getElementById('pluginDropdown');
let dropdownActiveIndex = -1;

function showPluginDropdown(query) {
  const q = query.toLowerCase().trim();
  if (q.length === 0) {
    pluginDropdown.style.display = 'none';
    return;
  }

  const matches = AUDIO_PLUGINS.filter(p => p.toLowerCase().includes(q));
  if (matches.length === 0) {
    pluginDropdown.innerHTML = '<div class="plugin-dropdown-empty">No match — press Enter to use custom name</div>';
    pluginDropdown.style.display = 'block';
    dropdownActiveIndex = -1;
    return;
  }

  pluginDropdown.innerHTML = matches.map((name, i) => {
    const idx = name.toLowerCase().indexOf(q);
    const before = name.slice(0, idx);
    const match = name.slice(idx, idx + q.length);
    const after = name.slice(idx + q.length);
    return `<div class="plugin-dropdown-item" data-index="${i}" data-name="${name}">
      ${before}<span class="match-highlight">${match}</span>${after}
    </div>`;
  }).join('');

  pluginDropdown.style.display = 'block';
  dropdownActiveIndex = -1;

  pluginDropdown.querySelectorAll('.plugin-dropdown-item').forEach(el => {
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      pluginSearchInput.value = this.dataset.name;
      pluginDropdown.style.display = 'none';
    });
  });
}

pluginSearchInput.addEventListener('input', function() {
  showPluginDropdown(this.value);
});

pluginSearchInput.addEventListener('focus', function() {
  if (this.value.trim()) showPluginDropdown(this.value);
});

pluginSearchInput.addEventListener('blur', function() {
  setTimeout(() => { pluginDropdown.style.display = 'none'; }, 150);
});

pluginSearchInput.addEventListener('keydown', function(e) {
  const items = pluginDropdown.querySelectorAll('.plugin-dropdown-item');
  if (!items.length) {
    if (e.key === 'Enter') document.getElementById('btnAddPluginToTrack').click();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    dropdownActiveIndex = Math.min(dropdownActiveIndex + 1, items.length - 1);
    updateDropdownActive(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    dropdownActiveIndex = Math.max(dropdownActiveIndex - 1, -1);
    updateDropdownActive(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (dropdownActiveIndex >= 0 && items[dropdownActiveIndex]) {
      pluginSearchInput.value = items[dropdownActiveIndex].dataset.name;
      pluginDropdown.style.display = 'none';
    }
    document.getElementById('btnAddPluginToTrack').click();
  } else if (e.key === 'Escape') {
    pluginDropdown.style.display = 'none';
  }
});

function updateDropdownActive(items) {
  items.forEach((el, i) => {
    el.classList.toggle('active', i === dropdownActiveIndex);
    if (i === dropdownActiveIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ---- ExtendScript Bridge ----
function callExtendScript(func, params) {
  return new Promise((resolve) => {
    try {
      const csInterface = new CSInterface();
      const argsJson = JSON.stringify(params);
      csInterface.evalScript(`hostBridge('${func}', '${argsJson.replace(/'/g, "\\'")}')`, (result) => {
        try {
          resolve(JSON.parse(result));
        } catch(e) {
          resolve({ success: false, error: result });
        }
      });
    } catch(e) {
      // In browser dev mode (no CSInterface), return mock
      console.log('[ExtendScript Mock]', func, params);
      resolve({ success: true, mock: true });
    }
  });
}

// ---- Helpers ----
function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ---- BRAND SWITCHING ----
const BRANDS = {
  ican: {
    name: 'ICAN Film',
    sub:  'AI EDITOR',
    logo: 'assets/logo.png',
    attr: null          // default theme (red)
  },
  lucy: {
    name: 'Lucy TV',
    sub:  'AI EDITOR',
    logo: 'assets/lucy-logo.png',
    attr: 'lucy'        // triggers [data-brand="lucy"] CSS
  }
};

function applyBrandTheme(brand) {
  const cfg = BRANDS[brand] || BRANDS.ican;
  document.body.dataset.brand = cfg.attr || '';

  const logoImg  = document.querySelector('.logo-img');
  const logoTitle = document.querySelector('.logo-title');
  const logoSub  = document.querySelector('.logo-sub');

  if (logoImg)   logoImg.src          = cfg.logo;
  if (logoTitle) logoTitle.textContent = cfg.name;
  if (logoSub)   logoSub.textContent   = cfg.sub;
}

document.getElementById('brandSelect').addEventListener('change', function() {
  const brand = this.value;
  state.settings.activeBrand = brand;

  // Load per-brand branding files
  const allBrandFiles = state.settings.brandingByBrand || {};
  state.brandingFiles = allBrandFiles[brand] || { hIntro: null, hOutro: null, vIntro: null, vOutro: null };
  updateBrandingUI();
  applyBrandTheme(brand);

  // Sync branding tab preset selector
  const bp = document.getElementById('brandingPreset');
  if (bp) bp.value = brand;

  localStorage.setItem('icanSettings', JSON.stringify(state.settings));
  setStatus(`Switched to ${BRANDS[brand]?.name || brand}`, 'success');
});

// Save per-brand branding files
const _origSaveBrandPreset = document.getElementById('btnSaveBrandPreset').onclick;
document.getElementById('btnSaveBrandPreset').addEventListener('click', () => {
  const brand = state.settings.activeBrand || 'ican';
  if (!state.settings.brandingByBrand) state.settings.brandingByBrand = {};
  state.settings.brandingByBrand[brand] = { ...state.brandingFiles };
  localStorage.setItem('icanSettings', JSON.stringify(state.settings));
  setStatus(`Branding saved for ${BRANDS[brand]?.name || brand}`, 'success');
});

// ---- AUTO-SAVE TRANSCRIPT ----
let _autoSaveTimer = null;

function scheduleAutoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(doAutoSave, 3000);
}

async function doAutoSave() {
  if (!state.transcriptData || !state.transcriptData.length) return;
  try {
    // Get project folder so transcripts save next to the project
    let projectFolder = '';
    try {
      const pf = await callExtendScript('getProjectFolder', {});
      if (pf && pf.projectFolder) projectFolder = pf.projectFolder;
      state.projectFolder = projectFolder; // cache for save buttons
    } catch(e) {}

    const projectName = (state.settings.activeBrand || 'ican') + '_transcript';
    await fetch(`${SERVER_URL()}/save-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: state.transcriptData, projectName, projectFolder })
    });
    // Save to sessionStorage as a fast restore fallback
    sessionStorage.setItem('icanLastTranscript', JSON.stringify(state.transcriptData));
  } catch(e) {}
}

// Check for unsaved transcript on load
function checkForRestoreableTranscript() {
  const saved = sessionStorage.getItem('icanLastTranscript');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data && data.length > 0) {
        document.getElementById('restoreBanner').classList.add('visible');
        document.getElementById('btnRestoreYes').addEventListener('click', () => {
          state.transcriptData = data;
          renderScript(data);
          scheduleAutoSave();
          document.getElementById('scriptSection').style.display = 'block';
          document.getElementById('analyzeNotice').style.display = 'none';
          document.getElementById('analyzePanel').style.display = 'block';
          document.getElementById('captionsNotice').style.display = 'none';
          document.getElementById('captionsPanel').style.display = 'block';
          document.getElementById('restoreBanner').classList.remove('visible');
          setStatus(`Transcript restored (${data.length} segments)`, 'success');
        });
        document.getElementById('btnRestoreNo').addEventListener('click', () => {
          sessionStorage.removeItem('icanLastTranscript');
          document.getElementById('restoreBanner').classList.remove('visible');
        });
      }
    } catch(e) {}
  }
}

// Auto-save whenever transcript changes
const _origRenderScript = renderScript;
// Hook into renderScript to trigger auto-save
function renderScriptWithSave(segments) {
  _origRenderScript(segments);
  scheduleAutoSave();
}

// ---- UPDATE CHECK ----
let _updateData = null;

async function checkForUpdates() {
  try {
    const res  = await fetch(`${SERVER_URL()}/check-update`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.currentVersion) {
      const lbl = document.getElementById('versionLabel');
      if (lbl) lbl.textContent = 'v' + data.currentVersion;
    }

    if (data.hasUpdate) {
      _updateData = data;
      const banner = document.getElementById('updateBanner');
      const text   = document.getElementById('updateText');
      banner.style.display = 'flex';
      text.textContent = `🎉 v${data.newVersion} available (you have v${data.currentVersion})`;
    }
  } catch(e) {}
}

// "Update Now" — downloads zip, extracts, reloads panel (all inside Premiere Pro)
document.getElementById('btnUpdate').addEventListener('click', async () => {
  if (!_updateData) return;

  if (!_updateData.downloadUrl) {
    setStatus(`v${_updateData.newVersion} is ready — update URL not yet set up. Contact support.`, 'working');
    return;
  }

  document.getElementById('updateBanner').style.display = 'none';
  setStatus('Downloading update...', 'working');
  showProgress(5, 'Downloading update package...');

  try {
    showProgress(30, 'Downloading...');
    const res = await fetch(`${SERVER_URL()}/apply-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadUrl: _updateData.downloadUrl })
    });
    const result = await res.json();

    if (result.success) {
      showProgress(100, 'Update applied!');
      setStatus('Update complete! Reloading plugin in 3 seconds...', 'success');
      setTimeout(() => window.location.reload(), 3000);
    } else {
      throw new Error(result.error || 'Update extraction failed');
    }
  } catch(err) {
    setStatus('Update failed: ' + err.message, 'error');
    hideProgress();
  }
});

// ---- API STATUS DOTS ----
function updateApiStatusDots() {
  const s = state.settings;

  // Transcription key
  const transcribeProvider = s.transcribeProvider || 'groq';
  const hasTranscribeKey = transcribeProvider === 'groq' ? !!(s.groqKey) : !!(s.openaiKey);
  const transcribeLabel  = transcribeProvider === 'groq' ? 'Groq' : 'Whisper';

  // AI provider key
  const aiProvider = s.aiProvider || 'groq';
  let hasAiKey = false;
  let aiLabel  = 'Groq';
  if (aiProvider === 'groq')      { hasAiKey = !!(s.groqKey);      aiLabel = 'Groq'; }
  if (aiProvider === 'anthropic') { hasAiKey = !!(s.anthropicKey); aiLabel = 'Claude'; }
  if (aiProvider === 'gemini')    { hasAiKey = !!(s.geminiKey);    aiLabel = 'Gemini'; }
  if (aiProvider === 'ollama')    { hasAiKey = true;               aiLabel = 'Ollama'; }

  const dotO = document.getElementById('dotOpenai');
  const dotA = document.getElementById('dotAnthropic');

  if (dotO) { dotO.className = 'api-dot ' + (hasTranscribeKey ? 'ok' : 'missing'); dotO.textContent = transcribeLabel; }
  if (dotA) { dotA.className = 'api-dot ' + (hasAiKey         ? 'ok' : 'missing'); dotA.textContent = aiLabel; }
}

// ---- Export / Import Settings (for team sharing) ----
document.getElementById('btnExportSettings').addEventListener('click', () => {
  // Export all settings EXCEPT sensitive keys — coworkers need their own keys
  const exportable = { ...state.settings };
  // Keep keys optional — user can choose to share them (they're in the exported file)
  const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ican-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('Settings exported — share the file with your team', 'success');
});

document.getElementById('btnImportSettings').addEventListener('click', () => {
  document.getElementById('importSettingsFile').click();
});

document.getElementById('importSettingsFile').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      state.settings = { ...state.settings, ...imported };
      localStorage.setItem('icanSettings', JSON.stringify(state.settings));
      loadSettings(); // refresh all fields
      setStatus('Settings imported successfully', 'success');
      closeModal('settingsModal');
    } catch {
      setStatus('Import failed — invalid settings file', 'error');
    }
  };
  reader.readAsText(file);
  this.value = ''; // reset so same file can be re-imported
});

// ---- Auto-Start Server ----
// Starts node server.js directly from the extension folder.
// The server itself handles EADDRINUSE (kills old process and retries).
// Uses CEP's built-in Node.js (--enable-nodejs in manifest).
async function ensureServerRunning() {
  // 1. Already running? Do nothing.
  try {
    const r = await fetch(`${SERVER_URL()}/ping`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) return true;
  } catch {}

  setStatus('Starting AI server...', 'working');

  try {
    const csi       = new CSInterface();
    const extPath   = csi.getSystemPath(SystemPath.EXTENSION);
    const serverDir = extPath.replace(/\//g, '\\') + '\\server';

    const nodeRequire = window.require || (typeof require !== 'undefined' ? require : null);
    if (!nodeRequire) throw new Error('Node.js unavailable in CEP context');

    const { spawn, execSync } = nodeRequire('child_process');
    const fs        = nodeRequire('fs');

    if (!fs.existsSync(serverDir + '\\server.js')) {
      throw new Error('server.js not found at: ' + serverDir);
    }

    // Find node.exe path
    let nodePath = 'node';
    try {
      nodePath = execSync('where node', { encoding: 'utf8' }).trim().split('\n')[0].trim();
    } catch(e) {}

    // Ensure node_modules exist (run npm install if missing)
    if (!fs.existsSync(serverDir + '\\node_modules')) {
      console.log('[AutoStart] node_modules missing — running npm install...');
      setStatus('Installing server dependencies...', 'working');
      try {
        execSync('npm install --production', { cwd: serverDir, encoding: 'utf8', timeout: 120000 });
        console.log('[AutoStart] npm install complete');
      } catch(npmErr) {
        console.error('[AutoStart] npm install failed:', npmErr.message);
        throw new Error('npm install failed — open a terminal in ' + serverDir + ' and run: npm install');
      }
    }

    console.log('[AutoStart] Server dir:', serverDir);
    console.log('[AutoStart] Node path:', nodePath);

    // Use cmd.exe /c start to create a truly independent visible console window
    // This works reliably from CEP context where spawn+detached often fails
    const child = spawn('cmd.exe', ['/c', 'start', '"ICAN Server"', '/D', serverDir, nodePath, 'server.js'], {
      cwd:         serverDir,
      detached:    true,
      stdio:       'ignore',
      windowsHide: false,
      shell:       false
    });
    child.unref();

    // Poll every second for up to 30 seconds
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      setStatus(`Starting AI server... (${i + 1}s)`, 'working');
      try {
        const r = await fetch(`${SERVER_URL()}/ping`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return true;
      } catch {}
    }
  } catch (e) {
    console.error('[AutoStart]', e.message);
  }

  return false;
}

// ---- Init ----
window.addEventListener('load', async () => {
  loadSettings();
  updateApiStatusDots();
  checkForRestoreableTranscript();
  setStatus('Starting server...', 'working');

  const serverOk = await ensureServerRunning();

  if (serverOk) {
    try {
      const ping = await fetch(`${SERVER_URL()}/ping`);
      const data = await ping.json();
      const lbl  = document.getElementById('versionLabel');
      if (lbl && data.version) lbl.textContent = 'v' + data.version;
    } catch {}
    setStatus('Ready', 'idle');
    checkForUpdates(); // background update check
  } else {
    setStatus('⚠️ Server offline — click ⚙️ Settings → check port, or restart Premiere Pro', 'error');
  }
});

// ---- Shutdown server when panel closes (Premiere Pro exit) ----
window.addEventListener('unload', () => {
  try {
    // Only stop the server when running inside Adobe CEP (not in a browser)
    if (typeof CSInterface === 'undefined') return;
    const url = `${SERVER_URL()}/stop`;
    const body = JSON.stringify({ source: 'cep-panel' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body });
    }
  } catch(e) {}
});
