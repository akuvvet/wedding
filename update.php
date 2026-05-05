<?php
declare(strict_types=1);
session_start();
header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Yetkisiz erisim.']);
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '{}', true);
$id = (int)($input['id'] ?? 0);
$status = (int)($input['status'] ?? 0);
$salonCapacity = 300;

if ($id <= 0 || !in_array($status, [1,2,3], true)) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Gecersiz veri.']);
    exit;
}

$dbHost = '127.0.0.1';
$dbName = 'davetiye_app';
$dbUser = 'root';
$dbPass = '';

try {
    $pdo = new PDO("mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4", $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $stmt = $pdo->prepare('UPDATE guests SET status = :status WHERE id = :id');
    $stmt->execute(['status' => $status, 'id' => $id]);

    $countsRaw = $pdo->query('SELECT status, COUNT(*) AS total FROM guests GROUP BY status')->fetchAll();
    $counts = [1 => 0, 2 => 0, 3 => 0];
    foreach ($countsRaw as $row) {
        $key = (int)$row['status'];
        if (isset($counts[$key])) $counts[$key] = (int)$row['total'];
    }
    $totalGuests = array_sum($counts);
    $occupancyRate = $salonCapacity > 0 ? min(100, ($counts[1] / $salonCapacity) * 100) : 0;

    echo json_encode([
        'success' => true,
        'stats' => [
            'count_1' => $counts[1],
            'count_2' => $counts[2],
            'count_3' => $counts[3],
            'total_guests' => $totalGuests,
            'occupancy_rate' => number_format($occupancyRate, 1),
        ]
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Sunucu hatasi: ' . $e->getMessage()]);
}
