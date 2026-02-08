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
echo [1/3] Installing dependencies...
pip install --upgrade pyinstaller flask flask-socketio pillow python-engineio python-socketio werkzeug
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)
echo.

:: Build the exe
echo [2/3] Building executable with PyInstaller...
pyinstaller --clean --noconfirm DynamicMapRenderer.spec
if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    pause
    exit /b 1
)
echo.

:: Done
echo [3/3] Build complete!
echo.
echo ============================================
echo   Output:  dist\DynamicMapRenderer.exe
echo ============================================
echo.
echo Send that single .exe file to your friend.
echo They just double-click it and a browser will open automatically.
echo.
pause
