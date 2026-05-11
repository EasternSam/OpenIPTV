/* ══════════════════════════════════════════════════════════════
   OpenIPTV — Mobile Control Center v8
   PHP Polling API — Compatible with Tizen Standalone App
   ══════════════════════════════════════════════════════════════ */

const Remote = {

    code: null,
    connected: false,
    stateInterval: null,
    channels: [],
    groups: [],
    currentTab: 'channels',
    currentCategory: 'all',
    currentGroup: null,
    currentChannel: null,
    isPlaying: false,

    init() {
        this._blockZoom();
        this._bindPairingEvents();
        this._bindBottomNav();
        this._bindRemoteEvents();
        this._bindChannelTab();
        this._bindPlaylistTab();

        const saved = localStorage.getItem('openiptv_remote_code');
        if (saved) this._tryReconnect(saved);
    },

    /* ═══════════════════════════════
       ANTI-ZOOM
       ═══════════════════════════════ */
    _blockZoom() {
        document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
        document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
        document.addEventListener('gestureend', e => e.preventDefault(), { passive: false });
        document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
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
                err.textContent = '❌ Código inválido o expirado';
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
            localStorage.setItem('openiptv_remote_code', code);

            document.getElementById('screen-pair').classList.remove('active');
            document.getElementById('screen-remote').classList.add('active');

            this._startStatePolling();
            this._vibrate(100);
            this._toast('✅ Conectado a la TV');
        } catch(e) {
            err.textContent = '❌ Error de conexión al servidor';
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
            } else {
                localStorage.removeItem('openiptv_remote_code');
            }
        } catch(e) { localStorage.removeItem('openiptv_remote_code'); }
    },

    /* ═══════════════════════════════
       BOTTOM NAV
       ═══════════════════════════════ */
    _bindBottomNav() {
        document.querySelectorAll('.r-nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.currentTab = tab;

                document.querySelectorAll('.r-nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.r-tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`tab-${tab}`)?.classList.add('active');

                if (tab === 'channels') this._renderChannels();
            });
        });
    },

    /* ═══════════════════════════════
       REMOTE COMMANDS
       ═══════════════════════════════ */
    _bindRemoteEvents() {
        document.querySelectorAll('[data-cmd]').forEach(btn => {
            if (btn.classList.contains('r-filter-pill')) return;
            if (btn.classList.contains('r-danger-btn')) return;

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
        } catch(e) {}
    },

    _disconnect() {
        this.connected = false;
        this.code = null;
        this.channels = [];
        localStorage.removeItem('openiptv_remote_code');
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
        document.getElementById('pair-error').textContent = '📺 La TV se desconectó. Genera un nuevo código.';
    },

    /* ═══════════════════════════════
       CHANNELS TAB
       ═══════════════════════════════ */
    _bindChannelTab() {
        document.querySelectorAll('.r-filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                this.currentCategory = pill.dataset.category;
                this.currentGroup = null;
                document.querySelectorAll('.r-filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this._renderChannels();
            });
        });

        const search = document.getElementById('r-ch-search');
        if (search) {
            let timer;
            search.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => this._renderChannels(), 200);
            });
        }
    },

    _renderChannels() {
        const list = document.getElementById('r-ch-list');
        if (!list) return;

        const search = (document.getElementById('r-ch-search')?.value || '').trim().toLowerCase();
        let chs = [...this.channels];

        // Group filter
        if (this.currentGroup) {
            chs = chs.filter(c => c.group === this.currentGroup);
        }

        // Search filter
        if (search) {
            chs = chs.filter(c =>
                c.name.toLowerCase().includes(search) ||
                (c.group || '').toLowerCase().includes(search) ||
                (c.num || '').toString() === search
            );
        }

        // Render groups bar
        this._renderGroups();

        if (chs.length === 0 && this.channels.length === 0) {
            list.innerHTML = `<div class="r-ch-empty-state">
                <div class="r-ch-empty-icon">📡</div>
                <p>Esperando canales de la TV...</p>
                <span class="r-ch-empty-sub">Asegúrate de tener una playlist cargada en la TV</span>
            </div>`;
            return;
        }

        if (chs.length === 0) {
            list.innerHTML = `<div class="r-ch-empty-state">
                <div class="r-ch-empty-icon">🔍</div>
                <p>Sin resultados</p>
                <span class="r-ch-empty-sub">Intenta con otro término de búsqueda</span>
            </div>`;
            return;
        }

        const currentUrl = this.currentChannel?.url || null;
        const max = 200;

        // Channel count header
        let html = `<div class="r-ch-count-bar">${chs.length} canal${chs.length !== 1 ? 'es' : ''}${this.currentGroup ? ' en ' + this._esc(this.currentGroup) : ''}</div>`;

        html += chs.slice(0, max).map(ch => {
            const playing = ch.url === currentUrl ? 'playing' : '';
            const logoHtml = ch.logo
                ? `<img class="r-ch-logo" src="${this._esc(ch.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="r-ch-initial">${this._esc((ch.name || '?').substring(0, 2).toUpperCase())}</div>`;
            return `<div class="r-ch-item ${playing}" data-url="${this._esc(ch.url)}">
                <span class="r-ch-num">${ch.num || ''}</span>
                ${logoHtml}
                <div class="r-ch-info">
                    <span class="r-ch-name">${this._esc(ch.name)}</span>
                    <span class="r-ch-group">${this._esc(ch.group || '')}</span>
                </div>
                ${playing ? '<span class="r-ch-playing-badge">▶</span>' : ''}
            </div>`;
        }).join('');

        if (chs.length > max) {
            html += `<p class="r-ch-truncated">Mostrando ${max} de ${chs.length} canales. Usa la búsqueda para encontrar más.</p>`;
        }

        list.innerHTML = html;

        list.querySelectorAll('.r-ch-item').forEach(item => {
            item.addEventListener('click', () => {
                this._sendCommand('play-channel', { url: item.dataset.url });
                this._vibrate(50);
                this._toast('📺 Cambiando canal...');

                // Immediate visual feedback
                list.querySelectorAll('.r-ch-item').forEach(i => i.classList.remove('playing'));
                item.classList.add('playing');
            });
        });
    },

    _renderGroups() {
        const bar = document.getElementById('r-groups-bar');
        if (!bar) return;

        const groupSet = new Set();
        this.channels.forEach(c => { if (c.group) groupSet.add(c.group); });
        const groups = [...groupSet].sort();

        if (groups.length === 0) { bar.innerHTML = ''; return; }

        let html = `<button class="r-group-tag ${!this.currentGroup ? 'active' : ''}" data-group="">Todos</button>`;
        html += groups.map(g => {
            const active = this.currentGroup === g ? 'active' : '';
            return `<button class="r-group-tag ${active}" data-group="${this._esc(g)}">${this._esc(g)}</button>`;
        }).join('');

        bar.innerHTML = html;

        bar.querySelectorAll('.r-group-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                this.currentGroup = tag.dataset.group || null;
                this._renderChannels();
            });
        });
    },

    /* ═══════════════════════════════
       PLAYLISTS TAB
       ═══════════════════════════════ */
    _bindPlaylistTab() {
        document.getElementById('r-pl-load-btn')?.addEventListener('click', () => {
            const input = document.getElementById('r-pl-url-input');
            const url = input?.value?.trim();
            if (url) {
                this._sendCommand('load-playlist-url', { url });
                this._toast('⏳ Cargando playlist en la TV...');
                input.value = '';
            }
        });

        document.getElementById('r-pl-url-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('r-pl-load-btn')?.click();
        });
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
                this._updateFromState(state);
            } else if (r.status === 404) {
                // Session expired
                this._handleTVDisconnect();
            }
        } catch(e) {}
    },

    _updateFromState(state) {
        if (!state || Object.keys(state).length === 0) return;

        // Update current channel info
        if (state.currentChannel) {
            this.currentChannel = state.currentChannel;
            const name = document.getElementById('r-channel-name');
            if (name) name.textContent = state.currentChannel.name || '—';

            // Now playing card
            const npName = document.getElementById('r-np-card-name');
            const npNum = document.getElementById('r-np-ch-number');
            const npGroup = document.getElementById('r-np-card-group');
            if (npName) npName.textContent = state.currentChannel.name || 'Ningún canal';
            if (npNum) npNum.textContent = state.currentChannel.num || '—';
            if (npGroup) npGroup.textContent = state.currentChannel.group || '';
        } else {
            this.currentChannel = null;
        }

        // Playing state
        this.isPlaying = state.isPlaying || false;
        const signalText = document.getElementById('r-np-signal-text');
        const signalBadge = document.getElementById('r-np-signal-badge');
        if (signalText) signalText.textContent = this.isPlaying ? 'Reproduciendo' : 'Detenido';
        if (signalBadge) {
            signalBadge.className = 'r-np-signal-badge ' + (this.isPlaying ? 'signal-good' : 'signal-none');
        }

        // Channels list
        if (state.channels && state.channels.length > 0) {
            if (this.channels.length !== state.channels.length) {
                this.channels = state.channels;
                if (this.currentTab === 'channels') this._renderChannels();
                this._toast(`📺 ${this.channels.length} canales sincronizados`);
            }
        }

        // Signal bars
        const signal = document.getElementById('r-signal');
        if (signal) {
            signal.className = 'r-signal';
            if (this.isPlaying) signal.classList.add('signal-good');
        }

        // Stats
        const statChannels = document.getElementById('r-pl-stat-channels');
        const statGroups = document.getElementById('r-pl-stat-groups');
        if (statChannels) statChannels.textContent = this.channels.length;
        if (statGroups) {
            const gs = new Set(this.channels.map(c => c.group).filter(Boolean));
            statGroups.textContent = gs.size;
        }
    },

    /* ═══════════════════════════════
       TOAST
       ═══════════════════════════════ */
    _toast(msg) {
        const toast = document.getElementById('r-toast');
        const txt = document.getElementById('r-toast-msg');
        if (!toast || !txt) return;
        txt.textContent = msg;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, 2500);
    },

    /* ═══════════════════════════════
       HELPERS
       ═══════════════════════════════ */
    _vibrate(p) { if (navigator.vibrate) navigator.vibrate(p); },
    _flash(btn) { btn.classList.add('btn-flash'); setTimeout(() => btn.classList.remove('btn-flash'), 120); },
    _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; },
};

document.addEventListener('DOMContentLoaded', () => Remote.init());
