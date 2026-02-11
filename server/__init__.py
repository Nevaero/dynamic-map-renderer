# server/__init__.py
# Application factory — creates Flask app + SocketIO

import os

from flask import Flask
from flask_socketio import SocketIO

from server import config
from server.filters import load_available_filters
from server.routes_core import core_bp
from server.routes_saves import saves_bp, init_saves, _init_saves_db
from server.sockets import register_socket_handlers

socketio = SocketIO()


def create_app():
    """Create and configure the Flask application."""
    app = Flask(__name__,
                static_folder=os.path.join(config.BUNDLE_DIR, 'static'),
                template_folder=os.path.join(config.BUNDLE_DIR, 'templates'))
    app.config['SECRET_KEY'] = os.urandom(24)

    # Initialize SocketIO
    socketio.init_app(app, cors_allowed_origins="*", async_mode='threading')

    # Load filters
    load_available_filters()

    # Initialize saves DB + migration
    _init_saves_db()

    # Provide socketio reference to saves blueprint
    init_saves(socketio)

    # Register blueprints
    app.register_blueprint(core_bp)
    app.register_blueprint(saves_bp)

    # Register socket event handlers
    register_socket_handlers(socketio)

    return app
