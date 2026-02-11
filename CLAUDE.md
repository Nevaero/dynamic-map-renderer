# Dynamic Map Renderer (v0.4.1)

A web-based TTRPG tool that lets a Game Master transform static map images into dynamic, interactive displays for players in real-time. Built with a retro sci-fi aesthetic (Mothership, Traveller, Aliens RPG vibe).

## Tech Stack

- **Backend:** Flask + Flask-SocketIO (Python)
- **Frontend:** Three.js (WebGL shaders) + vanilla JS + Socket.IO
- **Build:** PyInstaller (standalone `.exe`)

## Architecture

- **GM interface** (`templates/index.html` + `static/js/gm.js`) — control panel for maps, filters, fog of war, tokens, view state
- **Player view** (`templates/player.html` + `static/js/player.js`) — full-screen WebGL-rendered display with real-time sync
- **Server** (`app.py` + `server/` package) — Flask app factory with modular routing, WebSocket comms, image compositing, config persistence
- **Filters** (`filters/`) — GLSL shaders (CRT green, CRT amber, none) with tunable parameters
- **Configs** (`configs/`) — per-map JSON auto-save of all state (filter params, fog polygons, view)

## Key Features

- Upload/load maps (PNG, JPG, WebP)
- Real-time WebGL visual filters with adjustable parameters (CRT green, CRT amber, none)
- Fog of War system: freehand drawing + shape tools (circle, ellipse, square, rectangle, triangle)
- Fog polygon editing: select to move (drag), edit individual vertices, recolor via color swatches (context popup + sidebar)
- Figma-style edge/corner resize handles for square/rectangle fog shapes; 4-corner resize handles for circles/ellipses
- Fog undo/redo (Ctrl+Z / Ctrl+Y, up to 50 states) for all fog mutations
- Player tokens (draggable, labeled, colored) — persisted in server memory per session, survive page reloads; shared `token-shared.js` IIFE used by both GM and player views
- Pan/zoom control (GM-side) + player-side pinch-to-zoom touch gestures
- Save/Load system — SQLite-backed CRUD (`saves.db`), auto-loads latest save on startup, save/rename/overwrite/delete from GM panel
- Collapsible + resizable GM left panel
- QR code for quick player connection
- Cloudflare tunnel — optional remote access via `cloudflared.exe` (auto-detected, started in background)
- Auto-save per-map config (filter params, fog polygons, view state) as JSON in `configs/`
- GM authentication — startup token gates the GM view; players cannot access `/` without it
- Single GM connection — only one GM socket at a time; duplicate connections are rejected
- Protected write APIs — all mutating endpoints (`POST`, `PUT`, `DELETE`) require GM session
- Protected socket events — `gm_update` is rejected from non-GM clients
- Player preview iframe — live `/player` view embedded in the GM interface (bottom-right corner), toggled with `P` key or button, resizable via top-left drag handle; tokens are hidden in preview mode to avoid duplication with the GM SVG overlay
- Builds to a single `.exe` for distribution (PyInstaller via `build.bat`)

## Directory Structure

- `app.py` — slim entry point (creates app, runs server)
- `server/` — backend package
  - `__init__.py` — `create_app()` factory, registers blueprints + sockets
  - `auth.py` — `gm_required` decorator for protecting write-only HTTP endpoints
  - `config.py` — paths, constants, folder creation, logging, LAN IP, `GM_SECRET` token
  - `state.py` — shared mutable globals (`current_state`, `current_tokens`, `current_save_id`, `gm_socket_sid`)
  - `filters.py` — filter loading from GLSL shader directories
  - `helpers.py` — map config I/O, state builders, `merge_dicts`
  - `map_gen.py` — fog-of-war compositing (`generate_player_map`, `generate_player_map_bytes`)
  - `tunnel.py` — Cloudflare tunnel management
  - `routes_core.py` — Blueprint: templates, file serving, filters, maps, config APIs (GM-gated `/` route, `@gm_required` on writes)
  - `routes_saves.py` — Blueprint: SQLite save/load CRUD + auto-load (`@gm_required` on mutations)
  - `sockets.py` — all SocketIO event handlers (GM socket tracking, session-checked `gm_update`)
- `templates/` — HTML templates (index.html for GM, player.html for player, unauthorized.html for access-denied page)
- `static/js/gm.js` — GM interface logic
- `static/js/player.js` — player view logic
- `static/js/token-shared.js` — shared token utilities (IIFE → `window.TokenShared`): socket wrappers, UI helpers, color/label logic used by both GM and player views
- `static/css/style.css` — consolidated styles
- `filters/` — filter subdirectories each containing config.json + vertex/fragment GLSL shaders
- `maps/` — map image storage
- `configs/` — per-map auto-saved JSON configuration files
- `generated_maps/` — temporary fog-composited map images
- `build.bat` / `DynamicMapRenderer.spec` — PyInstaller build config

## Security Model

- On startup, a random `GM_SECRET` token is generated and printed in the console banner.
- The browser auto-opens `http://127.0.0.1:5000/?token=<GM_SECRET>`, which sets `session['is_gm'] = True` and redirects to the clean `/` URL.
- Subsequent requests (HTTP and SocketIO) carry the Flask session cookie — no token in the URL after the initial auth.
- Navigating to `/` without a valid session shows a themed "Access Denied" page (`unauthorized.html`) and auto-redirects to `/player`.
- All write endpoints (`POST /api/maps`, `POST /api/config/*`, save mutations) are protected with `@gm_required` (returns 403).
- The `gm_update` socket event checks `session['is_gm']` and silently drops non-GM emitters.
- Only one GM socket connection is allowed at a time; duplicate GM connects are immediately disconnected (preview iframe excluded via `preview` query param).
- Read-only endpoints (`GET /api/*`), the player view, and token socket events remain open.

## Data Flow

GM Interface → WebSocket (SocketIO) → Flask Server (process + save config) → Broadcast to Players → Three.js renders with GLSL shader

**Important invariant:** `state.current_state['map_content_path']` must always be `'binary://'` (never the raw file path) when a map is loaded. Players receive fog-composited images exclusively via the `map_image_data` binary event. Metadata-only broadcasts (filter/view changes) send `map_content_path = 'binary://'` so the player keeps its existing composited texture. The raw file path is stored in `original_map_path` (server-only, stripped before broadcast) and written to disk configs by `save_map_config`.

## Development

```bash
pip install -r requirements.txt
python app.py
# Console prints the GM URL with token: http://127.0.0.1:5000/?token=<random>
# Browser auto-opens to that URL
```

## Build

```bash
build.bat
# Output: dist/DynamicMapRenderer.exe
```
