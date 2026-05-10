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

    // ─── DOM ───
    var video, iframe, sidebar, channelList, osd, numOsd, numDisplay, loadingMsg;

    // ─── SAMSUNG KEYS ───
    var KEY = {
        LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40,
        ENTER: 13, BACK: 10009, RETURN: 461,
        PLAY: 415, PAUSE: 19, STOP: 413, PLAYPAUSE: 10252,
        CH_UP: 427, CH_DOWN: 428,
        NUM_0: 48, NUM_9: 57,
        ESC: 27, BACKSPACE: 8
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
                        'ChannelUp','ChannelDown',
                        '0','1','2','3','4','5','6','7','8','9'];
            for (var k = 0; k < keys.length; k++) {
                tizen.tvinputdevice.registerKey(keys[k]);
            }
        } catch(e) { console.log('Keyboard mode'); }

        document.addEventListener('keydown', handleKey);

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
        showLoading('Conectando...');

        var xhr = new XMLHttpRequest();
        xhr.open('GET', SERVER + '/api/data', true);
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    favorites = data.favorites || [];
                    if (data.playlists && data.playlists.length > 0) {
                        showLoading('Cargando ' + data.playlists.length + ' lista(s)...');
                        loadAllPlaylists(data.playlists);
                    } else {
                        showLoading('Sin playlists.\nAgrega desde: ' + SERVER + '/panel');
                        loadingTimer = setInterval(function() { loadPlaylistsFromServer(); }, 10000);
                    }
                } catch(e) { showLoading('Error al leer datos'); }
            } else { showLoading('Error: ' + xhr.status); }
        };
        xhr.onerror = function() { showLoading('Sin conexión'); };
        xhr.ontimeout = function() {
            showLoading('Timeout. Reintentando...');
            setTimeout(loadPlaylistsFromServer, 3000);
        };
        xhr.send();
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
        if (ch.iframe) {
            // Use the server's iframe-proxy for proper autoplay
            video.style.display = 'none';
            video.src = '';
            if (hls) { hls.destroy(); hls = null; }

            var proxyUrl = SERVER + '/api/iframe-proxy?url=' + encodeURIComponent(ch.url);
            iframe.src = proxyUrl;
            iframe.style.display = 'block';

            // Auto-focus iframe after load for remote control passthrough
            setTimeout(function() { iframe.focus(); }, 1500);
            setTimeout(function() { iframe.focus(); }, 3000);
        } else {
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
        }
    }

    // ═══════════════════════════════════════
    // KEYS
    // ═══════════════════════════════════════

    function handleKey(e) {
        var code = e.keyCode;

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
                else { try { tizen.application.getCurrentApplication().exit(); } catch(ex) {} }
            }
            return;
        }

        // ─── PLAYER ───
        if (code === KEY.ENTER || code === KEY.LEFT) {
            e.preventDefault();
            if (channels.length > 0) showSidebar();
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
        } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
            e.preventDefault();
            if (osd.style.display !== 'none') { osd.style.display = 'none'; }
            else if (currentIndex > -1) { showSidebar(); }
            else { try { tizen.application.getCurrentApplication().exit(); } catch(ex) {} }
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

    document.addEventListener('DOMContentLoaded', init);
})();
