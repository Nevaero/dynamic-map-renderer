# Dynamic Map Renderer (v0.3.0)

A web-based TTRPG tool that lets a Game Master transform static map images into dynamic, interactive displays for players in real-time. Built with a retro sci-fi aesthetic (Mothership, Traveller, Aliens RPG vibe).

## Tech Stack

- **Backend:** Flask + Flask-SocketIO (Python)
- **Frontend:** Three.js (WebGL shaders) + vanilla JS + Socket.IO
- **Build:** PyInstaller (standalone `.exe`)

## Architecture

- **GM interface** (`templates/index.html` + `static/js/gm.js`) — control panel for maps, filters, fog of war, tokens, view state
- **Player view** (`templates/player.html` + `static/js/player.js`) — full-screen WebGL-rendered display with real-time sync
- **Server** (`app.py`) — Flask app handling WebSocket comms, image compositing, config persistence
- **Filters** (`filters/`) — GLSL shaders (CRT green, CRT amber, none) with tunable parameters
- **Configs** (`configs/`) — per-map JSON auto-save of all state (filter params, fog polygons, view)

## Key Features

- Upload/load maps (PNG, JPG, WebP)
- Real-time WebGL visual filters with adjustable parameters
- Fog of War system (freehand + shape tools, undo/redo)
- Player tokens (draggable, labeled, colored) — persisted in server memory per session, survive page reloads
- Pan/zoom control (GM and player-side with pinch-to-zoom)
- QR code for quick player connection
- Auto-save all state per map
- Builds to a single `.exe` for distribution

## Directory Structure

- `app.py` — main Flask application
- `templates/` — HTML templates (index.html for GM, player.html for player)
- `static/js/gm.js` — GM interface logic
- `static/js/player.js` — player view logic
- `static/js/token-shared.js` — shared token utilities (IIFE → `window.TokenShared`): socket wrappers, UI helpers, color/label logic used by both GM and player views
- `static/css/style.css` — consolidated styles
- `filters/` — filter subdirectories each containing config.json + vertex/fragment GLSL shaders
- `maps/` — map image storage
- `configs/` — per-map auto-saved JSON configuration files
- `generated_maps/` — temporary fog-composited map images
- `build.bat` / `DynamicMapRenderer.spec` — PyInstaller build config

## Data Flow

GM Interface → WebSocket (SocketIO) → Flask Server (process + save config) → Broadcast to Players → Three.js renders with GLSL shader

## Development

```bash
pip install -r requirements.txt
python app.py
# Opens http://127.0.0.1:5000/
```

## Build

```bash
build.bat
# Output: dist/DynamicMapRenderer.exe
```
