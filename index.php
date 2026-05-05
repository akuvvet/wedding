<?php
declare(strict_types=1);
session_start();
if (!isset($_SESSION['user_id'])) {
    header('Location: login.php');
    exit;
}

$dbHost = '127.0.0.1';
$dbName = 'davetiye_app';
$dbUser = 'root';
$dbPass = '';
$success = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim((string)($_POST['name'] ?? ''));
    $phone = trim((string)($_POST['phone'] ?? ''));
    $email = trim((string)($_POST['email'] ?? ''));
    $status = (int)($_POST['status'] ?? 2);

    if ($name === '') {
        $error = 'Ad Soyad zorunludur.';
    } elseif (!in_array($status, [1,2,3], true)) {
        $error = 'Gecersiz status secimi.';
    } else {
        try {
            $pdo = new PDO("mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4", $dbUser, $dbPass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            $stmt = $pdo->prepare('INSERT INTO guests (name, phone, email, status) VALUES (:name,:phone,:email,:status)');
            $stmt->execute([
                'name' => $name,
                'phone' => $phone !== '' ? $phone : null,
                'email' => $email !== '' ? $email : null,
                'status' => $status
            ]);
            header('Location: index.php?ok=1');
            exit;
        } catch (PDOException $e) {
            $error = 'Kayit hatasi: ' . $e->getMessage();
        }
    }
}
if (isset($_GET['ok'])) $success = 'Davetli basariyla kaydedildi.';
?>
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Giris Formu</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="min-h-screen bg-slate-100">
  <nav class="bg-slate-900 text-white"><div class="max-w-6xl mx-auto px-4 py-3 flex justify-between"><span>Davetli Yonetim Paneli</span><div class="flex gap-2 text-sm"><a class="px-3 py-1.5 rounded bg-indigo-600" href="index.php">Giris Formu</a><a class="px-3 py-1.5 rounded bg-slate-700" href="list.php">Davetli Listesi</a><a class="px-3 py-1.5 rounded bg-rose-700" href="login.php?logout=1">Cikis</a></div></div></nav>
  <main class="max-w-3xl mx-auto p-4 sm:p-6">
    <section class="bg-white border rounded-2xl p-6">
      <h1 class="text-xl font-bold">Davetli Veri Girisi</h1>
      <?php if ($success !== ''): ?><div class="mt-4 rounded bg-emerald-100 text-emerald-700 px-3 py-2 text-sm"><?= htmlspecialchars($success, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
      <?php if ($error !== ''): ?><div class="mt-4 rounded bg-red-100 text-red-700 px-3 py-2 text-sm"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
      <form method="post" class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="sm:col-span-2"><label class="text-sm">Ad Soyad</label><input name="name" required class="mt-1 w-full rounded border px-3 py-2"></div>
        <div><label class="text-sm">Telefon</label><input name="phone" class="mt-1 w-full rounded border px-3 py-2"></div>
        <div><label class="text-sm">Email</label><input type="email" name="email" class="mt-1 w-full rounded border px-3 py-2"></div>
        <div class="sm:col-span-2"><label class="text-sm">Baslangic Statusu</label><select name="status" class="mt-1 w-full rounded border px-3 py-2"><option value="1">1 - Mutlaka</option><option value="2" selected>2 - Olabilir</option><option value="3">3 - Gerek Yok</option></select></div>
        <div class="sm:col-span-2"><button class="rounded bg-indigo-600 text-white px-5 py-2.5 font-semibold">Kaydet</button></div>
      </form>
    </section>
  </main>
</body>
</html>
