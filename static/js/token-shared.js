// static/js/token-shared.js
// Shared token utilities for GM and Player views

(function () {
    'use strict';

    // --- Pure Utilities ---

    function getContrastColor(hexColor) {
        if (!hexColor || hexColor.length < 7) return '#ffffff';
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    function rgbToHex(r, g, b) {
        r = Math.max(0, Math.min(255, Math.round(r)));
        g = Math.max(0, Math.min(255, Math.round(g)));
        b = Math.max(0, Math.min(255, Math.round(b)));
        const componentToHex = (c) => {
            const hex = c.toString(16);
            return hex.length == 1 ? "0" + hex : hex;
        };
        return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b).toUpperCase();
    }

    // --- Socket Emit Wrappers ---

    function emitTokenPlace(socket, sessionId, label, color, x, y) {
        if (!socket || !socket.connected) return;
        socket.emit('token_place', {
            session_id: sessionId,
            token: { label: label, color: color, x: x, y: y }
        });
    }

    function emitTokenMove(socket, sessionId, tokenId, x, y) {
        if (!socket || !socket.connected) return;
        socket.emit('token_move', {
            session_id: sessionId,
            token_id: tokenId,
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y))
        });
    }

    function emitTokenRemove(socket, sessionId, tokenId) {
        if (!socket || !socket.connected) return;
        socket.emit('token_remove', {
            session_id: sessionId,
            token_id: tokenId
        });
    }

    function emitTokenUpdateColor(socket, sessionId, tokenId, color) {
        if (!socket || !socket.connected) return;
        socket.emit('token_update_color', {
            session_id: sessionId,
            token_id: tokenId,
            color: color
        });
    }

    // --- Socket Listener ---

    function onTokensUpdate(socket, callback) {
        if (!socket) return;
        socket.on('tokens_update', (data) => {
            if (data && Array.isArray(data.tokens)) {
                callback(data.tokens);
            }
        });
    }

    // --- UI Setup Helpers ---

    /**
     * setupTokenContextPopup(config)
     *
     * Wires Delete button, Color button + <input type="color">, click-outside dismiss.
     *
     * config: {
     *   popupEl,         - the popup container element
     *   deleteBtnEl,     - the Delete button element
     *   colorBtnEl,      - the Color button element
     *   colorInputEl,    - the <input type="color"> element
     *   getSocket,       - () => socket
     *   getSessionId,    - () => sessionId
     *   getSelectedId,   - () => selectedTokenId
     *   getTokens,       - () => tokens array
     *   onDismiss        - () => void, called when popup is dismissed
     * }
     */
    function setupTokenContextPopup(config) {
        const { popupEl, deleteBtnEl, colorBtnEl, colorInputEl,
                getSocket, getSessionId, getSelectedId, getTokens, onDismiss } = config;
        if (!popupEl) return;

        if (deleteBtnEl) {
            deleteBtnEl.addEventListener('click', () => {
                const selectedId = getSelectedId();
                if (selectedId) {
                    emitTokenRemove(getSocket(), getSessionId(), selectedId);
                }
                onDismiss();
            });
        }

        if (colorBtnEl && colorInputEl) {
            colorBtnEl.addEventListener('click', () => {
                const selectedId = getSelectedId();
                const token = getTokens().find(t => t.id === selectedId);
                if (token) colorInputEl.value = token.color || '#ff0000';
                colorInputEl.click();
            });
            colorInputEl.addEventListener('input', () => {
                const selectedId = getSelectedId();
                if (selectedId) {
                    emitTokenUpdateColor(getSocket(), getSessionId(), selectedId, colorInputEl.value);
                }
            });
            colorInputEl.addEventListener('change', () => {
                onDismiss();
            });
        }

        // Use mousedown instead of click so the dismiss fires at the start of
        // a *new* interaction, not as a trailing event of the interaction that
        // opened the popup (GM opens via mouseup → click would fire immediately).
        document.addEventListener('mousedown', (e) => {
            if (popupEl.style.display === 'block' && !popupEl.contains(e.target)) {
                onDismiss();
            }
        });
    }

    /**
     * setupColorSwatches(container, onColorSelected)
     *
     * Wires .token-color-swatch click handlers inside the container.
     * onColorSelected(color) is called with the selected hex color string.
     */
    function setupColorSwatches(container, onColorSelected) {
        if (!container) return;
        container.querySelectorAll('.token-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                container.querySelectorAll('.token-color-swatch').forEach(s => s.classList.remove('token-color-active'));
                swatch.classList.add('token-color-active');
                onColorSelected(color);
            });
        });
    }

    /**
     * setupLabelInput(inputEl, onLabelChanged)
     *
     * Wires label input with 2-char limit.
     * onLabelChanged(label) is called with the new label string.
     */
    function setupLabelInput(inputEl, onLabelChanged) {
        if (!inputEl) return;
        inputEl.addEventListener('input', () => {
            const label = inputEl.value.slice(0, 2) || 'A';
            onLabelChanged(label);
        });
    }

    // --- Expose API ---

    window.TokenShared = {
        getContrastColor: getContrastColor,
        rgbToHex: rgbToHex,
        emitTokenPlace: emitTokenPlace,
        emitTokenMove: emitTokenMove,
        emitTokenRemove: emitTokenRemove,
        emitTokenUpdateColor: emitTokenUpdateColor,
        onTokensUpdate: onTokensUpdate,
        setupTokenContextPopup: setupTokenContextPopup,
        setupColorSwatches: setupColorSwatches,
        setupLabelInput: setupLabelInput
    };
})();
