/* ═══════════════════════════════════════════════
   OpenIPTV — Samsung TV Standalone App
   Loads playlists from server, controlled via mobile/PC
   All code uses var/function for Tizen compat
   ═══════════════════════════════════════════════ */

(function() {
    "use strict";

    var SERVER = 'https://iptv.90s.agency';

    // ─── STATE ───
    var channels = [];
    var filteredChannels = [];
    var groups = [];
    var currentGroup = 'all';
    var currentIndex = -1;
    var sidebarOpen = false;
    var focusedIndex = 0;
    var focusArea = 'none'; // 'sidebar' | 'groups' | 'none'
    var hls = null;
    var osdTimer = null;
    var numberBuffer = '';
    var numberTimer = null;
    var loadingTimer = null;

    // ─── DOM ───
    var video, iframe, sidebar, channelList, osd, numOsd, numDisplay;
    var loadingMsg;

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

        // Register Samsung remote keys
        try {
            var keys = ['MediaPlay','MediaPause','MediaStop','MediaPlayPause',
                        'ChannelUp','ChannelDown',
                        '0','1','2','3','4','5','6','7','8','9'];
            for (var k = 0; k < keys.length; k++) {
                tizen.tvinputdevice.registerKey(keys[k]);
            }
        } catch(e) {
            console.log('Not Tizen, using keyboard');
        }

        document.addEventListener('keydown', handleKey);

        // Splash -> Load playlists
        setTimeout(function() {
            document.getElementById('splash').style.display = 'none';
            document.getElementById('main').style.display = 'block';
            loadPlaylistsFromServer();
        }, 2500);
    }

    // ═══════════════════════════════════════
    // LOAD FROM SERVER
    // ═══════════════════════════════════════

    function loadPlaylistsFromServer() {
        showLoading('Conectando con servidor...');

        var xhr = new XMLHttpRequest();
        xhr.open('GET', SERVER + '/api/data', true);
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.playlists && data.playlists.length > 0) {
                        showLoading('Cargando ' + data.playlists.length + ' playlist(s)...');
                        loadAllPlaylists(data.playlists);
                    } else {
                        showLoading('Sin playlists. Agrega una desde el móvil o PC:\n' + SERVER + '/panel');
                        // Retry every 10 seconds
                        loadingTimer = setInterval(function() {
                            loadPlaylistsFromServer();
                        }, 10000);
                    }
                } catch(e) {
                    showLoading('Error al leer datos del servidor');
                }
            } else {
                showLoading('Error: ' + xhr.status);
            }
        };
        xhr.onerror = function() {
            showLoading('No se pudo conectar.\nVerifica que el servidor esté activo.');
        };
        xhr.ontimeout = function() {
            showLoading('Timeout al conectar.\nReintentando...');
            setTimeout(loadPlaylistsFromServer, 3000);
        };
        xhr.send();
    }

    function loadAllPlaylists(playlists) {
        var loaded = 0;
        var total = playlists.length;

        for (var i = 0; i < playlists.length; i++) {
            (function(pl, idx) {
                var xhr2 = new XMLHttpRequest();
                xhr2.open('GET', pl.url, true);
                xhr2.timeout = 15000;
                xhr2.onload = function() {
                    if (xhr2.status === 200) {
                        parseM3U(xhr2.responseText, pl.name || ('Lista ' + (idx + 1)));
                    }
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
            showLoading('No se encontraron canales.\nVerifica las URLs desde ' + SERVER + '/panel');
            return;
        }

        filteredChannels = channels;
        renderGroups();
        renderChannels();

        // Hide loading, show sidebar with channels
        loadingMsg.style.display = 'none';
        showSidebar();
    }

    function showLoading(msg) {
        loadingMsg.textContent = msg;
        loadingMsg.style.display = 'flex';
    }

    // ═══════════════════════════════════════
    // M3U PARSER
    // ═══════════════════════════════════════

    function parseM3U(text, playlistName) {
        var lines = text.split('\n');
        var name = '', group = '', logo = '', url = '';
        var grpSet = {};

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();

            if (line.indexOf('#EXTINF') === 0) {
                var commaIdx = line.lastIndexOf(',');
                name = commaIdx > -1 ? line.substring(commaIdx + 1).trim() : 'Canal';

                var gm = line.match(/group-title="([^"]*)"/);
                group = gm ? gm[1] : playlistName;

                var lm = line.match(/tvg-logo="([^"]*)"/);
                logo = lm ? lm[1] : '';

                if (name.indexOf('|iframe') > -1) {
                    name = name.replace('|iframe', '').trim();
                }
            } else if (line && line.charAt(0) !== '#') {
                url = line;
                if (name && url) {
                    var isIframe = url.indexOf('.m3u8') === -1 && url.indexOf('.ts') === -1 && url.indexOf('rtmp') === -1;

                    // Check duplicate
                    var dupe = false;
                    for (var d = 0; d < channels.length; d++) {
                        if (channels[d].url === url) { dupe = true; break; }
                    }
                    if (!dupe) {
                        channels.push({
                            name: name,
                            group: group || playlistName,
                            logo: logo,
                            url: url,
                            iframe: isIframe && (url.indexOf('http') === 0),
                            num: channels.length + 1
                        });
                        if (group) grpSet[group] = true;
                    }
                }
                name = ''; group = ''; logo = ''; url = '';
            }
        }

        // Merge groups
        for (var g in grpSet) {
            if (grpSet.hasOwnProperty(g) && groups.indexOf(g) === -1) {
                groups.push(g);
            }
        }
        groups.sort();
    }

    // ═══════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════

    function renderGroups() {
        var container = document.getElementById('groups');
        var html = '<button class="group-btn focusable' + (currentGroup === 'all' ? ' active' : '') + '" data-group="all">Todos (' + channels.length + ')</button>';
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
        var html = '';
        for (var i = 0; i < filteredChannels.length; i++) {
            var ch = filteredChannels[i];
            var isActive = (currentIndex > -1 && channels[currentIndex] && channels[currentIndex].url === ch.url);
            html += '<div class="ch-item focusable' + (isActive ? ' active' : '') + '" data-idx="' + i + '">' +
                '<div class="ch-item-num">' + ch.num + '</div>' +
                '<div class="ch-item-info">' +
                '<div class="ch-item-name">' + escapeHtml(ch.name) + '</div>' +
                '<div class="ch-item-group">' + escapeHtml(ch.group) + '</div>' +
                '</div></div>';
        }
        channelList.innerHTML = html;
        document.getElementById('ch-count').textContent = filteredChannels.length + ' canales';

        var items = channelList.querySelectorAll('.ch-item');
        for (var j = 0; j < items.length; j++) {
            (function(item) {
                item.addEventListener('click', function() {
                    var idx = parseInt(item.getAttribute('data-idx'));
                    playChannel(idx);
                });
            })(items[j]);
        }
    }

    function selectGroup(g) {
        currentGroup = g;
        if (g === 'all') {
            filteredChannels = channels;
        } else {
            filteredChannels = [];
            for (var i = 0; i < channels.length; i++) {
                if (channels[i].group === g) filteredChannels.push(channels[i]);
            }
        }
        renderGroups();
        renderChannels();
        focusArea = 'sidebar';
        focusedIndex = 0;
        updateFocus();
    }

    // ═══════════════════════════════════════
    // PLAYBACK
    // ═══════════════════════════════════════

    function playChannel(filteredIdx) {
        var ch = filteredChannels[filteredIdx];
        if (!ch) return;

        for (var i = 0; i < channels.length; i++) {
            if (channels[i].url === ch.url) { currentIndex = i; break; }
        }

        showOSD(ch);

        if (ch.iframe) {
            video.style.display = 'none';
            video.src = '';
            if (hls) { hls.destroy(); hls = null; }

            var autoUrl = ch.url;
            try {
                var u = new URL(ch.url);
                if (!u.searchParams.has('autoplay')) u.searchParams.set('autoplay', '1');
                if (!u.searchParams.has('auto_play')) u.searchParams.set('auto_play', '1');
                autoUrl = u.toString();
            } catch(e) { }

            iframe.src = autoUrl;
            iframe.style.display = 'block';
            setTimeout(function() { iframe.focus(); }, 1000);
        } else {
            iframe.style.display = 'none';
            iframe.src = '';
            video.style.display = 'block';

            if (hls) { hls.destroy(); hls = null; }

            if (ch.url.indexOf('.m3u8') > -1 && typeof Hls !== 'undefined' && Hls.isSupported()) {
                hls = new Hls({ enableWorker: false });
                hls.loadSource(ch.url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    video.play().catch(function(e) {});
                });
                hls.on(Hls.Events.ERROR, function(ev, data) {
                    if (data.fatal) console.log('HLS error:', data.type);
                });
            } else {
                video.src = ch.url;
                video.play().catch(function(e) {});
            }
        }

        renderChannels();
        hideSidebar();
    }

    function playByNumber(num) {
        for (var i = 0; i < channels.length; i++) {
            if (channels[i].num === num) {
                for (var j = 0; j < filteredChannels.length; j++) {
                    if (filteredChannels[j].url === channels[i].url) {
                        playChannel(j);
                        return;
                    }
                }
                return;
            }
        }
    }

    function nextChannel() {
        if (channels.length === 0) return;
        var idx = currentIndex + 1;
        if (idx >= channels.length) idx = 0;
        currentIndex = idx;
        showOSD(channels[idx]);

        var ch = channels[idx];
        if (ch.iframe) {
            video.style.display = 'none'; video.src = '';
            if (hls) { hls.destroy(); hls = null; }
            iframe.src = ch.url; iframe.style.display = 'block';
            setTimeout(function() { iframe.focus(); }, 500);
        } else {
            iframe.style.display = 'none'; iframe.src = '';
            video.style.display = 'block';
            if (hls) { hls.destroy(); hls = null; }
            if (ch.url.indexOf('.m3u8') > -1 && typeof Hls !== 'undefined' && Hls.isSupported()) {
                hls = new Hls({ enableWorker: false });
                hls.loadSource(ch.url); hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function(e){}); });
            } else {
                video.src = ch.url; video.play().catch(function(e){});
            }
        }
        renderChannels();
    }

    function prevChannel() {
        if (channels.length === 0) return;
        var idx = currentIndex - 1;
        if (idx < 0) idx = channels.length - 1;
        currentIndex = idx;
        showOSD(channels[idx]);

        var ch = channels[idx];
        if (ch.iframe) {
            video.style.display = 'none'; video.src = '';
            if (hls) { hls.destroy(); hls = null; }
            iframe.src = ch.url; iframe.style.display = 'block';
            setTimeout(function() { iframe.focus(); }, 500);
        } else {
            iframe.style.display = 'none'; iframe.src = '';
            video.style.display = 'block';
            if (hls) { hls.destroy(); hls = null; }
            if (ch.url.indexOf('.m3u8') > -1 && typeof Hls !== 'undefined' && Hls.isSupported()) {
                hls = new Hls({ enableWorker: false });
                hls.loadSource(ch.url); hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function(e){}); });
            } else {
                video.src = ch.url; video.play().catch(function(e){});
            }
        }
        renderChannels();
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
        sidebar.style.display = 'flex';
        sidebarOpen = true;
        focusArea = 'sidebar';
        var items = channelList.querySelectorAll('.ch-item');
        focusedIndex = 0;
        for (var i = 0; i < items.length; i++) {
            if (items[i].classList.contains('active')) { focusedIndex = i; break; }
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
        if (el) {
            el.classList.add('focused');
            el.focus();
            if (el.closest('.sidebar-list')) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
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
            var grpBtns = document.querySelectorAll('.group-btn');
            if (grpBtns.length > 0) {
                if (focusedIndex >= grpBtns.length) focusedIndex = grpBtns.length - 1;
                if (focusedIndex < 0) focusedIndex = 0;
                setFocus(grpBtns[focusedIndex]);
            }
        }
    }

    // ═══════════════════════════════════════
    // KEY HANDLER
    // ═══════════════════════════════════════

    function handleKey(e) {
        var code = e.keyCode;

        // ─── SIDEBAR OPEN: CHANNEL LIST ───
        if (sidebarOpen && focusArea === 'sidebar') {
            if (code === KEY.DOWN) {
                e.preventDefault();
                focusedIndex++;
                updateFocus();
            } else if (code === KEY.UP) {
                e.preventDefault();
                if (focusedIndex > 0) {
                    focusedIndex--;
                    updateFocus();
                } else {
                    focusArea = 'groups';
                    focusedIndex = 0;
                    var grpBtns = document.querySelectorAll('.group-btn');
                    for (var i = 0; i < grpBtns.length; i++) {
                        if (grpBtns[i].classList.contains('active')) { focusedIndex = i; break; }
                    }
                    updateFocus();
                }
            } else if (code === KEY.ENTER) {
                e.preventDefault();
                var items = channelList.querySelectorAll('.ch-item');
                if (items[focusedIndex]) items[focusedIndex].click();
            } else if (code === KEY.RIGHT || code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                e.preventDefault();
                hideSidebar();
            }
            return;
        }

        // ─── SIDEBAR OPEN: GROUP TABS ───
        if (sidebarOpen && focusArea === 'groups') {
            if (code === KEY.LEFT) {
                e.preventDefault();
                if (focusedIndex > 0) focusedIndex--;
                updateFocus();
            } else if (code === KEY.RIGHT) {
                e.preventDefault();
                var btns = document.querySelectorAll('.group-btn');
                if (focusedIndex < btns.length - 1) focusedIndex++;
                updateFocus();
            } else if (code === KEY.DOWN) {
                e.preventDefault();
                focusArea = 'sidebar';
                focusedIndex = 0;
                updateFocus();
            } else if (code === KEY.ENTER) {
                e.preventDefault();
                var btns2 = document.querySelectorAll('.group-btn');
                if (btns2[focusedIndex]) btns2[focusedIndex].click();
            } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
                e.preventDefault();
                hideSidebar();
            }
            return;
        }

        // ─── FULLSCREEN PLAYER ───
        if (code === KEY.ENTER || code === KEY.LEFT) {
            e.preventDefault();
            if (channels.length > 0) showSidebar();
        } else if (code === KEY.CH_UP || code === KEY.UP) {
            e.preventDefault();
            nextChannel();
        } else if (code === KEY.CH_DOWN || code === KEY.DOWN) {
            e.preventDefault();
            prevChannel();
        } else if (code === KEY.PLAY || code === KEY.PLAYPAUSE) {
            e.preventDefault();
            if (video.paused) video.play().catch(function(e){});
            else video.pause();
        } else if (code === KEY.PAUSE) {
            e.preventDefault();
            video.pause();
        } else if (code === KEY.STOP) {
            e.preventDefault();
            video.pause(); video.src = '';
            iframe.src = ''; iframe.style.display = 'none';
        } else if (code === KEY.BACK || code === KEY.RETURN || code === KEY.ESC || code === KEY.BACKSPACE) {
            e.preventDefault();
            if (osd.style.display !== 'none') {
                osd.style.display = 'none';
            } else if (currentIndex > -1) {
                // Show sidebar instead of exiting
                showSidebar();
            } else {
                try { tizen.application.getCurrentApplication().exit(); } catch(e) { }
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

    // ═══════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── START ───
    document.addEventListener('DOMContentLoaded', init);
})();
