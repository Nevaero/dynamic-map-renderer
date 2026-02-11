# app.py
# Version: 3.0.0 (Modular server package)
# Entry point for the Dynamic Map Renderer

import os
import sys
import time
import threading

import webview

from server import create_app, socketio
from server import config
from server.config import cleanup_generated_maps, IS_PROD
from server.routes_saves import _auto_load_latest_save
from server.tunnel import _find_cloudflared, _start_tunnel


def resource_path(relative_path):
    """Resolve a path to a bundled resource (PyInstaller) or local file."""
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative_path)


# Create app at module level (PyInstaller needs it discoverable)
app = create_app()

# --- Main Execution ---
if __name__ == '__main__':
    cleanup_generated_maps()
    _auto_load_latest_save()

    if not IS_PROD:
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
    print(" (Close the GM window to stop the server)")
    print("------------------------------------------")

    # Start cloudflared tunnel in background
    if _find_cloudflared():
        print(" Starting Cloudflare tunnel...")
        threading.Thread(target=_start_tunnel, daemon=True).start()
    else:
        print(" Cloudflare tunnel: unavailable (cloudflared.exe not found)")
    print("------------------------------------------")

    # Start Flask-SocketIO server in a daemon thread
    server_thread = threading.Thread(
        target=socketio.run,
        args=(app,),
        kwargs=dict(host='0.0.0.0', port=5000, use_reloader=False, debug=False, log_output=not IS_PROD),
        daemon=True,
    )
    server_thread.start()

    # Wait briefly for the server to be ready
    time.sleep(1)

    # Resolve icon path (place icon.ico in the project root)
    icon_path = resource_path('icon.ico')
    icon = icon_path if os.path.isfile(icon_path) else None

    # Launch pywebview window on main thread
    webview.create_window(
        'Dynamic Map Renderer — GM',
        gm_url,
        width=1280,
        height=900,
        min_size=(800, 600),
    )
    webview.start(icon=icon)
