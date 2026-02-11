# server/routes_core.py
# Blueprint: templates, file serving, filters, maps, config APIs

import os
import copy
import logging

from flask import Blueprint, request, jsonify, render_template, send_from_directory, send_file, make_response
from werkzeug.utils import secure_filename

from server import config
from server import filters
from server import helpers
from server import tunnel

core_bp = Blueprint('core', __name__)


@core_bp.route('/')
def index(): return render_template('index.html')


@core_bp.route('/player')
def player():
    return render_template('player.html')


@core_bp.route('/maps/<path:filename>')
def serve_map_image(filename):
    log_prefix = "[serve_map_image]"; logging.debug(f"{log_prefix} Request: {filename}"); safe_base_filename = secure_filename(filename)
    if safe_base_filename.startswith("generated_"): logging.warning(f"{log_prefix} Denying generated: {filename}"); return jsonify({"error": "Access denied"}), 403
    logging.debug(f"{log_prefix} Secured: {safe_base_filename}"); maps_dir = config.MAPS_FOLDER; filepath = os.path.join(maps_dir, safe_base_filename)
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


@core_bp.route('/generated_maps/<filename>')
def serve_generated_map(filename):
    log_prefix = "[serve_generated_map]"; logging.debug(f"{log_prefix} Route hit. Raw: '{filename}'"); safe_filename = secure_filename(filename)
    if safe_filename != filename: logging.warning(f"{log_prefix} Sanitized: '{safe_filename}'")
    generated_maps_dir = config.GENERATED_MAPS_FOLDER; filepath = os.path.join(generated_maps_dir, safe_filename)
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


@core_bp.route('/filters/<path:filter_id>/<shader_type>')
def serve_shader(filter_id, shader_type):
    logging.debug(f"Request shader: {filter_id}/{shader_type}"); secured_filter_id=secure_filename(filter_id); secured_shader_type=secure_filename(shader_type)
    if secured_shader_type not in ['vertex.glsl', 'fragment.glsl']: return jsonify({"error": "Invalid shader type"}), 400
    filters_dir=config.FILTERS_FOLDER; filter_subdir=os.path.join(filters_dir, secured_filter_id); shader_path=os.path.join(filter_subdir, secured_shader_type)
    logging.debug(f"Serving shader from: {shader_path}")
    try:
        if not os.path.abspath(shader_path).startswith(os.path.abspath(filters_dir)): raise FileNotFoundError
        if not os.path.exists(shader_path): raise FileNotFoundError
        return send_from_directory(filter_subdir, secured_shader_type, mimetype='text/plain')
    except FileNotFoundError: logging.error(f"Shader not found: {filter_id}/{shader_type}")
    except Exception as e: logging.error(f"Error serving shader {filter_id}/{shader_type}: {e}", exc_info=True)
    return jsonify({"error": "Shader not found or error"}), 404


@core_bp.route('/api/filters', methods=['GET'])
def get_filters():
    client_safe_filters = {}; text_params = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize']
    for f_id, f_config in filters.available_filters.items():
        safe_config = {k: v for k, v in f_config.items() if k not in ['vertex_shader_path', 'fragment_shader_path']}
        if 'params' in safe_config: params_copy = copy.deepcopy(safe_config['params']); [params_copy.pop(key, None) for key in text_params]; safe_config['params'] = params_copy
        client_safe_filters[f_id] = safe_config
    return jsonify(client_safe_filters)


@core_bp.route('/api/lan-info', methods=['GET'])
def get_lan_info():
    return jsonify({"ip": config.LAN_IP, "port": 5000})


@core_bp.route('/api/tunnel-info', methods=['GET'])
def get_tunnel_info():
    return jsonify(tunnel.get_tunnel_info())


@core_bp.route('/api/maps', methods=['GET'])
def list_map_content():
    try:
        maps_dir = config.MAPS_FOLDER
        if not os.path.isdir(maps_dir): logging.error(f"Maps directory not found: {maps_dir}"); return jsonify([])
        content_files = [f for f in os.listdir(maps_dir) if os.path.isfile(os.path.join(maps_dir, f)) and helpers.allowed_map_file(f) and not f.startswith('generated_')]
        return jsonify(sorted(content_files))
    except Exception as e: logging.error(f"Error listing map content in {config.MAPS_FOLDER}: {e}", exc_info=True); return jsonify({"error": "Server error listing maps"}), 500


@core_bp.route('/api/maps', methods=['POST'])
def upload_map_content():
    if 'mapFile' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['mapFile'];
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    if file and helpers.allowed_map_file(file.filename):
        filename = secure_filename(file.filename); save_path = os.path.join(config.MAPS_FOLDER, filename); config_path = helpers.get_map_config_path(filename)
        try:
            file.save(save_path); logging.info(f"Map uploaded: {save_path}")
            if not os.path.exists(config_path) and not os.path.exists(config_path + ".bak"):
                 logging.info(f"Creating default config for {filename}."); default_state = helpers.get_state_for_map(filename)
                 if default_state:
                     if not helpers.save_map_config(filename, default_state): logging.warning(f"Failed save default config {filename}.")
                     else: logging.info(f"Default config saved {filename}")
                 else: logging.warning(f"Could not generate default state {filename}.")
            else: logging.info(f"Config exists {filename}.")
            return jsonify({"success": True, "filename": filename}), 201
        except Exception as e: logging.error(f"Error saving map '{filename}': {e}", exc_info=True); return jsonify({"error": "Could not save map"}), 500
    else: logging.warning(f"Upload rejected type: '{file.filename}'"); allowed_str = ', '.join(config.ALLOWED_MAP_EXTENSIONS); return jsonify({"error": f"Type not allowed. Allowed: {allowed_str}"}), 400


@core_bp.route('/api/config/<path:map_filename>', methods=['GET'])
def get_config(map_filename):
    secured_filename = secure_filename(map_filename); map_file_path = os.path.join(config.MAPS_FOLDER, secured_filename)
    if not helpers.allowed_map_file(secured_filename) or not os.path.exists(map_file_path): return jsonify({"error": "Map not found/invalid"}), 404
    map_state = helpers.get_state_for_map(secured_filename)
    if map_state: state_to_send = copy.deepcopy(map_state); state_to_send.pop('original_map_path', None); return jsonify(state_to_send)
    else: logging.error(f"Failed get/generate state {secured_filename}"); return jsonify({"error": "Could not get/generate config"}), 500


@core_bp.route('/api/config/<path:map_filename>', methods=['POST'])
def save_config_api(map_filename):
    secured_filename = secure_filename(map_filename); map_file_path = os.path.join(config.MAPS_FOLDER, secured_filename)
    if not helpers.allowed_map_file(secured_filename) or not os.path.exists(map_file_path): return jsonify({"error": "Map not found/invalid"}), 404
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    config_data = request.get_json(); required_keys = ["map_content_path", "current_filter", "view_state", "filter_params", "fog_of_war"]
    if not isinstance(config_data, dict) or not all(k in config_data for k in required_keys): return jsonify({"error": "Invalid config structure"}), 400
    fog_data = config_data.get("fog_of_war");
    if not isinstance(fog_data, dict) or not isinstance(fog_data.get("hidden_polygons"), list): return jsonify({"error": "Invalid fog structure"}), 400
    if helpers.save_map_config(secured_filename, config_data): logging.info(f"Config saved via API: {secured_filename}"); return jsonify({"success": True}), 200
    else: logging.error(f"Failed save config via API: {map_filename}"); return jsonify({"error": "Could not save config"}), 500
