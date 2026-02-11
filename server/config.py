# server/config.py
# Paths, constants, folder creation, logging, LAN IP detection

import os
import sys
import logging
import socket

# --- PyInstaller / dev path detection ---
if getattr(sys, 'frozen', False):
    BUNDLE_DIR = sys._MEIPASS
    APP_ROOT = os.path.dirname(sys.executable)
else:
    BUNDLE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    APP_ROOT = BUNDLE_DIR

# --- Folder paths ---
MAPS_FOLDER = os.path.join(APP_ROOT, 'maps')
CONFIGS_FOLDER = os.path.join(APP_ROOT, 'configs')
FILTERS_FOLDER = os.path.join(APP_ROOT, 'filters')
GENERATED_MAPS_FOLDER = os.path.join(APP_ROOT, 'generated_maps')

# On first run of the packaged .exe, copy bundled seed data next to the executable
if getattr(sys, 'frozen', False):
    import shutil
    for _folder_name in ('filters', 'maps', 'configs'):
        _src = os.path.join(BUNDLE_DIR, _folder_name)
        _dst = os.path.join(APP_ROOT, _folder_name)
        if os.path.isdir(_src) and not os.path.isdir(_dst):
            shutil.copytree(_src, _dst)

# --- Constants ---
ALLOWED_MAP_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
DEFAULT_HELP_MAP_FILENAME = "Help.png"
SAVES_DB_PATH = os.path.join(APP_ROOT, 'saves.db')
SAVES_FOLDER_LEGACY = os.path.join(APP_ROOT, 'saves')  # for migration only
ROOM_NAME = "game"

# --- Ensure directories exist ---
os.makedirs(MAPS_FOLDER, exist_ok=True)
os.makedirs(CONFIGS_FOLDER, exist_ok=True)
os.makedirs(FILTERS_FOLDER, exist_ok=True)
os.makedirs(GENERATED_MAPS_FOLDER, exist_ok=True)

# --- Logging ---
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')


def cleanup_generated_maps():
    """Removes old PNG files from the generated maps folder."""
    logging.info(f"Cleaning up generated maps in: {GENERATED_MAPS_FOLDER}")
    count = 0
    try:
        for filename in os.listdir(GENERATED_MAPS_FOLDER):
            if filename.lower().endswith('.png'):
                filepath = os.path.join(GENERATED_MAPS_FOLDER, filename)
                try:
                    if os.path.isfile(filepath): os.remove(filepath); count += 1
                except OSError as e: logging.warning(f"Could not remove file {filepath}: {e}")
        logging.info(f"Cleanup complete. Removed {count} file(s).")
    except Exception as e: logging.error(f"Error during generated map cleanup: {e}", exc_info=True)


# --- LAN IP Detection ---
def get_lan_ip():
    """Return the machine's LAN IP address (best-effort)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

LAN_IP = get_lan_ip()
