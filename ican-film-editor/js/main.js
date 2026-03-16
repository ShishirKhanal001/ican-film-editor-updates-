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
  viewMode: 'english'         // english | original | both
};

// ---- Provider UI toggle ----
function updateProviderUI(provider) {
  document.getElementById('claudeKeyRow').style.display = provider === 'anthropic' ? 'flex' : 'none';
  document.getElementById('geminiKeyRow').style.display = provider === 'gemini'    ? 'flex' : 'none';
  document.getElementById('ollamaRow').style.display    = provider === 'ollama'    ? 'block' : 'none';
}

document.getElementById('aiProvider').addEventListener('change', function() {
  updateProviderUI(this.value);
});

// ---- Load settings from localStorage ----
function loadSettings() {
  try {
    state.settings = JSON.parse(localStorage.getItem('icanSettings') || '{}');
    if (state.settings.openaiKey)    document.getElementById('openaiKey').value    = state.settings.openaiKey;
    if (state.settings.anthropicKey) document.getElementById('anthropicKey').value = state.settings.anthropicKey;
    if (state.settings.geminiKey)    document.getElementById('geminiKey').value    = state.settings.geminiKey;
    if (state.settings.tempFolder)   document.getElementById('tempFolder').value   = state.settings.tempFolder;
    if (state.settings.serverPort)   document.getElementById('serverPort').value   = state.settings.serverPort;
    if (state.settings.aiProvider)   document.getElementById('aiProvider').value   = state.settings.aiProvider;
    if (state.settings.ollamaModel)  document.getElementById('ollamaModel').value  = state.settings.ollamaModel;
    if (state.settings.ollamaUrl)    document.getElementById('ollamaUrl').value    = state.settings.ollamaUrl;
    updateProviderUI(state.settings.aiProvider || 'anthropic');

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
    openaiKey:    document.getElementById('openaiKey').value.trim(),
    anthropicKey: document.getElementById('anthropicKey').value.trim(),
    geminiKey:    document.getElementById('geminiKey').value.trim(),
    tempFolder:   document.getElementById('tempFolder').value.trim(),
    serverPort:   document.getElementById('serverPort').value.trim(),
    aiProvider:   document.getElementById('aiProvider').value,
    ollamaModel:  document.getElementById('ollamaModel').value,
    ollamaUrl:    document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
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
  if (!settings.openaiKey) {
    setStatus('OpenAI API key missing — open Settings.', 'error');
    return;
  }

  setStatus('Extracting audio from timeline...', 'working');
  showProgress(10, 'Extracting audio...');

  try {
    // 1. Tell ExtendScript to export the audio
    const exportResult = await callExtendScript('exportTimelineAudio', {
      tempFolder: settings.tempFolder || 'C:/Temp',
      source: document.getElementById('audioSource').value
    });

    if (!exportResult.success) throw new Error(exportResult.error || 'Audio export failed');

    showProgress(25, 'Sending to Whisper AI for transcription...');
    setStatus('Transcribing audio (this may take a few minutes for long videos)...', 'working');

    // 2. Transcribe via server
    const lang = document.getElementById('sourceLang').value;
    const transcribeRes = await fetch(`${SERVER_URL()}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioPath: exportResult.audioPath,
        language: lang === 'auto' ? null : lang,
        openaiKey: settings.openaiKey
      })
    });

    if (!transcribeRes.ok) throw new Error(await transcribeRes.text());
    const transcribeData = await transcribeRes.json();

    showProgress(65, 'Translating to English...');
    setStatus('Translating...', 'working');

    // 3. Translate via server
    const targetLang = document.getElementById('targetLang').value;
    const translateRes = await fetch(`${SERVER_URL()}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments:     transcribeData.segments,
        targetLang,
        provider:     settings.aiProvider || 'anthropic',
        anthropicKey: settings.anthropicKey,
        geminiKey:    settings.geminiKey,
        ollamaModel:  settings.ollamaModel,
        ollamaUrl:    settings.ollamaUrl
      })
    });

    if (!translateRes.ok) throw new Error(await translateRes.text());
    const translateData = await translateRes.json();

    showProgress(100, 'Done!');
    state.transcriptData = translateData.segments;
    sessionStorage.setItem('icanLastTranscript', JSON.stringify(state.transcriptData));

    // Render script
    renderScript(state.transcriptData);
    scheduleAutoSave();
    document.getElementById('scriptSection').style.display = 'block';

    // Enable analyze tab
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
});

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
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('btnCopyScript').addEventListener('click', () => {
  if (!state.transcriptData) return;
  const lines = state.transcriptData.map(s => `[${formatTime(s.timeSec)}] ${s.english}`).join('\n');
  navigator.clipboard.writeText(lines).catch(() => {});
  setStatus('Script copied to clipboard', 'success');
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
  if (!settings.anthropicKey) {
    setStatus('Claude API key missing — open Settings.', 'error');
    return;
  }

  setStatus('Running AI analysis...', 'working');
  showProgress(30, 'Claude is analyzing your script...');

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
        provider:     settings.aiProvider || 'anthropic',
        anthropicKey: settings.anthropicKey,
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

// Mark highlights
document.getElementById('markHighlights').addEventListener('click', () => {
  if (!state.analysisData?.highlights) return;
  callExtendScript('addMarkers', { markers: state.analysisData.highlights, color: 'yellow', label: 'Highlight' });
  setStatus('Highlights marked in timeline', 'success');
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

// ---- AUDIO CHAIN ----
document.getElementById('btnAddPlugin').addEventListener('click', () => {
  const chain = document.getElementById('pluginChainDialogue');
  const count = chain.querySelectorAll('.plugin-slot').length;
  const slot = document.createElement('div');
  slot.className = 'plugin-slot';
  slot.dataset.index = count;
  slot.innerHTML = `
    <span class="plugin-slot-num">${count + 1}</span>
    <input type="text" class="plugin-name-input" placeholder="Enter plugin name..." />
    <button class="btn btn-xs danger remove-plugin">✕</button>`;
  chain.appendChild(slot);
  bindRemovePlugin(slot.querySelector('.remove-plugin'));
});

function bindRemovePlugin(btn) {
  btn.addEventListener('click', () => {
    btn.closest('.plugin-slot').remove();
    renumberPlugins();
  });
}

function renumberPlugins() {
  document.querySelectorAll('#pluginChainDialogue .plugin-slot').forEach((slot, i) => {
    slot.querySelector('.plugin-slot-num').textContent = i + 1;
  });
}

document.querySelectorAll('.remove-plugin').forEach(btn => bindRemovePlugin(btn));

document.getElementById('btnSaveAudioPreset').addEventListener('click', () => {
  const plugins = [];
  document.querySelectorAll('.plugin-name-input').forEach(input => {
    if (input.value.trim()) plugins.push(input.value.trim());
  });
  state.settings.audioChain = plugins;
  localStorage.setItem('icanSettings', JSON.stringify(state.settings));
  setStatus('Audio chain saved', 'success');
});

document.getElementById('btnApplyAudio').addEventListener('click', async () => {
  const plugins = [];
  document.querySelectorAll('.plugin-name-input').forEach(input => {
    if (input.value.trim()) plugins.push(input.value.trim());
  });

  const trackTypes = [];
  if (document.getElementById('applyDialogueTracks').checked) trackTypes.push('dialogue');
  if (document.getElementById('applyMusicTracks').checked) trackTypes.push('music');
  if (document.getElementById('applySfxTracks').checked) trackTypes.push('sfx');

  setStatus('Applying audio plugin chain...', 'working');
  const result = await callExtendScript('applyAudioChain', { plugins, trackTypes });
  setStatus(result.success ? 'Audio chain applied!' : 'Error: ' + result.error, result.success ? 'success' : 'error');
});

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
    const projectName = (state.settings.activeBrand || 'ican') + '_transcript';
    await fetch(`${SERVER_URL()}/save-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: state.transcriptData, projectName })
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
  const s        = state.settings;
  const provider = s.aiProvider || 'anthropic';
  const hasOpenai = !!(s.openaiKey);

  // AI provider key check
  let hasAiKey = false;
  let aiLabel  = 'Claude';
  if (provider === 'anthropic') { hasAiKey = !!(s.anthropicKey); aiLabel = 'Claude'; }
  if (provider === 'gemini')    { hasAiKey = !!(s.geminiKey);    aiLabel = 'Gemini'; }
  if (provider === 'ollama')    { hasAiKey = true;               aiLabel = 'Ollama'; } // no key needed

  const dotO = document.getElementById('dotOpenai');
  const dotA = document.getElementById('dotAnthropic');

  if (dotO) dotO.className = 'api-dot ' + (hasOpenai ? 'ok' : 'missing');
  if (dotA) { dotA.className = 'api-dot ' + (hasAiKey ? 'ok' : 'missing'); dotA.textContent = aiLabel; }
}

// ---- Auto-Start Server ----
// When the panel opens, automatically starts the Node.js server if it isn't running.
// Uses CEP's built-in Node.js (available via require in CEP renderer context).
async function ensureServerRunning() {
  // 1. Check if already running
  try {
    await fetch(`${SERVER_URL()}/ping`);
    return true;
  } catch {}

  // 2. Not running — try to spawn it automatically
  setStatus('Starting server...', 'working');
  try {
    const csi = new CSInterface();
    const extPath = csi.getSystemPath(SystemPath.EXTENSION).replace(/\\/g, '/');
    const serverScript = extPath + '/server/server.js';

    // CEP exposes Node.js require in the HTML panel context
    const nodeRequire = window.require || (typeof require !== 'undefined' ? require : null);
    if (!nodeRequire) throw new Error('Node.js not available in this context');

    const { spawn } = nodeRequire('child_process');
    spawn('node', [serverScript], {
      detached: true,
      stdio:    'ignore',
      windowsHide: true
    }).unref();

    // Poll every second for up to 20 seconds
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        await fetch(`${SERVER_URL()}/ping`);
        return true; // server is up
      } catch {}
    }
  } catch(e) {
    console.log('[AutoStart]', e.message);
  }

  return false;
}

// ---- Init ----
window.addEventListener('load', async () => {
  loadSettings();
  updateApiStatusDots();
  checkForRestoreableTranscript();
  setStatus('Starting...', 'working');

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
    setStatus('⚠️ Server offline — double-click "START ICAN EDITOR.bat"', 'error');
  }
});
