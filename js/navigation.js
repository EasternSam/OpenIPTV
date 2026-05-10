/* ══════════════════════════════════════════════════════════════
   OpenIPTV - TV Navigation System
   D-pad (arrow keys) spatial navigation for Samsung TV remotes
   ══════════════════════════════════════════════════════════════ */

var Navigation = {

    // All focusable elements indexed
    focusableElements: [],
    currentFocusIndex: -1,
    activeArea: 'sidebar', // 'sidebar' | 'main' | 'player' | 'modal' | 'topbar'

    // Samsung Tizen TV key codes
    KEY_CODES: {
        LEFT: [37, 10009],      // ArrowLeft + Samsung Left
        UP: [38, 10010],        // ArrowUp + Samsung Up
        RIGHT: [39, 10011],     // ArrowRight + Samsung Right
        DOWN: [40, 10012],      // ArrowDown + Samsung Down
        ENTER: [13, 10013],     // Enter + Samsung Enter
        BACK: [8, 10009, 461],  // Backspace + Samsung Back + LG Back
        PLAY: [415],            // Samsung Play
        PAUSE: [19],            // Samsung Pause
        STOP: [413],            // Samsung Stop
        CHANNEL_UP: [427],      // Samsung CH+
        CHANNEL_DOWN: [428],    // Samsung CH-
        VOLUME_UP: [447],       // Samsung Vol+
        VOLUME_DOWN: [448],     // Samsung Vol-
        MUTE: [449],            // Samsung Mute
        INFO: [457],            // Samsung Info
        RED: [403],
        GREEN: [404],
        YELLOW: [405],
        BLUE: [406],
        NUM_0: [48, 96],
        NUM_1: [49, 97],
        NUM_2: [50, 98],
        NUM_3: [51, 99],
        NUM_4: [52, 100],
        NUM_5: [53, 101],
        NUM_6: [54, 102],
        NUM_7: [55, 103],
        NUM_8: [56, 104],
        NUM_9: [57, 105],
    },

    // Number input state
    numberBuffer: '',
    numberTimer: null,

    /* ─── Initialize ─── */
    init() {
        document.addEventListener('keydown', function(e) this._handleKeyDown(e));
        
        // Mouse movement detection (hide cursor on TV, show on PC)
        var mouseTimer;
        document.addEventListener('mousemove', function() {
            document.body.classList.add('has-mouse');
            clearTimeout(mouseTimer);
            mouseTimer = setTimeout(function() {
                document.body.classList.remove('has-mouse');
            }, 3000);
        });

        // Click on focusable items
        document.addEventListener('click', function(e) {
            var focusable = e.target.closest('.focusable');
            if (focusable) {
                this._setFocusTo(focusable);
            }
        });

        // Touch support
        document.addEventListener('touchstart', function() {
            document.body.classList.add('has-mouse');
        });

        this.refreshFocusables();
        return this;
    },

    /* ─── Refresh focusable elements ─── */
    refreshFocusables() {
        this.focusableElements = Array.from(
            document.querySelectorAll('.focusable:not(.hidden):not([disabled])')
        ).filter(el => {
            // Only include visible elements
            return el.offsetParent !== null || el.closest('.modal:not(.hidden)');
        });
    },

    /* ─── Set focus area ─── */
    setArea(area) {
        this.activeArea = area;
        this.refreshFocusables();
    },

    /* ─── Focus helpers ─── */
    _setFocusTo(element) {
        if (!element) return;
        
        // Remove previous focus
        document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        
        // Set new focus
        element.classList.add('focused');
        element.focus({ preventScroll: false });
        
        // Scroll into view if in a scrollable container
        var scrollParent = element.closest('.channel-list, .group-list, .saved-playlists');
        if (scrollParent) {
            element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        var idx = this.focusableElements.indexOf(element);
        if (idx > -1) this.currentFocusIndex = idx;
    },

    _getCurrentFocused() {
        return document.querySelector('.focused') || document.activeElement;
    },

    /* ─── Spatial Navigation ─── */
    _getElementsInArea(area) {
        this.refreshFocusables();
        if (area === 'modal') {
            return this.focusableElements.filter(el => el.closest('.modal:not(.hidden)'));
        }
        return this.focusableElements.filter(el => {
            var group = el.dataset.focusGroup;
            return group === area;
        });
    },

    _findNearest(current, elements, direction) {
        if (!current || elements.length === 0) return elements[0] || null;

        var rect = current.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;

        var best = null;
        var bestDist = Infinity;

        for (var el of elements) {
            if (el === current) continue;

            var r = el.getBoundingClientRect();
            var ex = r.left + r.width / 2;
            var ey = r.top + r.height / 2;

            var valid = false;
            switch (direction) {
                case 'up':    valid = ey < cy - 5; break;
                case 'down':  valid = ey > cy + 5; break;
                case 'left':  valid = ex < cx - 5; break;
                case 'right': valid = ex > cx + 5; break;
            }

            if (valid) {
                var dist = Math.sqrt(Math.pow(ex - cx, 2) + Math.pow(ey - cy, 2));
                if (dist < bestDist) {
                    bestDist = dist;
                    best = el;
                }
            }
        }

        return best;
    },

    _navigateDirection(direction) {
        this.refreshFocusables();

        var current = this._getCurrentFocused();
        var targetArea = this.activeArea;

        // Check for cross-area navigation
        if (direction === 'right' && this.activeArea === 'sidebar') {
            targetArea = 'main';
            this.activeArea = 'main';
        } else if (direction === 'left' && (this.activeArea === 'main' || this.activeArea === 'player')) {
            var sidebar = document.getElementById('sidebar');
            if (sidebar && !sidebar.classList.contains('collapsed')) {
                targetArea = 'sidebar';
                this.activeArea = 'sidebar';
            }
        }

        var areaElements = this._getElementsInArea(targetArea);
        
        if (areaElements.length === 0) {
            // Fallback to all visible elements
            var nearest = this._findNearest(current, this.focusableElements, direction);
            if (nearest) this._setFocusTo(nearest);
            return;
        }

        var nearest = this._findNearest(current, areaElements, direction);
        if (nearest) {
            this._setFocusTo(nearest);
        } else if (targetArea !== this.activeArea) {
            // Try the target area's first element
            this._setFocusTo(areaElements[0]);
        }
    },

    /* ─── Key Handler ─── */
    _handleKeyDown(e) {
        var code = e.keyCode || e.which;

        // Prevent default browser behavior for TV keys
        if (code >= 403 && code <= 457) {
            e.preventDefault();
        }

        // Check if an input is focused
        var isInputFocused = document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

        // Arrow navigation (not in input fields)
        if (this._isKey(code, 'UP') && !isInputFocused) {
            e.preventDefault();
            this._navigateDirection('up');
            return;
        }
        if (this._isKey(code, 'DOWN') && !isInputFocused) {
            e.preventDefault();
            this._navigateDirection('down');
            return;
        }
        if (this._isKey(code, 'LEFT') && !isInputFocused) {
            e.preventDefault();
            this._navigateDirection('left');
            return;
        }
        if (this._isKey(code, 'RIGHT') && !isInputFocused) {
            e.preventDefault();
            this._navigateDirection('right');
            return;
        }

        // Enter key
        if (this._isKey(code, 'ENTER')) {
            if (isInputFocused) return; // var inputs handle Enter normally
            e.preventDefault();
            var focused = this._getCurrentFocused();
            if (focused) focused.click();
            return;
        }

        // Back key
        if (this._isKey(code, 'BACK') && !isInputFocused) {
            e.preventDefault();
            this._handleBack();
            return;
        }

        // Media keys
        if (this._isKey(code, 'PLAY') || this._isKey(code, 'PAUSE')) {
            e.preventDefault();
            Player.togglePause();
            return;
        }
        if (this._isKey(code, 'STOP')) {
            e.preventDefault();
            Player.stop();
            return;
        }

        // Channel Up/Down
        if (this._isKey(code, 'CHANNEL_UP')) {
            e.preventDefault();
            if (typeof App !== 'undefined') App.nextChannel();
            return;
        }
        if (this._isKey(code, 'CHANNEL_DOWN')) {
            e.preventDefault();
            if (typeof App !== 'undefined') App.prevChannel();
            return;
        }

        // Volume
        if (this._isKey(code, 'VOLUME_UP')) {
            e.preventDefault();
            Player.setVolume(Player.getVolume() + 5);
            return;
        }
        if (this._isKey(code, 'VOLUME_DOWN')) {
            e.preventDefault();
            Player.setVolume(Player.getVolume() - 5);
            return;
        }
        if (this._isKey(code, 'MUTE')) {
            e.preventDefault();
            Player.toggleMute();
            return;
        }

        // Info key - toggle overlay
        if (this._isKey(code, 'INFO')) {
            e.preventDefault();
            Player.toggleOverlay();
            return;
        }

        // Number keys - direct channel input
        var numKey = this._getNumberKey(code);
        if (numKey !== null && !isInputFocused) {
            e.preventDefault();
            this._handleNumberInput(numKey);
            return;
        }

        // Escape - same as back
        if (code === 27) {
            e.preventDefault();
            this._handleBack();
            return;
        }

        // 'F' key for fullscreen
        if (code === 70 && !isInputFocused) {
            e.preventDefault();
            Player.toggleFullscreen();
            return;
        }

        // 'M' key for mute
        if (code === 77 && !isInputFocused) {
            e.preventDefault();
            Player.toggleMute();
            return;
        }

        // Space for play/pause
        if (code === 32 && !isInputFocused) {
            e.preventDefault();
            Player.togglePause();
            return;
        }
    },

    /* ─── Back Handler ─── */
    _handleBack() {
        // Close modals first
        var openModal = document.querySelector('.modal:not(.hidden)');
        if (openModal) {
            openModal.classList.add('hidden');
            this.setArea('sidebar');
            return;
        }

        // If playing, toggle overlay or go back to channel list
        if (Player.isPlaying) {
            if (Player.overlayVisible) {
                Player.hideOverlay();
            } else {
                Player.showOverlay();
            }
            return;
        }

        // Toggle sidebar if collapsed
        var sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
            this.setArea('sidebar');
        }
    },

    /* ─── Number Input for Direct Channel ─── */
    _handleNumberInput(num) {
        this.numberBuffer += num.toString();

        // Show OSD
        var osd = document.getElementById('channel-osd');
        var osdNum = document.getElementById('osd-number');
        if (osd && osdNum) {
            osdNum.textContent = this.numberBuffer;
            osd.classList.remove('hidden');
        }

        // Reset timer
        clearTimeout(this.numberTimer);
        this.numberTimer = setTimeout(function() {
            var channelNum = parseInt(this.numberBuffer, 10);
            this.numberBuffer = '';
            
            // Hide OSD
            if (osd) osd.classList.add('hidden');
            
            // Navigate to channel
            if (typeof App !== 'undefined' && channelNum > 0) {
                App.goToChannel(channelNum);
            }
        }, 1500);
    },

    /* ─── Helpers ─── */
    _isKey(code, keyName) {
        return this.KEY_CODES[keyName] && this.KEY_CODES[keyName].includes(code);
    },

    _getNumberKey(code) {
        for (var i = 0; i <= 9; i++) {
            if (this._isKey(code, `NUM_${i}`)) return i;
        }
        return null;
    },

    /* ─── Focus first element of an area ─── */
    focusFirst(area) {
        this.setArea(area);
        var elements = this._getElementsInArea(area);
        if (elements.length > 0) {
            this._setFocusTo(elements[0]);
        }
    }
};
