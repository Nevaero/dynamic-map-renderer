# server/state.py
# Shared mutable globals — accessed via `from server import state` then `state.X`

current_state = None      # dict or None
current_tokens = []       # [token_dict, ...]
current_save_id = None    # ID of the currently loaded save file
