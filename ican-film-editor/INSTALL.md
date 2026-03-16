# ICAN Film Editor Plugin — Installation Guide
### No coding experience needed. Follow each step carefully.

---

## STEP 1 — Install Node.js (One-time setup)

1. Go to: **https://nodejs.org**
2. Click the big green button that says **"LTS"** (recommended)
3. Download and run the installer
4. Click Next → Next → Install → Finish
5. To verify: open Command Prompt (press Win+R, type `cmd`, press Enter) and type:
   ```
   node --version
   ```
   You should see something like `v20.x.x` ✓

---

## STEP 2 — Install FFmpeg (One-time setup)

FFmpeg extracts audio from your videos.

1. Go to: **https://www.gyan.dev/ffmpeg/builds/**
2. Under "release builds", download: `ffmpeg-release-essentials.zip`
3. Extract the zip — you'll get a folder like `ffmpeg-7.0-essentials_build`
4. Inside it, open the `bin` folder
5. Copy the file `ffmpeg.exe`
6. Paste it into:
   ```
   C:\Users\jhabi\Downloads\ICAN FILM EDITOR\ican-film-editor\server\bin\
   ```
   (Create the `bin` folder if it doesn't exist)

---

## STEP 3 — Set Up the Server (One-time setup)

1. Open Command Prompt (Win+R → type `cmd` → Enter)
2. Type this command and press Enter:
   ```
   cd "C:\Users\jhabi\Downloads\ICAN FILM EDITOR\ican-film-editor\server"
   ```
3. Then type this and press Enter:
   ```
   npm install
   ```
4. Wait for it to finish (it downloads the necessary software — may take 1-2 minutes)
5. You'll see something like `added 150 packages` when done ✓

---

## STEP 4 — Enable Premiere Pro CEP Extensions

Adobe Premiere Pro requires a special setting to allow custom plugins.

1. Open **Registry Editor**: press Win+R, type `regedit`, press Enter
2. Navigate to this path (copy and paste into the address bar at the top):
   ```
   HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11
   ```
3. Right-click in the right panel → New → String Value
4. Name it: `PlayerDebugMode`
5. Double-click it and set Value to: `1`
6. Click OK and close Registry Editor

---

## STEP 5 — Install the Plugin into Premiere Pro

1. Open File Explorer
2. Navigate to:
   ```
   C:\Users\jhabi\AppData\Roaming\Adobe\CEP\extensions\
   ```
   (If the `extensions` folder doesn't exist, create it)
3. Copy this entire folder:
   ```
   C:\Users\jhabi\Downloads\ICAN FILM EDITOR\ican-film-editor\
   ```
4. Paste it into the `extensions` folder
5. Rename the pasted folder to exactly: `ican-film-editor`

---

## STEP 6 — Get Your API Keys

You'll need 3 API keys. These are like passwords that let the plugin use AI services.

### OpenAI API Key (for transcription)
1. Go to: **https://platform.openai.com/api-keys**
2. Sign up / log in
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)
5. Add billing at: https://platform.openai.com/billing (pay-as-you-go, ~$0.006/min of audio)

### Google Translate API Key (for translation)
1. Go to: **https://console.cloud.google.com**
2. Create a new project (call it "ICAN Film")
3. Go to APIs & Services → Enable "Cloud Translation API"
4. Go to APIs & Services → Credentials → Create Credentials → API Key
5. Copy the key (starts with `AIza...`)
6. Note: ~$20 per 1 million characters — very cheap for video scripts

### Anthropic (Claude) API Key (for AI analysis)
1. Go to: **https://console.anthropic.com**
2. Sign up / log in
3. Go to API Keys → Create Key
4. Copy the key (starts with `sk-ant-...`)
5. Add billing (pay-as-you-go, ~$0.003 per analysis)

---

## STEP 7 — Daily Usage

### Every time you want to use the plugin:

**First — Start the Server:**
1. Open Command Prompt
2. Type:
   ```
   cd "C:\Users\jhabi\Downloads\ICAN FILM EDITOR\ican-film-editor\server"
   ```
3. Type:
   ```
   npm start
   ```
4. Leave this window open in the background (minimize it, don't close it)

**Then — Open Premiere Pro:**
1. Open Adobe Premiere Pro
2. Go to: **Window → Extensions → ICAN Film Editor**
3. The panel will appear on the right side
4. First time: click the ⚙️ Settings button and enter your 3 API keys

---

## STEP 8 — Using the Plugin

### Transcribe Tab
1. Select your language (Amharic or Tigrinya)
2. Click **"Start Transcription"**
3. Wait — for a 60-minute show, this takes about 3-5 minutes
4. Review and fix errors in the English translation by clicking on any line
5. Click any line to jump to that moment in your timeline

### Analyze Tab
1. After transcribing, click **"Run AI Analysis"**
2. Choose what you want: summary, highlights, fillers, reels
3. Set how many reels you want (e.g. 2)
4. Wait ~30 seconds for Claude to analyze
5. Review suggestions, check/uncheck fillers, then cut or create reels

### Branding Tab
1. Click Browse to select your intro/outro files (do this once and save)
2. Click **"Apply Branding"** — it adds them to all your sequences automatically

### Captions Tab
1. After transcribing, captions are ready — no extra processing needed
2. Choose your style and click **"Add Captions to Timeline"**

### Audio Tab
1. Enter your Waves plugin names in the chain
2. Click **"Apply Plugin Chain"** to add them to all dialogue tracks

---

## Troubleshooting

**"Server not running" error in the plugin:**
→ Make sure you ran `npm start` in the server folder first

**Plugin doesn't appear in Premiere Pro:**
→ Make sure you completed Step 4 (Registry Editor) and restarted Premiere Pro

**Transcription is inaccurate:**
→ Amharic and Tigrinya are complex languages — review the script and fix errors before analyzing
→ Better audio quality = better transcription

**"API key missing" error:**
→ Open Settings (⚙️) in the plugin and enter all three API keys

---

## Cost Estimate for Lucy TV (per 60-minute episode)

| Service | Cost |
|---------|------|
| OpenAI Whisper (transcription) | ~$0.36 |
| Google Translate | ~$0.05 |
| Claude (analysis) | ~$0.10 |
| **Total per episode** | **~$0.51** |

Less than $1 per full episode of AI editing assistance!

---

*Made with ❤️ for ICAN Film & Lucy TV — Calgary, Canada*
