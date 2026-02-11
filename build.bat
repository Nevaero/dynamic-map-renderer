@echo off
echo ============================================
echo   Building Dynamic Map Renderer (.exe)
echo ============================================
echo.

:: Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

:: Install / upgrade build dependencies
echo [1/4] Installing dependencies...
pip install --upgrade pyinstaller flask flask-socketio pillow python-engineio python-socketio werkzeug pywebview
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)
echo.

:: Download cloudflared if not present
echo [2/4] Checking for cloudflared...
if exist cloudflared.exe (
    echo cloudflared.exe already present, skipping download.
) else (
    echo Downloading cloudflared.exe from GitHub...
    curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    if errorlevel 1 (
        echo WARNING: Could not download cloudflared.exe. Tunnel support will be unavailable.
        echo Build will continue without tunnel support.
        if exist cloudflared.exe del cloudflared.exe
    ) else (
        echo cloudflared.exe downloaded successfully.
    )
)
echo.

:: Build the exe
echo [3/4] Building executable with PyInstaller...
pyinstaller --clean --noconfirm DynamicMapRenderer.spec
if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    pause
    exit /b 1
)
echo.

:: Done
echo [4/4] Build complete!
echo.
echo ============================================
echo   Output:  dist\DynamicMapRenderer.exe
echo ============================================
echo.
echo Send that single .exe file to your friend.
echo They just double-click it and a native GM window will open automatically.
echo.
pause
