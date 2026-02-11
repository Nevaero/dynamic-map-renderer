# app.py
# Version: 3.0.0 (Modular server package)
# Entry point for the Dynamic Map Renderer

import os
import sys
import time
import threading
import webbrowser

from server import create_app, socketio
from server import config
from server.config import cleanup_generated_maps
from server.routes_saves import _auto_load_latest_save
from server.tunnel import _find_cloudflared, _start_tunnel

# Create app at module level (PyInstaller needs it discoverable)
app = create_app()

# --- Main Execution ---
if __name__ == '__main__':
    cleanup_generated_maps()
    _auto_load_latest_save()

    is_frozen = getattr(sys, 'frozen', False)
    if not is_frozen:
        with app.app_context(): print("--- Registered URL Routes ---\n", app.url_map, "\n-----------------------------")

    print("------------------------------------------")
    print(" Starting Dynamic Map Renderer server... ")
    print(" Backend version: 3.0.0 (Modular server package) ")
    print(f" Serving map images from: {config.MAPS_FOLDER}")
    print(f" Using configs from:      {config.CONFIGS_FOLDER}")
    print(f" Loading filters from:    {config.FILTERS_FOLDER}")
    print(f" Saving generated images to:    {config.GENERATED_MAPS_FOLDER}")
    print(f" Save database:               {config.SAVES_DB_PATH}")
    print("------------------------------------------")
    print(f" Your LAN IP: {config.LAN_IP}")
    print("------------------------------------------")
    gm_url = f"http://127.0.0.1:5000/?token={config.GM_SECRET}"
    print(f" GM View (this machine): {gm_url}")
    print(f" Player View (LAN):      http://{config.LAN_IP}:5000/player")
    print("------------------------------------------")
    if is_frozen:
        print(" (Close this window to stop the server)")
        print("------------------------------------------")

    # Start cloudflared tunnel in background
    if _find_cloudflared():
        print(" Starting Cloudflare tunnel...")
        threading.Thread(target=_start_tunnel, daemon=True).start()
    else:
        print(" Cloudflare tunnel: unavailable (cloudflared.exe not found)")
    print("------------------------------------------")

    # Auto-open browser after a short delay to let the server start
    # Only open in the reloader child process (or when reloader is disabled)
    # to avoid opening two tabs.
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or is_frozen:
        def open_browser():
            time.sleep(1.5)
            webbrowser.open(gm_url)
        threading.Thread(target=open_browser, daemon=True).start()

    socketio.run(app, debug=not is_frozen, host='0.0.0.0', port=5000, use_reloader=not is_frozen)
