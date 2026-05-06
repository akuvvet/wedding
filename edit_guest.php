<?php
declare(strict_types=1);
session_start();
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Yetkisiz erisim.']);
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '{}', true);
$id = (int)($input['id'] ?? 0);
$name = trim((string)($input['name'] ?? ''));
$phone = trim((string)($input['phone'] ?? ''));
$email = trim((string)($input['email'] ?? ''));
$status = (int)($input['status'] ?? 0);
$salonCapacity = SALON_CAPACITY;

if ($id <= 0 || $name === '' || !in_array($status, [1, 2, 3], true)) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Gecersiz veri.']);
    exit;
}

try {
    $pdo = getPdo();
    $stmt = $pdo->prepare('UPDATE guests SET name = :name, phone = :phone, email = :email, status = :status WHERE id = :id');
    $stmt->execute([
        'name' => $name,
        'phone' => $phone !== '' ? $phone : null,
        'email' => $email !== '' ? $email : null,
        'status' => $status,
        'id' => $id,
    ]);

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
        ],
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Sunucu hatasi: ' . $e->getMessage()]);
}
