$src = "C:\Users\jhabi\Downloads\ICAN FILM EDITOR\ican-film-editor"
$dst = "$env:APPDATA\Adobe\CEP\extensions\ican-film-editor"

# Ensure destination dirs exist
New-Item -ItemType Directory -Force -Path "$dst\server\routes" | Out-Null
New-Item -ItemType Directory -Force -Path "$dst\server\utils" | Out-Null
New-Item -ItemType Directory -Force -Path "$dst\js" | Out-Null
New-Item -ItemType Directory -Force -Path "$dst\jsx" | Out-Null
New-Item -ItemType Directory -Force -Path "$dst\css" | Out-Null

# Copy server files
Copy-Item "$src\server\server.js" "$dst\server\server.js" -Force
Copy-Item "$src\server\package.json" "$dst\server\package.json" -Force
Copy-Item "$src\server\_launch.bat" "$dst\server\_launch.bat" -Force
Copy-Item "$src\server\routes\transcribe.js" "$dst\server\routes\transcribe.js" -Force
Copy-Item "$src\server\routes\translate.js" "$dst\server\routes\translate.js" -Force
Copy-Item "$src\server\routes\analyze.js" "$dst\server\routes\analyze.js" -Force
Copy-Item "$src\server\utils\chunker.js" "$dst\server\utils\chunker.js" -Force

# Copy UI files
Copy-Item "$src\js\main.js" "$dst\js\main.js" -Force
Copy-Item "$src\css\styles.css" "$dst\css\styles.css" -Force
Copy-Item "$src\index.html" "$dst\index.html" -Force
Copy-Item "$src\jsx\host.jsx" "$dst\jsx\host.jsx" -Force
Copy-Item "$src\version.json" "$dst\version.json" -Force

Write-Host "All files deployed to: $dst"
