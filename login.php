<?php
declare(strict_types=1);
session_start();

if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: login.php');
    exit;
}

if (isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit;
}

$dbHost = '127.0.0.1';
$dbName = 'davetiye_app';
$dbUser = 'root';
$dbPass = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim((string)($_POST['username'] ?? ''));
    $password = (string)($_POST['password'] ?? '');

    if ($username === '' || $password === '') {
        $error = 'Kullanici adi ve sifre zorunludur.';
    } else {
        try {
            $pdo = new PDO("mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4", $dbUser, $dbPass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            $stmt = $pdo->prepare('SELECT id, username, password_hash FROM users WHERE username = :username LIMIT 1');
            $stmt->execute(['username' => $username]);
            $user = $stmt->fetch();

            if ($user && hash_equals($user['password_hash'], hash('sha256', $password))) {
                session_regenerate_id(true);
                $_SESSION['user_id'] = (int)$user['id'];
                $_SESSION['username'] = $user['username'];
                header('Location: index.php');
                exit;
            }
            $error = 'Giris bilgileri hatali.';
        } catch (PDOException $e) {
            $error = 'Veritabani baglantisi basarisiz: ' . $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Giris</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="min-h-screen bg-slate-100 flex items-center justify-center p-4">
  <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
    <h1 class="text-2xl font-bold text-slate-800">Guvenli Giris</h1>
    <?php if ($error !== ''): ?><div class="mt-4 rounded bg-red-100 text-red-700 px-3 py-2 text-sm"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
    <form method="post" class="mt-5 space-y-4">
      <div><label class="text-sm">Kullanici Adi</label><input name="username" required class="mt-1 w-full rounded border px-3 py-2"></div>
      <div><label class="text-sm">Sifre</label><input type="password" name="password" required class="mt-1 w-full rounded border px-3 py-2"></div>
      <button class="w-full rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5">Giris Yap</button>
    </form>
  </div>
</body>
</html>
