/* ══════════════════════════════════════════════════════════════
   OpenIPTV - Storage Manager
   Hybrid: LocalStorage for device-specific + Server API for shared data
   ══════════════════════════════════════════════════════════════ */

const Storage = {

    KEYS: {
        FAVORITES: 'openiptv_favorites',
        RECENTS: 'openiptv_recents',
        PLAYLISTS: 'openiptv_playlists',
        LAST_PLAYLIST: 'openiptv_last_playlist',
        LAST_CHANNEL: 'openiptv_last_channel',
        SETTINGS: 'openiptv_settings',
        VOLUME: 'openiptv_volume',
    },

    MAX_RECENTS: 30,
    MAX_PLAYLISTS: 20,

    // Server API base (same origin)
    API_BASE: '/api',

    /* ═══════════════════════════════════════
       SERVER API METHODS (Shared across devices)
       ═══════════════════════════════════════ */

    /** Fetch all shared data from server */
    async fetchServerData() {
        try {
            const res = await fetch(`${this.API_BASE}/data`, { 
                signal: AbortSignal.timeout(5000) 
            });
            if (!res.ok) throw new Error('Server error');
            return await res.json();
        } catch (err) {
            console.warn('Storage: Could not fetch server data', err);
            return null;
        }
    },

    /** Save playlist to server (shared) */
    async savePlaylistToServer(url, name) {
        try {
            await fetch(`${this.API_BASE}/playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, name: name || this._extractPlaylistName(url) }),
            });
        } catch (err) {
            console.warn('Storage: Could not save playlist to server', err);
        }
    },

    /** Remove playlist from server */
    async removePlaylistFromServer(url) {
        try {
            await fetch(`${this.API_BASE}/playlists`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
        } catch (err) {
            console.warn('Storage: Could not remove playlist from server', err);
        }
    },

    /** Set last playlist on server */
    async setLastPlaylistOnServer(url) {
        try {
            await fetch(`${this.API_BASE}/last-playlist`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
        } catch (err) {
            console.warn('Storage: Could not set last playlist on server', err);
        }
    },

    /** Toggle favorite on server */
    async toggleFavoriteOnServer(url) {
        try {
            const res = await fetch(`${this.API_BASE}/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (res.ok) {
                const data = await res.json();
                // Sync server favorites to local
                this._set(this.KEYS.FAVORITES, data.favorites);
                return data.isFavorite;
            }
        } catch (err) {
            console.warn('Storage: Could not toggle favorite on server', err);
        }
        return null;
    },

    /** Clear favorites on server */
    async clearFavoritesOnServer() {
        try {
            await fetch(`${this.API_BASE}/favorites`, { method: 'DELETE' });
        } catch (err) {
            console.warn('Storage: Could not clear favorites on server', err);
        }
    },

    /** Sync local storage with server data */
    async syncFromServer() {
        const data = await this.fetchServerData();
        if (data) {
            if (data.playlists) this._set(this.KEYS.PLAYLISTS, data.playlists);
            if (data.lastPlaylist) this._set(this.KEYS.LAST_PLAYLIST, data.lastPlaylist);
            if (data.favorites) this._set(this.KEYS.FAVORITES, data.favorites);
            return data;
        }
        return null;
    },

    /* ═══════════════════════════════════════
       LOCAL STORAGE METHODS
       ═══════════════════════════════════════ */

    _get(key, fallback = null) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : fallback;
        } catch {
            return fallback;
        }
    },

    _set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('Storage: write failed', e);
            return false;
        }
    },

    _remove(key) {
        try {
            localStorage.removeItem(key);
        } catch {}
    },

    /* ─── Favorites (now synced with server) ─── */

    getFavorites() {
        return this._get(this.KEYS.FAVORITES, []);
    },

    isFavorite(channelUrl) {
        const favs = this.getFavorites();
        return favs.includes(channelUrl);
    },

    toggleFavorite(channelUrl) {
        // Update local immediately
        const favs = this.getFavorites();
        const index = favs.indexOf(channelUrl);
        if (index > -1) {
            favs.splice(index, 1);
        } else {
            favs.push(channelUrl);
        }
        this._set(this.KEYS.FAVORITES, favs);

        // Sync to server in background
        this.toggleFavoriteOnServer(channelUrl);

        return index === -1;
    },

    clearFavorites() {
        this._remove(this.KEYS.FAVORITES);
        this.clearFavoritesOnServer();
    },

    /* ─── Recents (local only - per device) ─── */

    getRecents() {
        return this._get(this.KEYS.RECENTS, []);
    },

    addRecent(channelUrl) {
        let recents = this.getRecents();
        recents = recents.filter(url => url !== channelUrl);
        recents.unshift(channelUrl);
        if (recents.length > this.MAX_RECENTS) {
            recents = recents.slice(0, this.MAX_RECENTS);
        }
        this._set(this.KEYS.RECENTS, recents);
    },

    clearRecents() {
        this._remove(this.KEYS.RECENTS);
    },

    /* ─── Playlists (synced with server) ─── */

    getSavedPlaylists() {
        return this._get(this.KEYS.PLAYLISTS, []);
    },

    savePlaylist(url, name) {
        const playlists = this.getSavedPlaylists();
        const filtered = playlists.filter(p => p.url !== url);
        const playlistName = name || this._extractPlaylistName(url);
        filtered.unshift({
            url,
            name: playlistName,
            addedAt: Date.now(),
        });
        if (filtered.length > this.MAX_PLAYLISTS) {
            filtered.pop();
        }
        this._set(this.KEYS.PLAYLISTS, filtered);

        // Sync to server
        this.savePlaylistToServer(url, playlistName);
    },

    removePlaylist(url) {
        const playlists = this.getSavedPlaylists();
        this._set(this.KEYS.PLAYLISTS, playlists.filter(p => p.url !== url));

        // Sync to server
        this.removePlaylistFromServer(url);
    },

    _extractPlaylistName(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname.split('/').pop();
            return path ? path.replace(/\.(m3u8?|txt)$/i, '') : urlObj.hostname;
        } catch {
            return 'Playlist';
        }
    },

    /* ─── Last State (synced with server) ─── */

    setLastPlaylist(url) {
        this._set(this.KEYS.LAST_PLAYLIST, url);
        this.setLastPlaylistOnServer(url);
    },

    getLastPlaylist() {
        return this._get(this.KEYS.LAST_PLAYLIST, null);
    },

    setLastChannel(channelUrl) {
        this._set(this.KEYS.LAST_CHANNEL, channelUrl);
    },

    getLastChannel() {
        return this._get(this.KEYS.LAST_CHANNEL, null);
    },

    /* ─── Volume (local only - per device) ─── */

    setVolume(vol) {
        this._set(this.KEYS.VOLUME, vol);
    },

    getVolume() {
        return this._get(this.KEYS.VOLUME, 80);
    },

    /* ─── Settings (local only - per device) ─── */

    getSettings() {
        return this._get(this.KEYS.SETTINGS, {
            bufferSize: 30,
            autoReconnect: true,
            retries: 5,
            hideControlsDelay: 5,
            showClock: true,
        });
    },

    updateSettings(partial) {
        const current = this.getSettings();
        this._set(this.KEYS.SETTINGS, { ...current, ...partial });
    },

    /* ─── Clear All ─── */

    clearAll() {
        Object.values(this.KEYS).forEach(key => this._remove(key));
    }
};
