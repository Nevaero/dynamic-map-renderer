# server/filters.py
# Filter loading from GLSL shader directories

import os
import json
import logging

from server import config

available_filters = {}


def load_single_filter(filter_id):
    filter_dir = os.path.join(config.FILTERS_FOLDER, filter_id); config_path = os.path.join(filter_dir, 'config.json'); vertex_path = os.path.join(filter_dir, 'vertex.glsl'); fragment_path = os.path.join(filter_dir, 'fragment.glsl')
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
    global available_filters; logging.info(f"Scanning for filters in: {config.FILTERS_FOLDER}"); loaded_filters = {}
    if not os.path.isdir(config.FILTERS_FOLDER): logging.warning(f"Filters dir not found: {config.FILTERS_FOLDER}"); return
    for item in os.listdir(config.FILTERS_FOLDER):
        item_path = os.path.join(config.FILTERS_FOLDER, item)
        if os.path.isdir(item_path):
            filter_id = item; filter_data = load_single_filter(filter_id)
            if filter_data: loaded_filters[filter_id] = filter_data; logging.info(f"  - Loaded: {filter_data['name']} ({filter_id})")
    available_filters = loaded_filters; logging.info(f"Total filters loaded: {len(available_filters)}")
