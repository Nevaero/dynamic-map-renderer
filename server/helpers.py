# server/helpers.py
# Map config I/O, state builders, merge_dicts

import os
import json
import copy
import logging

from werkzeug.utils import secure_filename

from server import config
from server import filters


def allowed_map_file(filename):
    if not filename: return False
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in config.ALLOWED_MAP_EXTENSIONS


def get_map_config_path(map_filename):
    secured_base = secure_filename(map_filename); config_filename = f"{secured_base}_config.json"; return os.path.join(config.CONFIGS_FOLDER, config_filename)


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
        try:
            if 'map_content_path' not in config_data and 'map_image_path' in config_data: config_data['map_content_path'] = config_data.pop('map_image_path')
            config_data['display_type'] = "image"
            if 'map_content_path' not in config_data:
                expected_path = os.path.join('maps', secure_filename(map_filename)).replace('\\', '/')
                if os.path.exists(os.path.join(config.MAPS_FOLDER, secure_filename(map_filename))): config_data['map_content_path'] = expected_path
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
    try:
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


def get_default_filter_params():
    filter_params = {}; text_params = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize']
    for f_id, f_config in filters.available_filters.items():
        defaults = {};
        for key, param_data in f_config.get('params', {}).items():
            if 'value' in param_data and key not in text_params: defaults[key] = param_data['value']
        filter_params[f_id] = defaults
    return filter_params


def get_default_session_state():
    """
    Returns the default structure for a new session state.
    Attempts to load Help.png state if it exists.
    """
    logging.debug(f"Attempting to load default state, checking for {config.DEFAULT_HELP_MAP_FILENAME}")
    help_map_path = os.path.join(config.MAPS_FOLDER, config.DEFAULT_HELP_MAP_FILENAME)
    if os.path.exists(help_map_path):
        logging.info(f"Found {config.DEFAULT_HELP_MAP_FILENAME}, attempting to load its state as default.")
        default_state = get_state_for_map(config.DEFAULT_HELP_MAP_FILENAME)
        if default_state:
            logging.info(f"Using state from {config.DEFAULT_HELP_MAP_FILENAME} as default session state.")
            return default_state
        else:
            logging.warning(f"Found {config.DEFAULT_HELP_MAP_FILENAME} but failed to load/generate its state.")

    logging.info("Using generic default session state (no map loaded).")
    default_filter_id = "none" if "none" in filters.available_filters else list(filters.available_filters.keys())[0] if filters.available_filters else ""
    return {
        "original_map_path": None,
        "map_content_path": None,
        "display_type": "image",
        "current_filter": default_filter_id,
        "view_state": {"center_x": 0.5, "center_y": 0.5, "scale": 1.0},
        "filter_params": get_default_filter_params(),
        "fog_of_war": {"hidden_polygons": []}
    }


def get_state_for_map(map_filename):
    map_config = load_map_config(map_filename)
    if map_config:
        loaded_filter_params = map_config.get("filter_params", {}); default_filter_params = get_default_filter_params()
        for f_id, params in default_filter_params.items():
            if f_id not in loaded_filter_params: loaded_filter_params[f_id] = params
            else:
                for key, default_value in params.items():
                    if key not in loaded_filter_params[f_id]: loaded_filter_params[f_id][key] = default_value
        map_config["filter_params"] = loaded_filter_params
        if "view_state" not in map_config: map_config["view_state"] = {"center_x": 0.5, "center_y": 0.5, "scale": 1.0}
        if "fog_of_war" not in map_config: map_config["fog_of_war"] = {"hidden_polygons": []}
        map_config["display_type"] = "image"; map_config["original_map_path"] = map_config.get("map_content_path")
        logging.info(f"Loaded state for map: {map_filename}"); return map_config
    else:
        map_path_on_disk = os.path.join(config.MAPS_FOLDER, secure_filename(map_filename))
        if os.path.exists(map_path_on_disk) and allowed_map_file(map_filename):
            relative_path = os.path.join('maps', secure_filename(map_filename)).replace('\\', '/')
            logging.info(f"Generating default state for: {map_filename}.")
            generic_default_state = { "original_map_path": relative_path, "map_content_path": None, "display_type": "image",
                                      "current_filter": "none" if "none" in filters.available_filters else list(filters.available_filters.keys())[0] if filters.available_filters else "",
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
