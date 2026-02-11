# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for Dynamic Map Renderer
# Build with:  pyinstaller DynamicMapRenderer.spec

import os

block_cipher = None
app_root = SPECPATH

# Bundle cloudflared.exe if present (optional — tunnel support)
_cloudflared_path = os.path.join(app_root, 'cloudflared.exe')
_extra_binaries = []
if os.path.isfile(_cloudflared_path):
    _extra_binaries.append((_cloudflared_path, '.'))

# Bundle icon.ico if present
_icon_path = os.path.join(app_root, 'icon.ico')
_extra_datas = []
if os.path.isfile(_icon_path):
    _extra_datas.append((_icon_path, '.'))

# Use icon.ico for the exe if present, otherwise None
_exe_icon = _icon_path if os.path.isfile(_icon_path) else None

a = Analysis(
    [os.path.join(app_root, 'app.py')],
    pathex=[app_root],
    binaries=_extra_binaries,
    datas=[
        # Read-only assets bundled inside the exe
        (os.path.join(app_root, 'templates'), 'templates'),
        (os.path.join(app_root, 'static'),    'static'),
        # Seed data — copied next to the exe on first run
        (os.path.join(app_root, 'filters'),   'filters'),
        (os.path.join(app_root, 'maps'),      'maps'),
        (os.path.join(app_root, 'configs'),   'configs'),
    ] + _extra_datas,
    hiddenimports=[
        'flask',
        'flask_socketio',
        'engineio',
        'engineio.async_drivers.threading',
        'socketio',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'server',
        'server.config',
        'server.state',
        'server.filters',
        'server.helpers',
        'server.map_gen',
        'server.tunnel',
        'server.routes_core',
        'server.auth',
        'server.routes_saves',
        'server.sockets',
        'webview',
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
    console=False,           # Silent — no console window in production
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_exe_icon,          # Sets the exe file icon + taskbar icon
)
