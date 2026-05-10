/* ══════════════════════════════════════════════════════════════
   OpenIPTV - M3U Parser
   Robust parser for M3U/M3U8 playlist formats
   ══════════════════════════════════════════════════════════════ */

const M3UParser = {

    /**
     * Parse M3U content string into structured channel data
     * @param {string} content - Raw M3U file content
     * @returns {{ channels: Array, groups: string[] }}
     */
    parse(content) {
        if (!content || typeof content !== 'string') {
            throw new Error('Contenido de playlist inválido');
        }

        // Normalize line endings
        const lines = content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);

        // Validate M3U header
        if (!lines[0] || !lines[0].toUpperCase().startsWith('#EXTM3U')) {
            throw new Error('Formato de playlist no válido. Debe iniciar con #EXTM3U');
        }

        const channels = [];
        const groupsSet = new Set();
        let channelNumber = 1;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('#EXTINF:')) {
                // Parse the EXTINF line
                const info = this._parseExtInf(line);

                // Find the next URL line (skip comments)
                let url = null;
                for (let j = i + 1; j < lines.length; j++) {
                    if (!lines[j].startsWith('#')) {
                        url = lines[j];
                        i = j; // advance index
                        break;
                    }
                    // Check for additional tags
                    if (lines[j].startsWith('#EXTVLCOPT:') || lines[j].startsWith('#KODIPROP:')) {
                        // Extract additional properties
                        const prop = this._parseAdditionalTag(lines[j]);
                        if (prop) {
                            info.properties = info.properties || {};
                            Object.assign(info.properties, prop);
                        }
                    }
                }

                if (url && this._isValidUrl(url)) {
                    const channel = {
                        id: `ch_${channelNumber}`,
                        number: channelNumber,
                        name: info.name || `Canal ${channelNumber}`,
                        url: url.trim(),
                        logo: info.logo || '',
                        group: info.group || 'Sin Grupo',
                        duration: info.duration || -1,
                        tvgId: info.tvgId || '',
                        tvgName: info.tvgName || '',
                        language: info.language || '',
                        country: info.country || '',
                        properties: info.properties || {},
                    };

                    channels.push(channel);
                    groupsSet.add(channel.group);
                    channelNumber++;
                }
            }
        }

        const groups = Array.from(groupsSet).sort((a, b) => 
            a.localeCompare(b, 'es', { sensitivity: 'base' })
        );

        return { channels, groups };
    },

    /**
     * Parse #EXTINF line attributes
     * @private
     */
    _parseExtInf(line) {
        const result = {
            duration: -1,
            name: '',
            logo: '',
            group: '',
            tvgId: '',
            tvgName: '',
            language: '',
            country: '',
        };

        // Extract duration
        const durationMatch = line.match(/#EXTINF:\s*(-?\d+)/);
        if (durationMatch) {
            result.duration = parseInt(durationMatch[1], 10);
        }

        // Extract attributes using regex
        // tvg-id
        const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
        if (tvgIdMatch) result.tvgId = tvgIdMatch[1];

        // tvg-name
        const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
        if (tvgNameMatch) result.tvgName = tvgNameMatch[1];

        // tvg-logo
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        if (logoMatch) result.logo = logoMatch[1];

        // tvg-language
        const langMatch = line.match(/tvg-language="([^"]*)"/i);
        if (langMatch) result.language = langMatch[1];

        // tvg-country
        const countryMatch = line.match(/tvg-country="([^"]*)"/i);
        if (countryMatch) result.country = countryMatch[1];

        // group-title
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        if (groupMatch) result.group = groupMatch[1] || 'Sin Grupo';

        // Channel name (everything after the last comma)
        const nameMatch = line.match(/,(.+)$/);
        if (nameMatch) result.name = nameMatch[1].trim();

        return result;
    },

    /**
     * Parse additional tag lines (#EXTVLCOPT, #KODIPROP, etc.)
     * @private
     */
    _parseAdditionalTag(line) {
        if (line.startsWith('#EXTVLCOPT:')) {
            const parts = line.substring(11).split('=');
            if (parts.length >= 2) {
                return { [parts[0].trim()]: parts.slice(1).join('=').trim() };
            }
        }
        if (line.startsWith('#KODIPROP:')) {
            const parts = line.substring(10).split('=');
            if (parts.length >= 2) {
                return { [parts[0].trim()]: parts.slice(1).join('=').trim() };
            }
        }
        return null;
    },

    /**
     * Basic URL validation
     * @private
     */
    _isValidUrl(str) {
        try {
            // Accept common stream protocols
            if (str.startsWith('http://') || str.startsWith('https://') ||
                str.startsWith('rtsp://') || str.startsWith('rtmp://') ||
                str.startsWith('mms://') || str.startsWith('udp://') ||
                str.startsWith('rtp://')) {
                return true;
            }
            return false;
        } catch(e) {
            return false;
        }
    },

    /**
     * Fetch and parse a remote M3U playlist
     * @param {string} url - URL of the M3U playlist
     * @returns {Promise<{ channels: Array, groups: string[] }>}
     */
    async fetchAndParse(url) {
        try {
            // Use local PHP proxy first, then fallbacks if needed
            const proxies = [
                '/api.php?action=proxy&url=',
                '', // Direct
                'https://api.allorigins.win/raw?url=',
                'https://corsproxy.io/?',
            ];

            let content = null;
            let lastError = null;

            for (const proxy of proxies) {
                try {
                    const targetUrl = proxy + encodeURIComponent(url);
                    const fetchUrl = proxy === '' ? url : targetUrl;
                    
                    const response = await fetch(fetchUrl, {
                        method: 'GET',
                        headers: {
                            'Accept': 'text/plain, application/x-mpegurl, */*',
                        },
                        signal: AbortSignal.timeout(30000),
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    content = await response.text();
                    
                    if (content && content.trim().toUpperCase().startsWith('#EXTM3U')) {
                        break;
                    }
                    content = null;
                } catch (err) {
                    lastError = err;
                    continue;
                }
            }

            if (!content) {
                throw lastError || new Error('No se pudo descargar la playlist');
            }

            return this.parse(content);
        } catch (error) {
            throw new Error(`Error al cargar playlist: ${error.message}`);
        }
    },

    /**
     * Parse M3U from a File object
     * @param {File} file
     * @returns {Promise<{ channels: Array, groups: string[] }>}
     */
    async parseFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const result = this.parse(e.target.result);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Error al leer el archivo'));
            reader.readAsText(file);
        });
    }
};
