# ============================================================
#  ICAN Film Editor — Automated Installer
#  Double-click INSTALL.bat to run this.
#  Everything is handled automatically.
# ============================================================

$Host.UI.RawUI.WindowTitle = "ICAN Film Editor — Installer"
$ErrorActionPreference = "Stop"

$PLUGIN_DIR   = "$PSScriptRoot\ican-film-editor"
$ADOBE_EXT    = "$env:APPDATA\Adobe\CEP\extensions\ican-film-editor"
$SERVER_DIR   = "$PLUGIN_DIR\server"
$FFMPEG_BIN   = "$SERVER_DIR\bin\ffmpeg.exe"
$DESKTOP      = [Environment]::GetFolderPath("Desktop")

function Write-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  ██╗ ██████╗ █████╗ ███╗  " -ForegroundColor Red
    Write-Host "  ██║██╔════╝██╔══██╗████╗ " -ForegroundColor Red
    Write-Host "  ██║██║     ███████║██╔██╗" -ForegroundColor Red
    Write-Host "  ██║██║     ██╔══██║██║╚██" -ForegroundColor Red
    Write-Host "  ██║╚██████╗██║  ██║██║ ╚█" -ForegroundColor Red
    Write-Host "  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  " -ForegroundColor Red
    Write-Host ""
    Write-Host "  ICAN Film Editor — Automated Installer" -ForegroundColor White
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step($num, $text) {
    Write-Host "  [$num] $text" -ForegroundColor Cyan
}

function Write-OK($text) {
    Write-Host "      ✓ $text" -ForegroundColor Green
}

function Write-Info($text) {
    Write-Host "      → $text" -ForegroundColor DarkGray
}

function Write-Warn($text) {
    Write-Host "      ! $text" -ForegroundColor Yellow
}

function Pause-Step($text) {
    Write-Host ""
    Write-Host "  $text" -ForegroundColor Yellow
    Write-Host "  Press any key to continue..." -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

Write-Header

# ---- STEP 1: Check for Node.js ----
Write-Step "1/5" "Checking Node.js..."

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
        Write-OK "Node.js $nodeVersion installed"
    } catch {
        Write-Host "  ✗ Could not auto-install Node.js." -ForegroundColor Red
        Write-Host "  Please download it manually from https://nodejs.org then re-run INSTALL.bat" -ForegroundColor Yellow
        Pause-Step "Press any key to exit."
        exit 1
    }
} else {
    Write-OK "Node.js $nodeVersion already installed"
}

# ---- STEP 2: Install FFmpeg ----
Write-Step "2/5" "Checking FFmpeg..."

if (-not (Test-Path $FFMPEG_BIN)) {
    Write-Warn "FFmpeg not found. Downloading..."
    $ffmpegZip = "$env:TEMP\ffmpeg.zip"
    $ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

    try {
        Write-Info "Downloading FFmpeg (this may take 1-2 minutes)..."
        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
        Write-Info "Extracting FFmpeg..."
        $extractPath = "$env:TEMP\ffmpeg-extract"
        if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
        Expand-Archive -Path $ffmpegZip -DestinationPath $extractPath -Force

        # Find ffmpeg.exe inside the extracted folder
        $ffmpegExe = Get-ChildItem -Path $extractPath -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
        if ($ffmpegExe) {
            $binDir = "$SERVER_DIR\bin"
            if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
            Copy-Item $ffmpegExe.FullName -Destination $FFMPEG_BIN -Force
            Write-OK "FFmpeg installed to plugin folder"
        } else {
            throw "ffmpeg.exe not found in archive"
        }

        Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warn "Could not auto-install FFmpeg: $_"
        Write-Warn "The plugin will still work but audio extraction may be limited."
    }
} else {
    Write-OK "FFmpeg already installed"
}

# ---- STEP 3: Install Node.js packages ----
Write-Step "3/5" "Installing AI packages..."
Write-Info "Running npm install in server folder..."

try {
    $npmResult = & npm install --prefix "$SERVER_DIR" 2>&1
    # Also install adm-zip for auto-update support
    & npm install adm-zip --prefix "$SERVER_DIR" --save 2>&1 | Out-Null
    Write-OK "All packages installed"
} catch {
    Write-Host "  ✗ npm install failed: $_" -ForegroundColor Red
    Pause-Step "Press any key to exit."
    exit 1
}

# ---- Download CSInterface.js (required for CEP panel to work) ----
Write-Info "Downloading Adobe CSInterface.js..."
$csInterfaceDest = "$PLUGIN_DIR\js\CSInterface.js"
# The file is already bundled in the plugin, but ensure it's up to date
if (-not (Test-Path $csInterfaceDest)) {
    try {
        $csUrl = "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js"
        Invoke-WebRequest -Uri $csUrl -OutFile $csInterfaceDest -UseBasicParsing -ErrorAction Stop
        Write-OK "CSInterface.js downloaded from Adobe"
    } catch {
        Write-Warn "Could not download CSInterface.js — using bundled version (this is fine)"
    }
} else {
    Write-OK "CSInterface.js already present"
}

# ---- STEP 4: Enable CEP extensions in Premiere Pro ----
Write-Step "4/5" "Enabling Premiere Pro extensions..."

try {
    # Try CSXS versions 9 through 12 (covers Premiere Pro 2020-2025)
    foreach ($ver in @("9","10","11","12")) {
        $regPath = "HKCU:\SOFTWARE\Adobe\CSXS.$ver"
        if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
        Set-ItemProperty -Path $regPath -Name "PlayerDebugMode" -Value "1" -Type String -Force
    }
    Write-OK "Premiere Pro extension mode enabled"
} catch {
    Write-Warn "Could not set registry automatically. You may need to do this manually."
    Write-Warn "See INSTALL-MANUAL.txt if Premiere does not show the plugin."
}

# ---- STEP 5: Copy plugin to Adobe extensions folder ----
Write-Step "5/5" "Installing plugin into Premiere Pro..."

try {
    # Create CEP extensions folder if it doesn't exist
    if (-not (Test-Path "$env:APPDATA\Adobe\CEP\extensions")) {
        New-Item -ItemType Directory -Path "$env:APPDATA\Adobe\CEP\extensions" -Force | Out-Null
    }

    # Remove old version if present
    if (Test-Path $ADOBE_EXT) {
        Remove-Item $ADOBE_EXT -Recurse -Force
    }

    # Copy plugin (excluding node_modules to save space, then npm install there)
    Write-Info "Copying plugin files..."
    Copy-Item -Path $PLUGIN_DIR -Destination $ADOBE_EXT -Recurse -Force

    Write-OK "Plugin installed to Premiere Pro"
} catch {
    Write-Host "  ✗ Could not copy plugin: $_" -ForegroundColor Red
    Pause-Step "Press any key to exit."
    exit 1
}

# ---- Create Desktop Shortcuts ----
Write-Info "Creating desktop shortcuts..."

# Launcher shortcut
$launcherPath = "$PSScriptRoot\START ICAN EDITOR.bat"
$WScriptShell = New-Object -ComObject WScript.Shell
$shortcut = $WScriptShell.CreateShortcut("$DESKTOP\ICAN Film Editor.lnk")
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "Start ICAN Film Editor Server"
$iconPath = "$ADOBE_EXT\assets\icons\icon.png"
if (Test-Path "$PSScriptRoot\Branding\Icanlogo.ico") {
    $shortcut.IconLocation = "$PSScriptRoot\Branding\Icanlogo.ico"
}
$shortcut.Save()

Write-OK "Desktop shortcut created"

# ---- Done! ----
Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host "  ✓  ICAN Film Editor installed successfully!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  HOW TO USE EVERY DAY:" -ForegroundColor White
Write-Host "  1. Double-click 'ICAN Film Editor' on your Desktop" -ForegroundColor Cyan
Write-Host "  2. Open Adobe Premiere Pro" -ForegroundColor Cyan
Write-Host "  3. Go to:  Window → Extensions → ICAN Film Editor" -ForegroundColor Cyan
Write-Host "  4. Click ⚙️ Settings and enter your API keys (first time only)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  API KEYS NEEDED (enter in plugin Settings):" -ForegroundColor White
Write-Host "  • OpenAI   → platform.openai.com/api-keys" -ForegroundColor DarkGray
Write-Host "  • Google   → console.cloud.google.com (Translation API)" -ForegroundColor DarkGray
Write-Host "  • Anthropic→ console.anthropic.com (Claude API)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Cost per 60-min episode: ~`$0.50 USD" -ForegroundColor DarkGray
Write-Host ""
Pause-Step "Installation complete. Press any key to close."
