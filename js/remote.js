/* ══════════════════════════════════════════════════════════════
   OpenIPTV - Mobile Remote Control Logic (Redesigned)
   Context-aware, keyboard mode, channel list, anti-zoom
   ══════════════════════════════════════════════════════════════ */

const Remote = {

    code: null,
    connected: false,
    stateInterval: null,
    channels: [],
    currentMode: 'control',

    init() {
        this._blockZoom();
        this._bindPairingEvents();
        this._bindRemoteEvents();
        this._bindModes();
        this._bindKeyboard();
        this._bindChannelSearch();

        const saved = sessionStorage.getItem('openiptv_remote_code');
        if (saved) this._tryReconnect(saved);
    },

    /* ═══════════════════════════════
       ANTI-ZOOM
       ═══════════════════════════════ */

    _blockZoom() {
        // Block pinch zoom
        document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
        document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
        document.addEventListener('gestureend', e => e.preventDefault(), { passive: false });

        // Block ctrl+wheel zoom
        document.addEventListener('wheel', e => {
            if (e.ctrlKey) e.preventDefault();
        }, { passive: false });

        // Block double-tap zoom
        let lastTap = 0;
        document.addEventListener('touchend', e => {
            const now = Date.now();
            if (now - lastTap < 300) e.preventDefault();
            lastTap = now;
        }, { passive: false });
    },

    /* ═══════════════════════════════
       PAIRING
       ═══════════════════════════════ */

    _bindPairingEvents() {
        const digits = document.querySelectorAll('.code-digit');
        const btn = document.getElementById('btn-connect');

        setTimeout(() => digits[0]?.focus(), 500);

        digits.forEach((input, i) => {
            input.addEventListener('input', e => {
                const v = e.target.value.replace(/\D/g, '');
                e.target.value = v.slice(-1);
                if (v && i < 3) digits[i + 1].focus();
                this._checkCode();
            });
            input.addEventListener('keydown', e => {
                if (e.key === 'Backspace' && !e.target.value && i > 0) {
                    digits[i - 1].focus();
                    digits[i - 1].value = '';
                }
                if (e.key === 'Enter') btn.click();
            });
            input.addEventListener('paste', e => {
                e.preventDefault();
                const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
                for (let j = 0; j < Math.min(t.length, 4); j++) digits[j].value = t[j];
                if (t.length >= 4) digits[3].focus();
                this._checkCode();
            });
        });

        btn.addEventListener('click', () => {
            const code = Array.from(digits).map(d => d.value).join('');
            if (code.length === 4) this._connect(code);
        });
    },

    _checkCode() {
        const code = Array.from(document.querySelectorAll('.code-digit')).map(d => d.value).join('');
        document.getElementById('btn-connect').disabled = code.length !== 4;
    },

    async _connect(code) {
        const err = document.getElementById('pair-error');
        const btn = document.getElementById('btn-connect');
        btn.disabled = true;
        btn.textContent = 'Conectando...';
        err.textContent = '';

        try {
            const r = await fetch(`/api/remote/check?code=${code}`);
            const d = await r.json();
            if (!d.valid) {
                err.textContent = '❌ Código inválido';
                btn.disabled = false;
                btn.textContent = 'Conectar';
                this._vibrate([50, 50, 50]);
                return;
            }

            await fetch('/api/remote/phone-connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

            this.code = code;
            this.connected = true;
            sessionStorage.setItem('openiptv_remote_code', code);

            document.getElementById('screen-pair').classList.remove('active');
            document.getElementById('screen-remote').classList.add('active');

            this._startStatePolling();
            this._fetchChannels();
            this._vibrate(100);
        } catch {
            err.textContent = '❌ Error de conexión';
            btn.disabled = false;
            btn.textContent = 'Conectar';
        }
    },

    async _tryReconnect(code) {
        try {
            const r = await fetch(`/api/remote/check?code=${code}`);
            const d = await r.json();
            if (d.valid) {
                await fetch('/api/remote/phone-connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code }),
                });
                this.code = code;
                this.connected = true;
                document.getElementById('screen-pair').classList.remove('active');
                document.getElementById('screen-remote').classList.add('active');
                this._startStatePolling();
                this._fetchChannels();
            } else {
                sessionStorage.removeItem('openiptv_remote_code');
            }
        } catch { sessionStorage.removeItem('openiptv_remote_code'); }
    },

    /* ═══════════════════════════════
       MODE TABS
       ═══════════════════════════════ */

    _bindModes() {
        document.querySelectorAll('.r-mode').forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                this.currentMode = mode;

                document.querySelectorAll('.r-mode').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                document.querySelectorAll('.r-mode-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`mode-${mode}`)?.classList.add('active');

                // Auto-focus keyboard input
                if (mode === 'keyboard') {
                    setTimeout(() => document.getElementById('r-kb-input')?.focus(), 200);
                }
            });
        });
    },

    /* Switch mode programmatically (e.g. when TV needs text) */
    switchToMode(mode) {
        document.querySelector(`.r-mode[data-mode="${mode}"]`)?.click();
    },

    /* ═══════════════════════════════
       REMOTE COMMANDS
       ═══════════════════════════════ */

    _bindRemoteEvents() {
        document.querySelectorAll('[data-cmd]').forEach(btn => {
            // Skip keyboard shortcuts (handled separately)
            if (btn.classList.contains('r-kb-sc')) return;

            btn.addEventListener('click', () => {
                const cmd = btn.dataset.cmd;
                const data = {};
                if (cmd === 'navigate') data.direction = btn.dataset.dir;
                if (cmd === 'number') data.number = parseInt(btn.dataset.num, 10);

                this._sendCommand(cmd, data);
                this._vibrate(25);
                this._flash(btn);
            });

            btn.addEventListener('contextmenu', e => e.preventDefault());
        });

        document.getElementById('btn-disconnect')?.addEventListener('click', () => this._disconnect());
    },

    async _sendCommand(command, data = {}) {
        if (!this.connected || !this.code) return;
        try {
            const r = await fetch('/api/remote/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: this.code, command, data }),
            });
            if (r.status === 404) this._handleTVDisconnect();
        } catch {}
    },

    _disconnect() {
        this.connected = false;
        this.code = null;
        this.channels = [];
        sessionStorage.removeItem('openiptv_remote_code');
        clearInterval(this.stateInterval);

        document.getElementById('screen-remote').classList.remove('active');
        document.getElementById('screen-pair').classList.add('active');
        document.querySelectorAll('.code-digit').forEach(d => { d.value = ''; });
        document.getElementById('pair-error').textContent = '';
        document.getElementById('btn-connect').disabled = true;
        document.getElementById('btn-connect').textContent = 'Conectar';
        setTimeout(() => document.querySelector('.code-digit')?.focus(), 300);
    },

    _handleTVDisconnect() {
        this._disconnect();
        document.getElementById('pair-error').textContent = '📺 La TV se desconectó';
    },

    /* ═══════════════════════════════
       KEYBOARD MODE
       ═══════════════════════════════ */

    _bindKeyboard() {
        // Send text button
        document.getElementById('r-kb-send')?.addEventListener('click', () => {
            const input = document.getElementById('r-kb-input');
            if (input && input.value) {
                this._sendCommand('type-text', { text: input.value });
                input.value = '';
                this._vibrate(50);
            }
        });

        // Clear
        document.getElementById('r-kb-clear')?.addEventListener('click', () => {
            this._sendCommand('clear-text', {});
            document.getElementById('r-kb-input').value = '';
        });

        // Enter key
        document.getElementById('r-kb-enter')?.addEventListener('click', () => {
            this._sendCommand('type-key', { key: 'Enter' });
            this._vibrate(30);
        });

        // Keyboard shortcuts (Backspace, Tab, Esc, Space)
        document.querySelectorAll('.r-kb-sc').forEach(btn => {
            btn.addEventListener('click', () => {
                this._sendCommand('type-key', { key: btn.dataset.key });
                this._vibrate(25);
                this._flash(btn);
            });
        });

        // Live typing - send each character as typed
        const kbInput = document.getElementById('r-kb-input');
        if (kbInput) {
            let lastLength = 0;
            kbInput.addEventListener('input', () => {
                const val = kbInput.value;
                // If text grew, send the new characters
                if (val.length > lastLength) {
                    const newChars = val.substring(lastLength);
                    this._sendCommand('type-text', { text: newChars, append: true });
                }
                lastLength = val.length;
            });
        }
    },

    /* ═══════════════════════════════
       CHANNELS MODE
       ═══════════════════════════════ */

    _bindChannelSearch() {
        const search = document.getElementById('r-ch-search');
        if (search) {
            search.addEventListener('input', () => {
                this._renderChannels(search.value.trim().toLowerCase());
            });
        }
    },

    async _fetchChannels() {
        try {
            const r = await fetch(`/api/remote/tv-state?code=${this.code}`);
            if (r.ok) {
                const state = await r.json();
                if (state.channels) {
                    this.channels = state.channels;
                    this._renderChannels();
                }
            }
        } catch {}
    },

    _renderChannels(filter = '') {
        const list = document.getElementById('r-ch-list');
        if (!list) return;

        let chs = this.channels;
        if (filter) {
            chs = chs.filter(c =>
                c.name.toLowerCase().includes(filter) ||
                c.group.toLowerCase().includes(filter) ||
                c.number.toString() === filter
            );
        }

        if (chs.length === 0) {
            list.innerHTML = '<p class="r-ch-empty">Sin canales</p>';
            return;
        }

        const max = 100;
        list.innerHTML = chs.slice(0, max).map(ch => `
            <div class="r-ch-item" data-url="${this._esc(ch.url)}">
                <span class="r-ch-num">${ch.number}</span>
                <span class="r-ch-name">${this._esc(ch.name)}</span>
                <span class="r-ch-group">${this._esc(ch.group)}</span>
            </div>
        `).join('');

        // Bind clicks
        list.querySelectorAll('.r-ch-item').forEach(item => {
            item.addEventListener('click', () => {
                this._sendCommand('play-channel', { url: item.dataset.url });
                this._vibrate(50);
                this.switchToMode('control');
            });
        });
    },

    _esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    },

    /* ═══════════════════════════════
       TV STATE POLLING
       ═══════════════════════════════ */

    _startStatePolling() {
        this._fetchTVState();
        this.stateInterval = setInterval(() => this._fetchTVState(), 2500);
    },

    async _fetchTVState() {
        if (!this.connected || !this.code) return;
        try {
            const r = await fetch(`/api/remote/tv-state?code=${this.code}`);
            if (r.ok) {
                const state = await r.json();
                this._updateUI(state);
            }
        } catch {}
    },

    _updateUI(state) {
        const name = document.getElementById('r-channel-name');
        if (name) name.textContent = state.channelName || '—';

        // Update channels if available
        if (state.channels && state.channels.length > 0 && this.channels.length === 0) {
            this.channels = state.channels;
            this._renderChannels();
        }

        // Auto-switch to keyboard if TV has a text input focused
        if (state.needsKeyboard && this.currentMode !== 'keyboard') {
            this.switchToMode('keyboard');
        }
    },

    /* ═══════════════════════════════
       HELPERS
       ═══════════════════════════════ */

    _vibrate(p) { if (navigator.vibrate) navigator.vibrate(p); },

    _flash(btn) {
        btn.classList.add('btn-flash');
        setTimeout(() => btn.classList.remove('btn-flash'), 120);
    },
};

document.addEventListener('DOMContentLoaded', () => Remote.init());
