const Panel = {
    API_BASE: '/api',
    data: { playlists: [], lastPlaylist: null },

    async init() {
        this.bindEvents();
        await this.fetchData();
    },

    bindEvents() {
        // Modal toggles
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

        // Save
        document.getElementById('btn-save').addEventListener('click', () => this.addPlaylist());

        // Refresh
        document.getElementById('btn-refresh').addEventListener('click', () => this.fetchData());
    },

    async fetchData() {
        this.renderLoading();
        try {
            const res = await fetch(`${this.API_BASE}/data`);
            if (!res.ok) throw new Error('Error al conectar con el servidor');
            const data = await res.json();
            this.data = data;
            
            // Render
            this.updateStats();
            this.renderGrid();
        } catch (err) {
            this.showToast('❌ ' + err.message);
            document.getElementById('playlist-grid').innerHTML = `
                <div class="loading-state" style="color: var(--danger)">
                    <p>No se pudo cargar la información.</p>
                </div>`;
        }
    },

    updateStats() {
        document.getElementById('stat-count').textContent = this.data.playlists?.length || 0;
        
        let defaultName = 'Ninguna';
        if (this.data.lastPlaylist) {
            const defPl = this.data.playlists.find(p => p.url === this.data.lastPlaylist);
            defaultName = defPl ? defPl.name : 'URL Desconocida';
        }
        document.getElementById('stat-default').textContent = defaultName;
    },

    renderGrid() {
        const grid = document.getElementById('playlist-grid');
        grid.innerHTML = '';

        if (!this.data.playlists || this.data.playlists.length === 0) {
            grid.innerHTML = `
                <div class="loading-state">
                    <p>No hay listas configuradas en el servidor.</p>
                </div>`;
            return;
        }

        this.data.playlists.forEach(pl => {
            const isDefault = this.data.lastPlaylist === pl.url;
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

            // Events
            const btnDefault = card.querySelector('.btn-set-default');
            if (btnDefault && !isDefault) {
                btnDefault.addEventListener('click', () => this.setDefault(pl.url));
            }

            const btnDelete = card.querySelector('.btn-delete');
            if (btnDelete) {
                btnDelete.addEventListener('click', () => {
                    if (confirm('¿Estás seguro de eliminar esta lista para todos los usuarios?')) {
                        this.deletePlaylist(pl.url);
                    }
                });
            }

            grid.appendChild(card);
        });
    },

    async addPlaylist() {
        const url = document.getElementById('input-pl-url').value.trim();
        const name = document.getElementById('input-pl-name').value.trim();

        if (!url) {
            this.showToast('❌ La URL es obligatoria');
            return;
        }

        const btn = document.getElementById('btn-save');
        btn.textContent = 'Guardando...';
        btn.disabled = true;

        try {
            const res = await fetch(`${this.API_BASE}/playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, name })
            });

            if (!res.ok) throw new Error('Error al guardar');
            
            this.showToast('✅ Playlist añadida correctamente');
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
            const res = await fetch(`${this.API_BASE}/playlists`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (!res.ok) throw new Error('Error al eliminar');
            
            this.showToast('🗑️ Playlist eliminada');
            this.fetchData();
        } catch (err) {
            this.showToast('❌ ' + err.message);
        }
    },

    async setDefault(url) {
        try {
            const res = await fetch(`${this.API_BASE}/last-playlist`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (!res.ok) throw new Error('Error al configurar principal');
            
            this.showToast('🌟 Lista principal actualizada');
            this.fetchData();
        } catch (err) {
            this.showToast('❌ ' + err.message);
        }
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
