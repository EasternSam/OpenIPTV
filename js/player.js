/* ══════════════════════════════════════════════════════════════
   OpenIPTV - Player Engine
   HLS.js powered video player with Samsung TV optimizations
   ══════════════════════════════════════════════════════════════ */

const Player = {

    // State
    video: null,
    hls: null,
    currentChannel: null,
    isPlaying: false,
    isMuted: false,
    signalQuality: 'none', // 'none' | 'good' | 'medium' | 'poor'
    channelHealth: {},     // { url: 'ok' | 'error' } — tracks tested channels
    retryCount: 0,
    retryTimer: null,
    controlsTimer: null,
    overlayVisible: true,

    // Callbacks
    onStateChange: null, // (state: 'playing'|'paused'|'loading'|'error'|'stopped') => void
    onError: null,       // (message: string) => void

    /* ─── Initialize ─── */
    init() {
        this.video = document.getElementById('video-player');
        this.iframe = document.getElementById('iframe-player');
        this._bindVideoEvents();

        // Restore volume
        const savedVol = Storage.getVolume();
        this.setVolume(savedVol);

        return this;
    },

    /* ─── Play Channel ─── */
    play(channel) {
        if (!channel || !channel.url) return;

        this.stop();
        this.currentChannel = channel;
        this.retryCount = 0;
        this._showLoading(true);

        let url = channel.url.trim();
        let headers = {};

        let isIframe = false;

        // Extraer encabezados estilo IPTV (ej. url|User-Agent=...&Referer=... o url|iframe=true)
        if (url.includes('|')) {
            const parts = url.split('|');
            url = parts[0];
            const headerString = parts[1];
            
            // Parseamos los headers como query params (Header1=Value1&Header2=Value2)
            const params = new URLSearchParams(headerString);
            
            if (params.has('iframe') || headerString.includes('iframe')) {
                isIframe = true;
            }

            for (const [key, value] of params.entries()) {
                // Mapear nombres comunes de IPTV al header HTTP real
                let headerName = key;
                if (key.toLowerCase() === 'user-agent') headerName = 'User-Agent';
                if (key.toLowerCase() === 'referer') headerName = 'Referer';
                
                headers[headerName] = value;
            }
        }

        // Determine stream type
        if (isIframe) {
            this._playIframe(url);
        } else if (this._isHLS(url)) {
            this._playHLS(url, headers);
        } else {
            this._playDirect(url);
        }

        // Track recent
        Storage.addRecent(channel.url);
        Storage.setLastChannel(channel.url);
    },

    /* ─── Play HLS Stream ─── */
    _playHLS(url, headers = {}) {
        this._prepareVideoElement();

        if (Hls.isSupported()) {
            const hlsConfig = {
                maxBufferLength: this._getBufferSize(),
                maxMaxBufferLength: this._getBufferSize() * 2,
                maxBufferSize: 60 * 1000 * 1000, // 60MB
                maxBufferHole: 0.5,
                lowLatencyMode: false,
                enableWorker: true,
                startLevel: -1, // Auto quality
                capLevelToPlayerSize: true,
                // Samsung TV specific: more forgiving error recovery
                fragLoadingMaxRetry: 6,
                fragLoadingMaxRetryTimeout: 64000,
                manifestLoadingMaxRetry: 4,
                levelLoadingMaxRetry: 4,
                // Reduce ABR oscillation
                abrEwmaDefaultEstimate: 500000,
                abrBandWidthUpFactor: 0.7,
                abrBandWidthFactor: 0.95,
            };

            // Inject Custom HTTP Headers si existen
            if (Object.keys(headers).length > 0) {
                hlsConfig.xhrSetup = function(xhr, url) {
                    for (const key in headers) {
                        try {
                            xhr.setRequestHeader(key, headers[key]);
                        } catch (e) {
                            console.warn(`[Player] No se pudo inyectar el header ${key}:`, e);
                        }
                    }
                };
            }

            this.hls = new Hls(hlsConfig);

            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);

            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.video.play().catch(() => {});
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                this._handleHLSError(data);
            });

            this.hls.on(Hls.Events.FRAG_LOADED, () => {
                this._updateSignalQuality('good');
            });

        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari, some Samsung TVs)
            this._playDirect(url);
        } else {
            this._showError('HLS no soportado en este navegador');
        }
    },

    /* ─── Play Direct (MP4, Native HLS) ─── */
    _playDirect(url) {
        this._prepareVideoElement();
        this.video.src = url;
        this.video.play().catch(e => {
            console.error('[Player] Direct play failed', e);
            this._showError('No se pudo reproducir este formato directamente.');
        });
    },

    /* ─── Play Iframe (Web embeds) ─── */
    _playIframe(url) {
        this._cleanup();
        this._removeIframeOverlay();
        this.video.classList.add('hidden');
        this.iframe.classList.remove('hidden');
        
        // Route through our proxy which injects autoplay script
        // This makes the wrapper same-origin so it can auto-click play buttons
        var proxyUrl = '/api/iframe-proxy?url=' + encodeURIComponent(url);

        this.iframe.src = proxyUrl;
        this.isPlaying = true;
        this._showLoading(false);
        this._updatePlayPauseIcon();
        if (this.currentChannel) this.channelHealth[this.currentChannel.url] = 'ok';
        
        // Focus iframe so remote events reach it
        setTimeout(function() {
            if (Player.iframe) Player.iframe.focus();
        }, 1000);
    },

    /* ─── Iframe click-interceptor overlay ─── */
    _createIframeOverlay() {
        this._removeIframeOverlay();
        
        var container = document.getElementById('video-container');
        if (!container) return;

        var overlay = document.createElement('div');
        overlay.id = 'iframe-click-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:50;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);';
        overlay.innerHTML = '<div style="text-align:center;color:white;font-family:Inter,sans-serif;"><div style="font-size:48px;margin-bottom:12px;">▶</div><div style="font-size:16px;opacity:0.8;">Presiona OK para reproducir</div></div>';
        container.appendChild(overlay);

        // Handle click/touch on overlay
        var self = this;
        var handleActivate = function(e) {
            e.preventDefault();
            e.stopPropagation();
            self._removeIframeOverlay();
            // Focus iframe and dispatch a click at its center
            if (self.iframe) {
                self.iframe.focus();
                // Dispatch a click event at center of iframe
                var rect = self.iframe.getBoundingClientRect();
                var clickX = rect.left + rect.width / 2;
                var clickY = rect.top + rect.height / 2;
                
                var clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    clientX: clickX,
                    clientY: clickY,
                    view: window
                });
                self.iframe.dispatchEvent(clickEvent);
            }
        };

        overlay.addEventListener('click', handleActivate);
        overlay.addEventListener('touchend', handleActivate);

        // Also listen for keyboard Enter/OK (Samsung remote)
        var keyHandler = function(e) {
            if (e.keyCode === 13 || e.keyCode === 10009 || e.keyCode === 32) {
                handleActivate(e);
                document.removeEventListener('keydown', keyHandler, true);
            }
        };
        document.addEventListener('keydown', keyHandler, true);

        // Auto-remove after 15s if not interacted
        setTimeout(function() {
            self._removeIframeOverlay();
            document.removeEventListener('keydown', keyHandler, true);
        }, 15000);
    },

    _removeIframeOverlay() {
        var overlay = document.getElementById('iframe-click-overlay');
        if (overlay) overlay.remove();
    },

    /* ─── Try to autoplay inside iframe (same-origin only) ─── */
    _tryIframeAutoplay() {
        var self = this;
        var attempts = [500, 1500, 3000];
        for (var i = 0; i < attempts.length; i++) {
            (function(delay) {
                setTimeout(function() {
                    try {
                        var doc = self.iframe.contentDocument || (self.iframe.contentWindow ? self.iframe.contentWindow.document : null);
                        if (doc) {
                            // Try to find and click play buttons
                            var playBtn = doc.querySelector(
                                'button[class*="play"], .vjs-big-play-button, .play-button, ' +
                                '[aria-label*="play"], [aria-label*="Play"], ' +
                                '.jw-icon-playback, .plyr__control--overlaid, video'
                            );
                            if (playBtn) {
                                playBtn.click();
                                self._removeIframeOverlay();
                                return;
                            }
                            // Try to play video directly
                            var video = doc.querySelector('video');
                            if (video) {
                                video.play().then(function() {
                                    self._removeIframeOverlay();
                                }).catch(function() {});
                            }
                        }
                    } catch(e) {
                        // Cross-origin — rely on overlay click interceptor
                    }
                }, delay);
            })(attempts[i]);
        }
    },

    /* ─── Helper to prepare video element ─── */
    _prepareVideoElement() {
        this.iframe.classList.add('hidden');
        this.iframe.src = '';
        this.video.classList.remove('hidden');
    },

    /* ─── Stop Playback ─── */
    stop() {
        clearTimeout(this.retryTimer);
        this._cleanup();
        this._removeIframeOverlay();

        this.isPlaying = false;
        this._showLoading(false);
        this._showError(null);
        this._fireState('stopped');
    },

    _cleanup() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.video) {
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
        }
        if (this.iframe) {
            this.iframe.src = '';
        }
    },

    /* ─── Pause / Resume ─── */
    togglePause() {
        if (!this.video) return;
        if (this.video.paused) {
            this.video.play().catch(() => {});
        } else {
            this.video.pause();
        }
    },

    /* ─── Volume ─── */
    setVolume(value) {
        if (!this.video) return;
        const vol = Math.max(0, Math.min(100, value));
        this.video.volume = vol / 100;
        this.isMuted = vol === 0;
        this.video.muted = this.isMuted;
        Storage.setVolume(vol);

        // Update UI
        const slider = document.getElementById('volume-slider');
        if (slider) slider.value = vol;
        this._updateVolumeIcons();
    },

    getVolume() {
        return this.video ? Math.round(this.video.volume * 100) : 80;
    },

    toggleMute() {
        if (!this.video) return;
        this.isMuted = !this.isMuted;
        this.video.muted = this.isMuted;
        this._updateVolumeIcons();
    },

    /* ─── Fullscreen ─── */
    _pendingFullscreen: false,
    _cssFullscreen: false,

    toggleFullscreen() {
        const container = document.getElementById('video-container');
        const video = this.video;
        if (!container) return;

        const isFS = document.fullscreenElement || document.webkitFullscreenElement || this._cssFullscreen;

        if (isFS) {
            // ── EXIT fullscreen ──
            this._cssFullscreen = false;
            this._pendingFullscreen = false;
            document.body.classList.remove('css-fullscreen');
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
        } else {
            // ── ENTER fullscreen ──
            // Strategy 1: video.webkitEnterFullscreen (Samsung Tizen / iOS)
            if (video && video.webkitEnterFullscreen) {
                try { video.webkitEnterFullscreen(); return; } catch(e) {}
            }
            if (video && video.webkitEnterFullScreen) {
                try { video.webkitEnterFullScreen(); return; } catch(e) {}
            }

            // Strategy 2: Native Fullscreen API (needs trusted gesture)
            const el = container;
            const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
            if (rfs) {
                rfs.call(el).then(() => {
                    // Native worked, clear CSS fallback
                    this._cssFullscreen = false;
                    document.body.classList.remove('css-fullscreen');
                }).catch(() => {
                    // Native failed — use CSS + arm pending
                    this._activateCSSFullscreen();
                });
            } else {
                this._activateCSSFullscreen();
            }
        }
    },

    _activateCSSFullscreen() {
        // Immediate visual fullscreen via CSS
        this._cssFullscreen = true;
        document.body.classList.add('css-fullscreen');

        // Arm: next REAL keypress on TV will trigger native fullscreen
        this._pendingFullscreen = true;
        this._bindPendingFullscreen();
    },

    _boundPendingHandler: null,

    _bindPendingFullscreen() {
        // Remove old listener if any
        if (this._boundPendingHandler) {
            document.removeEventListener('keydown', this._boundPendingHandler, true);
        }

        this._boundPendingHandler = (e) => {
            if (!this._pendingFullscreen) return;
            if (!e.isTrusted) return; // Only real user gestures

            this._pendingFullscreen = false;
            document.removeEventListener('keydown', this._boundPendingHandler, true);

            // Now we have a trusted gesture — try native fullscreen
            const container = document.getElementById('video-container');
            if (!container) return;

            const rfs = container.requestFullscreen || container.webkitRequestFullscreen || container.msRequestFullscreen;
            if (rfs) {
                rfs.call(container).then(() => {
                    this._cssFullscreen = false;
                    document.body.classList.remove('css-fullscreen');
                }).catch(() => {
                    // Still failed, CSS fullscreen stays
                });
            }
        };

        document.addEventListener('keydown', this._boundPendingHandler, true);
    },

    /* ─── Overlay Controls ─── */
    showOverlay() {
        const overlay = document.getElementById('player-overlay');
        if (!overlay) return;
        
        overlay.classList.remove('hidden-overlay');
        this.overlayVisible = true;
        this._resetControlsTimer();
    },

    hideOverlay() {
        const overlay = document.getElementById('player-overlay');
        if (!overlay) return;

        overlay.classList.add('hidden-overlay');
        this.overlayVisible = false;
    },

    toggleOverlay() {
        if (this.overlayVisible) {
            this.hideOverlay();
        } else {
            this.showOverlay();
        }
    },

    _resetControlsTimer() {
        clearTimeout(this.controlsTimer);
        const settings = Storage.getSettings();
        const delay = settings.hideControlsDelay;
        
        if (delay > 0 && this.isPlaying) {
            this.controlsTimer = setTimeout(() => {
                this.hideOverlay();
            }, delay * 1000);
        }
    },

    /* ─── Private: Video Events ─── */
    _bindVideoEvents() {
        if (!this.video) return;

        this.video.addEventListener('playing', () => {
            this.isPlaying = true;
            this._showLoading(false);
            this._showError(null);
            this._fireState('playing');
            this._updatePlayPauseIcon();
            this._resetControlsTimer();
            if (this.currentChannel) this.channelHealth[this.currentChannel.url] = 'ok';
        });

        this.video.addEventListener('pause', () => {
            this.isPlaying = false;
            this._fireState('paused');
            this._updatePlayPauseIcon();
            clearTimeout(this.controlsTimer);
        });

        this.video.addEventListener('waiting', () => {
            this._showLoading(true);
            this._fireState('loading');
        });

        this.video.addEventListener('canplay', () => {
            this._showLoading(false);
        });

        this.video.addEventListener('error', () => {
            const error = this.video.error;
            const msg = error ? `Error de video: código ${error.code}` : 'Error desconocido';
            if (this.currentChannel) this.channelHealth[this.currentChannel.url] = 'error';
            this._handlePlaybackError(msg);
        });

        this.video.addEventListener('ended', () => {
            // For live streams this shouldn't fire, but handle it
            this._handlePlaybackError('La señal ha terminado');
        });

        this.video.addEventListener('stalled', () => {
            this._updateSignalQuality('poor');
        });
    },

    /* ─── Private: Error Handling ─── */
    _handleHLSError(data) {
        if (data.fatal) {
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    console.warn('HLS network error, attempting recovery...');
                    this._updateSignalQuality('poor');
                    if (this._canRetry()) {
                        this.hls.startLoad();
                        this._scheduleRetry();
                    } else {
                        if (this.currentChannel) this.channelHealth[this.currentChannel.url] = 'error';
                        this._showError('Error de red. No se puede conectar al canal.');
                    }
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.warn('HLS media error, attempting recovery...');
                    this.hls.recoverMediaError();
                    break;
                default:
                    this._showError('Error fatal de reproducción');
                    this.stop();
                    break;
            }
        } else {
            // Non-fatal - just update signal quality
            this._updateSignalQuality('medium');
        }
    },

    _handlePlaybackError(message) {
        if (this._canRetry()) {
            this._scheduleRetry();
        } else {
            this._showError(message);
            this._fireState('error');
        }
    },

    _canRetry() {
        const settings = Storage.getSettings();
        return settings.autoReconnect && this.retryCount < settings.retries;
    },

    _scheduleRetry() {
        this.retryCount++;
        const delay = Math.min(2000 * this.retryCount, 10000);
        
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
            if (this.currentChannel) {
                console.log(`Retry ${this.retryCount}: reconnecting...`);
                this._showLoading(true);
                this._showError(null);
                
                if (this.hls) {
                    this.hls.startLoad();
                } else {
                    this.play(this.currentChannel);
                }
            }
        }, delay);
    },

    /* ─── Private: UI Updates ─── */
    _showLoading(show) {
        const el = document.getElementById('player-loading');
        if (el) el.classList.toggle('hidden', !show);
    },

    _showError(message) {
        const errorEl = document.getElementById('player-error');
        const msgEl = document.getElementById('error-message');
        if (errorEl && msgEl) {
            if (message) {
                msgEl.textContent = message;
                errorEl.classList.remove('hidden');
                this._showLoading(false);
            } else {
                errorEl.classList.add('hidden');
            }
        }
        if (message && this.onError) {
            this.onError(message);
        }
    },

    _updatePlayPauseIcon() {
        const playIcon = document.getElementById('icon-play');
        const pauseIcon = document.getElementById('icon-pause');
        if (playIcon && pauseIcon) {
            playIcon.classList.toggle('hidden', this.isPlaying);
            pauseIcon.classList.toggle('hidden', !this.isPlaying);
        }
    },

    _updateVolumeIcons() {
        const volIcon = document.getElementById('icon-volume');
        const mutedIcon = document.getElementById('icon-muted');
        if (volIcon && mutedIcon) {
            volIcon.classList.toggle('hidden', this.isMuted);
            mutedIcon.classList.toggle('hidden', !this.isMuted);
        }
    },

    _updateSignalQuality(level) {
        this.signalQuality = level;
        const el = document.getElementById('signal-quality');
        if (el) {
            el.className = 'signal-quality';
            if (level === 'poor') el.classList.add('poor');
            else if (level === 'medium') el.classList.add('medium');
        }
    },

    _fireState(state) {
        if (this.onStateChange) this.onStateChange(state);
    },

    /* ─── Private: Helpers ─── */
    _isHLS(url) {
        return /\.(m3u8?)(\?|$)/i.test(url) || url.includes('/live/') || url.includes('.m3u8');
    },

    _getBufferSize() {
        const settings = Storage.getSettings();
        return settings.bufferSize || 30;
    },

    /* ─── Retry from UI ─── */
    retry() {
        if (this.currentChannel) {
            this.retryCount = 0;
            this.play(this.currentChannel);
        }
    }
};
