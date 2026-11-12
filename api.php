<?php
// MoraEvE – PHP back end. Stores data as JSON files in ../data (or ./data).
header('Content-Type: application/json');

$resources = ['events', 'registrations', 'members'];
$r = $_GET['r'] ?? '';
if (!in_array($r, $resources, true)) { http_response_code(404); echo json_encode(['error' => 'Unknown resource']); exit; }

$dir = is_dir(__DIR__ . '/../data') ? __DIR__ . '/../data' : __DIR__ . '/data';
if (!is_dir($dir)) { mkdir($dir, 0775, true); }
$file = "$dir/$r.json";

function rows($file) { return file_exists($file) ? (json_decode(file_get_contents($file), true) ?: []) : []; }
function clean($v, $n = 200) { return mb_substr(trim((string)($v ?? '')), 0, $n); }

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // registrations and members hold personal data: not returned publicly
    echo json_encode($r === 'events' ? rows($file) : []);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $b = json_decode(file_get_contents('php://input'), true);
    if (!is_array($b)) { http_response_code(400); echo json_encode(['error' => 'Bad JSON']); exit; }

    $validEmail = fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL);
    if ($r === 'events') {
        $row = ['id' => 'u' . base_convert((string)round(microtime(true) * 1000), 10, 36), 'title' => clean($b['title'] ?? ''), 'venue' => clean($b['venue'] ?? '', 60), 'date' => clean($b['date'] ?? '', 10), 'price' => max(0, (float)($b['price'] ?? 0))];
        $ok = $row['title'] !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $row['date']);
    } elseif ($r === 'registrations') {
        $row = ['id' => clean($b['id'] ?? '', 40), 'eventId' => clean($b['eventId'] ?? '', 40), 'eventTitle' => clean($b['eventTitle'] ?? ''), 'name' => clean($b['name'] ?? '', 100), 'email' => clean($b['email'] ?? '', 120), 'at' => date('c')];
        $ok = $row['name'] !== '' && $validEmail($row['email']) && $row['eventId'] !== '';
    } else {
        $row = ['id' => clean($b['id'] ?? '', 40), 'name' => clean($b['name'] ?? '', 100), 'email' => clean($b['email'] ?? '', 120), 'at' => date('c')];
        $ok = $row['name'] !== '' && $validEmail($row['email']);
    }
    if (!$ok) { http_response_code(422); echo json_encode(['error' => 'Invalid data']); exit; }

    $fp = fopen($file, 'c+'); flock($fp, LOCK_EX);
    $all = json_decode(stream_get_contents($fp), true) ?: [];
    $all[] = $row;
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($all, JSON_PRETTY_PRINT));
    flock($fp, LOCK_UN); fclose($fp);
    http_response_code(201); echo json_encode($row); exit;
}

http_response_code(405); echo json_encode(['error' => 'Method not allowed']);
