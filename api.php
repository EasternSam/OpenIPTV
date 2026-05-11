<?php
/**
 * OpenIPTV - Simple PHP API
 * Reads/writes data/playlists.json
 * Works on any cPanel without Node.js
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataDir = __DIR__ . '/data';
$dataFile = $dataDir . '/playlists.json';

// Ensure data directory and file exist
if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);
if (!file_exists($dataFile)) {
    file_put_contents($dataFile, json_encode([
        'playlists' => [],
        'lastPlaylist' => null,
        'favorites' => []
    ], JSON_PRETTY_PRINT));
}

function readData() {
    global $dataFile;
    $content = file_get_contents($dataFile);
    $data = json_decode($content, true);
    if (!$data) $data = ['playlists' => [], 'lastPlaylist' => null, 'favorites' => []];
    if (!isset($data['favorites'])) $data['favorites'] = [];
    return $data;
}

function writeData($data) {
    global $dataFile;
    file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function getInput() {
    return json_decode(file_get_contents('php://input'), true) ?: [];
}

// Route based on query parameter
$action = isset($_GET['action']) ? $_GET['action'] : 'data';
$method = $_SERVER['REQUEST_METHOD'];

// GET /api.php → return all data
if ($action === 'data' && $method === 'GET') {
    echo json_encode(readData());
    exit;
}

// POST /api.php?action=playlists → add playlist
if ($action === 'playlists' && $method === 'POST') {
    $body = getInput();
    if (empty($body['url'])) {
        http_response_code(400);
        echo json_encode(['error' => 'URL required']);
        exit;
    }
    $data = readData();
    $data['playlists'] = array_values(array_filter($data['playlists'], function($p) use ($body) {
        return $p['url'] !== $body['url'];
    }));
    array_unshift($data['playlists'], [
        'url' => $body['url'],
        'name' => isset($body['name']) ? $body['name'] : 'Playlist',
        'addedAt' => time() * 1000
    ]);
    if (count($data['playlists']) > 20) $data['playlists'] = array_slice($data['playlists'], 0, 20);
    $data['lastPlaylist'] = $body['url'];
    writeData($data);
    echo json_encode(['success' => true, 'playlists' => $data['playlists']]);
    exit;
}

// DELETE /api.php?action=playlists → remove playlist
if ($action === 'playlists' && $method === 'DELETE') {
    $body = getInput();
    $data = readData();
    $data['playlists'] = array_values(array_filter($data['playlists'], function($p) use ($body) {
        return $p['url'] !== $body['url'];
    }));
    writeData($data);
    echo json_encode(['success' => true]);
    exit;
}

// PUT /api.php?action=last-playlist → set default
if ($action === 'last-playlist' && $method === 'PUT') {
    $body = getInput();
    $data = readData();
    $data['lastPlaylist'] = isset($body['url']) ? $body['url'] : null;
    writeData($data);
    echo json_encode(['success' => true]);
    exit;
}

// POST /api.php?action=favorites → toggle favorite
if ($action === 'favorites' && $method === 'POST') {
    $body = getInput();
    if (empty($body['url'])) {
        http_response_code(400);
        echo json_encode(['error' => 'URL required']);
        exit;
    }
    $data = readData();
    $idx = array_search($body['url'], $data['favorites']);
    if ($idx !== false) {
        array_splice($data['favorites'], $idx, 1);
        $isFav = false;
    } else {
        $data['favorites'][] = $body['url'];
        $isFav = true;
    }
    $data['favorites'] = array_values($data['favorites']);
    writeData($data);
    echo json_encode(['success' => true, 'isFavorite' => $isFav, 'favorites' => $data['favorites']]);
    exit;
}

// DELETE /api.php?action=favorites → clear all favorites
if ($action === 'favorites' && $method === 'DELETE') {
    $data = readData();
    $data['favorites'] = [];
    writeData($data);
    echo json_encode(['success' => true]);
    exit;
}

// GET /api.php?action=proxy&url=... → fetch external M3U to bypass CORS
if ($action === 'proxy' && $method === 'GET') {
    $targetUrl = isset($_GET['url']) ? $_GET['url'] : '';
    if (empty($targetUrl)) {
        http_response_code(400);
        echo "Missing URL";
        exit;
    }

    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    
    if (curl_errno($ch)) {
        http_response_code(500);
        echo "Curl error: " . curl_error($ch);
    } else {
        http_response_code($httpCode >= 200 && $httpCode < 400 ? 200 : $httpCode);
        header('Content-Type: text/plain; charset=utf-8');
        echo $response;
    }
    curl_close($ch);
    exit;
}

// POST /api.php?action=upload → upload M3U file
if ($action === 'upload' && $method === 'POST') {
    $uploadDir = __DIR__ . '/uploads';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

    if (empty($_FILES['m3u']) || $_FILES['m3u']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['error' => 'No file uploaded']);
        exit;
    }

    $file = $_FILES['m3u'];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['m3u', 'm3u8', 'txt'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Only .m3u / .m3u8 / .txt files']);
        exit;
    }

    // Sanitize filename
    $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($file['name'], PATHINFO_FILENAME));
    $safeName = substr($safeName, 0, 50) . '_' . time() . '.' . $ext;
    $dest = $uploadDir . '/' . $safeName;

    if (move_uploaded_file($file['tmp_name'], $dest)) {
        // Build public URL
        $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'];
        $url = $proto . '://' . $host . '/uploads/' . $safeName;

        // Auto-add as playlist
        $name = isset($_POST['name']) && $_POST['name'] ? $_POST['name'] : pathinfo($file['name'], PATHINFO_FILENAME);
        $data = readData();
        array_unshift($data['playlists'], [
            'url' => $url,
            'name' => $name,
            'addedAt' => time() * 1000
        ]);
        $data['lastPlaylist'] = $url;
        writeData($data);

        echo json_encode(['success' => true, 'url' => $url, 'name' => $name]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Upload failed']);
    }
    exit;
}

// ═══════════════════════════════════════════════
// REMOTE CONTROL POLLING API (PHP FALLBACK)
// ═══════════════════════════════════════════════

function getRemoteFile($code) {
    $code = preg_replace('/[^0-9]/', '', $code);
    if (empty($code)) return null;
    $dir = __DIR__ . '/data/remote';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return $dir . '/' . $code . '.json';
}

if ($action === 'remote-pair' && $method === 'POST') {
    $code = str_pad((string)rand(0, 9999), 4, '0', STR_PAD_LEFT);
    $file = getRemoteFile($code);
    file_put_contents($file, json_encode(['phoneConnected' => false, 'commands' => [], 'state' => null]));
    echo json_encode(['code' => $code]);
    exit;
}

if ($action === 'remote-tv-poll' && $method === 'GET') {
    $code = isset($_GET['code']) ? $_GET['code'] : '';
    $file = getRemoteFile($code);
    if (!$file || !file_exists($file)) { http_response_code(404); echo json_encode(['error' => 'not found']); exit; }
    $data = json_decode(file_get_contents($file), true);
    
    if (count($data['commands']) > 0) {
        $outData = $data;
        $data['commands'] = [];
        file_put_contents($file, json_encode($data));
        echo json_encode(['phoneConnected' => $outData['phoneConnected'], 'commands' => $outData['commands']]);
    } else {
        echo json_encode(['phoneConnected' => $data['phoneConnected'], 'commands' => []]);
    }
    exit;
}

if ($action === 'remote-phone-connect' && $method === 'POST') {
    $body = getInput();
    $code = isset($body['code']) ? $body['code'] : '';
    $file = getRemoteFile($code);
    if (!$file || !file_exists($file)) { http_response_code(404); echo json_encode(['error' => 'not found']); exit; }
    $data = json_decode(file_get_contents($file), true);
    $data['phoneConnected'] = true;
    file_put_contents($file, json_encode($data));
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'remote-command' && $method === 'POST') {
    $body = getInput();
    $code = isset($body['code']) ? $body['code'] : '';
    $file = getRemoteFile($code);
    if (!$file || !file_exists($file)) { http_response_code(404); exit; }
    $data = json_decode(file_get_contents($file), true);
    $data['commands'][] = ['command' => $body['command'], 'data' => isset($body['data']) ? $body['data'] : null];
    file_put_contents($file, json_encode($data));
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'remote-sync' && $method === 'POST') {
    $body = getInput();
    $code = isset($body['code']) ? $body['code'] : '';
    $file = getRemoteFile($code);
    if ($file && file_exists($file)) {
        $data = json_decode(file_get_contents($file), true);
        $data['state'] = isset($body['state']) ? $body['state'] : null;
        file_put_contents($file, json_encode($data));
    }
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'remote-check' && $method === 'GET') {
    $code = isset($_GET['code']) ? $_GET['code'] : '';
    $file = getRemoteFile($code);
    if ($file && file_exists($file)) {
        echo json_encode(['valid' => true]);
    } else {
        echo json_encode(['valid' => false]);
    }
    exit;
}

if ($action === 'remote-tv-state' && $method === 'GET') {
    $code = isset($_GET['code']) ? $_GET['code'] : '';
    $file = getRemoteFile($code);
    if (!$file || !file_exists($file)) { http_response_code(404); exit; }
    $data = json_decode(file_get_contents($file), true);
    if ($data['state']) {
        echo json_encode($data['state']);
    } else {
        echo json_encode([]);
    }
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Unknown action']);
