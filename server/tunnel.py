# server/tunnel.py
# Cloudflare tunnel management

import os
import sys
import re
import logging
import threading
import subprocess
import atexit

from server import config

_tunnel_process = None
_tunnel_url = None
_tunnel_error = None
_tunnel_lock = threading.Lock()


def _find_cloudflared():
    """Locate cloudflared binary: bundled (frozen) or project dir (dev)."""
    if getattr(sys, 'frozen', False):
        path = os.path.join(config.BUNDLE_DIR, 'cloudflared.exe')
    else:
        path = os.path.join(config.BUNDLE_DIR, 'cloudflared.exe')
    if os.path.isfile(path):
        return path
    return None


def _start_tunnel():
    """Start cloudflared quick-tunnel in a background thread."""
    global _tunnel_process, _tunnel_url, _tunnel_error
    cloudflared_path = _find_cloudflared()
    if not cloudflared_path:
        with _tunnel_lock:
            _tunnel_error = "cloudflared not found"
        logging.info("Cloudflared binary not found — tunnel unavailable.")
        return

    logging.info(f"Starting cloudflared tunnel from: {cloudflared_path}")
    try:
        creation_flags = 0
        if sys.platform == 'win32':
            creation_flags = subprocess.CREATE_NO_WINDOW
        proc = subprocess.Popen(
            [cloudflared_path, 'tunnel', '--url', 'http://localhost:5000'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creation_flags,
        )
        with _tunnel_lock:
            _tunnel_process = proc
        # cloudflared prints the URL to stderr
        url_pattern = re.compile(r'(https://[a-zA-Z0-9-]+\.trycloudflare\.com)')
        for line in proc.stderr:
            try:
                decoded = line.decode('utf-8', errors='replace').strip()
            except Exception:
                continue
            if decoded:
                logging.debug(f"[cloudflared] {decoded}")
            match = url_pattern.search(decoded)
            if match:
                with _tunnel_lock:
                    _tunnel_url = match.group(1)
                logging.info(f"Cloudflare tunnel URL: {_tunnel_url}")
                break
        # Keep reading stderr to prevent pipe buffer from blocking
        for line in proc.stderr:
            pass
    except Exception as e:
        logging.error(f"Cloudflared tunnel error: {e}", exc_info=True)
        with _tunnel_lock:
            _tunnel_error = str(e)


def _stop_tunnel():
    """Terminate cloudflared subprocess on exit."""
    global _tunnel_process
    with _tunnel_lock:
        proc = _tunnel_process
        _tunnel_process = None
    if proc and proc.poll() is None:
        logging.info("Stopping cloudflared tunnel...")
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def get_tunnel_info():
    """Return current tunnel status as a dict."""
    with _tunnel_lock:
        url = _tunnel_url
        error = _tunnel_error
    if url:
        return {"status": "connected", "url": url}
    elif error:
        return {"status": "error", "error": error}
    else:
        return {"status": "connecting"}


atexit.register(_stop_tunnel)
