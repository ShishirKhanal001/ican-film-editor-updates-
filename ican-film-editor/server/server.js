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

// ---- Save transcript to disk (auto-backup) ----
app.post('/save-transcript', (req, res) => {
  try {
    const { transcript, projectName } = req.body;
    const saveDir  = path.join(os.homedir(), 'Documents', 'ICAN Film Editor', 'Transcripts');
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    const safeName = (projectName || 'transcript').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath  = path.join(saveDir, `${safeName}_${timestamp}.json`);

    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), 'utf8');
    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Load saved transcripts ----
app.get('/list-transcripts', (req, res) => {
  try {
    const saveDir = path.join(os.homedir(), 'Documents', 'ICAN Film Editor', 'Transcripts');
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
    const saveDir  = path.join(os.homedir(), 'Documents', 'ICAN Film Editor', 'Transcripts');
    const filePath = path.join(saveDir, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ---- Start ----
app.listen(PORT, '127.0.0.1', async () => {
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
