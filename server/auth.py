# server/auth.py
# Shared GM authentication decorator

from functools import wraps
from flask import session, jsonify


def gm_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('is_gm'):
            return jsonify({"error": "Forbidden"}), 403
        return f(*args, **kwargs)
    return decorated
