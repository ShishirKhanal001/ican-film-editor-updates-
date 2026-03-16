# ============================================================
#  ICAN Film Editor -- Automated Installer
# ============================================================

$Host.UI.RawUI.WindowTitle = "ICAN Film Editor -- Installer"
$ErrorActionPreference = "Stop"

$PLUGIN_DIR   = "$PSScriptRoot\ican-film-editor"
$ADOBE_EXT    = "$env:APPDATA\Adobe\CEP\extensions\ican-film-editor"
$SERVER_DIR   = "$PLUGIN_DIR\server"
$FFMPEG_BIN   = "$SERVER_DIR\bin\ffmpeg.exe"
$DESKTOP      = [Environment]::GetFolderPath("Desktop")

function Write-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  +------------------------------------------+" -ForegroundColor Red
    Write-Host "  |                                          |" -ForegroundColor Red
    Write-Host "  |      ICAN FILM EDITOR  v1.0.0            |" -ForegroundColor Red
    Write-Host "  |      Automated Installer                 |" -ForegroundColor Red
    Write-Host "  |                                          |" -ForegroundColor Red
    Write-Host "  +------------------------------------------+" -ForegroundColor Red
    Write-Host ""
    Write-Host "  This will install everything automatically." -ForegroundColor Gray
    Write-Host "  Please wait and do not close this window." -ForegroundColor Gray
    Write-Host ""
}

function Write-Step($num, $text) {
    Write-Host ""
    Write-Host "  ------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  STEP $num  |  $text" -ForegroundColor Cyan
    Write-Host "  ------------------------------------------" -ForegroundColor DarkGray
}

function Write-OK($text) {
    Write-Host "  [OK]  $text" -ForegroundColor Green
}

function Write-Info($text) {
    Write-Host "   ...  $text" -ForegroundColor Gray
}

function Write-Warn($text) {
    Write-Host "  [!!]  $text" -ForegroundColor Yellow
}

function Pause-Step($text) {
    Write-Host ""
    Write-Host "  $text" -ForegroundColor Yellow
    Write-Host "  Press any key to continue..." -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

Write-Header

# ---- STEP 1: Check for Node.js ----
Write-Step "1/5" "Checking Node.js"

$nodeVersion = $null
try { $nodeVersion = (node --version 2>$null) } catch {}

if (-not $nodeVersion) {
    Write-Warn "Node.js not found. Downloading installer..."
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    $nodeUrl = "https://nodejs.org/dist/v20.15.0/node-v20.15.0-x64.msi"
    Write-Info "Downloading from nodejs.org (this may take a minute)..."
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
        Write-Info "Installing Node.js silently..."
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeInstaller`" /qn /norestart" -Wait -Verb RunAs
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVersion = (node --version 2>$null)
        Remove-Item $nodeInstaller -Force -ErrorAction SilentlyContinue
        Write-OK "Node.js $nodeVersion installed successfully"
    } catch {
        Write-Host "  [FAIL]  Could not auto-install Node.js." -ForegroundColor Red
        Write-Host "          Download manually from https://nodejs.org then re-run INSTALL.bat" -ForegroundColor Yellow
        Pause-Step "Press any key to exit."
        exit 1
    }
} else {
    Write-OK "Node.js $nodeVersion is already installed"
}

# ---- STEP 2: Install FFmpeg ----
Write-Step "2/5" "Checking FFmpeg"

if (-not (Test-Path $FFMPEG_BIN)) {
    Write-Warn "FFmpeg not found. Downloading now..."
    $ffmpegZip = "$env:TEMP\ffmpeg.zip"
    $ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

    try {
        Write-Info "Downloading FFmpeg (this may take 1-2 minutes)..."
        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
        Write-Info "Extracting FFmpeg..."
        $extractPath = "$env:TEMP\ffmpeg-extract"
        if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
        Expand-Archive -Path $ffmpegZip -DestinationPath $extractPath -Force

        $ffmpegExe = Get-ChildItem -Path $extractPath -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
        if ($ffmpegExe) {
            $binDir = "$SERVER_DIR\bin"
            if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
            Copy-Item $ffmpegExe.FullName -Destination $FFMPEG_BIN -Force
            Write-OK "FFmpeg installed successfully"
        } else {
            throw "ffmpeg.exe not found in archive"
        }

        Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warn "Could not auto-install FFmpeg: $_"
        Write-Warn "Plugin will still work but audio export may be limited."
    }
} else {
    Write-OK "FFmpeg is already installed"
}

# ---- STEP 3: Install Node.js packages ----
Write-Step "3/5" "Installing AI packages"
Write-Info "Installing npm packages (Claude, Gemini, Ollama support)..."

try {
    # Use Push-Location to avoid issues with spaces in folder names
    Push-Location "$SERVER_DIR"
    & npm install 2>&1 | Out-Null
    & npm install adm-zip --save 2>&1 | Out-Null
    Pop-Location
    Write-OK "All AI packages installed successfully"
} catch {
    try { Pop-Location } catch {}
    Write-Host "  [FAIL]  npm install failed: $_" -ForegroundColor Red
    Write-Host "          Make sure Node.js is installed and try again." -ForegroundColor Yellow
    Pause-Step "Press any key to exit."
    exit 1
}

# ---- Download CSInterface.js if missing ----
Write-Info "Checking Adobe CSInterface.js..."
$csInterfaceDest = "$PLUGIN_DIR\js\CSInterface.js"
if (-not (Test-Path $csInterfaceDest)) {
    try {
        $csUrl = "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js"
        Invoke-WebRequest -Uri $csUrl -OutFile $csInterfaceDest -UseBasicParsing -ErrorAction Stop
        Write-OK "CSInterface.js downloaded"
    } catch {
        Write-Warn "Could not download CSInterface.js -- bundled version will be used (this is fine)"
    }
} else {
    Write-OK "CSInterface.js already present"
}

# ---- STEP 4: Enable CEP extensions in Premiere Pro ----
Write-Step "4/5" "Enabling Premiere Pro extensions"

try {
    foreach ($ver in @("9","10","11","12","13")) {
        $regPath = "HKCU:\SOFTWARE\Adobe\CSXS.$ver"
        if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
        Set-ItemProperty -Path $regPath -Name "PlayerDebugMode" -Value "1" -Type String -Force
    }
    Write-OK "Premiere Pro extension mode enabled (all versions)"
} catch {
    Write-Warn "Could not set registry automatically."
    Write-Warn "If the plugin does not appear in Premiere, run this in Command Prompt:"
    Write-Warn "  reg add HKCU\SOFTWARE\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f"
}

# ---- STEP 5: Copy plugin to Adobe extensions folder ----
Write-Step "5/5" "Installing plugin into Premiere Pro"

try {
    if (-not (Test-Path "$env:APPDATA\Adobe\CEP\extensions")) {
        New-Item -ItemType Directory -Path "$env:APPDATA\Adobe\CEP\extensions" -Force | Out-Null
    }

    if (Test-Path $ADOBE_EXT) {
        Write-Info "Removing old version..."
        Remove-Item $ADOBE_EXT -Recurse -Force
    }

    Write-Info "Copying plugin files to Premiere Pro..."
    Copy-Item -Path $PLUGIN_DIR -Destination $ADOBE_EXT -Recurse -Force
    Write-OK "Plugin installed to Premiere Pro"
} catch {
    Write-Host "  [FAIL]  Could not copy plugin: $_" -ForegroundColor Red
    Pause-Step "Press any key to exit."
    exit 1
}

# ---- Create Desktop Shortcut ----
Write-Info "Creating desktop shortcut..."
try {
    $launcherPath = "$PSScriptRoot\START ICAN EDITOR.bat"
    $WScriptShell = New-Object -ComObject WScript.Shell
    $shortcut = $WScriptShell.CreateShortcut("$DESKTOP\ICAN Film Editor.lnk")
    $shortcut.TargetPath = $launcherPath
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.Description = "Start ICAN Film Editor Server"
    if (Test-Path "$PSScriptRoot\Branding\Icanlogo.ico") {
        $shortcut.IconLocation = "$PSScriptRoot\Branding\Icanlogo.ico"
    }
    $shortcut.Save()
    Write-OK "Desktop shortcut created"
} catch {
    Write-Warn "Could not create shortcut: $_"
}

# ---- Done! ----
Write-Host ""
Write-Host "  +------------------------------------------+" -ForegroundColor Green
Write-Host "  |                                          |" -ForegroundColor Green
Write-Host "  |   ICAN Film Editor installed!            |" -ForegroundColor Green
Write-Host "  |                                          |" -ForegroundColor Green
Write-Host "  +------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  HOW TO USE:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Open Adobe Premiere Pro" -ForegroundColor Cyan
Write-Host "  2. Go to:  Window  >  Extensions  >  ICAN Film Editor" -ForegroundColor Cyan
Write-Host "  3. The server starts automatically when the panel opens" -ForegroundColor Cyan
Write-Host "  4. Click the gear icon (Settings) and enter your API keys" -ForegroundColor Cyan
Write-Host "     (only needed the first time)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  API KEYS (get these free, enter them in Settings):" -ForegroundColor White
Write-Host "  * OpenAI    ->  platform.openai.com/api-keys" -ForegroundColor DarkGray
Write-Host "  * Anthropic ->  console.anthropic.com" -ForegroundColor DarkGray
Write-Host "  * OR Gemini ->  console.cloud.google.com  (free with Google Workspace)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Cost per 60-min episode: approx 0.50 USD" -ForegroundColor DarkGray
Write-Host ""
Pause-Step "Installation complete! Press any key to close."
