@echo off
cd /d "%~dp0"

:: Install dependencies automatically on first run (after git clone)
if not exist "node_modules\" (
    echo Instalando dependencias por primera vez, espera un momento...
    npm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install fallo. Asegurate de tener Node.js v18+ instalado.
        echo Descarga Node.js en: https://nodejs.org
        pause
        exit /b 1
    )
    echo.
)

:: Kill any existing instance before launching a new one
taskkill /F /IM electron.exe >nul 2>&1
timeout /t 1 /nobreak >nul
start "" "node_modules\electron\dist\electron.exe" .
