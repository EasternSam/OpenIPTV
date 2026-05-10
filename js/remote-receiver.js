/* ══════════════════════════════════════════════════════════════
   OpenIPTV - Remote Receiver (TV Side) — Redesigned
   Handles commands, keyboard input, and context-aware state
   ══════════════════════════════════════════════════════════════ */

const RemoteReceiver = {

    code: null,
    eventSource: null,
    connected: false,
    phoneConnected: false,
    stateReportInterval: null,
    _remoteMode: false,

    /* ─── Start Pairing ─── */
    async startPairing() {
        if (this.code && this.phoneConnected) {
            this._showPairOverlay(this.code);
            this._updateOverlayStatus(true);
            return this.code;
        }

        this.stop();

        try {
            const res = await fetch('/api/remote/pair', { method: 'POST' });
            const data = await res.json();
            this.code = data.code;
            this._showPairOverlay(this.code);
            this._connectSSE(this.code);
            return this.code;
        } catch (err) {
            console.error('Pairing failed:', err);
            if (typeof App !== 'undefined') App._toast('❌ Error al generar código');
            return null;
        }
    },

    /* ─── SSE Connection ─── */
    _connectSSE(code) {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        this.eventSource = new EventSource(`/api/remote/tv-connect?code=${code}`);
        this.connected = true;

        this.eventSource.addEventListener('connected', () => {
            console.log('📺 SSE connected');
        });

        this.eventSource.addEventListener('phone-connected', () => {
            console.log('📱 Phone connected!');
            this.phoneConnected = true;
            this._updateOverlayStatus(true);
            this._enterRemoteMode();
            if (typeof App !== 'undefined') App._toast('📱 Control remoto conectado');

            // Send channel list to phone
            setTimeout(() => this._reportState(), 500);
        });

        this.eventSource.addEventListener('command', (e) => {
            try {
                const { command, data } = JSON.parse(e.data);
                this._handleCommand(command, data);
            } catch (err) {
                console.warn('Invalid command:', err);
            }
        });

        this.eventSource.onerror = () => {
            console.warn('SSE reconnecting...');
        };

        this._startStateReporting();
    },

    /* ─── Enter Remote Mode (change TV UI) ─── */
    _enterRemoteMode() {
        if (this._remoteMode) return;
        this._remoteMode = true;

        document.body.classList.add('remote-mode');

        // Show remote indicator
        let indicator = document.getElementById('remote-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'remote-indicator';
            indicator.className = 'remote-indicator';
            indicator.innerHTML = '📱 Control remoto conectado';
            document.body.appendChild(indicator);

            // Auto-hide after 3s
            setTimeout(() => indicator.classList.add('fade'), 3000);
        }

        // Hide pair overlay
        setTimeout(() => this.hidePairOverlay(), 1000);
    },

    _exitRemoteMode() {
        this._remoteMode = false;
        document.body.classList.remove('remote-mode');
        const indicator = document.getElementById('remote-indicator');
        if (indicator) indicator.remove();
    },

    /* ─── Handle Commands ─── */
    _handleCommand(command, data) {
        // Close pair overlay on any command
        if (!document.getElementById('pair-overlay')?.classList.contains('hidden')) {
            this.hidePairOverlay();
        }

        switch (command) {
            case 'navigate':
                this._simulateKey(data.direction);
                break;
            case 'enter':
                this._simulateKey('enter');
                break;
            case 'back':
                this._simulateKey('back');
                break;

            case 'play-pause':
                if (typeof Player !== 'undefined') Player.togglePause();
                break;
            case 'stop':
                if (typeof Player !== 'undefined') Player.stop();
                if (typeof App !== 'undefined') App._showVideoContainer(false);
                break;

            case 'channel-up':
                if (typeof App !== 'undefined') App.nextChannel();
                break;
            case 'channel-down':
                if (typeof App !== 'undefined') App.prevChannel();
                break;
            case 'number':
                if (typeof Navigation !== 'undefined') Navigation._handleNumberInput(data.number);
                break;

            // Play specific channel by URL
            case 'play-channel':
                if (typeof App !== 'undefined' && data.url) {
                    const ch = App.channels.find(c => c.url === data.url);
                    if (ch) App.playChannel(ch);
                }
                break;

            case 'volume-up':
                if (typeof Player !== 'undefined') Player.setVolume(Player.getVolume() + 5);
                break;
            case 'volume-down':
                if (typeof Player !== 'undefined') Player.setVolume(Player.getVolume() - 5);
                break;
            case 'mute':
                if (typeof Player !== 'undefined') Player.toggleMute();
                break;

            case 'fullscreen':
                if (typeof Player !== 'undefined') Player.toggleFullscreen();
                break;
            case 'toggle-sidebar':
                if (typeof App !== 'undefined') App._toggleSidebar();
                break;
            case 'favorite':
                document.getElementById('btn-favorite')?.click();
                break;
            case 'load-url':
                if (typeof App !== 'undefined') App._showModal('modal-url');
                break;
            case 'settings':
                if (typeof App !== 'undefined') {
                    App._showModal('modal-settings');
                    App._loadSettingsUI();
                }
                break;

            // ── Mobile Control Center commands ──
            case 'load-playlist-url':
                if (typeof App !== 'undefined' && data.url) {
                    App.loadPlaylistFromUrl(data.url);
                }
                break;
            case 'remove-playlist':
                if (typeof App !== 'undefined' && data.url) {
                    App._removeLoadedPlaylist(data.url);
                }
                break;
            case 'set-volume':
                if (typeof Player !== 'undefined' && data.volume != null) {
                    Player.setVolume(data.volume);
                }
                break;
            case 'update-settings':
                if (typeof Storage !== 'undefined' && data) {
                    Storage.updateSettings(data);
                    if (typeof App !== 'undefined') App._toast('⚙️ Configuración actualizada desde el móvil');
                }
                break;
            case 'clear-favorites':
                if (typeof Storage !== 'undefined') {
                    Storage.clearFavorites();
                    if (typeof App !== 'undefined') { App._renderChannels(); App._toast('Favoritos borrados'); }
                }
                break;
            case 'clear-recents':
                if (typeof Storage !== 'undefined') {
                    Storage.clearRecents();
                    if (typeof App !== 'undefined') { App._renderChannels(); App._toast('Recientes borrados'); }
                }
                break;
            case 'clear-all':
                if (typeof Storage !== 'undefined') {
                    Storage.clearAll();
                    if (typeof App !== 'undefined') {
                        App.channels = []; App.filteredChannels = []; App.groups = [];
                        App._renderChannels(); App._renderGroups(); App._updateChannelCount();
                        App._toast('Todos los datos borrados');
                    }
                }
                break;

            // Keyboard commands
            case 'type-text':
                this._handleTypeText(data);
                break;
            case 'type-key':
                this._handleTypeKey(data);
                break;
            case 'clear-text':
                this._handleClearText();
                break;
        }
    },

    /* ─── Keyboard Handling ─── */
    _handleTypeText(data) {
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
            if (data.append) {
                // Append text at cursor
                const start = focused.selectionStart;
                const end = focused.selectionEnd;
                const val = focused.value;
                focused.value = val.substring(0, start) + data.text + val.substring(end);
                focused.selectionStart = focused.selectionEnd = start + data.text.length;
            } else {
                focused.value = data.text;
            }
            // Trigger input event so the app reacts
            focused.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            // Try to find the first visible input and focus it
            const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="range"]), textarea');
            for (const inp of inputs) {
                if (inp.offsetParent !== null) {
                    inp.focus();
                    inp.value = data.text;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    break;
                }
            }
        }
    },

    _handleTypeKey(data) {
        const keyMap = {
            'Enter': { key: 'Enter', keyCode: 13 },
            'Backspace': { key: 'Backspace', keyCode: 8 },
            'Tab': { key: 'Tab', keyCode: 9 },
            'Escape': { key: 'Escape', keyCode: 27 },
            ' ': { key: ' ', keyCode: 32 },
        };

        const mapped = keyMap[data.key];
        if (mapped) {
            // If there's a focused input and it's Backspace, delete char
            const focused = document.activeElement;
            if (data.key === 'Backspace' && focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
                const start = focused.selectionStart;
                if (start > 0) {
                    focused.value = focused.value.substring(0, start - 1) + focused.value.substring(focused.selectionEnd);
                    focused.selectionStart = focused.selectionEnd = start - 1;
                    focused.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return;
            }

            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: mapped.key,
                keyCode: mapped.keyCode,
                which: mapped.keyCode,
                bubbles: true,
                cancelable: true,
            }));
        }
    },

    _handleClearText() {
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
            focused.value = '';
            focused.dispatchEvent(new Event('input', { bubbles: true }));
        }
    },

    /* ─── Simulate Keyboard for Navigation ─── */
    _simulateKey(direction) {
        const keyMap = {
            'up':    { key: 'ArrowUp',    keyCode: 38 },
            'down':  { key: 'ArrowDown',  keyCode: 40 },
            'left':  { key: 'ArrowLeft',  keyCode: 37 },
            'right': { key: 'ArrowRight', keyCode: 39 },
            'enter': { key: 'Enter',      keyCode: 13 },
            'back':  { key: 'Backspace',  keyCode: 8  },
        };

        const mapped = keyMap[direction];
        if (!mapped) return;

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: mapped.key,
            keyCode: mapped.keyCode,
            which: mapped.keyCode,
            bubbles: true,
            cancelable: true,
        }));
    },

    /* ─── Report TV State ─── */
    _startStateReporting() {
        clearInterval(this.stateReportInterval);
        this.stateReportInterval = setInterval(() => this._reportState(), 2500);
    },

    async _reportState() {
        if (!this.code) return;

        // Check if a text input is focused
        const focused = document.activeElement;
        const needsKeyboard = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA') && focused.type !== 'range';

        // Build channel list (lightweight)
        let channelList = [];
        if (typeof App !== 'undefined' && App.channels) {
            channelList = App.channels.map(c => ({
                number: c.number,
                name: c.name,
                group: c.group || '',
                url: c.url,
                logo: c.logo || '',
            }));
        }

        // Build playlists info
        let playlistsInfo = [];
        if (typeof App !== 'undefined' && App.loadedPlaylists) {
            const saved = (typeof Storage !== 'undefined') ? Storage.getSavedPlaylists() : [];
            for (const pl of saved) {
                playlistsInfo.push({
                    url: pl.url,
                    name: pl.name || 'Playlist',
                    loaded: App.loadedPlaylists.has(pl.url),
                });
            }
        }

        // Favorites & Recents
        let favorites = [];
        let recents = [];
        if (typeof Storage !== 'undefined') {
            favorites = Storage.getFavorites() || [];
            recents = Storage.getRecents() || [];
        }

        const currentCh = (typeof Player !== 'undefined') ? Player.currentChannel : null;

        const state = {
            channelName: currentCh ? currentCh.name : null,
            channelNumber: currentCh ? currentCh.number : null,
            channelGroup: currentCh ? (currentCh.group || '') : '',
            channelUrl: currentCh ? currentCh.url : null,
            playing: (typeof Player !== 'undefined') ? Player.isPlaying : false,
            muted: (typeof Player !== 'undefined') ? !!Player.isMuted : false,
            volume: (typeof Player !== 'undefined') ? Player.getVolume() : 0,
            signalQuality: (typeof Player !== 'undefined') ? (Player.signalQuality || 'none') : 'none',
            needsKeyboard,
            channels: channelList,
            playlists: playlistsInfo,
            favorites,
            recents,
        };

        try {
            await fetch('/api/remote/tv-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: this.code, state }),
            });
        } catch {}
    },

    /* ─── Pairing Overlay ─── */
    _showPairOverlay(code) {
        const overlay = document.getElementById('pair-overlay');
        const codeEl = document.getElementById('pair-code');
        const urlEl = document.getElementById('pair-url');
        if (!overlay) return;

        const host = window.location.hostname;
        const port = window.location.port;
        if (codeEl) codeEl.textContent = code;
        if (urlEl) urlEl.textContent = `http://${host}${port ? ':' + port : ''}/remote`;

        this._updateOverlayStatus(this.phoneConnected);
        overlay.classList.remove('hidden');
    },

    _updateOverlayStatus(isConnected) {
        const el = document.getElementById('pair-status');
        if (!el) return;
        el.innerHTML = isConnected
            ? '<span style="color:#22c55e;font-weight:600;">✅ Celular conectado</span>'
            : '<span class="pair-waiting">Esperando conexión...</span>';
    },

    hidePairOverlay() {
        document.getElementById('pair-overlay')?.classList.add('hidden');
    },

    /* ─── Stop ─── */
    stop() {
        if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
        clearInterval(this.stateReportInterval);
        this.code = null;
        this.connected = false;
        this.phoneConnected = false;
        this._exitRemoteMode();
        this.hidePairOverlay();
    },
};
