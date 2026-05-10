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

http_response_code(404);
echo json_encode(['error' => 'Unknown action']);
