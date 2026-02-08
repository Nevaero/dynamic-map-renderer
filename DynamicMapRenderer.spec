# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for Dynamic Map Renderer
# Build with:  pyinstaller DynamicMapRenderer.spec

import os

block_cipher = None
app_root = SPECPATH

a = Analysis(
    [os.path.join(app_root, 'app.py')],
    pathex=[app_root],
    binaries=[],
    datas=[
        # Read-only assets bundled inside the exe
        (os.path.join(app_root, 'templates'), 'templates'),
        (os.path.join(app_root, 'static'),    'static'),
        # Seed data — copied next to the exe on first run
        (os.path.join(app_root, 'filters'),   'filters'),
        (os.path.join(app_root, 'maps'),      'maps'),
        (os.path.join(app_root, 'configs'),   'configs'),
    ],
    hiddenimports=[
        'flask',
        'flask_socketio',
        'engineio',
        'engineio.async_drivers.threading',
        'socketio',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', '_tkinter',
        'matplotlib', 'numpy', 'scipy', 'pandas',
        'pytest', 'unittest',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='DynamicMapRenderer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,            # Keep console visible so user sees server logs
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,               # Add an .ico file here if you have one
)
