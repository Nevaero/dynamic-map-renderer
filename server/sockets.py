# server/sockets.py
# All SocketIO event handlers

import os
import re
import json
import copy
import time
import base64
import logging
from uuid import uuid4

from flask import request, session
from flask_socketio import emit as socketio_emit, join_room, disconnect
from werkzeug.utils import secure_filename

from server import config
from server import state
from server import helpers
from server.map_gen import generate_player_map_bytes


def register_socket_handlers(sio):
    """Register all SocketIO event handlers on the given SocketIO instance."""

    @sio.on('connect')
    def handle_connect():
        logging.info(f"Client connected: {request.sid}")
        if session.get('is_gm'):
            if state.gm_socket_sid is not None:
                # Already have an active GM — reject this connection
                logging.warning(f"Rejected duplicate GM connection: {request.sid} (active GM: {state.gm_socket_sid})")
                disconnect()
                return
            state.gm_socket_sid = request.sid
            logging.info(f"GM socket registered: {request.sid}")

    @sio.on('disconnect')
    def handle_disconnect():
        logging.info(f"Client disconnected: {request.sid}")
        if request.sid == state.gm_socket_sid:
            state.gm_socket_sid = None
            logging.info("GM socket cleared.")

    @sio.on('join_game')
    def handle_join_game(data=None):
        """Handles a client joining the single game room."""
        join_room(config.ROOM_NAME)
        logging.info(f"Client {request.sid} joined room: {config.ROOM_NAME}")
        # Initialize state if needed
        if state.current_state is None:
            logging.info("Creating default state for game room.")
            state.current_state = helpers.get_default_session_state()
        # Generate image bytes in memory
        image_bytes = None
        if state.current_state.get('original_map_path'):
            image_bytes = generate_player_map_bytes(state.current_state)
        state_to_send = copy.deepcopy(state.current_state)
        state_to_send['map_content_path'] = 'binary://' if image_bytes else None
        state_to_send.pop('original_map_path', None)
        logging.info(f"Sending initial state to {request.sid}. Binary image: {len(image_bytes) if image_bytes else 0} bytes")
        socketio_emit('state_update', state_to_send, to=request.sid)
        if image_bytes:
            b64_data = base64.b64encode(image_bytes).decode('ascii')
            socketio_emit('map_image_data', {'b64': b64_data}, to=request.sid)
        # Send current tokens
        socketio_emit('tokens_update', {'tokens': state.current_tokens}, to=request.sid)

    @sio.on('gm_update')
    def handle_gm_update(data):
        """Handles partial state updates received from the GM client."""
        if not session.get('is_gm'):
            logging.warning(f"Non-GM client {request.sid} tried to emit gm_update — rejected.")
            return
        if not isinstance(data, dict) or 'update_data' not in data: logging.warning("Invalid GM update."); return
        update_delta = data['update_data']
        # Initialize state if needed
        if state.current_state is None:
            logging.warning("GM update with no current state. Creating default.")
            state.current_state = helpers.get_default_session_state()
        logging.debug(f"Received GM update: {json.dumps(update_delta)}")
        try:
            current_authoritative_state = state.current_state
            original_map_path_before_update = current_authoritative_state.get('original_map_path')
            fog_changed = 'fog_of_war' in update_delta
            new_original_map_path = update_delta.get('map_content_path'); map_changed = False; state_to_merge_into = current_authoritative_state
            if new_original_map_path and new_original_map_path != original_map_path_before_update:
                map_filename = os.path.basename(new_original_map_path); map_path_on_disk = os.path.join(config.MAPS_FOLDER, secure_filename(map_filename))
                if os.path.exists(map_path_on_disk) and helpers.allowed_map_file(map_filename):
                    new_map_state = helpers.get_state_for_map(map_filename)
                    if new_map_state: state_to_merge_into = new_map_state; logging.info(f"Loaded state for new map '{map_filename}'."); map_changed = True
                    else: logging.error(f"Could not load state for map '{map_filename}'."); return
                else: logging.warning(f"GM sent invalid map path '{new_original_map_path}'."); return
            elif new_original_map_path is None and 'map_content_path' in update_delta:
                state_to_merge_into = helpers.get_default_session_state(); logging.info("Map reset."); map_changed = True
            if not map_changed:
                update_delta_copy = copy.deepcopy(update_delta); update_delta_copy.pop('map_content_path', None); updated_state = helpers.merge_dicts(state_to_merge_into, update_delta_copy)
            else: updated_state = helpers.merge_dicts(state_to_merge_into, update_delta)
            if map_changed: updated_state['original_map_path'] = new_original_map_path
            else: updated_state['original_map_path'] = original_map_path_before_update
            updated_state['display_type'] = 'image'

            image_bytes = None
            regenerate_image = map_changed or fog_changed
            if regenerate_image and updated_state.get('original_map_path'):
                logging.info(f"Regenerating map image (in memory) because map_changed={map_changed} or fog_changed={fog_changed}")
                image_bytes = generate_player_map_bytes(updated_state)

            updated_state['map_content_path'] = 'binary://' if image_bytes else current_authoritative_state.get('map_content_path')
            state.current_state = updated_state
            logging.debug("Authoritative state updated.")

            state_to_send = copy.deepcopy(updated_state)
            state_to_send.pop('original_map_path', None)
            if image_bytes:
                state_to_send['map_content_path'] = 'binary://'
                logging.info(f"Broadcasting update with {len(image_bytes)} bytes binary image.")
            elif not regenerate_image:
                state_to_send['map_content_path'] = current_authoritative_state.get('map_content_path')
                logging.debug("Broadcasting metadata-only update.")
            else:
                logging.warning("Broadcasting update with null map path (image generation failed).")
                state_to_send['map_content_path'] = None
            socketio_emit('state_update', state_to_send, room=config.ROOM_NAME)
            if image_bytes:
                b64_data = base64.b64encode(image_bytes).decode('ascii')
                socketio_emit('map_image_data', {'b64': b64_data}, room=config.ROOM_NAME)
            logging.debug("Broadcasted state_update.")
        except Exception as e: logging.error(f"Error processing GM update: {e}", exc_info=True)

    # --- Token Socket Event Handlers ---

    @sio.on('token_place')
    def handle_token_place(data):
        """Place a new token on the map."""
        if not isinstance(data, dict):
            return
        token_data = data.get('token')
        if not isinstance(token_data, dict):
            return
        label = str(token_data.get('label', 'A'))[:2]
        color = token_data.get('color', '#ff0000')
        x = token_data.get('x', 0.5)
        y = token_data.get('y', 0.5)
        if not isinstance(color, str) or not re.match(r'^#[0-9a-fA-F]{6}$', color):
            color = '#ff0000'
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
        state.current_tokens.append(new_token)
        logging.info(f"Token placed: {token_id} by {request.sid}")
        socketio_emit('tokens_update', {'tokens': state.current_tokens}, room=config.ROOM_NAME)

    @sio.on('token_move')
    def handle_token_move(data):
        """Move an existing token."""
        if not isinstance(data, dict):
            return
        token_id = data.get('token_id')
        x = data.get('x')
        y = data.get('y')
        if not token_id or x is None or y is None:
            return
        for token in state.current_tokens:
            if token['id'] == token_id:
                token['x'] = max(0.0, min(1.0, float(x)))
                token['y'] = max(0.0, min(1.0, float(y)))
                logging.debug(f"Token moved: {token_id} to ({token['x']:.3f}, {token['y']:.3f})")
                socketio_emit('tokens_update', {'tokens': state.current_tokens}, room=config.ROOM_NAME)
                return

    @sio.on('token_remove')
    def handle_token_remove(data):
        """Remove a token from the map."""
        if not isinstance(data, dict):
            return
        token_id = data.get('token_id')
        if not token_id:
            return
        before = len(state.current_tokens)
        state.current_tokens = [t for t in state.current_tokens if t['id'] != token_id]
        if len(state.current_tokens) < before:
            logging.info(f"Token removed: {token_id}")
            socketio_emit('tokens_update', {'tokens': state.current_tokens}, room=config.ROOM_NAME)

    @sio.on('token_update_color')
    def handle_token_update_color(data):
        """Update a token's color."""
        if not isinstance(data, dict):
            return
        token_id = data.get('token_id')
        color = data.get('color')
        if not token_id or not color:
            return
        if not isinstance(color, str) or not re.match(r'^#[0-9a-fA-F]{6}$', color):
            return
        for token in state.current_tokens:
            if token['id'] == token_id:
                token['color'] = color
                logging.info(f"Token color updated: {token_id} to {color}")
                socketio_emit('tokens_update', {'tokens': state.current_tokens}, room=config.ROOM_NAME)
                return
