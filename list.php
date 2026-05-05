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
$salonCapacity = 300;

$pdo = new PDO("mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4", $dbUser, $dbPass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$guests = $pdo->query('SELECT id,name,phone,email,status,created_at FROM guests ORDER BY id DESC')->fetchAll();
$countsRaw = $pdo->query('SELECT status, COUNT(*) AS total FROM guests GROUP BY status')->fetchAll();
$counts = [1 => 0, 2 => 0, 3 => 0];
foreach ($countsRaw as $row) {
    $s = (int)$row['status'];
    if (isset($counts[$s])) $counts[$s] = (int)$row['total'];
}
$totalGuests = array_sum($counts);
$occupancyRate = $salonCapacity > 0 ? min(100, ($counts[1] / $salonCapacity) * 100) : 0;
?>
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Davetli Listesi</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="min-h-screen bg-slate-100">
  <nav class="bg-slate-900 text-white"><div class="max-w-7xl mx-auto px-4 py-3 flex justify-between"><span>Davetli Yonetim Paneli</span><div class="flex gap-2 text-sm"><a class="px-3 py-1.5 rounded bg-slate-700" href="index.php">Giris Formu</a><a class="px-3 py-1.5 rounded bg-indigo-600" href="list.php">Davetli Listesi</a><a class="px-3 py-1.5 rounded bg-rose-700" href="login.php?logout=1">Cikis</a></div></div></nav>
  <main class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <section class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
      <div class="rounded-xl bg-emerald-600 text-white p-4"><p class="text-sm">Kesin Gelecekler (1)</p><p class="text-3xl font-bold" id="count-1"><?= $counts[1] ?></p></div>
      <div class="rounded-xl bg-amber-500 text-white p-4"><p class="text-sm">Belirsizler (2)</p><p class="text-3xl font-bold" id="count-2"><?= $counts[2] ?></p></div>
      <div class="rounded-xl bg-rose-600 text-white p-4"><p class="text-sm">Elenenler / Yedekler (3)</p><p class="text-3xl font-bold" id="count-3"><?= $counts[3] ?></p></div>
      <div class="rounded-xl bg-slate-800 text-white p-4"><p class="text-sm">Toplam Davetli</p><p class="text-3xl font-bold" id="total-guests"><?= $totalGuests ?></p></div>
      <div class="rounded-xl bg-indigo-700 text-white p-4"><p class="text-sm">Kapasite / Doluluk</p><p class="text-lg"><?= $salonCapacity ?> kisi</p><p class="text-2xl font-bold" id="occupancy-rate"><?= number_format($occupancyRate,1) ?>%</p></div>
    </section>

    <section class="bg-white rounded-2xl overflow-hidden border">
      <div class="p-4 border-b"><h1 class="text-lg font-semibold">Davetli Listesi</h1></div>
      <div id="tableWrap" class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-50"><tr><th class="px-4 py-3 text-left">ID</th><th class="px-4 py-3 text-left">Ad Soyad</th><th class="px-4 py-3 text-left">Telefon</th><th class="px-4 py-3 text-left">Email</th><th class="px-4 py-3 text-left">Status</th><th class="px-4 py-3 text-left">Tarih</th></tr></thead>
          <tbody>
            <?php foreach ($guests as $g): ?>
            <tr class="border-t">
              <td class="px-4 py-3"><?= (int)$g['id'] ?></td>
              <td class="px-4 py-3 font-medium"><?= htmlspecialchars($g['name'], ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3"><?= htmlspecialchars((string)$g['phone'], ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3"><?= htmlspecialchars((string)$g['email'], ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3">
                <div class="status-control">
                  <input type="range" min="1" max="3" step="1" value="<?= (int)$g['status'] ?>" class="status-slider status-<?= (int)$g['status'] ?>" data-id="<?= (int)$g['id'] ?>">
                  <span class="status-label text-xs text-slate-600 mt-1 inline-block"><?= (int)$g['status'] ?> - <span class="status-text"><?= (int)$g['status'] === 1 ? 'Mutlaka' : ((int)$g['status'] === 2 ? 'Olabilir' : 'Gerek Yok') ?></span></span>
                </div>
              </td>
              <td class="px-4 py-3"><?= htmlspecialchars((string)$g['created_at'], ENT_QUOTES, 'UTF-8') ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
  const statusTextMap = {1:'Mutlaka',2:'Olabilir',3:'Gerek Yok'};
  function updateSliderStyle(slider, status){ slider.classList.remove('status-1','status-2','status-3'); slider.classList.add(`status-${status}`); }
  function updateStats(stats){ document.getElementById('count-1').textContent=stats.count_1; document.getElementById('count-2').textContent=stats.count_2; document.getElementById('count-3').textContent=stats.count_3; document.getElementById('total-guests').textContent=stats.total_guests; document.getElementById('occupancy-rate').textContent=`${stats.occupancy_rate}%`; }
  async function updateGuestStatus(id,status,slider){
    const res = await fetch('update.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status})});
    const data = await res.json();
    if(!res.ok || !data.success){ alert(data.message || 'Guncelleme basarisiz'); return; }
    const wrap = slider.closest('.status-control');
    wrap.querySelector('.status-label').firstChild.textContent = `${status} - `;
    wrap.querySelector('.status-text').textContent = statusTextMap[status];
    updateStats(data.stats);
  }
  document.querySelectorAll('.status-slider').forEach((slider)=>{
    slider.addEventListener('input', ()=> updateSliderStyle(slider, slider.value));
    slider.addEventListener('change', ()=>{ const status = Number(slider.value); const id = Number(slider.dataset.id); updateSliderStyle(slider,status); updateGuestStatus(id,status,slider); });
  });
  </script>
</body>
</html>
