const Panel = {
    API_BASE: '/api',
    data: { playlists: [], lastPlaylist: null, favorites: [] },

    async init() {
        this.bindEvents();
        await this.fetchData();
    },

    bindEvents() {
        document.getElementById('btn-add-playlist').addEventListener('click', () => {
            document.getElementById('modal-add').classList.remove('hidden');
        });

        const closeModal = () => {
            document.getElementById('modal-add').classList.add('hidden');
            document.getElementById('input-pl-url').value = '';
            document.getElementById('input-pl-name').value = '';
        };

        document.getElementById('btn-close-modal').addEventListener('click', closeModal);
        document.getElementById('btn-cancel').addEventListener('click', closeModal);
        document.querySelector('.modal-backdrop').addEventListener('click', closeModal);

        document.getElementById('btn-save').addEventListener('click', () => this.addPlaylist());
        document.getElementById('btn-refresh').addEventListener('click', () => this.fetchData());
    },

    async fetchData() {
        this.renderLoading();

        // Try server first, fallback to localStorage
        let serverOk = false;
        try {
            const res = await fetch(`${this.API_BASE}/data`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                const data = await res.json();
                this.data = data;
                // Sync to localStorage
                this._setLocal('openiptv_playlists', data.playlists || []);
                this._setLocal('openiptv_last_playlist', data.lastPlaylist);
                this._setLocal('openiptv_favorites', data.favorites || []);
                serverOk = true;
            }
        } catch (err) { /* server unavailable */ }

        if (!serverOk) {
            // Read from localStorage
            this.data = {
                playlists: this._getLocal('openiptv_playlists', []),
                lastPlaylist: this._getLocal('openiptv_last_playlist', null),
                favorites: this._getLocal('openiptv_favorites', []),
            };
        }

        this.serverAvailable = serverOk;
        this.updateStats();
        this.renderGrid();
    },

    _getLocal(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) { return fallback; }
    },

    _setLocal(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    },

    updateStats() {
        document.getElementById('stat-count').textContent = this.data.playlists?.length || 0;
        
        let defaultName = 'Ninguna';
        if (this.data.lastPlaylist) {
            const defPl = this.data.playlists.find(p => p.url === this.data.lastPlaylist);
            defaultName = defPl ? defPl.name : 'URL Desconocida';
        }
        document.getElementById('stat-default').textContent = defaultName;

        // Show server status
        const statusEl = document.getElementById('server-status');
        if (statusEl) {
            statusEl.textContent = this.serverAvailable ? '🟢 Servidor activo' : '🟡 Modo local (sin servidor)';
            statusEl.style.color = this.serverAvailable ? '#4ade80' : '#fbbf24';
        }
    },

    renderGrid() {
        const grid = document.getElementById('playlist-grid');
        grid.innerHTML = '';

        if (!this.data.playlists || this.data.playlists.length === 0) {
            grid.innerHTML = `
                <div class="loading-state">
                    <p>No hay listas configuradas.</p>
                    <p style="font-size: 14px; color: var(--text-muted); margin-top: 8px;">Haz clic en "Añadir Playlist" para agregar una.</p>
                </div>`;
            return;
        }

        this.data.playlists.forEach(pl => {
            const isDefault = this.data.lastPlaylist === pl.url;
            const isFav = (this.data.favorites || []).includes(pl.url);
            const date = new Date(pl.addedAt || Date.now()).toLocaleDateString();

            const card = document.createElement('div');
            card.className = `playlist-card ${isDefault ? 'is-default' : ''}`;
            
            let html = '';
            if (isDefault) html += `<div class="default-badge">Principal</div>`;
            
            html += `
                <h3 class="pl-name">${this.escapeHtml(pl.name)}</h3>
                <div class="pl-url" title="${this.escapeHtml(pl.url)}">${this.escapeHtml(pl.url)}</div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">Añadida: ${date}</div>
                <div class="pl-actions">
                    <button class="btn-small btn-set-default" data-url="${this.escapeHtml(pl.url)}" ${isDefault ? 'disabled style="opacity: 0.5; cursor: not-allowed"' : ''}>Hacer Principal</button>
                    <button class="btn-small btn-danger btn-delete" data-url="${this.escapeHtml(pl.url)}">Eliminar</button>
                </div>
            `;
            
            card.innerHTML = html;

            const btnDefault = card.querySelector('.btn-set-default');
            if (btnDefault && !isDefault) {
                btnDefault.addEventListener('click', () => this.setDefault(pl.url));
            }

            const btnDelete = card.querySelector('.btn-delete');
            if (btnDelete) {
                btnDelete.addEventListener('click', () => {
                    if (confirm('¿Estás seguro de eliminar esta lista?')) {
                        this.deletePlaylist(pl.url);
                    }
                });
            }

            grid.appendChild(card);
        });
    },

    async addPlaylist() {
        const url = document.getElementById('input-pl-url').value.trim();
        const name = document.getElementById('input-pl-name').value.trim() || this._extractName(url);

        if (!url) {
            this.showToast('❌ La URL es obligatoria');
            return;
        }

        const btn = document.getElementById('btn-save');
        btn.textContent = 'Guardando...';
        btn.disabled = true;

        try {
            // Save to localStorage first (always works)
            const playlists = this._getLocal('openiptv_playlists', []);
            const filtered = playlists.filter(p => p.url !== url);
            filtered.unshift({ url, name, addedAt: Date.now() });
            this._setLocal('openiptv_playlists', filtered);
            if (!this._getLocal('openiptv_last_playlist', null)) {
                this._setLocal('openiptv_last_playlist', url);
            }

            // Try server sync
            try {
                await fetch(`${this.API_BASE}/playlists`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name }),
                    signal: AbortSignal.timeout(3000),
                });
            } catch (e) { /* server offline, localStorage is enough */ }
            
            this.showToast('✅ Playlist añadida');
            document.getElementById('btn-close-modal').click();
            this.fetchData();
        } catch (err) {
            this.showToast('❌ ' + err.message);
        } finally {
            btn.textContent = 'Guardar Playlist';
            btn.disabled = false;
        }
    },

    async deletePlaylist(url) {
        try {
            // Remove from localStorage
            const playlists = this._getLocal('openiptv_playlists', []);
            this._setLocal('openiptv_playlists', playlists.filter(p => p.url !== url));

            // Try server
            try {
                await fetch(`${this.API_BASE}/playlists`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(3000),
                });
            } catch (e) {}
            
            this.showToast('🗑️ Playlist eliminada');
            this.fetchData();
        } catch (err) {
            this.showToast('❌ ' + err.message);
        }
    },

    async setDefault(url) {
        try {
            this._setLocal('openiptv_last_playlist', url);
            try {
                await fetch(`${this.API_BASE}/last-playlist`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(3000),
                });
            } catch (e) {}
            
            this.showToast('🌟 Lista principal actualizada');
            this.fetchData();
        } catch (err) {
            this.showToast('❌ ' + err.message);
        }
    },

    _extractName(url) {
        try {
            const u = new URL(url);
            const p = u.pathname.split('/').pop();
            return p ? p.replace(/\.(m3u8?|txt)$/i, '') : u.hostname;
        } catch(e) { return 'Playlist'; }
    },

    renderLoading() {
        document.getElementById('playlist-grid').innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Cargando playlists...</p>
            </div>`;
    },

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, 3000);
    },

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

document.addEventListener('DOMContentLoaded', () => Panel.init());
