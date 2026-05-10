/* ══════════════════════════════════════════════════════════════
   OpenIPTV - Node.js Server
   Static files + REST API + Remote Control (SSE pairing)
   Zero dependencies - uses only Node.js built-in modules
   ══════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'data', 'playlists.json');
const STATIC_DIR = __dirname;

// ─── Ensure data directory exists ───
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        playlists: [],
        lastPlaylist: null,
        favorites: [],
    }, null, 2), 'utf8');
}

// ─── MIME Types ───
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

// ═══════════════════════════════════════════════
// REMOTE CONTROL - Pairing & SSE
// ═══════════════════════════════════════════════

// Active TV sessions: Map<code, { res, createdAt, sessionId, phoneConnected, tvState }>
const tvSessions = new Map();
let sessionIdCounter = 0;

function generatePairCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (tvSessions.has(code));
    return code;
}

function sendToTV(code, event, data) {
    const session = tvSessions.get(code);
    if (!session || !session.res || session.res.writableEnded) return false;

    try {
        session.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (err) {
        console.warn(`SSE write error for ${code}:`, err.message);
        return false;
    }
}

// Clean up expired sessions (older than 12 hours)
setInterval(() => {
    const now = Date.now();
    for (const [code, session] of tvSessions) {
        if (now - session.createdAt > 12 * 60 * 60 * 1000) {
            try { if (session.res && !session.res.writableEnded) session.res.end(); } catch(e) {}
            tvSessions.delete(code);
        }
    }
}, 60000);

// ─── Data helpers ───
function readData() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch(e) { return { playlists: [], lastPlaylist: null, favorites: [] }; }
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch(e) { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
    let filePath = req.url.split('?')[0];
    if (filePath === '/') filePath = '/index.html';
    if (filePath === '/remote') filePath = '/remote.html';
    if (filePath === '/panel') filePath = '/panel.html';

    const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(STATIC_DIR, safePath);

    if (safePath.startsWith('/data') || safePath === '/server.js') {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(content);
    });
}

// ═══════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
    const urlParts = req.url.split('?');
    const url = urlParts[0];
    const method = req.method.toUpperCase();
    const query = new URLSearchParams(urlParts[1] || '');

    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    // ═══════════════════════════════════════
    // IFRAME PROXY — serves external pages as same-origin with autoplay injection
    // ═══════════════════════════════════════

    if (url === '/api/iframe-proxy' && method === 'GET') {
        var targetUrl = query.get('url');
        if (!targetUrl) {
            res.writeHead(400); res.end('Missing url param'); return;
        }

        // Serve a wrapper page that loads the target in an iframe and auto-clicks play
        var wrapperHtml = '<!DOCTYPE html><html><head>' +
            '<meta charset="UTF-8">' +
            '<style>*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:#000}' +
            'iframe{width:100%;height:100%;border:none}</style></head>' +
            '<body>' +
            '<iframe id="f" src="' + targetUrl.replace(/"/g, '&quot;') + '" ' +
            'allow="autoplay;fullscreen" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"></iframe>' +
            '<script>' +
            'var f=document.getElementById("f");' +
            'f.onload=function(){' +
            '  var times=[500,1500,3000,5000,8000];' +
            '  for(var i=0;i<times.length;i++){' +
            '    (function(t){setTimeout(function(){try{' +
            '      var d=f.contentDocument||f.contentWindow.document;' +
            '      if(!d)return;' +
            '      var v=d.querySelector("video");' +
            '      if(v){v.muted=false;v.play().catch(function(){});}' +
            '      var btns=d.querySelectorAll("button,div[role=button],[class*=play],[aria-label*=play],[aria-label*=Play],.vjs-big-play-button,.jw-icon-playback,.plyr__control--overlaid");' +
            '      for(var j=0;j<btns.length;j++){' +
            '        var s=window.getComputedStyle(btns[j]);' +
            '        if(s.display!=="none"&&s.visibility!=="hidden"){btns[j].click();break;}' +
            '      }' +
            '    }catch(e){}},t);})(times[i]);' +
            '  }' +
            '};' +
            '</script></body></html>';

        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(wrapperHtml);
        return;
    }

    // ═══════════════════════════════════════
    // CORS M3U PROXY API
    // ═══════════════════════════════════════

    if (url === '/api/proxy' && method === 'GET') {
        var targetUrl = query.get('url');
        if (!targetUrl) {
            res.writeHead(400); res.end('Missing url param'); return;
        }

        const lib = targetUrl.startsWith('https') ? require('https') : require('http');
        const opts = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/plain, application/x-mpegurl, */*'
            }
        };

        const proxyReq = lib.get(targetUrl, opts, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            proxyRes.pipe(res);
        }).on('error', (err) => {
            res.writeHead(500); res.end('Proxy error: ' + err.message);
        });
        return;
    }

    // ═══════════════════════════════════════
    // REMOTE CONTROL API
    // ═══════════════════════════════════════

    // POST /api/remote/pair - TV requests a pairing code
    if (url === '/api/remote/pair' && method === 'POST') {
        const code = generatePairCode();
        // Pre-register the code so it exists before SSE connects
        tvSessions.set(code, {
            res: null,
            createdAt: Date.now(),
            sessionId: ++sessionIdCounter,
            phoneConnected: false,
            tvState: null,
        });
        console.log(`📺 Code generated: ${code}`);
        sendJSON(res, 200, { code });
        return;
    }

    // GET /api/remote/tv-connect?code=XXXX - TV opens SSE connection
    if (url === '/api/remote/tv-connect' && method === 'GET') {
        const code = query.get('code');
        if (!code) { sendJSON(res, 400, { error: 'Code required' }); return; }

        // Get existing session (pre-registered from /pair)
        const existing = tvSessions.get(code);
        
        // Close old SSE response if any
        if (existing && existing.res && !existing.res.writableEnded) {
            try { existing.res.end(); } catch(e) {}
        }

        // Set up SSE response
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();

        // Send initial connected event
        res.write(`event: connected\ndata: ${JSON.stringify({ code })}\n\n`);

        // Assign a unique session ID for this specific SSE connection
        const thisSessionId = ++sessionIdCounter;

        // Update session with new SSE response
        tvSessions.set(code, {
            res,
            createdAt: existing ? existing.createdAt : Date.now(),
            sessionId: thisSessionId,
            phoneConnected: existing ? existing.phoneConnected : false,
            tvState: existing ? existing.tvState : null,
        });
        console.log(`📺 TV SSE connected: ${code} (session ${thisSessionId})`);

        // Handle disconnect - ONLY delete if this is still the current session
        req.on('close', () => {
            const current = tvSessions.get(code);
            if (current && current.sessionId === thisSessionId) {
                tvSessions.delete(code);
                console.log(`📺 TV disconnected: ${code} (session ${thisSessionId})`);
            } else {
                console.log(`📺 Old SSE closed: ${code} (session ${thisSessionId}, superseded)`);
            }
        });

        // Keepalive every 15s
        const keepalive = setInterval(() => {
            if (res.writableEnded) { clearInterval(keepalive); return; }
            try { res.write(`:keepalive\n\n`); } catch(e) { clearInterval(keepalive); }
        }, 15000);

        return;
    }

    // GET /api/remote/check?code=XXXX - Phone checks if code is valid
    if (url === '/api/remote/check' && method === 'GET') {
        const code = query.get('code');
        const session = tvSessions.get(code);
        const valid = !!(session);
        sendJSON(res, 200, { valid });
        return;
    }

    // POST /api/remote/phone-connect - Phone confirms connection, notify TV
    if (url === '/api/remote/phone-connect' && method === 'POST') {
        try {
            const body = await parseBody(req);
            const code = body.code;
            const session = tvSessions.get(code);
            if (session) {
                session.phoneConnected = true;
                // Notify TV that phone is connected
                sendToTV(code, 'phone-connected', { connected: true });
                console.log(`📱 Phone connected to: ${code}`);
                sendJSON(res, 200, { success: true });
            } else {
                sendJSON(res, 404, { error: 'Code not found' });
            }
        } catch (err) {
            sendJSON(res, 500, { error: err.message });
        }
        return;
    }

    // POST /api/remote/command - Phone sends a command to TV
    if (url === '/api/remote/command' && method === 'POST') {
        try {
            const body = await parseBody(req);
            const { code, command, data } = body;

            if (!code || !command) {
                sendJSON(res, 400, { error: 'Code and command required' });
                return;
            }

            const session = tvSessions.get(code);
            if (!session) {
                sendJSON(res, 404, { error: 'TV not found' });
                return;
            }

            // Check if TV has an active SSE connection
            if (!session.res || session.res.writableEnded) {
                sendJSON(res, 200, { success: false, reason: 'TV SSE not connected' });
                return;
            }

            const sent = sendToTV(code, 'command', { command, data: data || {} });
            sendJSON(res, 200, { success: sent });
        } catch (err) {
            sendJSON(res, 500, { error: err.message });
        }
        return;
    }

    // POST /api/remote/tv-state - TV reports its state
    if (url === '/api/remote/tv-state' && method === 'POST') {
        try {
            const body = await parseBody(req);
            const session = tvSessions.get(body.code);
            if (session) session.tvState = body.state;
            sendJSON(res, 200, { success: true });
        } catch(e) { sendJSON(res, 500, { error: 'Failed' }); }
        return;
    }

    // GET /api/remote/tv-state?code=XXXX - Phone fetches TV state
    if (url === '/api/remote/tv-state' && method === 'GET') {
        const session = tvSessions.get(query.get('code'));
        sendJSON(res, 200, session?.tvState || { channel: null, playing: false });
        return;
    }

    // ═══════════════════════════════════════
    // PLAYLIST DATA API
    // ═══════════════════════════════════════

    if (url === '/api/data' && method === 'GET') {
        sendJSON(res, 200, readData()); return;
    }

    if (url === '/api/playlists' && method === 'POST') {
        try {
            const body = await parseBody(req);
            if (!body.url) { sendJSON(res, 400, { error: 'URL required' }); return; }
            const data = readData();
            data.playlists = data.playlists.filter(p => p.url !== body.url);
            data.playlists.unshift({ url: body.url, name: body.name || 'Playlist', addedAt: Date.now() });
            if (data.playlists.length > 20) data.playlists = data.playlists.slice(0, 20);
            data.lastPlaylist = body.url;
            writeData(data);
            sendJSON(res, 200, { success: true, playlists: data.playlists });
        } catch (err) { sendJSON(res, 500, { error: err.message }); }
        return;
    }

    if (url === '/api/playlists' && method === 'DELETE') {
        try {
            const body = await parseBody(req);
            const data = readData();
            data.playlists = data.playlists.filter(p => p.url !== body.url);
            writeData(data);
            sendJSON(res, 200, { success: true });
        } catch (err) { sendJSON(res, 500, { error: err.message }); }
        return;
    }

    if (url === '/api/last-playlist' && method === 'PUT') {
        try {
            const body = await parseBody(req);
            const data = readData();
            data.lastPlaylist = body.url || null;
            writeData(data);
            sendJSON(res, 200, { success: true });
        } catch (err) { sendJSON(res, 500, { error: err.message }); }
        return;
    }

    if (url === '/api/favorites' && method === 'POST') {
        try {
            const body = await parseBody(req);
            if (!body.url) { sendJSON(res, 400, { error: 'URL required' }); return; }
            const data = readData();
            const idx = data.favorites.indexOf(body.url);
            if (idx > -1) data.favorites.splice(idx, 1); else data.favorites.push(body.url);
            writeData(data);
            sendJSON(res, 200, { success: true, isFavorite: idx === -1, favorites: data.favorites });
        } catch (err) { sendJSON(res, 500, { error: err.message }); }
        return;
    }

    if (url === '/api/favorites' && method === 'DELETE') {
        const data = readData();
        data.favorites = [];
        writeData(data);
        sendJSON(res, 200, { success: true });
        return;
    }

    // ═══════════════════════════════════════
    // IPTV CORS PROXY (CLOUDFLARE BYPASS)
    // ═══════════════════════════════════════
    if (url === '/api/proxy' && method === 'GET') {
        const targetUrl = query.get('url');
        if (!targetUrl) {
            res.writeHead(400); res.end('Missing url param'); return;
        }

        try {
            const parsedUrl = new URL(targetUrl);
            const client = parsedUrl.protocol === 'https:' ? require('https') : http;
            
            const reqHeaders = {
                'User-Agent': query.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Referer': query.get('Referer') || parsedUrl.origin + '/',
                'Accept': '*/*'
            };

            const proxyReq = client.get(targetUrl, { headers: reqHeaders }, (proxyRes) => {
                const isM3U8 = targetUrl.includes('.m3u8') || (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('mpegurl'));
                
                res.writeHead(proxyRes.statusCode, {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': proxyRes.headers['content-type'] || 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-cache'
                });

                if (isM3U8) {
                    let body = '';
                    proxyRes.on('data', chunk => body += chunk.toString());
                    proxyRes.on('end', () => {
                        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                        // Rewrite relative TS/M3U8 chunks to route through proxy
                        const rewritten = body.split('\n').map(line => {
                            line = line.trim();
                            if (line && !line.startsWith('#')) {
                                const absoluteUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
                                return `/api/proxy?url=${encodeURIComponent(absoluteUrl)}&User-Agent=${encodeURIComponent(reqHeaders['User-Agent'])}&Referer=${encodeURIComponent(reqHeaders['Referer'])}`;
                            }
                            return line;
                        }).join('\n');
                        res.end(rewritten);
                    });
                } else {
                    proxyRes.pipe(res);
                }
            });

            proxyReq.on('error', (err) => {
                if (!res.headersSent) {
                    res.writeHead(500); res.end('Proxy error: ' + err.message);
                }
            });
        } catch (err) {
            res.writeHead(400); res.end('Invalid URL');
        }
        return;
    }

    // ─── Static Files ───
    serveStatic(req, res);
});

// ─── Passenger (cPanel) vs standalone ───
if (typeof(PhusionPassenger) !== 'undefined') {
    PhusionPassenger.configure({ autoInstall: false });
    server.listen('passenger', () => {
        console.log('OpenIPTV running via Passenger');
    });
} else {
    server.listen(PORT, HOST, () => {
        const ip = getLocalIP();
        console.log('');
        console.log('  ╔══════════════════════════════════════════════╗');
        console.log('  ║          OpenIPTV Server Running             ║');
        console.log('  ╠══════════════════════════════════════════════╣');
        console.log(`  ║  📺 TV:     http://${ip}:${PORT}          ║`);
        console.log(`  ║  📱 Remote: http://${ip}:${PORT}/remote    ║`);
        console.log('  ╚══════════════════════════════════════════════╝');
        console.log('');
    });
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '0.0.0.0';
}
