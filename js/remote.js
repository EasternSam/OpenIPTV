/* ══════════════════════════════════════════════════════════════
   OpenIPTV — Mobile Control Center v5
   Full TV control: channels, playback, playlists, settings
   ══════════════════════════════════════════════════════════════ */

const Remote = {

    code: null,
    connected: false,
    stateInterval: null,
    channels: [],
    favorites: [],
    recents: [],
    groups: [],
    currentTab: 'channels',
    currentCategory: 'all',
    currentGroup: null,
    tvState: {},

    init() {
        this._blockZoom();
        this._bindPairingEvents();
        this._bindBottomNav();
        this._bindRemoteEvents();
        this._bindChannelTab();
        this._bindPlaylistTab();
        this._bindSettingsTab();
        this._bindKeyboard();

        const saved = sessionStorage.getItem('openiptv_remote_code');
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
            } else {
                sessionStorage.removeItem('openiptv_remote_code');
            }
        } catch { sessionStorage.removeItem('openiptv_remote_code'); }
    },

    /* ═══════════════════════════════
       BOTTOM NAV (4 tabs)
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
                if (tab === 'playlists') this._renderPlaylists();
            });
        });
    },

    /* ═══════════════════════════════
       REMOTE COMMANDS
       ═══════════════════════════════ */
    _bindRemoteEvents() {
        document.querySelectorAll('[data-cmd]').forEach(btn => {
            if (btn.classList.contains('r-kb-sc')) return;
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

        // Volume slider
        const volSlider = document.getElementById('r-volume-slider');
        if (volSlider) {
            volSlider.addEventListener('input', () => {
                const val = parseInt(volSlider.value, 10);
                document.getElementById('r-vol-label').textContent = val + '%';
                this._sendCommand('set-volume', { volume: val });
            });
        }
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
       CHANNELS TAB
       ═══════════════════════════════ */
    _bindChannelTab() {
        // Category pills
        document.querySelectorAll('.r-filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                this.currentCategory = pill.dataset.category;
                this.currentGroup = null;
                document.querySelectorAll('.r-filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this._renderChannels();
            });
        });

        // Search
        const search = document.getElementById('r-ch-search');
        if (search) {
            search.addEventListener('input', () => this._renderChannels());
        }
    },

    _renderChannels() {
        const list = document.getElementById('r-ch-list');
        if (!list) return;

        const search = (document.getElementById('r-ch-search')?.value || '').trim().toLowerCase();
        let chs = [...this.channels];

        // Category filter
        if (this.currentCategory === 'favorites') {
            chs = chs.filter(c => this.favorites.includes(c.url));
        } else if (this.currentCategory === 'recent') {
            chs = chs.filter(c => this.recents.includes(c.url));
        }

        // Group filter
        if (this.currentGroup) {
            chs = chs.filter(c => c.group === this.currentGroup);
        }

        // Search filter
        if (search) {
            chs = chs.filter(c =>
                c.name.toLowerCase().includes(search) ||
                (c.group || '').toLowerCase().includes(search) ||
                c.number.toString() === search
            );
        }

        // Render groups bar
        this._renderGroups();

        if (chs.length === 0 && this.channels.length === 0) {
            list.innerHTML = `<div class="r-ch-empty-state">
                <div class="r-ch-empty-icon">📡</div>
                <p>Esperando canales de la TV...</p>
                <span class="r-ch-empty-sub">Asegúrate de tener una playlist cargada</span>
            </div>`;
            return;
        }

        if (chs.length === 0) {
            list.innerHTML = `<div class="r-ch-empty-state">
                <div class="r-ch-empty-icon">📭</div>
                <p>Sin resultados</p>
            </div>`;
            return;
        }

        const currentUrl = this.tvState.channelUrl || null;
        const max = 150;
        list.innerHTML = chs.slice(0, max).map(ch => {
            const playing = ch.url === currentUrl ? 'playing' : '';
            const isFav = this.favorites.includes(ch.url) ? 'is-fav' : '';
            const logoHtml = ch.logo
                ? `<img class="r-ch-logo" src="${this._esc(ch.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : '';
            return `<div class="r-ch-item ${playing} ${isFav}" data-url="${this._esc(ch.url)}">
                <span class="r-ch-num">${ch.number}</span>
                ${logoHtml}
                <div class="r-ch-info">
                    <span class="r-ch-name">${this._esc(ch.name)}</span>
                    <span class="r-ch-group">${this._esc(ch.group || '')}</span>
                </div>
                <span class="r-ch-fav-icon">⭐</span>
            </div>`;
        }).join('');

        if (chs.length > max) {
            list.innerHTML += `<p style="text-align:center;padding:12px;color:var(--txt3);font-size:11px">
                Mostrando ${max} de ${chs.length}. Usa la búsqueda.</p>`;
        }

        list.querySelectorAll('.r-ch-item').forEach(item => {
            item.addEventListener('click', () => {
                this._sendCommand('play-channel', { url: item.dataset.url });
                this._vibrate(50);
                this._toast('📺 Cambiando canal...');
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

        bar.innerHTML = groups.map(g => {
            const active = this.currentGroup === g ? 'active' : '';
            return `<button class="r-group-tag ${active}" data-group="${this._esc(g)}">${this._esc(g)}</button>`;
        }).join('');

        bar.querySelectorAll('.r-group-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                this.currentGroup = this.currentGroup === tag.dataset.group ? null : tag.dataset.group;
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

    _renderPlaylists() {
        const list = document.getElementById('r-pl-list');
        if (!list) return;

        const playlists = this.tvState.playlists || [];

        if (playlists.length === 0) {
            list.innerHTML = '<div class="r-pl-empty"><p>No hay playlists guardadas</p></div>';
        } else {
            list.innerHTML = playlists.map(pl => `
                <div class="r-pl-item ${pl.loaded ? 'loaded' : ''}">
                    <span class="r-pl-item-status">${pl.loaded ? '✅' : '⬜'}</span>
                    <div class="r-pl-item-info">
                        <span class="r-pl-item-name">${this._esc(pl.name)}</span>
                        <span class="r-pl-item-url">${this._esc(pl.url)}</span>
                    </div>
                    <button class="r-pl-item-del" data-url="${this._esc(pl.url)}">×</button>
                </div>
            `).join('');

            list.querySelectorAll('.r-pl-item-del').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    this._sendCommand('remove-playlist', { url: btn.dataset.url });
                    this._toast('🗑️ Eliminando playlist...');
                });
            });
        }

        // Stats
        const totalChannels = this.channels.length;
        const totalGroups = new Set(this.channels.map(c => c.group).filter(Boolean)).size;
        document.getElementById('r-pl-stat-lists').textContent = playlists.length;
        document.getElementById('r-pl-stat-channels').textContent = totalChannels;
        document.getElementById('r-pl-stat-groups').textContent = totalGroups;
    },

    /* ═══════════════════════════════
       SETTINGS TAB
       ═══════════════════════════════ */
    _bindSettingsTab() {
        // Settings selects — send to TV on change
        ['r-set-buffer', 'r-set-reconnect', 'r-set-retries', 'r-set-hide-controls', 'r-set-clock'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                this._sendSettingsToTV();
            });
        });

        // Danger buttons
        document.querySelectorAll('.r-danger-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cmd = btn.dataset.cmd;
                this._sendCommand(cmd, {});
                this._vibrate(50);
                this._toast('✅ Comando enviado');
            });
        });
    },

    _sendSettingsToTV() {
        const get = id => document.getElementById(id)?.value;
        this._sendCommand('update-settings', {
            bufferSize: parseInt(get('r-set-buffer'), 10),
            autoReconnect: get('r-set-reconnect') === 'true',
            retries: parseInt(get('r-set-retries'), 10),
            hideControlsDelay: parseInt(get('r-set-hide-controls'), 10),
            showClock: get('r-set-clock') === 'true',
        });
        this._toast('⚙️ Configuración enviada a la TV');
    },

    /* ═══════════════════════════════
       KEYBOARD
       ═══════════════════════════════ */
    _bindKeyboard() {
        document.getElementById('r-kb-send')?.addEventListener('click', () => {
            const input = document.getElementById('r-kb-input');
            if (input && input.value) {
                this._sendCommand('type-text', { text: input.value });
                input.value = '';
                this._vibrate(50);
            }
        });

        document.getElementById('r-kb-clear')?.addEventListener('click', () => {
            this._sendCommand('clear-text', {});
            document.getElementById('r-kb-input').value = '';
        });

        document.getElementById('r-kb-enter')?.addEventListener('click', () => {
            this._sendCommand('type-key', { key: 'Enter' });
            this._vibrate(30);
        });

        document.querySelectorAll('.r-kb-sc').forEach(btn => {
            btn.addEventListener('click', () => {
                this._sendCommand('type-key', { key: btn.dataset.key });
                this._vibrate(25);
                this._flash(btn);
            });
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
            }
        } catch {}
    },

    _updateFromState(state) {
        this.tvState = state;

        // Channel name in header
        const name = document.getElementById('r-channel-name');
        if (name) name.textContent = state.channelName || '—';

        // Now playing card
        const npName = document.getElementById('r-np-card-name');
        const npNum = document.getElementById('r-np-ch-number');
        const npGroup = document.getElementById('r-np-card-group');
        if (npName) npName.textContent = state.channelName || 'Ningún canal';
        if (npNum) npNum.textContent = state.channelNumber || '—';
        if (npGroup) npGroup.textContent = state.channelGroup || '';

        // Volume
        if (state.volume != null) {
            const slider = document.getElementById('r-volume-slider');
            const label = document.getElementById('r-vol-label');
            if (slider && !slider.matches(':active')) slider.value = state.volume;
            if (label) label.textContent = state.volume + '%';
        }

        // Channels
        if (state.channels && state.channels.length > 0) {
            if (this.channels.length !== state.channels.length) {
                this.channels = state.channels;
                if (this.currentTab === 'channels') this._renderChannels();
            }
        }

        // Favorites & recents
        if (state.favorites) this.favorites = state.favorites;
        if (state.recents) this.recents = state.recents;

        // Favorite button
        const favBtn = document.getElementById('r-np-fav-btn');
        if (favBtn && state.channelUrl) {
            favBtn.classList.toggle('is-fav', this.favorites.includes(state.channelUrl));
        }

        // Signal quality
        this._updateSignalUI(state.signalQuality || 'none', state.playing);
    },

    _updateSignalUI(quality, isPlaying) {
        // Header signal bars
        const signal = document.getElementById('r-signal');
        if (signal) {
            signal.className = 'r-signal';
            if (isPlaying) signal.classList.add(`signal-${quality}`);
        }

        // Now-playing badge
        const badge = document.getElementById('r-np-signal-badge');
        const dot = badge?.querySelector('.r-np-signal-dot');
        const text = document.getElementById('r-np-signal-text');
        if (badge) {
            badge.className = 'r-np-signal-badge';
            if (!isPlaying) {
                if (text) text.textContent = 'Sin señal';
                badge.classList.add('signal-none');
            } else if (quality === 'good') {
                if (text) text.textContent = 'Excelente';
                badge.classList.add('signal-good');
            } else if (quality === 'medium') {
                if (text) text.textContent = 'Regular';
                badge.classList.add('signal-medium');
            } else if (quality === 'poor') {
                if (text) text.textContent = 'Débil';
                badge.classList.add('signal-poor');
            } else {
                if (text) text.textContent = 'Conectando...';
                badge.classList.add('signal-none');
            }
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
