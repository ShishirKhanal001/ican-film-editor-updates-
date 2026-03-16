/**
 * Auto-Update System
 * Checks for new versions and downloads updates.
 * Update URL can be self-hosted (GitHub, Dropbox, your own website).
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');

const LOCAL_VERSION_FILE = path.join(__dirname, '..', 'version.json');

// ---- Read local version ----
function getLocalVersion() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_VERSION_FILE, 'utf8'));
  } catch {
    return { version: '1.0.0', channel: 'stable' };
  }
}

// ---- Fetch remote version info ----
function fetchRemoteVersion(updateUrl) {
  return new Promise((resolve, reject) => {
    const client = updateUrl.startsWith('https') ? https : http;
    const req = client.get(updateUrl, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid update server response')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Update check timed out')); });
  });
}

// ---- Compare semver ----
function isNewer(remoteVer, localVer) {
  const parse = v => String(v).split('.').map(Number);
  const [rMaj, rMin, rPat] = parse(remoteVer);
  const [lMaj, lMin, lPat] = parse(localVer);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

// ---- Main check function (called on server startup) ----
async function checkForUpdates(updateUrl) {
  if (!updateUrl || updateUrl.includes('YOUR_UPDATE_URL')) return null;

  try {
    const local  = getLocalVersion();
    const remote = await fetchRemoteVersion(updateUrl);

    if (remote.version && isNewer(remote.version, local.version)) {
      console.log(`\n  ┌─────────────────────────────────────────┐`);
      console.log(`  │  UPDATE AVAILABLE: v${remote.version} (current: v${local.version})  │`);
      console.log(`  │  Open the plugin and click "Update Now"  │`);
      console.log(`  └─────────────────────────────────────────┘\n`);
      return {
        hasUpdate:      true,
        currentVersion: local.version,
        newVersion:     remote.version,
        releaseNotes:   remote.releaseNotes || '',
        downloadUrl:    remote.downloadUrl  || null
      };
    }

    return { hasUpdate: false, currentVersion: local.version };
  } catch (err) {
    // Silent fail — don't crash server if update check fails
    console.log('  [Updater] Could not check for updates:', err.message);
    return null;
  }
}

// ---- Download and apply update ----
async function downloadUpdate(downloadUrl, destDir) {
  const zipPath = path.join(require('os').tmpdir(), 'ican-update.zip');

  await downloadFile(downloadUrl, zipPath);

  // Extract over existing files
  const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();

  if (!AdmZip) {
    return {
      success: false,
      error:   'Run "npm install adm-zip" in the server folder to enable auto-updates.',
      manual:  zipPath
    };
  }

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  fs.unlinkSync(zipPath);

  return { success: true };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

module.exports = { checkForUpdates, downloadUpdate, getLocalVersion };
