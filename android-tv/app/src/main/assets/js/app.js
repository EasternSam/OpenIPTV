/* ═══════════════════════════════════════════════
   OpenIPTV — Samsung TV App v3
   Favorites + Groups + Paginated + iframe-proxy
   ═══════════════════════════════════════════════ */

(function() {
    "use strict";

    var SERVER = 'https://iptv.90s.agency';
    var PAGE_SIZE = 40;

    // ─── STATE ───
    var channels = [];
    var filteredChannels = [];
    var groups = [];
    var favorites = []; // URLs from server
    var currentGroup = null;
    var currentIndex = -1;
    var sidebarOpen = false;
    var focusedIndex = 0;
    var focusArea = 'none'; // 'sidebar' | 'groups' | 'none'
    var hls = null;
    var osdTimer = null;
    var numberBuffer = '';
    var numberTimer = null;
    var loadingTimer = null;
    var renderPage = 0;
    var totalPages = 1;
    var gridOpen = false;
    var gridFocusIdx = 0;
    var gridFocusArea = 'cards'; // 'groups' | 'cards'
    var gridGroup = 'all';
    var gridChannels = [];
    var GRID_COLS = 6;

    // ─── DOM ───
    var video, iframe, sidebar, channelList, osd, numOsd, numDisplay, loadingMsg;

    // ─── SAMSUNG KEYS ───
    var KEY = {
        LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40,
        ENTER: 13, BACK: 10009, RETURN: 461,
        PLAY: 415, PAUSE: 19, STOP: 413, PLAYPAUSE: 10252,
        CH_UP: 427, CH_DOWN: 428,
        NUM_0: 48, NUM_9: 57,
        ESC: 27, BACKSPACE: 8,
        YELLOW: 405, KEY_F: 70,
        GREEN: 404, BLUE: 406
    };

    // ═══════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════

    function init() {
        video = document.getElementById('video');
        iframe = document.getElementById('iframe');
        sidebar = document.getElementById('sidebar');
        channelList = document.getElementById('channel-list');
        osd = document.getElementById('osd');
        numOsd = document.getElementById('num-osd');
        numDisplay = document.getElementById('num-display');
        loadingMsg = document.getElementById('loading-msg');

        try {
            var keys = ['MediaPlay','MediaPause','MediaStop','MediaPlayPause',
                        'ChannelUp','ChannelDown','ColorF0Yellow','ColorF1Green',
                        '0','1','2','3','4','5','6','7','8','9'];
            for (var k = 0; k < keys.length; k++) {
                tizen.tvinputdevice.registerKey(keys[k]);
            }
        } catch(e) { console.log('Keyboard mode'); }

        document.addEventListener('keydown', handleKey);

        // Remote button handler
        var btnRemote = document.getElementById('btn-remote');
        if (btnRemote) {
            btnRemote.addEventListener('click', function() {
                remoteStartPairing();
            });
        }

        setTimeout(function() {
            document.getElementById('splash').style.display = 'none';
            document.getElementById('main').style.display = 'block';
            loadPlaylistsFromServer();
        }, 2200);
    }

    // ═══════════════════════════════════════
    // SERVER
    // ═══════════════════════════════════════

    function loadPlaylistsFromServer() {
        // Clear any existing retry timer
        if (loadingTimer) { clearInterval(loadingTimer); loadingTimer = null; }
        showLoading('Conectando...');

        // Try PHP API first, then Node.js API as fallback
        tryFetch(SERVER + '/api.php?action=data', function(ok, data) {
            if (ok) {
                handleServerData(data);
            } else {
                // Fallback to Node.js API
                tryFetch(SERVER + '/api/data', function(ok2, data2) {
                    if (ok2) {
                        handleServerData(data2);
                    } else {
                        showLoading('Sin conexión al servidor.\nAgrega playlists desde:\n' + SERVER + '/panel');
                        loadingTimer = setInterval(function() { loadPlaylistsFromServer(); }, 15000);
                    }
                });
            }
        });
    }

    function tryFetch(url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 8000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    callback(true, JSON.parse(xhr.responseText));
                } catch(e) { callback(false, null); }
            } else { callback(false, null); }
        };
        xhr.onerror = function() { callback(false, null); };
        xhr.ontimeout = function() { callback(false, null); };
        xhr.send();
    }

    function handleServerData(data) {
        favorites = data.favorites || [];
        if (data.playlists && data.playlists.length > 0) {
            showLoading('Cargando ' + data.playlists.length + ' lista(s)...');
            loadAllPlaylists(data.playlists);
        } else {
            showLoading('Sin playlists.\nAgrega desde: ' + SERVER + '/panel');
            loadingTimer = setInterval(function() { loadPlaylistsFromServer(); }, 10000);
        }
    }

    function loadAllPlaylists(playlists) {
        var loaded = 0;
        var total = playlists.length;
        for (var i = 0; i < playlists.length; i++) {
            (function(pl, idx) {
                showLoading('Descargando ' + (idx + 1) + '/' + total + '...');
                var xhr2 = new XMLHttpRequest();
                xhr2.open('GET', pl.url, true);
                xhr2.timeout = 20000;
                xhr2.onload = function() {
                    if (xhr2.status === 200) parseM3U(xhr2.responseText, pl.name || ('Lista ' + (idx + 1)));
                    loaded++;
                    if (loaded >= total) finishLoading();
                };
                xhr2.onerror = function() { loaded++; if (loaded >= total) finishLoading(); };
                xhr2.ontimeout = function() { loaded++; if (loaded >= total) finishLoading(); };
                xhr2.send();
            })(playlists[i], i);
        }
    }

    function finishLoading() {
        if (loadingTimer) { clearInterval(loadingTimer); loadingTimer = null; }
        if (channels.length === 0) {
            showLoading('No se encontraron canales.\n' + SERVER + '/panel');
            return;
        }
        loadingMsg.style.display = 'none';

        // Start with favorites if any exist
        if (getFavoriteChannels().length > 0) {
            selectGroup('⭐ Favoritos');
        } else {
            showSidebar();
            focusArea = 'groups';
            focusedIndex = 0;
            updateFocus();
        }
    }

    function showLoading(msg) {
        loadingMsg.innerHTML = '<div class="loading-spinner"></div><div>' + msg.replace(/\n/g, '<br>') + '</div>';
        loadingMsg.style.display = 'flex';
    }

    // ═══════════════════════════════════════
    // M3U PARSER
    // ═══════════════════════════════════════

    function parseM3U(text, playlistName) {
        var lines = text.split('\n');
        var name = '', group = '', logo = '', url = '';
        var grpSet = {};
        var urlSet = {};
        for (var e = 0; e < channels.length; e++) urlSet[channels[e].url] = true;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXTINF') === 0) {
                var commaIdx = line.lastIndexOf(',');
                name = commaIdx > -1 ? line.substring(commaIdx + 1).trim() : 'Canal';
                var gm = line.match(/group-title="([^"]*)"/);
                group = gm ? gm[1] : '';
                var lm = line.match(/tvg-logo="([^"]*)"/);
                logo = lm ? lm[1] : '';
                if (name.indexOf('|iframe') > -1) name = name.replace('|iframe', '').trim();
            } else if (line && line.charAt(0) !== '#') {
                url = line;
                if (name && url && !urlSet[url]) {
                    var isIframe = url.indexOf('.m3u8') === -1 && url.indexOf('.ts') === -1 && url.indexOf('rtmp') === -1;
                    var grp = group || playlistName;
                    channels.push({
                        name: name, group: grp, logo: logo, url: url,
                        iframe: isIframe && (url.indexOf('http') === 0),
                        num: channels.length + 1
                    });
                    urlSet[url] = true;
                    if (grp) grpSet[grp] = true;
                }
                name = ''; group = ''; logo = ''; url = '';
            }
        }
        for (var g in grpSet) {
            if (grpSet.hasOwnProperty(g) && groups.indexOf(g) === -1) groups.push(g);
        }
        groups.sort();
    }

    // ═══════════════════════════════════════
    // FAVORITES
    // ═══════════════════════════════════════

    function getFavoriteChannels() {
        var favs = [];
        for (var i = 0; i < channels.length; i++) {
            if (favorites.indexOf(channels[i].url) > -1) favs.push(channels[i]);
        }
        return favs;
    }

    function isFavorite(ch) {
        return favorites.indexOf(ch.url) > -1;
    }

    function toggleFavorite(ch) {
        var idx = favorites.indexOf(ch.url);
        var nowFav;
        if (idx > -1) {
            favorites.splice(idx, 1);
            nowFav = false;
        } else {
            favorites.push(ch.url);
            nowFav = true;
        }

        // Sync to server
        var xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER + '/api.php?action=favorites', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    favorites = data.favorites || favorites;
                } catch(e) {}
            }
        };
        xhr.send(JSON.stringify({ url: ch.url }));

        // Show toast
        showFavToast(ch.name, nowFav);

        // Refresh visible UI
        if (sidebarOpen) { renderChannels(); updateFocus(); }
        if (gridOpen) { renderGridGroups(); renderGrid(); updateGridFocus(); }
    }

    function showFavToast(name, added) {
        var existing = document.getElementById('fav-toast');
        if (existing) existing.parentNode.removeChild(existing);
        var toast = document.createElement('div');
        toast.id = 'fav-toast';
        toast.style.cssText = 'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);z-index:999;' +
            'background:rgba(12,12,40,0.95);border:1px solid ' + (added ? 'rgba(250,204,21,0.5)' : 'rgba(255,255,255,0.1)') + ';' +
            'border-radius:16px;padding:18px 36px;font-size:22px;color:#f0f0ff;' +
            'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);animation:fadeIn 0.25s ease;';
        toast.textContent = (added ? '⭐ ' : '☆ ') + name + (added ? ' añadido a favoritos' : ' quitado de favoritos');
        document.getElementById('main').appendChild(toast);
        setTimeout(function() {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 2500);
    }

    // ═══════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════

    function renderGroups() {
        var container = document.getElementById('groups');
        var html = '';

        // Favorites always first
        var favCount = getFavoriteChannels().length;
        html += '<button class="group-btn focusable' + (currentGroup === '⭐ Favoritos' ? ' active' : '') + '" data-group="⭐ Favoritos">⭐ Favoritos' + (favCount > 0 ? ' (' + favCount + ')' : '') + '</button>';

        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var count = 0;
            for (var c = 0; c < channels.length; c++) {
                if (channels[c].group === g) count++;
            }
            html += '<button class="group-btn focusable' + (currentGroup === g ? ' active' : '') + '" data-group="' + escapeHtml(g) + '">' + escapeHtml(g) + ' (' + count + ')</button>';
        }
        container.innerHTML = html;

        var btns = container.querySelectorAll('.group-btn');
        for (var j = 0; j < btns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    selectGroup(btn.getAttribute('data-group'));
                });
            })(btns[j]);
        }
    }

    function renderChannels() {
        var start = renderPage * PAGE_SIZE;
        var end = Math.min(start + PAGE_SIZE, filteredChannels.length);
        totalPages = Math.ceil(filteredChannels.length / PAGE_SIZE);
        if (totalPages < 1) totalPages = 1;

        var html = '';
        if (filteredChannels.length === 0) {
            if (currentGroup === '⭐ Favoritos') {
                html = '<div class="ch-empty">Sin favoritos.<br>Agrega desde el celular.</div>';
            } else {
                html = '<div class="ch-empty">Sin canales en este grupo.</div>';
            }
        }

        for (var i = start; i < end; i++) {
            var ch = filteredChannels[i];
            var isActive = (currentIndex > -1 && channels[currentIndex] && channels[currentIndex].url === ch.url);
            var fav = isFavorite(ch) ? ' ⭐' : '';
            var typeTag = ch.iframe ? '<span class="ch-type">WEB</span>' : '';
            html += '<div class="ch-item focusable' + (isActive ? ' active' : '') + '" data-idx="' + i + '">' +
                '<div class="ch-item-num">' + ch.num + '</div>' +
                '<div class="ch-item-info">' +
                '<div class="ch-item-name">' + escapeHtml(ch.name) + fav + '</div>' +
                '<div class="ch-item-group">' + typeTag + escapeHtml(ch.group) + '</div>' +
                '</div></div>';
        }

        var pageInfo = filteredChannels.length + ' canales';
        if (totalPages > 1) pageInfo += '  •  Pág ' + (renderPage + 1) + '/' + totalPages;
        document.getElementById('ch-count').textContent = pageInfo;
        channelList.innerHTML = html;

        var items = channelList.querySelectorAll('.ch-item');
        for (var j = 0; j < items.length; j++) {
            (function(item) {
                item.addEventListener('click', function() {
                    playChannel(parseInt(item.getAttribute('data-idx')));
                });
            })(items[j]);
        }
    }

    function selectGroup(g) {
        currentGroup = g;
        if (g === '⭐ Favoritos') {
            filteredChannels = getFavoriteChannels();
        } else {
            filteredChannels = [];
            for (var i = 0; i < channels.length; i++) {
                if (channels[i].group === g) filteredChannels.push(channels[i]);
            }
        }
        renderPage = 0;
        renderGroups();
        renderChannels();

        if (!sidebarOpen) showSidebar();
        focusArea = 'sidebar';
        focusedIndex = 0;
        updateFocus();
    }

    // ═══════════════════════════════════════
    // PLAYBACK
    // ═══════════════════════════════════════

    function startPlayback(ch) {
        // Clean up previous iframe overlay
        var oldOverlay = document.getElementById('iframe-overlay');
        if (oldOverlay && oldOverlay.parentNode) oldOverlay.parentNode.removeChild(oldOverlay);

        if (ch.iframe) {
            // IFRAME PLAYBACK
            video.style.display = 'none';
            video.src = '';
            if (hls) { hls.destroy(); hls = null; }

            var finalUrl = ch.url;
            try {
                var u = new URL(ch.url);
                if (!u.searchParams.has('autoplay')) u.searchParams.set('autoplay', '1');
                if (!u.searchParams.has('auto_play')) u.searchParams.set('auto_play', '1');
                finalUrl = u.toString();
            } catch(e) {}

            iframe.src = finalUrl;
            iframe.style.display = 'block';

            // Auto-focus iframe after 2.5s (no event listener stacking)
            setTimeout(function() {
                iframe.focus();
            }, 2500);

        } else {
            // VIDEO PLAYBACK
            iframe.style.display = 'none';
            iframe.src = '';
            video.style.display = 'block';
            if (hls) { hls.destroy(); hls = null; }

            if (ch.url.indexOf('.m3u8') > -1 && typeof Hls !== 'undefined' && Hls.isSupported()) {
                hls = new Hls({ enableWorker: false });
                hls.loadSource(ch.url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function(){}); });
                hls.on(Hls.Events.ERROR, function(ev, data) { if (data.fatal) console.log('HLS:', data.type); });
            } else {
                video.src = ch.url;
                video.play().catch(function(){});
            }
        }
    }

    function playChannel(filteredIdx) {
        var ch = filteredChannels[filteredIdx];
        if (!ch) return;
        for (var i = 0; i < channels.length; i++) {
            if (channels[i].url === ch.url) { currentIndex = i; break; }
        }
        showOSD(ch);
        startPlayback(ch);
        renderChannels();
        hideSidebar();
    }

    function playByNumber(num) {
        for (var i = 0; i < channels.length; i++) {
            if (channels[i].num === num) {
                currentIndex = i;
                showOSD(channels[i]);
                startPlayback(channels[i]);
                return;
            }
        }
    }

    function nextChannel() {
        if (channels.length === 0) return;
        currentIndex = (currentIndex + 1) % channels.length;
        showOSD(channels[currentIndex]);
        startPlayback(channels[currentIndex]);
    }

    function prevChannel() {
        if (channels.length === 0) return;
        currentIndex = currentIndex - 1;
        if (currentIndex < 0) currentIndex = channels.length - 1;
        showOSD(channels[currentIndex]);
        startPlayback(channels[currentIndex]);
    }

    // ═══════════════════════════════════════
    // OSD
    // ═══════════════════════════════════════

    function showOSD(ch) {
        document.getElementById('osd-num').textContent = ch.num;
        document.getElementById('osd-name').textContent = ch.name;
        document.getElementById('osd-group').textContent = ch.group || '';
        osd.style.display = 'flex';
        clearTimeout(osdTimer);
        osdTimer = setTimeout(function() { osd.style.display = 'none'; }, 4000);
    }

    // ═══════════════════════════════════════
    // SIDEBAR
    // ═══════════════════════════════════════

    function showSidebar() {
        renderGroups();
        if (currentGroup) {
            renderChannels();
        } else {
            channelList.innerHTML = '<div class="ch-empty">Selecciona un grupo ▲</div>';
            document.getElementById('ch-count').textContent = channels.length + ' canales total';
        }
        sidebar.style.display = 'flex';
        sidebarOpen = true;

        if (currentGroup && filteredChannels.length > 0) {
            focusArea = 'sidebar';
            var items = channelList.querySelectorAll('.ch-item');
            focusedIndex = 0;
            for (var i = 0; i < items.length; i++) {
                if (items[i].classList.contains('active')) { focusedIndex = i; break; }
            }
        } else {
            focusArea = 'groups';
            focusedIndex = 0;
        }
        updateFocus();
    }

    function hideSidebar() {
        sidebar.style.display = 'none';
        sidebarOpen = false;
        focusArea = 'none';
        clearAllFocus();
    }

    // ═══════════════════════════════════════
    // FOCUS
    // ═══════════════════════════════════════

    function clearAllFocus() {
        var all = document.querySelectorAll('.focused');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('focused');
    }

    function setFocus(el) {
        clearAllFocus();
        if (!el) return;
        el.classList.add('focused');
        el.focus();
        var parent = el.closest('.sidebar-list');
        if (parent) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        var grpP = el.closest('.sidebar-groups');
        if (grpP) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }

    function updateFocus() {
        if (focusArea === 'sidebar') {
            var items = channelList.querySelectorAll('.ch-item');
            if (items.length > 0) {
                if (focusedIndex >= items.length) focusedIndex = items.length - 1;
                if (focusedIndex < 0) focusedIndex = 0;
                setFocus(items[focusedIndex]);
            }
        } else if (focusArea === 'groups') {
            var btns = document.querySelectorAll('.group-btn');
            if (btns.length > 0) {
                if (focusedIndex >= btns.length) focusedIndex = btns.length - 1;
                if (focusedIndex < 0) focusedIndex = 0;
                setFocus(btns[focusedIndex]);
            }
        } else if (focusArea === 'remote-btn') {
            var remBtn = document.getElementById('btn-remote');
            if (remBtn) setFocus(remBtn);
        }
    }

    // ═══════════════════════════════════════
    // KEYS
    // ═══════════════════════════════════════

    function handleKey(e) {
        var code = e.keyCode;

        // ─── REMOTE PAIR OVERLAY ───
        if (remotePairOverlayVisible) {
            if (code === KEY.GREEN || code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                e.preventDefault();
                remoteHidePairOverlay();
            }
            return;
        }

        // ─── GREEN KEY = Start Remote Pairing ───
        if (code === KEY.GREEN) {
            e.preventDefault();
            remoteStartPairing();
            return;
        }

        // ─── REMOTE BUTTON ───
        if (sidebarOpen && focusArea === 'remote-btn') {
            if (code === KEY.UP) {
                e.preventDefault();
                focusArea = 'sidebar';
                var items = channelList.querySelectorAll('.ch-item');
                focusedIndex = items.length > 0 ? items.length - 1 : 0;
                updateFocus();
            } else if (code === KEY.ENTER) {
                e.preventDefault();
                remoteStartPairing();
            } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                e.preventDefault(); hideSidebar();
            }
            return;
        }

        // ─── CHANNEL LIST ───
        if (sidebarOpen && focusArea === 'sidebar') {
            if (code === KEY.DOWN) {
                e.preventDefault();
                var items = channelList.querySelectorAll('.ch-item');
                if (focusedIndex < items.length - 1) {
                    focusedIndex++; updateFocus();
                } else if (renderPage < totalPages - 1) {
                    renderPage++; renderChannels();
                    focusedIndex = 0; updateFocus();
                } else {
                    // Last item on last page → focus remote button
                    focusArea = 'remote-btn';
                    updateFocus();
                }
            } else if (code === KEY.UP) {
                e.preventDefault();
                if (focusedIndex > 0) {
                    focusedIndex--; updateFocus();
                } else if (renderPage > 0) {
                    renderPage--; renderChannels();
                    var it = channelList.querySelectorAll('.ch-item');
                    focusedIndex = it.length - 1; updateFocus();
                } else {
                    focusArea = 'groups'; focusedIndex = 0;
                    var btns = document.querySelectorAll('.group-btn');
                    for (var i = 0; i < btns.length; i++) {
                        if (btns[i].classList.contains('active')) { focusedIndex = i; break; }
                    }
                    updateFocus();
                }
            } else if (code === KEY.ENTER) {
                e.preventDefault();
                var it2 = channelList.querySelectorAll('.ch-item');
                if (it2[focusedIndex]) it2[focusedIndex].click();
            } else if (code === KEY.YELLOW || code === KEY.KEY_F) {
                e.preventDefault();
                var chItems = channelList.querySelectorAll('.ch-item');
                if (chItems[focusedIndex]) {
                    var startIdx = renderPage * PAGE_SIZE;
                    var ch = filteredChannels[startIdx + focusedIndex];
                    if (ch) toggleFavorite(ch);
                }
            } else if (code === KEY.RIGHT || code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                e.preventDefault(); hideSidebar();
            }
            return;
        }

        // ─── GROUPS ───
        if (sidebarOpen && focusArea === 'groups') {
            if (code === KEY.LEFT) {
                e.preventDefault();
                if (focusedIndex > 0) { focusedIndex--; updateFocus(); }
            } else if (code === KEY.RIGHT) {
                e.preventDefault();
                var g = document.querySelectorAll('.group-btn');
                if (focusedIndex < g.length - 1) { focusedIndex++; updateFocus(); }
            } else if (code === KEY.DOWN) {
                e.preventDefault();
                if (currentGroup && filteredChannels.length > 0) {
                    focusArea = 'sidebar'; focusedIndex = 0; updateFocus();
                }
            } else if (code === KEY.ENTER) {
                e.preventDefault();
                var g2 = document.querySelectorAll('.group-btn');
                if (g2[focusedIndex]) g2[focusedIndex].click();
            } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                e.preventDefault();
                if (currentIndex > -1) { hideSidebar(); }
                else {
                    try { tizen.application.getCurrentApplication().exit(); } catch(ex) {
                        try { AndroidApp.exit(); } catch(e) {}
                    }
                }
            }
            return;
        }

        // ─── GRID BROWSER ───
        if (gridOpen) {
            handleGridKey(e);
            return;
        }

        // ─── PLAYER ───
        if (code === KEY.ENTER || code === KEY.LEFT) {
            e.preventDefault();
            if (channels.length > 0) showSidebar();
        } else if (code === KEY.RIGHT) {
            e.preventDefault();
            if (channels.length > 0) showGrid();
        } else if (code === KEY.CH_UP || code === KEY.UP) {
            e.preventDefault(); nextChannel();
        } else if (code === KEY.CH_DOWN || code === KEY.DOWN) {
            e.preventDefault(); prevChannel();
        } else if (code === KEY.PLAY || code === KEY.PLAYPAUSE) {
            e.preventDefault();
            if (video.paused) video.play().catch(function(){}); else video.pause();
        } else if (code === KEY.PAUSE) {
            e.preventDefault(); video.pause();
        } else if (code === KEY.STOP) {
            e.preventDefault();
            video.pause(); video.src = '';
            iframe.src = ''; iframe.style.display = 'none';
        } else if (code === KEY.YELLOW || code === KEY.KEY_F) {
            e.preventDefault();
            if (currentIndex > -1 && channels[currentIndex]) {
                toggleFavorite(channels[currentIndex]);
            }
        } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
            e.preventDefault();
            if (osd.style.display !== 'none') { osd.style.display = 'none'; }
            else if (currentIndex > -1) { showSidebar(); }
            else {
                try { tizen.application.getCurrentApplication().exit(); } catch(ex) {
                    try { AndroidApp.exit(); } catch(e) {}
                }
            }
        } else if (code >= KEY.NUM_0 && code <= KEY.NUM_9) {
            e.preventDefault();
            handleNumber(code - KEY.NUM_0);
        }
    }

    function handleNumber(n) {
        numberBuffer += n.toString();
        numDisplay.textContent = numberBuffer;
        numOsd.style.display = 'block';
        clearTimeout(numberTimer);
        numberTimer = setTimeout(function() {
            var num = parseInt(numberBuffer);
            numberBuffer = '';
            numOsd.style.display = 'none';
            if (num > 0) playByNumber(num);
        }, 1500);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ═══════════════════════════════════════
    // GRID BROWSER
    // ═══════════════════════════════════════

    function showGrid() {
        hideSidebar();
        gridGroup = 'all';
        gridChannels = channels;
        gridFocusIdx = 0;
        gridFocusArea = 'cards';
        renderGridGroups();
        renderGrid();
        document.getElementById('grid-browser').style.display = 'flex';
        gridOpen = true;
        updateGridFocus();
    }

    function hideGrid() {
        document.getElementById('grid-browser').style.display = 'none';
        gridOpen = false;
    }

    function renderGridGroups() {
        var container = document.getElementById('grid-groups');
        var html = '<button class="grid-group-btn focusable' + (gridGroup === 'all' ? ' active' : '') + '" data-grp="all">Todos (' + channels.length + ')</button>';

        // Favorites
        var favCount = 0;
        for (var f = 0; f < channels.length; f++) { if (favorites.indexOf(channels[f].url) > -1) favCount++; }
        if (favCount > 0) {
            html += '<button class="grid-group-btn focusable' + (gridGroup === '⭐ Favoritos' ? ' active' : '') + '" data-grp="⭐ Favoritos">⭐ Favoritos (' + favCount + ')</button>';
        }

        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var cnt = 0;
            for (var c = 0; c < channels.length; c++) { if (channels[c].group === g) cnt++; }
            html += '<button class="grid-group-btn focusable' + (gridGroup === g ? ' active' : '') + '" data-grp="' + escapeHtml(g) + '">' + escapeHtml(g) + ' (' + cnt + ')</button>';
        }
        container.innerHTML = html;

        var btns = container.querySelectorAll('.grid-group-btn');
        for (var j = 0; j < btns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    selectGridGroup(btn.getAttribute('data-grp'));
                });
            })(btns[j]);
        }
    }

    function selectGridGroup(g) {
        gridGroup = g;
        if (g === 'all') {
            gridChannels = channels;
        } else if (g === '⭐ Favoritos') {
            gridChannels = [];
            for (var i = 0; i < channels.length; i++) {
                if (favorites.indexOf(channels[i].url) > -1) gridChannels.push(channels[i]);
            }
        } else {
            gridChannels = [];
            for (var i = 0; i < channels.length; i++) {
                if (channels[i].group === g) gridChannels.push(channels[i]);
            }
        }
        gridFocusIdx = 0;
        gridFocusArea = 'cards';
        renderGridGroups();
        renderGrid();
        updateGridFocus();
    }

    function renderGrid() {
        var container = document.getElementById('grid-container');
        var max = Math.min(gridChannels.length, 200);
        var html = '';
        for (var i = 0; i < max; i++) {
            var ch = gridChannels[i];
            var isActive = (currentIndex > -1 && channels[currentIndex] && channels[currentIndex].url === ch.url);
            var isFav = favorites.indexOf(ch.url) > -1;
            var logoHtml = ch.logo
                ? '<img class="grid-card-logo" src="' + escapeHtml(ch.logo) + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" /><div class="grid-card-initial" style="display:none">' + escapeHtml(ch.name.substring(0, 3).toUpperCase()) + '</div>'
                : '<div class="grid-card-initial">' + escapeHtml(ch.name.substring(0, 3).toUpperCase()) + '</div>';

            html += '<div class="grid-card focusable' + (isActive ? ' active' : '') + '" data-gidx="' + i + '">' +
                '<span class="grid-card-num">' + ch.num + '</span>' +
                (isFav ? '<span class="grid-card-fav">⭐</span>' : '') +
                logoHtml +
                '<div class="grid-card-name">' + escapeHtml(ch.name) + '</div>' +
                '</div>';
        }
        container.innerHTML = html;
        document.getElementById('grid-info').textContent = gridChannels.length + ' canales';

        var cards = container.querySelectorAll('.grid-card');
        for (var j = 0; j < cards.length; j++) {
            (function(card) {
                card.addEventListener('click', function() {
                    playGridChannel(parseInt(card.getAttribute('data-gidx')));
                });
            })(cards[j]);
        }
    }

    function playGridChannel(idx) {
        var ch = gridChannels[idx];
        if (!ch) return;
        for (var i = 0; i < channels.length; i++) {
            if (channels[i].url === ch.url) { currentIndex = i; break; }
        }
        showOSD(ch);
        startPlayback(ch);
        hideGrid();
    }

    function updateGridFocus() {
        clearAllFocus();
        if (gridFocusArea === 'groups') {
            var btns = document.querySelectorAll('.grid-group-btn');
            if (btns.length > 0) {
                if (gridFocusIdx >= btns.length) gridFocusIdx = btns.length - 1;
                if (gridFocusIdx < 0) gridFocusIdx = 0;
                setFocus(btns[gridFocusIdx]);
            }
        } else {
            var cards = document.querySelectorAll('.grid-card');
            if (cards.length > 0) {
                if (gridFocusIdx >= cards.length) gridFocusIdx = cards.length - 1;
                if (gridFocusIdx < 0) gridFocusIdx = 0;
                setFocus(cards[gridFocusIdx]);
                cards[gridFocusIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    function handleGridKey(e) {
        var code = e.keyCode;
        e.preventDefault();

        if (gridFocusArea === 'groups') {
            if (code === KEY.LEFT && gridFocusIdx > 0) { gridFocusIdx--; updateGridFocus(); }
            else if (code === KEY.RIGHT) {
                var gb = document.querySelectorAll('.grid-group-btn');
                if (gridFocusIdx < gb.length - 1) { gridFocusIdx++; updateGridFocus(); }
            }
            else if (code === KEY.DOWN) { gridFocusArea = 'cards'; gridFocusIdx = 0; updateGridFocus(); }
            else if (code === KEY.ENTER) {
                var gb2 = document.querySelectorAll('.grid-group-btn');
                if (gb2[gridFocusIdx]) gb2[gridFocusIdx].click();
            }
            else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) { hideGrid(); }
        } else {
            // Cards area
            var total = document.querySelectorAll('.grid-card').length;
            if (code === KEY.RIGHT) {
                if (gridFocusIdx < total - 1) { gridFocusIdx++; updateGridFocus(); }
            } else if (code === KEY.LEFT) {
                if (gridFocusIdx > 0) { gridFocusIdx--; updateGridFocus(); }
            } else if (code === KEY.DOWN) {
                if (gridFocusIdx + GRID_COLS < total) { gridFocusIdx += GRID_COLS; updateGridFocus(); }
            } else if (code === KEY.UP) {
                if (gridFocusIdx - GRID_COLS >= 0) {
                    gridFocusIdx -= GRID_COLS; updateGridFocus();
                } else {
                    // Go to groups
                    gridFocusArea = 'groups'; gridFocusIdx = 0;
                    var gb3 = document.querySelectorAll('.grid-group-btn');
                    for (var i = 0; i < gb3.length; i++) {
                        if (gb3[i].classList.contains('active')) { gridFocusIdx = i; break; }
                    }
                    updateGridFocus();
                }
            } else if (code === KEY.ENTER) {
                playGridChannel(gridFocusIdx);
            } else if (code === KEY.YELLOW || code === KEY.KEY_F) {
                if (gridChannels[gridFocusIdx]) toggleFavorite(gridChannels[gridFocusIdx]);
            } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                hideGrid();
            }
        }
    }

    // ═══════════════════════════════════════
    // REMOTE CONTROL (Phone → TV via PHP polling)
    // ═══════════════════════════════════════

    var remoteCode = null;
    var remotePollInterval = null;
    var remoteStateInterval = null;
    var remotePhoneConnected = false;
    var remotePairOverlayVisible = false;

    function remoteStartPairing() {
        if (remotePairOverlayVisible) {
            remoteHidePairOverlay();
            return;
        }

        remoteStop();

        var xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER + '/api.php?action=remote-pair', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 8000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    remoteCode = data.code;
                    remoteShowPairOverlay(remoteCode);
                    remoteStartPolling(remoteCode);
                } catch(e) {
                    showRemoteToast('❌ Error al generar código');
                }
            } else {
                showRemoteToast('❌ Error de servidor');
            }
        };
        xhr.onerror = function() { showRemoteToast('❌ Sin conexión al servidor'); };
        xhr.send('{}');
    }

    function remoteStartPolling(code) {
        if (remotePollInterval) clearInterval(remotePollInterval);

        remotePollInterval = setInterval(function() {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', SERVER + '/api.php?action=remote-tv-poll&code=' + code, true);
            xhr.timeout = 5000;
            xhr.onload = function() {
                if (xhr.status !== 200) return;
                try {
                    var data = JSON.parse(xhr.responseText);

                    if (data.phoneConnected && !remotePhoneConnected) {
                        remotePhoneConnected = true;
                        remoteUpdateOverlayStatus(true);
                        showRemoteToast('📱 Control remoto conectado');
                        remoteReportState();
                    }

                    if (data.commands && data.commands.length > 0) {
                        for (var i = 0; i < data.commands.length; i++) {
                            remoteHandleCommand(data.commands[i].command, data.commands[i].data);
                        }
                    }
                } catch(e) {}
            };
            xhr.send();
        }, 1500);

        // Report state every 3 seconds
        if (remoteStateInterval) clearInterval(remoteStateInterval);
        remoteStateInterval = setInterval(function() {
            if (remotePhoneConnected) remoteReportState();
        }, 3000);
    }

    function remoteHandleCommand(command, data) {
        switch(command) {
            case 'navigate':
                if (data && data.direction) {
                    var keyMap = { up: KEY.UP, down: KEY.DOWN, left: KEY.LEFT, right: KEY.RIGHT };
                    var fakeCode = keyMap[data.direction];
                    if (fakeCode) {
                        handleKey({ keyCode: fakeCode, preventDefault: function(){} });
                    }
                }
                break;
            case 'enter':
                handleKey({ keyCode: KEY.ENTER, preventDefault: function(){} });
                break;
            case 'back':
                handleKey({ keyCode: KEY.BACK, preventDefault: function(){} });
                break;
            case 'play-pause':
                if (video.paused) video.play().catch(function(){}); else video.pause();
                break;
            case 'stop':
                video.pause(); video.src = '';
                iframe.src = ''; iframe.style.display = 'none';
                break;
            case 'channel-up':
                nextChannel();
                break;
            case 'channel-down':
                prevChannel();
                break;
            case 'number':
                if (data && typeof data.number !== 'undefined') handleNumber(data.number);
                break;
            case 'play-channel':
                if (data && data.url) {
                    for (var i = 0; i < channels.length; i++) {
                        if (channels[i].url === data.url) {
                            currentIndex = i;
                            showOSD(channels[i]);
                            startPlayback(channels[i]);
                            hideSidebar();
                            if (gridOpen) hideGrid();
                            break;
                        }
                    }
                }
                break;
            case 'volume-up':
            case 'volume-down':
                // Volume control is hardware-level on Samsung TV
                break;
        }
    }

    var remoteChannelsSent = false;

    function remoteReportState() {
        if (!remoteCode) return;
        var state = {
            currentChannel: null,
            isPlaying: !video.paused || iframe.style.display === 'block'
        };

        // Send full channel list only once (first time after connect)
        if (!remoteChannelsSent) {
            state.channels = [];
            for (var i = 0; i < channels.length; i++) {
                state.channels.push({
                    name: channels[i].name,
                    group: channels[i].group,
                    url: channels[i].url,
                    num: channels[i].num
                });
            }
            remoteChannelsSent = true;
        }

        if (currentIndex > -1 && channels[currentIndex]) {
            state.currentChannel = {
                name: channels[currentIndex].name,
                group: channels[currentIndex].group,
                url: channels[currentIndex].url,
                num: channels[currentIndex].num
            };
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER + '/api.php?action=remote-sync', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 10000;
        xhr.send(JSON.stringify({ code: remoteCode, state: state }));
    }

    function remoteShowPairOverlay(code) {
        var existing = document.getElementById('remote-pair-overlay');
        if (existing) existing.parentNode.removeChild(existing);

        var overlay = document.createElement('div');
        overlay.id = 'remote-pair-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;' +
            'background:rgba(6,6,26,0.92);display:flex;align-items:center;justify-content:center;' +
            'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);animation:fadeIn 0.3s ease;';

        var digits = code.split('').map(function(d) {
            return '<span style="display:inline-flex;align-items:center;justify-content:center;' +
                'width:100px;height:120px;font-size:64px;font-weight:800;color:#fff;' +
                'background:rgba(99,102,241,0.15);border:2px solid rgba(99,102,241,0.4);' +
                'border-radius:16px;margin:0 8px;">' + d + '</span>';
        }).join('');

        overlay.innerHTML =
            '<div style="text-align:center;max-width:600px;">' +
                '<div style="font-size:48px;margin-bottom:16px;">📱</div>' +
                '<div style="font-size:28px;font-weight:700;color:#f0f0ff;margin-bottom:8px;">Conectar Control Remoto</div>' +
                '<div style="font-size:18px;color:rgba(240,240,255,0.5);margin-bottom:32px;">Abre en tu celular:</div>' +
                '<div style="font-size:22px;color:rgba(167,139,250,1);font-weight:600;margin-bottom:32px;' +
                    'background:rgba(99,102,241,0.1);padding:14px 24px;border-radius:12px;border:1px solid rgba(99,102,241,0.2);">' +
                    SERVER + '/remote</div>' +
                '<div style="font-size:16px;color:rgba(240,240,255,0.4);margin-bottom:16px;">e ingresa este código:</div>' +
                '<div id="remote-pair-digits" style="display:flex;justify-content:center;margin-bottom:24px;">' + digits + '</div>' +
                '<div id="remote-pair-status" style="font-size:16px;color:rgba(240,240,255,0.3);">⏳ Esperando conexión...</div>' +
                '<div style="font-size:14px;color:rgba(240,240,255,0.2);margin-top:24px;">Presiona 🟢 Verde o BACK para cerrar</div>' +
            '</div>';

        document.body.appendChild(overlay);
        remotePairOverlayVisible = true;
    }

    function remoteUpdateOverlayStatus(connected) {
        var status = document.getElementById('remote-pair-status');
        if (status) {
            if (connected) {
                status.innerHTML = '✅ <span style="color:#4ade80;font-weight:600;">¡Celular conectado!</span>';
                setTimeout(function() {
                    remoteHidePairOverlay();
                }, 2000);
            }
        }
    }

    function remoteHidePairOverlay() {
        var overlay = document.getElementById('remote-pair-overlay');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        remotePairOverlayVisible = false;
    }

    function remoteStop() {
        if (remotePollInterval) { clearInterval(remotePollInterval); remotePollInterval = null; }
        if (remoteStateInterval) { clearInterval(remoteStateInterval); remoteStateInterval = null; }
        remoteCode = null;
        remotePhoneConnected = false;
        remoteChannelsSent = false;
        remoteHidePairOverlay();
    }

    function showRemoteToast(msg) {
        var existing = document.getElementById('remote-toast');
        if (existing) existing.parentNode.removeChild(existing);
        var toast = document.createElement('div');
        toast.id = 'remote-toast';
        toast.style.cssText = 'position:fixed;top:40px;right:40px;z-index:10000;' +
            'background:rgba(12,12,40,0.95);border:1px solid rgba(99,102,241,0.4);' +
            'border-radius:16px;padding:18px 36px;font-size:22px;color:#f0f0ff;' +
            'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);animation:fadeIn 0.25s ease;';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function() {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3000);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
