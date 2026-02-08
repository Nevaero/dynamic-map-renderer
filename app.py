# app.py
# Version: 2.7.15 (Fog of War - Stage C: Default Help Map State)
# Main Flask application file for the Dynamic Map Renderer

import os
import sys
import json
import copy
import traceback
import re
import time
import logging
import webbrowser
import threading
import socket
import base64
from io import BytesIO
from uuid import uuid4
from PIL import Image, ImageDraw, UnidentifiedImageError

from flask import Flask, request, jsonify, render_template, send_from_directory, send_file, make_response
from flask_socketio import SocketIO, emit as socketio_emit, join_room, leave_room
from werkzeug.utils import secure_filename

# --- Configuration ---
# When packaged with PyInstaller, bundled read-only assets live in sys._MEIPASS,
# while writable user data (maps, configs, generated_maps) lives next to the .exe.
if getattr(sys, 'frozen', False):
    # Running as a PyInstaller bundle
    BUNDLE_DIR = sys._MEIPASS                              # read-only bundled assets
    APP_ROOT = os.path.dirname(sys.executable)             # writable dir next to .exe
else:
    BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    APP_ROOT = BUNDLE_DIR

MAPS_FOLDER = os.path.join(APP_ROOT, 'maps')
CONFIGS_FOLDER = os.path.join(APP_ROOT, 'configs')
FILTERS_FOLDER = os.path.join(APP_ROOT, 'filters')
GENERATED_MAPS_FOLDER = os.path.join(APP_ROOT, 'generated_maps')

# On first run of the packaged .exe, copy bundled seed data next to the executable
# so the user has working filters and sample maps out of the box.
if getattr(sys, 'frozen', False):
    import shutil
    for _folder_name in ('filters', 'maps', 'configs'):
        _src = os.path.join(BUNDLE_DIR, _folder_name)
        _dst = os.path.join(APP_ROOT, _folder_name)
        if os.path.isdir(_src) and not os.path.isdir(_dst):
            shutil.copytree(_src, _dst)
ALLOWED_MAP_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
SESSION_ID_REGEX = re.compile(r'^[a-zA-Z0-9_-]{1,50}$')
DEFAULT_HELP_MAP_FILENAME = "Help.png" # Define default map filename

# Ensure directories exist
os.makedirs(MAPS_FOLDER, exist_ok=True)
os.makedirs(CONFIGS_FOLDER, exist_ok=True)
os.makedirs(FILTERS_FOLDER, exist_ok=True)
os.makedirs(GENERATED_MAPS_FOLDER, exist_ok=True)

# Setup logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Cleanup old generated maps on startup ---
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

# --- Filter Loading ---
available_filters = {}

# Initialize Flask App & Config
app = Flask(__name__,
            static_folder=os.path.join(BUNDLE_DIR, 'static'),
            template_folder=os.path.join(BUNDLE_DIR, 'templates'))
app.config['SECRET_KEY'] = os.urandom(24)
app.config['MAPS_FOLDER'] = MAPS_FOLDER
app.config['CONFIGS_FOLDER'] = CONFIGS_FOLDER
app.config['FILTERS_FOLDER'] = FILTERS_FOLDER
app.config['GENERATED_MAPS_FOLDER'] = GENERATED_MAPS_FOLDER

# --- Filter Loading Function Definitions ---
# ... (load_single_filter, load_available_filters - unchanged, condensed) ...
def load_single_filter(filter_id):
    filter_dir = os.path.join(FILTERS_FOLDER, filter_id); config_path = os.path.join(filter_dir, 'config.json'); vertex_path = os.path.join(filter_dir, 'vertex.glsl'); fragment_path = os.path.join(filter_dir, 'fragment.glsl')
    if not os.path.exists(config_path): return None
    try:
        with open(config_path, 'r', encoding='utf-8') as f: config_data = json.load(f)
        if not all(k in config_data for k in ['id', 'name', 'params']): raise ValueError("Invalid structure")
        if config_data['id'] != filter_id: raise ValueError(f"ID mismatch: {filter_id}")
        params = config_data.get('params', {}); keys_to_remove = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize'];
        for key in keys_to_remove: params.pop(key, None)
        config_data['params'] = params
        if os.path.exists(vertex_path): config_data['vertex_shader_path'] = os.path.join('filters', filter_id, 'vertex.glsl').replace('\\', '/')
        if os.path.exists(fragment_path): config_data['fragment_shader_path'] = os.path.join('filters', filter_id, 'fragment.glsl').replace('\\', '/')
        return config_data
    except Exception as e: logging.error(f"Error loading filter '{filter_id}': {e}", exc_info=True); return None
def load_available_filters():
    global available_filters; logging.info(f"Scanning for filters in: {FILTERS_FOLDER}"); loaded_filters = {}
    if not os.path.isdir(FILTERS_FOLDER): logging.warning(f"Filters dir not found: {FILTERS_FOLDER}"); return
    for item in os.listdir(FILTERS_FOLDER):
        item_path = os.path.join(FILTERS_FOLDER, item)
        if os.path.isdir(item_path):
            filter_id = item; filter_data = load_single_filter(filter_id)
            if filter_data: loaded_filters[filter_id] = filter_data; logging.info(f"  - Loaded: {filter_data['name']} ({filter_id})")
    available_filters = loaded_filters; logging.info(f"Total filters loaded: {len(available_filters)}")

# Load filters on startup
load_available_filters()

# Initialize SocketIO AFTER app instance is created
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# --- LAN IP Detection ---
def get_lan_ip():
    """Return the machine's LAN IP address (best-effort)."""
    try:
        # Connect to an external address (no data is sent) to find the preferred outbound IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

LAN_IP = get_lan_ip()

# --- In-Memory State Storage ---
session_states = {}
session_tokens = {}  # {session_id: [token_dict, ...]}

# --- Helper Function Definitions ---
# ... (allowed_map_file, get_map_config_path, load_map_config, save_map_config - unchanged, condensed) ...
def allowed_map_file(filename):
    if not filename: return False
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_MAP_EXTENSIONS
def get_map_config_path(map_filename):
    secured_base = secure_filename(map_filename); config_filename = f"{secured_base}_config.json"; return os.path.join(app.config['CONFIGS_FOLDER'], config_filename)
def load_map_config(map_filename):
    config_path = get_map_config_path(map_filename); backup_path = config_path + ".bak"; config_data = None; source_loaded = None
    if os.path.exists(config_path):
        logging.debug(f"Loading main config: {config_path}")
        try:
            with open(config_path, 'r', encoding='utf-8') as f: config_data = json.load(f)
            logging.info(f"Loaded config: {config_path}"); source_loaded = "main"
        except Exception as e: logging.error(f"Error reading/decoding main config {config_path}: {e}"); config_data = None
    if config_data is None and os.path.exists(backup_path):
        logging.warning(f"Main config failed/missing for '{map_filename}', trying backup: {backup_path}")
        try:
            with open(backup_path, 'r', encoding='utf-8') as f: config_data = json.load(f)
            logging.info(f"Loaded config from backup: {backup_path}"); source_loaded = "backup"
            if save_map_config(map_filename, config_data, create_backup=False): logging.info(f"Restored main config from backup for {map_filename}")
            else: logging.error(f"Failed to restore main config from backup for {map_filename}")
        except Exception as e: logging.error(f"Error reading/decoding backup config {backup_path}: {e}"); config_data = None
    if config_data is not None:
        try: # Cleanup/Migration/Defaulting logic...
            if 'map_content_path' not in config_data and 'map_image_path' in config_data: config_data['map_content_path'] = config_data.pop('map_image_path')
            config_data['display_type'] = "image"
            if 'map_content_path' not in config_data:
                expected_path = os.path.join('maps', secure_filename(map_filename)).replace('\\', '/')
                if os.path.exists(os.path.join(app.config['MAPS_FOLDER'], secure_filename(map_filename))): config_data['map_content_path'] = expected_path
                else: logging.error(f"Cannot find map file {map_filename}."); return None
            if 'filter_params' in config_data:
                params = config_data['filter_params']; keys_to_remove = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize']
                for filter_id in list(params.keys()):
                    if isinstance(params.get(filter_id), dict):
                        for key in keys_to_remove: params[filter_id].pop(key, None)
                config_data['filter_params'] = params
            if "view_state" not in config_data: config_data["view_state"] = {"center_x": 0.5, "center_y": 0.5, "scale": 1.0}
            if "fog_of_war" not in config_data: config_data["fog_of_war"] = {"hidden_polygons": []}
            elif not isinstance(config_data.get("fog_of_war"), dict): config_data["fog_of_war"] = {"hidden_polygons": []}
            elif "hidden_polygons" not in config_data["fog_of_war"] or not isinstance(config_data["fog_of_war"].get("hidden_polygons"), list): config_data["fog_of_war"]["hidden_polygons"] = []
            return config_data
        except Exception as e: logging.error(f"Error processing config {map_filename}: {e}", exc_info=True); return None
    logging.warning(f"Config/backup not found/failed for {map_filename}.")
    return None
def save_map_config(map_filename, config_data, create_backup=True):
    config_path = get_map_config_path(map_filename); backup_path = config_path + ".bak"; temp_path = config_path + ".tmp"
    try: # Cleanup/Validation logic...
        expected_path = os.path.join('maps', secure_filename(map_filename)).replace('\\', '/'); config_data['map_content_path'] = expected_path
        config_data['display_type'] = 'image'; config_data.pop('map_image_path', None)
        if 'filter_params' in config_data:
            params = config_data['filter_params']; keys_to_remove = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize']
            for filter_id in list(params.keys()):
                if isinstance(params.get(filter_id), dict):
                    for key in keys_to_remove: params[filter_id].pop(key, None)
            config_data['filter_params'] = params
        if "view_state" not in config_data: config_data["view_state"] = {"center_x": 0.5, "center_y": 0.5, "scale": 1.0}
        if "fog_of_war" not in config_data or not isinstance(config_data.get("fog_of_war"), dict): config_data["fog_of_war"] = {"hidden_polygons": []}
        if "hidden_polygons" not in config_data["fog_of_war"] or not isinstance(config_data["fog_of_war"].get("hidden_polygons"), list): config_data["fog_of_war"]["hidden_polygons"] = []
        with open(temp_path, 'w', encoding='utf-8') as f: json.dump(config_data, f, indent=2, ensure_ascii=False)
        if create_backup:
            try:
                if os.path.exists(config_path): os.replace(config_path, backup_path)
                logging.debug(f"Created backup: {backup_path}")
            except OSError as e: logging.error(f"Could not create backup {backup_path}: {e}", exc_info=True)
        os.replace(temp_path, config_path); logging.info(f"Map config saved: {config_path}"); return True
    except Exception as e: logging.error(f"Error saving config {map_filename}: {e}", exc_info=True)
    finally:
         if os.path.exists(temp_path):
             try: os.remove(temp_path)
             except OSError: pass
    return False

# ... (get_default_filter_params - unchanged, condensed) ...
def get_default_filter_params():
    filter_params = {}; text_params = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize']
    for f_id, f_config in available_filters.items():
        defaults = {};
        for key, param_data in f_config.get('params', {}).items():
            if 'value' in param_data and key not in text_params: defaults[key] = param_data['value']
        filter_params[f_id] = defaults
    return filter_params

# *** MODIFIED Function: get_default_session_state ***
def get_default_session_state():
    """
    Returns the default structure for a new session state.
    Attempts to load Help.png state if it exists.
    """
    logging.debug(f"Attempting to load default state, checking for {DEFAULT_HELP_MAP_FILENAME}")
    help_map_path = os.path.join(app.config['MAPS_FOLDER'], DEFAULT_HELP_MAP_FILENAME)
    if os.path.exists(help_map_path):
        logging.info(f"Found {DEFAULT_HELP_MAP_FILENAME}, attempting to load its state as default.")
        # Use get_state_for_map which handles loading config or generating defaults for Help.png
        default_state = get_state_for_map(DEFAULT_HELP_MAP_FILENAME)
        if default_state:
            # Ensure map_content_path is None initially for the session state
            # The player URL will be generated when the player joins
            default_state['map_content_path'] = None
            logging.info(f"Using state from {DEFAULT_HELP_MAP_FILENAME} as default session state.")
            return default_state
        else:
            logging.warning(f"Found {DEFAULT_HELP_MAP_FILENAME} but failed to load/generate its state.")
            # Fall through to generic default if Help.png state fails

    # Fallback to generic default if Help.png doesn't exist or its state fails to load
    logging.info("Using generic default session state (no map loaded).")
    default_filter_id = "none" if "none" in available_filters else list(available_filters.keys())[0] if available_filters else ""
    return {
        "original_map_path": None,
        "map_content_path": None,
        "display_type": "image",
        "current_filter": default_filter_id,
        "view_state": {"center_x": 0.5, "center_y": 0.5, "scale": 1.0},
        "filter_params": get_default_filter_params(),
        "fog_of_war": {"hidden_polygons": []}
    }

# ... (get_state_for_map, merge_dicts - unchanged, condensed) ...
def get_state_for_map(map_filename):
    config = load_map_config(map_filename)
    if config: # Defaulting logic...
        loaded_filter_params = config.get("filter_params", {}); default_filter_params = get_default_filter_params()
        for f_id, params in default_filter_params.items():
            if f_id not in loaded_filter_params: loaded_filter_params[f_id] = params
            else:
                for key, default_value in params.items():
                    if key not in loaded_filter_params[f_id]: loaded_filter_params[f_id][key] = default_value
        config["filter_params"] = loaded_filter_params
        if "view_state" not in config: config["view_state"] = {"center_x": 0.5, "center_y": 0.5, "scale": 1.0}
        if "fog_of_war" not in config: config["fog_of_war"] = {"hidden_polygons": []}
        config["display_type"] = "image"; config["original_map_path"] = config.get("map_content_path")
        logging.info(f"Loaded state for map: {map_filename}"); return config
    else: # Generate default if map exists
        map_path_on_disk = os.path.join(app.config['MAPS_FOLDER'], secure_filename(map_filename))
        if os.path.exists(map_path_on_disk) and allowed_map_file(map_filename):
            relative_path = os.path.join('maps', secure_filename(map_filename)).replace('\\', '/')
            logging.info(f"Generating default state for: {map_filename}.")
            # Use the generic default generator here, NOT the modified one to avoid recursion
            generic_default_state = { "original_map_path": relative_path, "map_content_path": None, "display_type": "image",
                                      "current_filter": "none" if "none" in available_filters else list(available_filters.keys())[0] if available_filters else "",
                                      "view_state": {"center_x": 0.5, "center_y": 0.5, "scale": 1.0}, "filter_params": get_default_filter_params(),
                                      "fog_of_war": {"hidden_polygons": []} }
            return generic_default_state
        else: logging.warning(f"Map file not found/invalid: {map_filename}"); return None
def merge_dicts(dict1, dict2):
    result = copy.deepcopy(dict1)
    for key, value in dict2.items():
        if key == 'original_map_path': continue
        if isinstance(value, dict) and key in result and isinstance(result[key], dict):
            if key == 'fog_of_war':
                if 'hidden_polygons' in value: result['fog_of_war']['hidden_polygons'] = copy.deepcopy(value['hidden_polygons'])
                for fog_key, fog_value in value.items():
                    if fog_key != 'hidden_polygons':
                        if isinstance(fog_value, dict) and fog_key in result['fog_of_war'] and isinstance(result['fog_of_war'][fog_key], dict):
                            result['fog_of_war'][fog_key] = merge_dicts(result['fog_of_war'][fog_key], fog_value)
                        else: result['fog_of_war'][fog_key] = fog_value
            else: result[key] = merge_dicts(result[key], value)
        else: result[key] = value
    return result

# ... (generate_player_map - unchanged, condensed) ...
def generate_player_map(session_id, state):
    original_map_path = state.get('original_map_path'); fog_data = state.get('fog_of_war', {}).get('hidden_polygons', [])
    if not original_map_path: logging.debug(f"generate_player_map: No original_map_path."); return None
    full_map_path = os.path.join(APP_ROOT, original_map_path)
    if not os.path.exists(full_map_path): logging.error(f"generate_player_map: Original map missing: {full_map_path}"); return None
    output_path = None
    try:
        with Image.open(full_map_path).convert('RGBA') as base_image:
            draw = ImageDraw.Draw(base_image)
            for polygon in fog_data: # Draw polygons...
                vertices = polygon.get('vertices'); 
                if not vertices or not isinstance(vertices, list) or len(vertices) < 3: continue
                size_x, size_y = base_image.size; absolute_vertices = []; valid_polygon = True
                for vertex in vertices:
                     if isinstance(vertex, dict) and 'x' in vertex and 'y' in vertex:
                         try: x_coord = max(0, min(int(float(vertex['x']) * size_x), size_x - 1)); y_coord = max(0, min(int(float(vertex['y']) * size_y), size_y - 1)); absolute_vertices.append((x_coord, y_coord))
                         except (ValueError, TypeError): valid_polygon = False; break
                     else: valid_polygon = False; break
                if not valid_polygon or len(absolute_vertices) < 3: continue
                color = polygon.get('color', '#000000');
                try:
                    if not re.match(r'^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$', color): color = '#000000'
                    draw.polygon(absolute_vertices, fill=color)
                except Exception as e: logging.error(f"generate_player_map: Error drawing polygon: {e}")
            timestamp = int(time.time()); output_filename = f"{session_id}_{timestamp}_{uuid4().hex[:8]}.png"
            output_path = os.path.join(app.config['GENERATED_MAPS_FOLDER'], output_filename)
            base_image.save(output_path, 'PNG')
        image_url = f"/generated_maps/{output_filename}"; logging.info(f"Generated map image: {output_path} URL: {image_url}"); return image_url
    except UnidentifiedImageError: logging.error(f"generate_player_map: Pillow could not identify: {full_map_path}")
    except Exception as e: logging.error(f"Error generating player map: {e}", exc_info=True)
    return None

def generate_player_map_bytes(state):
    """Generate composited map as JPEG bytes in memory (no disk I/O)."""
    original_map_path = state.get('original_map_path')
    fog_data = state.get('fog_of_war', {}).get('hidden_polygons', [])
    if not original_map_path:
        logging.debug("generate_player_map_bytes: No original_map_path.")
        return None
    full_map_path = os.path.join(APP_ROOT, original_map_path)
    if not os.path.exists(full_map_path):
        logging.error(f"generate_player_map_bytes: Original map missing: {full_map_path}")
        return None
    try:
        with Image.open(full_map_path).convert('RGB') as base_image:
            draw = ImageDraw.Draw(base_image)
            for polygon in fog_data:
                vertices = polygon.get('vertices')
                if not vertices or not isinstance(vertices, list) or len(vertices) < 3:
                    continue
                size_x, size_y = base_image.size
                absolute_vertices = []
                valid_polygon = True
                for vertex in vertices:
                    if isinstance(vertex, dict) and 'x' in vertex and 'y' in vertex:
                        try:
                            x_coord = max(0, min(int(float(vertex['x']) * size_x), size_x - 1))
                            y_coord = max(0, min(int(float(vertex['y']) * size_y), size_y - 1))
                            absolute_vertices.append((x_coord, y_coord))
                        except (ValueError, TypeError):
                            valid_polygon = False
                            break
                    else:
                        valid_polygon = False
                        break
                if not valid_polygon or len(absolute_vertices) < 3:
                    continue
                color = polygon.get('color', '#000000')
                try:
                    if not re.match(r'^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$', color):
                        color = '#000000'
                    draw.polygon(absolute_vertices, fill=color)
                except Exception as e:
                    logging.error(f"generate_player_map_bytes: Error drawing polygon: {e}")
            buf = BytesIO()
            base_image.save(buf, format='JPEG', quality=85)
            image_bytes = buf.getvalue()
            logging.info(f"generate_player_map_bytes: Generated {len(image_bytes)} bytes JPEG in memory.")
            return image_bytes
    except UnidentifiedImageError:
        logging.error(f"generate_player_map_bytes: Pillow could not identify: {full_map_path}")
    except Exception as e:
        logging.error(f"Error generating player map bytes: {e}", exc_info=True)
    return None

# --- HTTP Routes (Unchanged, condensed) ---
@app.route('/')
def index(): return render_template('index.html')
@app.route('/player')
def player():
    session_id = request.args.get('session')
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id): return "Error: Session ID missing/invalid.", 400
    return render_template('player.html', session_id=session_id)
@app.route('/maps/<path:filename>')
def serve_map_image(filename):
    log_prefix = "[serve_map_image]"; logging.debug(f"{log_prefix} Request: {filename}"); safe_base_filename = secure_filename(filename)
    if safe_base_filename.startswith("generated_"): logging.warning(f"{log_prefix} Denying generated: {filename}"); return jsonify({"error": "Access denied"}), 403
    logging.debug(f"{log_prefix} Secured: {safe_base_filename}"); maps_dir = app.config['MAPS_FOLDER']; filepath = os.path.join(maps_dir, safe_base_filename)
    logging.debug(f"{log_prefix} Path: '{filepath}'"); file_exists = os.path.exists(filepath); is_file = os.path.isfile(filepath)
    logging.debug(f"{log_prefix} Exists: {file_exists}, Is file: {is_file}")
    try:
        if not file_exists or not is_file: raise FileNotFoundError()
        if not os.path.abspath(filepath).startswith(os.path.abspath(maps_dir)): raise FileNotFoundError()
        logging.debug(f"{log_prefix} Sending from dir='{maps_dir}', filename='{safe_base_filename}'"); response = send_from_directory(maps_dir, safe_base_filename, as_attachment=False)
        logging.debug(f"{log_prefix} Success for {safe_base_filename}"); return response
    except FileNotFoundError: logging.error(f"{log_prefix} FileNotFoundError: {filename}")
    except Exception as e: logging.error(f"{log_prefix} Error serving '{safe_base_filename}': {e}", exc_info=True)
    return jsonify({"error": "Map image not found or error"}), 404
@app.route('/generated_maps/<filename>')
def serve_generated_map(filename):
    log_prefix = "[serve_generated_map]"; logging.debug(f"{log_prefix} Route hit. Raw: '{filename}'"); safe_filename = secure_filename(filename)
    if safe_filename != filename: logging.warning(f"{log_prefix} Sanitized: '{safe_filename}'")
    generated_maps_dir = app.config['GENERATED_MAPS_FOLDER']; filepath = os.path.join(generated_maps_dir, safe_filename)
    logging.debug(f"{log_prefix} Path: '{filepath}'"); file_exists = os.path.exists(filepath); is_file = os.path.isfile(filepath)
    logging.debug(f"{log_prefix} Exists: {file_exists}, Is file: {is_file}")
    try:
        if not file_exists or not is_file: logging.error(f"{log_prefix} Not found/file: {filepath}"); raise FileNotFoundError()
        if not os.path.abspath(filepath).startswith(os.path.abspath(generated_maps_dir)): logging.error(f"{log_prefix} Traversal attempt: {filename}"); raise FileNotFoundError()
        logging.debug(f"{log_prefix} Sending file: '{filepath}'"); response = make_response(send_file(filepath, mimetype='image/png', as_attachment=False))
        response.headers['Access-Control-Allow-Origin'] = '*'; logging.debug(f"{log_prefix} Added CORS header."); return response
    except FileNotFoundError: logging.error(f"{log_prefix} FileNotFoundError: {filename}")
    except Exception as e: logging.error(f"{log_prefix} Error serving {filename}: {e}", exc_info=True)
    status_code = 404 if isinstance(e, FileNotFoundError) else 500
    return make_response(jsonify({"error": "Generated map image not found or error"}), status_code)
@app.route('/filters/<path:filter_id>/<shader_type>')
def serve_shader(filter_id, shader_type):
    logging.debug(f"Request shader: {filter_id}/{shader_type}"); secured_filter_id=secure_filename(filter_id); secured_shader_type=secure_filename(shader_type)
    if secured_shader_type not in ['vertex.glsl', 'fragment.glsl']: return jsonify({"error": "Invalid shader type"}), 400
    filters_dir=app.config['FILTERS_FOLDER']; filter_subdir=os.path.join(filters_dir, secured_filter_id); shader_path=os.path.join(filter_subdir, secured_shader_type)
    logging.debug(f"Serving shader from: {shader_path}")
    try:
        if not os.path.abspath(shader_path).startswith(os.path.abspath(filters_dir)): raise FileNotFoundError
        if not os.path.exists(shader_path): raise FileNotFoundError
        return send_from_directory(filter_subdir, secured_shader_type, mimetype='text/plain')
    except FileNotFoundError: logging.error(f"Shader not found: {filter_id}/{shader_type}")
    except Exception as e: logging.error(f"Error serving shader {filter_id}/{shader_type}: {e}", exc_info=True)
    return jsonify({"error": "Shader not found or error"}), 404
@app.route('/api/filters', methods=['GET'])
def get_filters():
    client_safe_filters = {}; text_params = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize']
    for f_id, f_config in available_filters.items():
        safe_config = {k: v for k, v in f_config.items() if k not in ['vertex_shader_path', 'fragment_shader_path']}
        if 'params' in safe_config: params_copy = copy.deepcopy(safe_config['params']); [params_copy.pop(key, None) for key in text_params]; safe_config['params'] = params_copy
        client_safe_filters[f_id] = safe_config
    return jsonify(client_safe_filters)
@app.route('/api/lan-info', methods=['GET'])
def get_lan_info():
    return jsonify({"ip": LAN_IP, "port": 5000})
@app.route('/api/maps', methods=['GET'])
def list_map_content():
    try:
        maps_dir = app.config['MAPS_FOLDER']
        if not os.path.isdir(maps_dir): logging.error(f"Maps directory not found: {maps_dir}"); return jsonify([])
        content_files = [f for f in os.listdir(maps_dir) if os.path.isfile(os.path.join(maps_dir, f)) and allowed_map_file(f) and not f.startswith('generated_')]
        return jsonify(sorted(content_files))
    except Exception as e: logging.error(f"Error listing map content in {maps_dir}: {e}", exc_info=True); return jsonify({"error": "Server error listing maps"}), 500
@app.route('/api/maps', methods=['POST'])
def upload_map_content():
    if 'mapFile' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['mapFile'];
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    if file and allowed_map_file(file.filename):
        filename = secure_filename(file.filename); save_path = os.path.join(app.config['MAPS_FOLDER'], filename); config_path = get_map_config_path(filename)
        try:
            file.save(save_path); logging.info(f"Map uploaded: {save_path}")
            if not os.path.exists(config_path) and not os.path.exists(config_path + ".bak"):
                 logging.info(f"Creating default config for {filename}."); default_state = get_state_for_map(filename)
                 if default_state:
                     if not save_map_config(filename, default_state): logging.warning(f"Failed save default config {filename}.")
                     else: logging.info(f"Default config saved {filename}")
                 else: logging.warning(f"Could not generate default state {filename}.")
            else: logging.info(f"Config exists {filename}.")
            return jsonify({"success": True, "filename": filename}), 201
        except Exception as e: logging.error(f"Error saving map '{filename}': {e}", exc_info=True); return jsonify({"error": "Could not save map"}), 500
    else: logging.warning(f"Upload rejected type: '{file.filename}'"); allowed_str = ', '.join(ALLOWED_MAP_EXTENSIONS); return jsonify({"error": f"Type not allowed. Allowed: {allowed_str}"}), 400
@app.route('/api/config/<path:map_filename>', methods=['GET'])
def get_config(map_filename):
    secured_filename = secure_filename(map_filename); map_file_path = os.path.join(app.config['MAPS_FOLDER'], secured_filename)
    if not allowed_map_file(secured_filename) or not os.path.exists(map_file_path): return jsonify({"error": "Map not found/invalid"}), 404
    map_state = get_state_for_map(secured_filename)
    if map_state: state_to_send = copy.deepcopy(map_state); state_to_send.pop('original_map_path', None); return jsonify(state_to_send)
    else: logging.error(f"Failed get/generate state {secured_filename}"); return jsonify({"error": "Could not get/generate config"}), 500
@app.route('/api/config/<path:map_filename>', methods=['POST'])
def save_config_api(map_filename):
    secured_filename = secure_filename(map_filename); map_file_path = os.path.join(app.config['MAPS_FOLDER'], secured_filename)
    if not allowed_map_file(secured_filename) or not os.path.exists(map_file_path): return jsonify({"error": "Map not found/invalid"}), 404
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    config_data = request.get_json(); required_keys = ["map_content_path", "current_filter", "view_state", "filter_params", "fog_of_war"]
    if not isinstance(config_data, dict) or not all(k in config_data for k in required_keys): return jsonify({"error": "Invalid config structure"}), 400
    fog_data = config_data.get("fog_of_war");
    if not isinstance(fog_data, dict) or not isinstance(fog_data.get("hidden_polygons"), list): return jsonify({"error": "Invalid fog structure"}), 400
    if save_map_config(secured_filename, config_data): logging.info(f"Config saved via API: {secured_filename}"); return jsonify({"success": True}), 200
    else: logging.error(f"Failed save config via API: {map_filename}"); return jsonify({"error": "Could not save config"}), 500

# --- WebSocket Event Handlers ---
@socketio.on('connect')
def handle_connect(): logging.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    logging.info(f"Client disconnected: {request.sid}")

@socketio.on('leave_session')
def handle_leave_session(data):
    """Handles client leaving a session room."""
    if not isinstance(data, dict) or 'session_id' not in data: return
    session_id = data['session_id']
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id): return
    leave_room(session_id); logging.info(f"Client {request.sid} left: {session_id}")

@socketio.on('join_session')
def handle_join_session(data):
    """Handles player joining a session."""
    if not isinstance(data, dict) or 'session_id' not in data: logging.warning(f"Invalid join: {request.sid}"); socketio_emit('error', {'message': 'Invalid join.'}, to=request.sid); return
    session_id = data['session_id'];
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id): logging.warning(f"Invalid join ID: {session_id}"); socketio_emit('error', {'message': f'Invalid session ID.'}, to=request.sid); return
    join_room(session_id); logging.info(f"Client {request.sid} joined: {session_id}")
    # *** Use updated get_default_session_state when creating ***
    if session_id not in session_states:
        logging.info(f"Creating default state for session: {session_id}")
        session_states[session_id] = get_default_session_state() # This might now load Help.png state
    current_session_state = session_states.get(session_id)
    # Generate image bytes in memory
    image_bytes = None
    if current_session_state.get('original_map_path'):
        image_bytes = generate_player_map_bytes(current_session_state)
    state_to_send = copy.deepcopy(current_session_state)
    state_to_send['map_content_path'] = 'binary://' if image_bytes else None
    state_to_send.pop('original_map_path', None)
    logging.info(f"Sending initial state to {request.sid}. Binary image: {len(image_bytes) if image_bytes else 0} bytes")
    socketio_emit('state_update', state_to_send, to=request.sid)
    if image_bytes:
        b64_data = base64.b64encode(image_bytes).decode('ascii')
        socketio_emit('map_image_data', {'b64': b64_data}, to=request.sid)
    # Send current tokens for this session
    current_tokens = session_tokens.get(session_id, [])
    socketio_emit('tokens_update', {'tokens': current_tokens}, to=request.sid)

@socketio.on('gm_update')
def handle_gm_update(data):
    """Handles partial state updates received from the GM client."""
    if not isinstance(data, dict) or 'session_id' not in data or 'update_data' not in data: logging.warning("Invalid GM update."); return
    session_id = data['session_id']; update_delta = data['update_data']
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id): logging.error(f"GM update invalid ID: {session_id}"); return
    # *** Use updated get_default_session_state when creating ***
    if session_id not in session_states:
        logging.warning(f"GM update for non-existent session {session_id}. Creating default state.")
        session_states[session_id] = get_default_session_state()
    logging.debug(f"Received GM update session {session_id}: {json.dumps(update_delta)}")
    try:
        current_authoritative_state = session_states[session_id]
        original_map_path_before_update = current_authoritative_state.get('original_map_path')
        fog_changed = 'fog_of_war' in update_delta # Check if fog data is in the delta
        new_original_map_path = update_delta.get('map_content_path'); map_changed = False; state_to_merge_into = current_authoritative_state
        if new_original_map_path and new_original_map_path != original_map_path_before_update: # Map change check
            map_filename = os.path.basename(new_original_map_path); map_path_on_disk = os.path.join(app.config['MAPS_FOLDER'], secure_filename(map_filename))
            if os.path.exists(map_path_on_disk) and allowed_map_file(map_filename): # Validate map
                new_map_state = get_state_for_map(map_filename)
                if new_map_state: state_to_merge_into = new_map_state; logging.info(f"Session {session_id}: Loaded state new map '{map_filename}'."); map_changed = True
                else: logging.error(f"Session {session_id}: Could not load state map '{map_filename}'."); return
            else: logging.warning(f"Session {session_id}: GM sent invalid map path '{new_original_map_path}'."); return
        elif new_original_map_path is None and 'map_content_path' in update_delta: # Map reset check
            state_to_merge_into = get_default_session_state(); logging.info(f"Session {session_id}: Map reset."); map_changed = True
        if not map_changed: # Merge delta
            update_delta_copy = copy.deepcopy(update_delta); update_delta_copy.pop('map_content_path', None); updated_state = merge_dicts(state_to_merge_into, update_delta_copy)
        else: updated_state = merge_dicts(state_to_merge_into, update_delta)
        if map_changed: updated_state['original_map_path'] = new_original_map_path # Update original path
        else: updated_state['original_map_path'] = original_map_path_before_update # Preserve original path
        updated_state['display_type'] = 'image' # Ensure type

        image_bytes = None
        regenerate_image = map_changed or fog_changed
        if regenerate_image and updated_state.get('original_map_path'):
            logging.info(f"Regenerating map image for session {session_id} (in memory) because map_changed={map_changed} or fog_changed={fog_changed}")
            image_bytes = generate_player_map_bytes(updated_state)

        updated_state['map_content_path'] = 'binary://' if image_bytes else current_authoritative_state.get('map_content_path')
        session_states[session_id] = updated_state
        logging.debug(f"Session {session_id}: Authoritative state updated.")

        state_to_send = copy.deepcopy(updated_state)
        state_to_send.pop('original_map_path', None)
        if image_bytes:
            state_to_send['map_content_path'] = 'binary://'
            logging.info(f"Broadcasting update session {session_id} with {len(image_bytes)} bytes binary image.")
        elif not regenerate_image:
            # No image change — keep map_content_path as-is so player doesn't refetch
            state_to_send['map_content_path'] = current_authoritative_state.get('map_content_path')
            logging.debug(f"Broadcasting metadata-only update session {session_id}.")
        else:
            logging.warning(f"Broadcasting update session {session_id} with null map path (image generation failed).")
            state_to_send['map_content_path'] = None
        socketio_emit('state_update', state_to_send, room=session_id)
        if image_bytes:
            b64_data = base64.b64encode(image_bytes).decode('ascii')
            socketio_emit('map_image_data', {'b64': b64_data}, room=session_id)
        logging.debug(f"Session {session_id}: Broadcasted state_update.")
    except Exception as e: logging.error(f"Error processing GM update session {session_id}: {e}", exc_info=True)


# --- Token Socket Event Handlers ---

@socketio.on('token_place')
def handle_token_place(data):
    """Place a new token on the map."""
    if not isinstance(data, dict):
        return
    session_id = data.get('session_id')
    token_data = data.get('token')
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id):
        return
    if not isinstance(token_data, dict):
        return
    label = str(token_data.get('label', 'A'))[:2]
    color = token_data.get('color', '#ff0000')
    x = token_data.get('x', 0.5)
    y = token_data.get('y', 0.5)
    # Validate color
    if not isinstance(color, str) or not re.match(r'^#[0-9a-fA-F]{6}$', color):
        color = '#ff0000'
    # Clamp coordinates
    x = max(0.0, min(1.0, float(x)))
    y = max(0.0, min(1.0, float(y)))
    token_id = f"tok_{int(time.time()*1000)}_{uuid4().hex[:5]}"
    new_token = {
        'id': token_id,
        'label': label,
        'color': color,
        'x': x,
        'y': y
    }
    if session_id not in session_tokens:
        session_tokens[session_id] = []
    session_tokens[session_id].append(new_token)
    logging.info(f"Token placed: {token_id} in session {session_id} by {request.sid}")
    socketio_emit('tokens_update', {'tokens': session_tokens[session_id]}, room=session_id)


@socketio.on('token_move')
def handle_token_move(data):
    """Move an existing token."""
    if not isinstance(data, dict):
        return
    session_id = data.get('session_id')
    token_id = data.get('token_id')
    x = data.get('x')
    y = data.get('y')
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id):
        return
    if not token_id or x is None or y is None:
        return
    tokens = session_tokens.get(session_id, [])
    for token in tokens:
        if token['id'] == token_id:
            token['x'] = max(0.0, min(1.0, float(x)))
            token['y'] = max(0.0, min(1.0, float(y)))
            logging.debug(f"Token moved: {token_id} to ({token['x']:.3f}, {token['y']:.3f})")
            socketio_emit('tokens_update', {'tokens': tokens}, room=session_id)
            return


@socketio.on('token_remove')
def handle_token_remove(data):
    """Remove a token from the map."""
    if not isinstance(data, dict):
        return
    session_id = data.get('session_id')
    token_id = data.get('token_id')
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id):
        return
    if not token_id:
        return
    tokens = session_tokens.get(session_id, [])
    before = len(tokens)
    session_tokens[session_id] = [t for t in tokens if t['id'] != token_id]
    if len(session_tokens[session_id]) < before:
        logging.info(f"Token removed: {token_id} from session {session_id}")
        socketio_emit('tokens_update', {'tokens': session_tokens[session_id]}, room=session_id)


@socketio.on('token_update_color')
def handle_token_update_color(data):
    """Update a token's color."""
    if not isinstance(data, dict):
        return
    session_id = data.get('session_id')
    token_id = data.get('token_id')
    color = data.get('color')
    if not session_id or not isinstance(session_id, str) or not SESSION_ID_REGEX.match(session_id):
        return
    if not token_id or not color:
        return
    if not isinstance(color, str) or not re.match(r'^#[0-9a-fA-F]{6}$', color):
        return
    tokens = session_tokens.get(session_id, [])
    for token in tokens:
        if token['id'] == token_id:
            token['color'] = color
            logging.info(f"Token color updated: {token_id} to {color}")
            socketio_emit('tokens_update', {'tokens': tokens}, room=session_id)
            return


# --- Main Execution ---
if __name__ == '__main__':
    cleanup_generated_maps() # Clear old maps on start
    is_frozen = getattr(sys, 'frozen', False)
    if not is_frozen:
        with app.app_context(): print("--- Registered URL Routes ---\n", app.url_map, "\n-----------------------------")
    print("------------------------------------------")
    print(" Starting Dynamic Map Renderer server... ")
    print(" Backend version: 2.7.15 (Fog of War - Stage C: Default Help Map State) ") # Version updated
    print(f" Serving map images from: {app.config['MAPS_FOLDER']}")
    print(f" Using configs from:      {app.config['CONFIGS_FOLDER']}")
    print(f" Loading filters from:    {app.config['FILTERS_FOLDER']}")
    print(f" Saving generated images to:    {app.config['GENERATED_MAPS_FOLDER']}")
    print("------------------------------------------")
    print(f" Your LAN IP: {LAN_IP}")
    print("------------------------------------------")
    print(f" GM View (this machine): http://127.0.0.1:5000/")
    print(f" Player View (LAN):      http://{LAN_IP}:5000/player?session=<session-id>")
    print("------------------------------------------")
    if is_frozen:
        print(" (Close this window to stop the server)")
        print("------------------------------------------")

    # Auto-open browser after a short delay to let the server start
    def open_browser():
        time.sleep(1.5)
        webbrowser.open("http://127.0.0.1:5000/")
    threading.Thread(target=open_browser, daemon=True).start()

    socketio.run(app, debug=not is_frozen, host='0.0.0.0', port=5000, use_reloader=not is_frozen)

