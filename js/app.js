/* ══════════════════════════════════════════════════════════════
   OpenIPTV - Main Application Controller
   Orchestrates all modules: parser, storage, player, navigation
   ══════════════════════════════════════════════════════════════ */

const App = {

    // State
    channels: [],
    filteredChannels: [],
    groups: [],
    currentChannelIndex: -1,
    currentCategory: 'all',
    currentGroup: null,
    isLoading: false,
    loadedPlaylists: new Map(), // url -> { channels, groups, name }

    /* ═══════════════════════════════════════
       INITIALIZATION
       ═══════════════════════════════════════ */

    init() {
        // Initialize modules
        Player.init();
        Navigation.init();

        // Bind UI events
        this._bindEvents();

        // Start clock
        this._updateClock();
        setInterval(() => this._updateClock(), 1000);

        // Load splash → app
        this._startSplash();

        // Try to restore last session
        this._restoreSession();
    },

    /* ─── Splash Screen ─── */
    _startSplash() {
        setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            const app = document.getElementById('app');
            if (splash && app) {
                splash.style.opacity = '0';
                splash.style.transition = 'opacity 0.5s ease';
                setTimeout(() => {
                    splash.classList.add('hidden');
                    app.classList.remove('hidden');
                    Navigation.focusFirst('main');

                    // Auto-show pairing on first load
                    if (!sessionStorage.getItem('openiptv_paired')) {
                        setTimeout(() => {
                            RemoteReceiver.startPairing();
                            sessionStorage.setItem('openiptv_paired', '1');
                        }, 800);
                    }
                }, 500);
            }
        }, 2500);
    },

    /* ─── Restore Last Session (loads ALL saved playlists) ─── */
    async _restoreSession() {
        try {
            const serverData = await Storage.syncFromServer();
            if (serverData) {
                console.log('Synced from server:', serverData.playlists?.length, 'playlists');
            }
        } catch (err) {
            console.warn('Server sync failed:', err);
        }

        const playlists = Storage.getSavedPlaylists();
        if (playlists.length > 0) {
            try {
                await new Promise(r => setTimeout(r, 3000));

                // Load ALL saved playlists
                for (const pl of playlists) {
                    try {
                        await this._addPlaylist(pl.url, pl.name, true);
                    } catch (err) {
                        console.warn(`Skipping playlist ${pl.name}:`, err.message);
                    }
                }

                this._mergeAllPlaylists();
                this._toast(`✅ ${this.channels.length} canales de ${this.loadedPlaylists.size} listas`);

                // Try to restore last channel
                const lastChannel = Storage.getLastChannel();
                if (lastChannel) {
                    const ch = this.channels.find(c => c.url === lastChannel);
                    if (ch) this._selectChannelInList(ch);
                }
            } catch (err) {
                console.warn('Could not restore session:', err);
            }
        }
    },

    /* ═══════════════════════════════════════
       EVENT BINDING
       ═══════════════════════════════════════ */

    _bindEvents() {
        // ─── Load Playlist Buttons ───
        document.getElementById('btn-load-url')?.addEventListener('click', () => {
            this._showModal('modal-url');
        });

        document.getElementById('btn-load-file')?.addEventListener('click', () => {
            document.getElementById('file-input')?.click();
        });

        document.getElementById('file-input')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this._loadFromFile(e.target.files[0]);
                e.target.value = '';
            }
        });

        // ─── URL Modal ───
        document.getElementById('btn-load-playlist')?.addEventListener('click', () => {
            const input = document.getElementById('playlist-url-input');
            if (input && input.value.trim()) {
                this.loadPlaylistFromUrl(input.value.trim());
                this._hideModal('modal-url');
            }
        });

        document.getElementById('modal-url-close')?.addEventListener('click', () => {
            this._hideModal('modal-url');
        });

        document.getElementById('playlist-url-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('btn-load-playlist')?.click();
            }
        });

        // ─── Remote Pairing ───
        document.getElementById('btn-remote-pair')?.addEventListener('click', () => {
            RemoteReceiver.startPairing();
        });

        document.getElementById('pair-overlay-close')?.addEventListener('click', () => {
            RemoteReceiver.hidePairOverlay();
        });

        // ─── Settings ───
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            this._showModal('modal-settings');
            this._loadSettingsUI();
        });

        document.getElementById('modal-settings-close')?.addEventListener('click', () => {
            this._hideModal('modal-settings');
        });

        // Settings changes
        ['setting-buffer', 'setting-reconnect', 'setting-retries', 'setting-hide-controls', 'setting-clock'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this._saveSettingsFromUI());
        });

        document.getElementById('btn-clear-favorites')?.addEventListener('click', () => {
            Storage.clearFavorites();
            this._renderChannels();
            this._toast('Favoritos borrados');
        });

        document.getElementById('btn-clear-recents')?.addEventListener('click', () => {
            Storage.clearRecents();
            this._renderChannels();
            this._toast('Recientes borrados');
        });

        document.getElementById('btn-clear-all')?.addEventListener('click', () => {
            Storage.clearAll();
            this.channels = [];
            this.filteredChannels = [];
            this.groups = [];
            this._renderChannels();
            this._renderGroups();
            this._updateChannelCount();
            this._toast('Todos los datos borrados');
        });

        // ─── Modal Backdrop Close ───
        document.querySelectorAll('.modal-backdrop').forEach(bd => {
            bd.addEventListener('click', () => {
                const modal = bd.closest('.modal');
                if (modal) modal.classList.add('hidden');
                Navigation.setArea(Player.isPlaying ? 'player' : 'sidebar');
            });
        });

        // ─── Player Controls ───
        document.getElementById('btn-play-pause')?.addEventListener('click', () => Player.togglePause());
        document.getElementById('btn-stop')?.addEventListener('click', () => {
            Player.stop();
            this._showVideoContainer(false);
        });
        document.getElementById('btn-prev-channel')?.addEventListener('click', () => this.prevChannel());
        document.getElementById('btn-next-channel')?.addEventListener('click', () => this.nextChannel());
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => Player.toggleFullscreen());
        document.getElementById('btn-mute')?.addEventListener('click', () => Player.toggleMute());
        document.getElementById('btn-retry')?.addEventListener('click', () => Player.retry());

        document.getElementById('btn-favorite')?.addEventListener('click', () => {
            if (Player.currentChannel) {
                const added = Storage.toggleFavorite(Player.currentChannel.url);
                this._updateFavoriteIcon(added);
                this._renderChannels();
                this._toast(added ? '⭐ Añadido a favoritos' : 'Eliminado de favoritos');
            }
        });

        document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
            this._toggleSidebar();
        });

        // Volume slider
        document.getElementById('volume-slider')?.addEventListener('input', (e) => {
            Player.setVolume(parseInt(e.target.value, 10));
        });

        // Video container click to toggle overlay
        document.getElementById('video-container')?.addEventListener('click', (e) => {
            if (!e.target.closest('.control-btn, .control-btn-large, .volume-slider')) {
                Player.toggleOverlay();
            }
        });

        // ─── Search ───
        document.getElementById('search-input')?.addEventListener('input', (e) => {
            this._filterChannels(e.target.value);
        });

        // ─── Category Tabs ───
        document.querySelectorAll('.category-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this._setCategory(tab.dataset.category);
            });
        });

        // ─── Player state changes ───
        Player.onStateChange = (state) => {
            if (state === 'playing') {
                Player.showOverlay();
            }
        };
    },

    /* ═══════════════════════════════════════
       PLAYLIST LOADING
       ═══════════════════════════════════════ */

    async loadPlaylistFromUrl(url, silent = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        if (!silent) this._toast('⏳ Cargando playlist...');

        try {
            await this._addPlaylist(url, null, silent);
            this._mergeAllPlaylists();

            // Save playlist
            Storage.savePlaylist(url);
            Storage.setLastPlaylist(url);
            this._renderSavedPlaylists();

            if (!silent) {
                this._toast(`✅ ${this.channels.length} canales de ${this.loadedPlaylists.size} lista(s)`);
            }

            setTimeout(() => {
                Navigation.setArea('sidebar');
                const firstChannel = document.querySelector('.channel-item');
                if (firstChannel) Navigation._setFocusTo(firstChannel);
            }, 300);

        } catch (error) {
            this._toast(`❌ ${error.message}`);
            console.error('Playlist load error:', error);
        } finally {
            this.isLoading = false;
        }
    },

    /* ─── Core: add a single playlist to the loaded map ─── */
    async _addPlaylist(url, name, silent) {
        const result = await M3UParser.fetchAndParse(url);
        const plName = name || this._playlistNameFromUrl(url);
        this.loadedPlaylists.set(url, {
            channels: result.channels,
            groups: result.groups,
            name: plName,
        });
    },

    /* ─── Merge all loaded playlists into a single list ─── */
    _mergeAllPlaylists() {
        const seen = new Set();
        const merged = [];
        const groupSet = new Set();

        for (const [url, pl] of this.loadedPlaylists) {
            for (const ch of pl.channels) {
                if (!seen.has(ch.url)) {
                    seen.add(ch.url);
                    merged.push({ ...ch, _source: url });
                    if (ch.group) groupSet.add(ch.group);
                }
            }
        }

        // Re-number
        merged.forEach((ch, i) => { ch.number = i + 1; });

        this.channels = merged;
        this.groups = [...groupSet].sort();
        this.filteredChannels = [...this.channels];
        this.currentChannelIndex = -1;

        this._renderGroups();
        this._renderChannels();
        this._updateChannelCount();
        document.getElementById('empty-state')?.classList.add('hidden');
    },

    /* ─── Remove a playlist and re-merge ─── */
    _removeLoadedPlaylist(url) {
        this.loadedPlaylists.delete(url);
        Storage.removePlaylist(url);
        this._mergeAllPlaylists();
        this._renderSavedPlaylists();
        this._toast('Lista eliminada');
    },

    _playlistNameFromUrl(url) {
        try {
            const u = new URL(url);
            return u.hostname.replace('www.', '');
        } catch { return 'Playlist'; }
    },

    async _loadFromFile(file) {
        if (this.isLoading) return;
        this.isLoading = true;
        this._toast('⏳ Cargando archivo...');

        try {
            const result = await M3UParser.parseFile(file);
            const fakeUrl = `file://${file.name}_${Date.now()}`;
            this.loadedPlaylists.set(fakeUrl, {
                channels: result.channels,
                groups: result.groups,
                name: file.name,
            });
            this._mergeAllPlaylists();

            this._toast(`✅ ${result.channels.length} canales de "${file.name}" añadidos (${this.channels.length} total)`);

            setTimeout(() => {
                Navigation.setArea('sidebar');
                const firstChannel = document.querySelector('.channel-item');
                if (firstChannel) Navigation._setFocusTo(firstChannel);
            }, 300);

        } catch (error) {
            this._toast(`❌ ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    },

    /* ═══════════════════════════════════════
       CHANNEL NAVIGATION
       ═══════════════════════════════════════ */

    playChannel(channel) {
        if (!channel) return;

        const index = this.filteredChannels.findIndex(c => c.url === channel.url);
        if (index > -1) this.currentChannelIndex = index;

        // Update UI
        this._showVideoContainer(true);
        this._updateChannelInfo(channel);
        this._updateFavoriteIcon(Storage.isFavorite(channel.url));

        // Highlight in list
        this._selectChannelInList(channel);

        // Play
        Player.play(channel);

        // Collapse sidebar on play (TV experience)
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
        Navigation.setArea('player');
    },

    nextChannel() {
        if (this.filteredChannels.length === 0) return;
        this.currentChannelIndex = (this.currentChannelIndex + 1) % this.filteredChannels.length;
        this.playChannel(this.filteredChannels[this.currentChannelIndex]);
    },

    prevChannel() {
        if (this.filteredChannels.length === 0) return;
        this.currentChannelIndex = (this.currentChannelIndex - 1 + this.filteredChannels.length) % this.filteredChannels.length;
        this.playChannel(this.filteredChannels[this.currentChannelIndex]);
    },

    goToChannel(number) {
        const channel = this.channels.find(c => c.number === number);
        if (channel) {
            this.playChannel(channel);
            this._toast(`📺 Canal ${number}: ${channel.name}`);
        } else {
            this._toast(`❌ Canal ${number} no encontrado`);
        }
    },

    /* ═══════════════════════════════════════
       UI RENDERING
       ═══════════════════════════════════════ */

    _renderChannels() {
        const list = document.getElementById('channel-list');
        if (!list) return;

        const favorites = Storage.getFavorites();
        const recents = Storage.getRecents();

        let channels = this.filteredChannels;

        // Apply category filter
        if (this.currentCategory === 'favorites') {
            channels = channels.filter(c => favorites.includes(c.url));
        } else if (this.currentCategory === 'recent') {
            channels = channels.filter(c => recents.includes(c.url));
            // Sort by recency
            channels.sort((a, b) => recents.indexOf(a.url) - recents.indexOf(b.url));
        }

        // Apply group filter
        if (this.currentGroup) {
            channels = channels.filter(c => c.group === this.currentGroup);
        }

        // Virtualize for performance (render max 200 at a time)
        const maxRender = 200;
        const toRender = channels.slice(0, maxRender);

        // Build HTML
        const fragment = document.createDocumentFragment();

        toRender.forEach(channel => {
            const item = document.createElement('button');
            item.className = 'channel-item focusable';
            item.dataset.focusGroup = 'sidebar';
            item.tabIndex = 0;
            
            if (favorites.includes(channel.url)) {
                item.classList.add('is-favorite');
            }
            if (Player.currentChannel && Player.currentChannel.url === channel.url) {
                item.classList.add('active');
            }

            const logoHtml = channel.logo 
                ? `<img class="ch-logo" src="${this._escapeHtml(channel.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                : '';

            item.innerHTML = `
                <span class="ch-number">${channel.number}</span>
                ${logoHtml}
                <span class="ch-number" style="${channel.logo ? 'display:none' : ''}">${channel.number}</span>
                <div class="ch-info">
                    <span class="ch-name">${this._escapeHtml(channel.name)}</span>
                    <span class="ch-group">${this._escapeHtml(channel.group)}</span>
                </div>
                <span class="ch-fav">⭐</span>
            `;

            item.addEventListener('click', () => this.playChannel(channel));
            fragment.appendChild(item);
        });

        list.innerHTML = '';
        list.appendChild(fragment);

        // Show count info
        if (channels.length > maxRender) {
            const more = document.createElement('div');
            more.className = 'channel-list-more';
            more.style.cssText = 'text-align:center;padding:12px;color:var(--text-muted);font-size:12px;';
            more.textContent = `Mostrando ${maxRender} de ${channels.length} canales. Usa la búsqueda para filtrar.`;
            list.appendChild(more);
        }

        if (channels.length === 0) {
            list.innerHTML = `
                <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
                    <p style="font-size:32px;margin-bottom:12px;">📭</p>
                    <p style="font-size:14px;">No se encontraron canales</p>
                </div>
            `;
        }

        Navigation.refreshFocusables();
    },

    _renderGroups() {
        const container = document.getElementById('group-list');
        if (!container) return;

        container.innerHTML = '';

        this.groups.forEach(group => {
            const btn = document.createElement('button');
            btn.className = 'group-tag focusable';
            btn.dataset.focusGroup = 'sidebar';
            btn.tabIndex = 0;
            btn.textContent = group;
            
            if (this.currentGroup === group) {
                btn.classList.add('active');
            }

            btn.addEventListener('click', () => {
                if (this.currentGroup === group) {
                    this.currentGroup = null;
                    btn.classList.remove('active');
                } else {
                    // Remove active from all
                    container.querySelectorAll('.group-tag').forEach(g => g.classList.remove('active'));
                    this.currentGroup = group;
                    btn.classList.add('active');
                }
                this._renderChannels();
            });

            container.appendChild(btn);
        });

        Navigation.refreshFocusables();
    },

    _renderSavedPlaylists() {
        const container = document.getElementById('saved-playlists');
        if (!container) return;

        const playlists = Storage.getSavedPlaylists();

        if (playlists.length === 0) {
            container.innerHTML = '<p class="no-saved">No hay playlists guardadas</p>';
            return;
        }

        container.innerHTML = '';

        playlists.forEach(pl => {
            const isLoaded = this.loadedPlaylists.has(pl.url);
            const info = isLoaded ? this.loadedPlaylists.get(pl.url) : null;
            const chCount = info ? info.channels.length : '';

            const item = document.createElement('div');
            item.className = `saved-playlist-item focusable ${isLoaded ? 'loaded' : ''}`;
            item.dataset.focusGroup = 'modal';
            item.tabIndex = 0;
            item.innerHTML = `
                <div class="saved-playlist-status">${isLoaded ? '✅' : '⬜'}</div>
                <div class="saved-playlist-info">
                    <div class="saved-playlist-name">${this._escapeHtml(pl.name)}${chCount ? ` <span class="pl-ch-count">(${chCount} ch)</span>` : ''}</div>
                    <div class="saved-playlist-url">${this._escapeHtml(pl.url)}</div>
                </div>
                <button class="saved-playlist-delete" title="Eliminar">×</button>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.saved-playlist-delete')) {
                    this._removeLoadedPlaylist(pl.url);
                    return;
                }
                // Toggle: load or unload this playlist
                if (isLoaded) {
                    this.loadedPlaylists.delete(pl.url);
                    this._mergeAllPlaylists();
                    this._renderSavedPlaylists();
                    this._toast(`Lista "${pl.name}" desactivada`);
                } else {
                    this._toast('⏳ Cargando...');
                    this._addPlaylist(pl.url, pl.name, false).then(() => {
                        this._mergeAllPlaylists();
                        this._renderSavedPlaylists();
                        this._toast(`✅ "${pl.name}" añadida (${this.channels.length} canales total)`);
                    }).catch(err => {
                        this._toast(`❌ ${err.message}`);
                    });
                }
            });

            container.appendChild(item);
        });

        // Summary
        if (this.loadedPlaylists.size > 0) {
            const summary = document.createElement('div');
            summary.className = 'saved-playlists-summary';
            summary.textContent = `${this.loadedPlaylists.size} lista(s) activas · ${this.channels.length} canales`;
            container.appendChild(summary);
        }
    },

    /* ─── Channel Info Banner ─── */
    _updateChannelInfo(channel) {
        const logo = document.getElementById('channel-logo');
        const name = document.getElementById('channel-name-display');
        const num = document.getElementById('channel-number');
        const group = document.getElementById('channel-group-display');

        if (logo) {
            if (channel.logo) {
                logo.src = channel.logo;
                logo.style.display = '';
            } else {
                logo.style.display = 'none';
            }
        }
        if (name) name.textContent = channel.name;
        if (num) num.textContent = `CH ${channel.number}`;
        if (group) group.textContent = channel.group;
    },

    _selectChannelInList(channel) {
        document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
        
        // Find and activate the channel item
        const items = document.querySelectorAll('.channel-item');
        items.forEach(item => {
            const nameEl = item.querySelector('.ch-name');
            if (nameEl && nameEl.textContent === channel.name) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });
    },

    _updateFavoriteIcon(isFav) {
        const empty = document.getElementById('icon-fav-empty');
        const filled = document.getElementById('icon-fav-filled');
        if (empty) empty.classList.toggle('hidden', isFav);
        if (filled) filled.classList.toggle('hidden', !isFav);
    },

    /* ═══════════════════════════════════════
       FILTERING
       ═══════════════════════════════════════ */

    _setCategory(category) {
        this.currentCategory = category;
        this.currentGroup = null;

        // Update tab UI
        document.querySelectorAll('.category-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });
        document.querySelectorAll('.group-tag').forEach(g => g.classList.remove('active'));

        this._renderChannels();
    },

    _filterChannels(query) {
        if (!query || query.trim() === '') {
            this.filteredChannels = [...this.channels];
        } else {
            const q = query.toLowerCase().trim();
            this.filteredChannels = this.channels.filter(c => 
                c.name.toLowerCase().includes(q) ||
                c.group.toLowerCase().includes(q) ||
                c.number.toString() === q
            );
        }
        this._renderChannels();
    },

    /* ═══════════════════════════════════════
       UI HELPERS
       ═══════════════════════════════════════ */

    _showVideoContainer(show) {
        const videoContainer = document.getElementById('video-container');
        const emptyState = document.getElementById('empty-state');
        if (videoContainer) videoContainer.classList.toggle('hidden', !show);
        if (emptyState) emptyState.classList.toggle('hidden', show);
    },

    _toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        if (sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('sidebar-show');
            sidebar.classList.remove('collapsed');
            Navigation.setArea('sidebar');
            setTimeout(() => sidebar.classList.remove('sidebar-show'), 300);
        } else {
            sidebar.classList.add('collapsed');
            Navigation.setArea('player');
        }
    },

    _updateChannelCount() {
        const el = document.getElementById('total-channels');
        if (el) el.textContent = this.channels.length;
    },

    _updateClock() {
        const now = new Date();
        const time = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        
        const clockEl = document.getElementById('current-time');
        const playerClock = document.getElementById('player-time');
        
        if (clockEl) clockEl.textContent = time;
        if (playerClock) playerClock.textContent = time;
    },

    _showModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('hidden');
            Navigation.setArea('modal');
            
            if (id === 'modal-url') {
                this._renderSavedPlaylists();
                setTimeout(() => {
                    document.getElementById('playlist-url-input')?.focus();
                }, 300);
            }
        }
    },

    _hideModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('hidden');
        Navigation.setArea(Player.isPlaying ? 'player' : 'sidebar');
    },

    _loadSettingsUI() {
        const s = Storage.getSettings();
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val.toString();
        };
        set('setting-buffer', s.bufferSize);
        set('setting-reconnect', s.autoReconnect);
        set('setting-retries', s.retries);
        set('setting-hide-controls', s.hideControlsDelay);
        set('setting-clock', s.showClock);
    },

    _saveSettingsFromUI() {
        const get = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : null;
        };

        Storage.updateSettings({
            bufferSize: parseInt(get('setting-buffer'), 10),
            autoReconnect: get('setting-reconnect') === 'true',
            retries: parseInt(get('setting-retries'), 10),
            hideControlsDelay: parseInt(get('setting-hide-controls'), 10),
            showClock: get('setting-clock') === 'true',
        });

        this._toast('⚙️ Configuración guardada');
    },

    _toast(message) {
        const toast = document.getElementById('toast');
        const msg = document.getElementById('toast-message');
        if (!toast || !msg) return;

        msg.textContent = message;
        toast.classList.remove('hidden');
        toast.classList.add('show');

        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, 3000);
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};

/* ═══════════════════════════════════════
   BOOT
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
