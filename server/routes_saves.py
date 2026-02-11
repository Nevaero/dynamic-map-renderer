# server/routes_saves.py
# Blueprint: SQLite save/load CRUD + auto-load

import os
import json
import copy
import time
import logging
import sqlite3
from uuid import uuid4

from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
import base64

from server import config
from server import state
from server import helpers
from server.map_gen import generate_player_map_bytes
from server.auth import gm_required

saves_bp = Blueprint('saves', __name__)

# Module-level socketio reference — set by init_saves()
_socketio = None


def init_saves(socketio_instance):
    """Called from create_app() to provide the socketio reference."""
    global _socketio
    _socketio = socketio_instance


# --- SQLite helpers ---

def _init_saves_db():
    """Create saves table and migrate any legacy JSON save files."""
    conn = sqlite3.connect(config.SAVES_DB_PATH)
    try:
        conn.execute('''CREATE TABLE IF NOT EXISTS saves (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            map_filename TEXT,
            state TEXT,
            tokens TEXT
        )''')
        conn.commit()
    finally:
        conn.close()

    # Migrate legacy JSON saves if they exist
    if os.path.isdir(config.SAVES_FOLDER_LEGACY):
        json_files = [f for f in os.listdir(config.SAVES_FOLDER_LEGACY) if f.endswith('.json')]
        if json_files:
            logging.info(f"Migrating {len(json_files)} legacy JSON save(s) to SQLite...")
            migrated = 0
            conn = sqlite3.connect(config.SAVES_DB_PATH)
            try:
                for fname in json_files:
                    fpath = os.path.join(config.SAVES_FOLDER_LEGACY, fname)
                    try:
                        with open(fpath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        conn.execute(
                            'INSERT OR IGNORE INTO saves (id, name, created_at, modified_at, map_filename, state, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            (
                                data.get('id', fname.replace('.json', '')),
                                data.get('name', 'Unnamed'),
                                data.get('created_at', ''),
                                data.get('modified_at', ''),
                                data.get('map_filename', ''),
                                json.dumps(data.get('state', {}), ensure_ascii=False),
                                json.dumps(data.get('tokens', []), ensure_ascii=False),
                            )
                        )
                        migrated += 1
                    except Exception as e:
                        logging.warning(f"Could not migrate save file {fname}: {e}")
                conn.commit()
            finally:
                conn.close()
            if migrated > 0:
                migrated_dir = config.SAVES_FOLDER_LEGACY + '_migrated'
                try:
                    os.rename(config.SAVES_FOLDER_LEGACY, migrated_dir)
                    logging.info(f"Migrated {migrated} save(s). Old folder renamed to {migrated_dir}")
                except OSError as e:
                    logging.warning(f"Could not rename saves folder after migration: {e}")


def _get_db():
    """Return a short-lived SQLite connection."""
    conn = sqlite3.connect(config.SAVES_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _read_save(save_id):
    """Read a save by ID, returning a dict or None."""
    conn = _get_db()
    try:
        row = conn.execute('SELECT * FROM saves WHERE id = ?', (save_id,)).fetchone()
        if not row:
            return None
        return {
            'id': row['id'],
            'name': row['name'],
            'created_at': row['created_at'],
            'modified_at': row['modified_at'],
            'map_filename': row['map_filename'],
            'state': json.loads(row['state']) if row['state'] else {},
            'tokens': json.loads(row['tokens']) if row['tokens'] else [],
        }
    except Exception as e:
        logging.error(f"Error reading save {save_id}: {e}")
        return None
    finally:
        conn.close()


def _write_save(save_data):
    """Insert or replace a save. Returns True on success."""
    conn = _get_db()
    try:
        conn.execute(
            'INSERT OR REPLACE INTO saves (id, name, created_at, modified_at, map_filename, state, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (
                save_data['id'],
                save_data['name'],
                save_data['created_at'],
                save_data['modified_at'],
                save_data.get('map_filename', ''),
                json.dumps(save_data.get('state', {}), ensure_ascii=False),
                json.dumps(save_data.get('tokens', []), ensure_ascii=False),
            )
        )
        conn.commit()
        return True
    except Exception as e:
        logging.error(f"Error writing save {save_data.get('id')}: {e}")
        return False
    finally:
        conn.close()


def _delete_save(save_id):
    """Delete a save by ID. Returns True if a row was deleted."""
    conn = _get_db()
    try:
        cursor = conn.execute('DELETE FROM saves WHERE id = ?', (save_id,))
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        logging.error(f"Error deleting save {save_id}: {e}")
        return False
    finally:
        conn.close()


def _list_saves():
    """List all saves (summary info), ordered by modified_at DESC."""
    conn = _get_db()
    try:
        rows = conn.execute('SELECT id, name, created_at, modified_at, map_filename FROM saves ORDER BY modified_at DESC').fetchall()
        return [{'id': r['id'], 'name': r['name'], 'created_at': r['created_at'], 'modified_at': r['modified_at'], 'map_filename': r['map_filename']} for r in rows]
    except Exception as e:
        logging.error(f"Error listing saves: {e}")
        return []
    finally:
        conn.close()


# --- REST endpoints ---

@saves_bp.route('/api/saves', methods=['GET'])
def list_saves():
    """List all saves (summary info only)."""
    return jsonify(_list_saves())


@saves_bp.route('/api/saves', methods=['POST'])
@gm_required
def create_save():
    """Create a new save from current state + tokens."""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    body = request.get_json()
    name = body.get('name', 'Unnamed Save').strip()
    if not name:
        name = 'Unnamed Save'

    state_snapshot = copy.deepcopy(state.current_state) if state.current_state else helpers.get_default_session_state()
    tokens_snapshot = copy.deepcopy(state.current_tokens) if state.current_tokens else []

    original_map_path = state_snapshot.get('original_map_path') or state_snapshot.get('map_content_path', '')
    map_filename = os.path.basename(original_map_path) if original_map_path else ''

    state_to_save = copy.deepcopy(state_snapshot)
    state_to_save.pop('original_map_path', None)

    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    save_id = f"sav_{int(time.time() * 1000)}_{uuid4().hex[:5]}"
    save_data = {
        'id': save_id,
        'name': name,
        'created_at': now,
        'modified_at': now,
        'map_filename': map_filename,
        'state': state_to_save,
        'tokens': tokens_snapshot,
    }

    if _write_save(save_data):
        state.current_save_id = save_id
        logging.info(f"Save created: {save_id} ({name})")
        return jsonify(save_data), 201
    else:
        return jsonify({"error": "Could not write save"}), 500


@saves_bp.route('/api/saves/<save_id>', methods=['GET'])
def get_save(save_id):
    """Get full save data."""
    data = _read_save(save_id)
    if data is None:
        return jsonify({"error": "Save not found"}), 404
    return jsonify(data)


@saves_bp.route('/api/saves/<save_id>', methods=['PUT'])
@gm_required
def update_save(save_id):
    """Update save: rename via {name}, or overwrite state via {state, tokens}."""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    existing = _read_save(save_id)
    if existing is None:
        return jsonify({"error": "Save not found"}), 404
    body = request.get_json()

    if 'name' in body:
        existing['name'] = body['name'].strip() or existing['name']

    if 'state' in body:
        existing['state'] = body['state']
        map_path = body['state'].get('map_content_path', '')
        existing['map_filename'] = os.path.basename(map_path) if map_path else existing.get('map_filename', '')

    if 'tokens' in body:
        existing['tokens'] = body['tokens']

    existing['modified_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

    if _write_save(existing):
        logging.info(f"Save updated: {save_id}")
        return jsonify(existing)
    else:
        return jsonify({"error": "Could not write save"}), 500


@saves_bp.route('/api/saves/<save_id>', methods=['DELETE'])
@gm_required
def delete_save(save_id):
    """Delete a save."""
    if not _delete_save(save_id):
        return jsonify({"error": "Save not found"}), 404
    if state.current_save_id == save_id:
        state.current_save_id = None
    logging.info(f"Save deleted: {save_id}")
    return jsonify({"success": True})


@saves_bp.route('/api/saves/<save_id>/load', methods=['POST'])
@gm_required
def load_save(save_id):
    """Load a save into current game state and broadcast to all players."""
    save_data = _read_save(save_id)
    if save_data is None:
        return jsonify({"error": "Save not found"}), 404

    saved_state = save_data.get('state', {})
    saved_tokens = save_data.get('tokens', [])
    map_filename = save_data.get('map_filename', '')

    if map_filename:
        map_path_on_disk = os.path.join(config.MAPS_FOLDER, secure_filename(map_filename))
        if not os.path.exists(map_path_on_disk):
            return jsonify({"error": f"Map file '{map_filename}' no longer exists"}), 400

    loaded_state = copy.deepcopy(saved_state)
    map_content_path = loaded_state.get('map_content_path', '')
    loaded_state['original_map_path'] = map_content_path
    loaded_state['display_type'] = 'image'

    # Normalize map_content_path to binary sentinel so metadata-only broadcasts
    # never expose the raw file path to players (which would bypass fog compositing).
    has_map = bool(loaded_state.get('original_map_path'))
    loaded_state['map_content_path'] = 'binary://' if has_map else None

    state.current_state = loaded_state
    state.current_tokens = copy.deepcopy(saved_tokens)
    state.current_save_id = save_id
    logging.info(f"Save loaded: {save_id} — map={map_filename}, tokens={len(state.current_tokens)}")

    image_bytes = None
    if has_map:
        image_bytes = generate_player_map_bytes(state.current_state)

    state_to_send = copy.deepcopy(state.current_state)
    state_to_send.pop('original_map_path', None)
    state_to_send['map_content_path'] = 'binary://' if image_bytes else None
    _socketio.emit('state_update', state_to_send, room=config.ROOM_NAME)
    if image_bytes:
        b64_data = base64.b64encode(image_bytes).decode('ascii')
        _socketio.emit('map_image_data', {'b64': b64_data}, room=config.ROOM_NAME)
    _socketio.emit('tokens_update', {'tokens': state.current_tokens}, room=config.ROOM_NAME)

    return jsonify({"success": True, "save": save_data})


@saves_bp.route('/api/saves/current', methods=['GET'])
def get_current_save_id():
    """Return the ID and name of the currently loaded save (if any)."""
    name = None
    if state.current_save_id:
        data = _read_save(state.current_save_id)
        if data:
            name = data.get('name')
    return jsonify({"current_save_id": state.current_save_id, "current_save_name": name})


def _auto_load_latest_save():
    """Load the most recently modified save into memory on startup (no broadcast)."""
    conn = _get_db()
    try:
        row = conn.execute('SELECT * FROM saves ORDER BY modified_at DESC LIMIT 1').fetchone()
        if not row:
            logging.info("No saves found — starting fresh.")
            return
        save_id = row['id']
        saved_state = json.loads(row['state']) if row['state'] else {}
        saved_tokens = json.loads(row['tokens']) if row['tokens'] else []
        map_filename = row['map_filename'] or ''

        if map_filename:
            map_path_on_disk = os.path.join(config.MAPS_FOLDER, secure_filename(map_filename))
            if not os.path.exists(map_path_on_disk):
                logging.warning(f"Auto-load: map '{map_filename}' no longer exists, skipping save {save_id}.")
                return

        loaded_state = copy.deepcopy(saved_state)
        map_content_path = loaded_state.get('map_content_path', '')
        loaded_state['original_map_path'] = map_content_path
        loaded_state['display_type'] = 'image'
        # Normalize to binary sentinel so metadata-only broadcasts never leak the raw path
        has_map = bool(map_content_path)
        loaded_state['map_content_path'] = 'binary://' if has_map else None

        state.current_state = loaded_state
        state.current_tokens = copy.deepcopy(saved_tokens)
        state.current_save_id = save_id
        logging.info(f"Auto-loaded save: {save_id} ({row['name']}) — map={map_filename}, tokens={len(state.current_tokens)}")
    except Exception as e:
        logging.error(f"Error auto-loading latest save: {e}", exc_info=True)
    finally:
        conn.close()
