/**
 * ICAN Film Editor — Local AI Server
 * Runs on your PC and handles all AI API calls.
 * Start this before opening Premiere Pro.
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

const transcribeRoute = require('./routes/transcribe');
const translateRoute  = require('./routes/translate');
const analyzeRoute    = require('./routes/analyze');
const audioRoute      = require('./routes/audio');
const { checkForUpdates, downloadUpdate, getLocalVersion } = require('./updater');

const app        = express();
const PORT       = process.env.PORT || 3737;
const PLUGIN_ROOT = path.join(__dirname, '..');

// ---- Middleware ----
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---- Serve plugin UI for browser preview ----
app.use(express.static(PLUGIN_ROOT));

// ---- Health check ----
app.get('/ping', (req, res) => {
  const ver = getLocalVersion();
  res.json({ status: 'ok', version: ver.version, name: 'ICAN Film Editor Server' });
});

// ---- Update check endpoint ----
let _cachedUpdateInfo = null;

app.get('/check-update', async (req, res) => {
  try {
    const ver = getLocalVersion();
    const updateUrl = ver.updateUrl;
    const info = await checkForUpdates(updateUrl);
    _cachedUpdateInfo = info;
    res.json(info || { hasUpdate: false, currentVersion: ver.version });
  } catch (err) {
    res.json({ hasUpdate: false, error: err.message });
  }
});

// ---- Check if a file exists (used to poll for AME export completion) ----
app.get('/check-file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.json({ exists: false });
  res.json({ exists: fs.existsSync(filePath) });
});

// ---- Resolve save directory: project folder > Documents fallback ----
function getTranscriptDir(projectFolder) {
  // Prefer saving inside the project folder
  if (projectFolder) {
    const projDir = path.join(projectFolder, 'ICAN Temp', 'Transcripts');
    try {
      if (!fs.existsSync(projDir)) fs.mkdirSync(projDir, { recursive: true });
      return projDir;
    } catch(e) {}
  }
  // Fallback to Documents
  const docDir = path.join(os.homedir(), 'Documents', 'ICAN Film Editor', 'Transcripts');
  if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
  return docDir;
}

// ---- Save transcript to disk (auto-backup) ----
app.post('/save-transcript', (req, res) => {
  try {
    const { transcript, projectName, projectFolder } = req.body;
    const saveDir = getTranscriptDir(projectFolder);

    const safeName = (projectName || 'transcript').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath  = path.join(saveDir, `${safeName}_${timestamp}.json`);

    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), 'utf8');
    console.log(`[AutoSave] Saved to: ${filePath}`);
    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Load saved transcripts ----
app.get('/list-transcripts', (req, res) => {
  try {
    const projectFolder = req.query.projectFolder;
    const saveDir = getTranscriptDir(projectFolder);
    if (!fs.existsSync(saveDir)) return res.json({ files: [] });
    const files = fs.readdirSync(saveDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, path: path.join(saveDir, f), mtime: fs.statSync(path.join(saveDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20);
    res.json({ files });
  } catch (err) {
    res.json({ files: [], error: err.message });
  }
});

app.get('/load-transcript/:filename', (req, res) => {
  try {
    const projectFolder = req.query.projectFolder;
    const saveDir = getTranscriptDir(projectFolder);
    const filePath = path.join(saveDir, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Save file to disk (for TXT/SRT export — CEP blocks Blob URLs) ----
app.post('/save-file', (req, res) => {
  try {
    const { content, filename, projectFolder } = req.body;
    if (!content || !filename) return res.status(400).json({ error: 'Missing content or filename' });

    // Save next to the project in "ICAN Exports", or fallback to Documents
    let saveDir;
    if (projectFolder) {
      saveDir = path.join(projectFolder, 'ICAN Exports');
    } else {
      saveDir = path.join(os.homedir(), 'Documents', 'ICAN Film Editor', 'Exports');
    }
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    const safeName = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const filePath = path.join(saveDir, safeName);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[Export] Saved: ${filePath}`);
    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Stop server (called when Premiere closes the panel) ----
app.post('/stop', (req, res) => {
  // Only shut down if the request includes the CEP confirm flag
  if (!req.body || req.body.source !== 'cep-panel') {
    return res.json({ success: false, message: 'Ignored — not from CEP panel' });
  }
  res.json({ success: true, message: 'Server shutting down...' });
  console.log('\n  [Server] Shutdown requested by panel. Goodbye!\n');
  setTimeout(() => process.exit(0), 500);
});

// ---- Apply update in-plugin ----
// Downloads the update zip, extracts over the plugin dir, then restarts server.
// The panel reloads itself via window.location.reload() after this responds.
app.post('/apply-update', async (req, res) => {
  const { downloadUrl } = req.body;
  if (!downloadUrl) {
    return res.status(400).json({ success: false, error: 'No download URL provided.' });
  }
  try {
    const result = await downloadUpdate(downloadUrl, PLUGIN_ROOT);
    res.json(result);
    if (result.success) {
      console.log('\n  [Updater] Update applied — restarting server...\n');
      setTimeout(() => process.exit(0), 2000); // clean exit; launcher BAT restarts automatically
    }
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Progress tracking (shared state for long operations) ----
global.icanProgress = { stage: '', detail: '', percent: 0 };
app.get('/progress', (req, res) => {
  res.json(global.icanProgress);
});

// ---- Routes ----
app.use('/transcribe', transcribeRoute);
app.use('/translate',  translateRoute);
app.use('/analyze',    analyzeRoute);
app.use('/audio',      audioRoute);

// ---- Error handler ----
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message });
});

// ---- Kill existing process on same port (handles EADDRINUSE) ----
async function killExistingServer() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    // Find and kill any process on our port
    exec(`for /f "tokens=5" %a in ('netstat -aon 2^>nul ^| findstr ":${PORT} "') do taskkill /F /PID %a`, { shell: 'cmd.exe' }, () => {
      // Wait a moment for port to be released
      setTimeout(resolve, 1000);
    });
  });
}

// ---- Start ----
const server = app.listen(PORT, '127.0.0.1', async () => {
  const ver = getLocalVersion();
  console.log('');
  console.log('  ██╗ ██████╗ █████╗ ███╗   ██╗');
  console.log('  ██║██╔════╝██╔══██╗████╗  ██║');
  console.log('  ██║██║     ███████║██╔██╗ ██║');
  console.log('  ██║██║     ██╔══██║██║╚██╗██║');
  console.log('  ██║╚██████╗██║  ██║██║ ╚████║');
  console.log('  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝');
  console.log('');
  console.log(`  ICAN Film Editor v${ver.version} — Port ${PORT}`);
  console.log(`  http://localhost:${PORT}/ping`);
  console.log('');
  console.log('  Keep this window open while using Premiere Pro.');
  console.log('  Press Ctrl+C to stop.\n');

  // Background update check
  const info = await checkForUpdates(ver.updateUrl);
  _cachedUpdateInfo = info;
});

// Handle port already in use — kill old process and retry ONCE
server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  Port ${PORT} is busy — killing old server and retrying...`);
    await killExistingServer();
    app.listen(PORT, '127.0.0.1', async () => {
      const ver = getLocalVersion();
      console.log(`\n  ICAN Film Editor v${ver.version} — Port ${PORT} (recovered)`);
      console.log(`  http://localhost:${PORT}/ping\n`);
      const info = await checkForUpdates(ver.updateUrl);
      _cachedUpdateInfo = info;
    });
  } else {
    console.error('  Server error:', err.message);
    process.exit(1);
  }
});
