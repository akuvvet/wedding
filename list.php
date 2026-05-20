<?php
declare(strict_types=1);
session_start();
require_once __DIR__ . '/config.php';
requireLogin();

$readOnly = isViewer();
$isAdmin = isAdmin();
$currentUserId = currentUserId();
$salonCapacity = SALON_CAPACITY;
$pdo = getPdo();
$guestSql = $readOnly
    ? 'SELECT g.id, g.name, g.city, g.status, g.user_id, u.username AS kullanici
       FROM guests g
       LEFT JOIN users u ON u.id = g.user_id
       ORDER BY g.name ASC, g.id ASC'
    : 'SELECT g.id, g.name, g.phone, g.email, g.city, g.status, g.user_id, u.username AS kullanici
       FROM guests g
       LEFT JOIN users u ON u.id = g.user_id
       ORDER BY g.name ASC, g.id ASC';
$guests = $pdo->query($guestSql)->fetchAll();
$filterUsers = $pdo->query(
    'SELECT u.id, u.username FROM users u
     WHERE u.id IN (SELECT DISTINCT user_id FROM guests WHERE user_id IS NOT NULL)
     ORDER BY u.username ASC'
)->fetchAll();
$filterCities = $pdo->query(
    "SELECT DISTINCT TRIM(city) AS city FROM guests
     WHERE city IS NOT NULL AND TRIM(city) <> ''
     ORDER BY city ASC"
)->fetchAll();
$hasUnassignedGuests = (bool)$pdo->query('SELECT 1 FROM guests WHERE user_id IS NULL LIMIT 1')->fetchColumn();
$hasEmptyCityGuests = (bool)$pdo->query("SELECT 1 FROM guests WHERE city IS NULL OR TRIM(city) = '' LIMIT 1")->fetchColumn();
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
  <?php require __DIR__ . '/includes/nav.php'; ?>

  <main class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <section class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
      <div class="rounded-xl bg-emerald-600 text-white p-4"><p class="text-sm">Kesin Gelecekler (1)</p><p class="text-3xl font-bold" id="count-1"><?= $counts[1] ?></p></div>
      <div class="rounded-xl bg-amber-500 text-white p-4"><p class="text-sm">Belirsizler (2)</p><p class="text-3xl font-bold" id="count-2"><?= $counts[2] ?></p></div>
      <div class="rounded-xl bg-rose-600 text-white p-4"><p class="text-sm">Elenenler / Yedekler (3)</p><p class="text-3xl font-bold" id="count-3"><?= $counts[3] ?></p></div>
      <div class="rounded-xl bg-slate-800 text-white p-4"><p class="text-sm">Toplam Davetli</p><p class="text-3xl font-bold" id="total-guests"><?= $totalGuests ?></p></div>
      <div class="rounded-xl bg-indigo-700 text-white p-4"><p class="text-sm">Kapasite / Doluluk</p><p class="text-lg"><?= $salonCapacity ?> kisi</p><p class="text-2xl font-bold" id="occupancy-rate"><?= number_format($occupancyRate,1) ?>%</p></div>
    </section>

    <section class="bg-white rounded-2xl overflow-hidden border">
      <div class="p-4 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 class="text-lg font-semibold">Davetli Listesi</h1>
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 ml-auto w-full sm:w-auto">
          <label class="flex items-center gap-2 text-sm text-slate-600 shrink-0">
            <span class="whitespace-nowrap font-medium">Kullanici</span>
            <select id="userFilter" class="table-filter-select rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm min-w-[9rem] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none">
              <option value="">Tumu</option>
              <?php if ($hasUnassignedGuests): ?><option value="__none__">—</option><?php endif; ?>
              <?php foreach ($filterUsers as $fu): ?><option value="<?= (int)$fu['id'] ?>"><?= htmlspecialchars($fu['username'], ENT_QUOTES, 'UTF-8') ?></option><?php endforeach; ?>
            </select>
            <span id="filteredGuestCount" class="text-slate-500 text-sm tabular-nums whitespace-nowrap" title="Filtreye uyan satir / tablodaki tum satirlar"></span>
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-600 shrink-0">
            <span class="whitespace-nowrap font-medium">Sehir</span>
            <select id="cityFilter" class="table-filter-select rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm min-w-[9rem] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none">
              <option value="">Tumu</option>
              <?php if ($hasEmptyCityGuests): ?><option value="__none__">—</option><?php endif; ?>
              <?php foreach ($filterCities as $fc): ?><option value="<?= htmlspecialchars($fc['city'], ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($fc['city'], ENT_QUOTES, 'UTF-8') ?></option><?php endforeach; ?>
            </select>
          </label>
          <div class="table-search w-full sm:w-auto">
            <input type="search" id="tableSearch" class="table-search-input" placeholder="Tabloda ara..." autocomplete="off" spellcheck="false">
            <button type="button" id="tableSearchClear" class="table-search-clear" aria-label="Aramayi temizle" title="Temizle">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" fill="none" d="m3 3 8 8M11 3l-8 8"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div id="tableWrap" class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-50"><tr><th class="px-4 py-3 text-left">ID</th><th class="px-4 py-3 text-left" title="Isme gore siralama"><button type="button" class="sort-btn inline-flex items-center gap-1 font-semibold text-left text-slate-800 hover:text-indigo-700" data-sort-key="name" aria-label="Ad Soyad sirala">Ad Soyad <span class="sort-indicator text-slate-400" aria-hidden="true">A-Z</span></button></th><?php if (!$readOnly): ?><th class="px-4 py-3 text-left">Telefon</th><th class="px-4 py-3 text-left">Email</th><?php endif; ?><th class="px-4 py-3 text-left" title="Sehire gore siralama"><button type="button" class="sort-btn inline-flex items-center gap-1 font-semibold text-left text-slate-800 hover:text-indigo-700" data-sort-key="city" aria-label="Sehir sirala">Sehir <span class="sort-indicator text-slate-400" aria-hidden="true"></span></button></th><th class="px-4 py-3 text-left" title="Statusa gore siralama"><button type="button" class="sort-btn inline-flex items-center gap-1 font-semibold text-left text-slate-800 hover:text-indigo-700" data-sort-key="status" aria-label="Status sirala">Status <span class="sort-indicator text-slate-400" aria-hidden="true"></span></button></th><th class="px-4 py-3 text-left">Kullanici</th><?php if (!$readOnly): ?><th class="px-4 py-3 text-left whitespace-nowrap">Islem</th><?php endif; ?></tr></thead>
          <tbody>
            <?php foreach ($guests as $g):
              $guestUserId = $g['user_id'] !== null ? (int)$g['user_id'] : null;
              $ownsGuest = $guestUserId !== null && $guestUserId === $currentUserId;
              $canManage = $isAdmin || $ownsGuest;
              $canSeeContact = $isAdmin || $ownsGuest;
            ?>
            <tr class="border-t guest-row" data-id="<?= (int)$g['id'] ?>" data-name="<?= htmlspecialchars($g['name'], ENT_QUOTES, 'UTF-8') ?>"<?php if ($canSeeContact): ?> data-phone="<?= htmlspecialchars((string)($g['phone'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" data-email="<?= htmlspecialchars((string)($g['email'] ?? ''), ENT_QUOTES, 'UTF-8') ?>"<?php endif; ?> data-city="<?= htmlspecialchars((string)$g['city'], ENT_QUOTES, 'UTF-8') ?>" data-status="<?= (int)$g['status'] ?>" data-user-id="<?= $g['user_id'] !== null ? (int)$g['user_id'] : '' ?>" data-can-manage="<?= $canManage ? '1' : '0' ?>">
              <td class="px-4 py-3"><?= (int)$g['id'] ?></td>
              <td class="px-4 py-3 font-medium guest-cell-name"><?= htmlspecialchars($g['name'], ENT_QUOTES, 'UTF-8') ?></td>
              <?php if (!$readOnly): ?><td class="px-4 py-3 guest-cell-phone text-slate-500"><?= $canSeeContact ? htmlspecialchars((string)($g['phone'] ?? ''), ENT_QUOTES, 'UTF-8') : '—' ?></td><td class="px-4 py-3 guest-cell-email text-slate-500"><?= $canSeeContact ? htmlspecialchars((string)($g['email'] ?? ''), ENT_QUOTES, 'UTF-8') : '—' ?></td><?php endif; ?>
              <td class="px-4 py-3 guest-cell-city"><?= htmlspecialchars((string)$g['city'], ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3 guest-cell-status align-top">
                <?php if ($readOnly || !$canManage): ?>
                <span class="inline-block text-xs font-medium px-2 py-1 rounded status-badge status-<?= (int)$g['status'] ?>"><?= (int)$g['status'] ?> - <?= (int)$g['status'] === 1 ? 'Mutlaka' : ((int)$g['status'] === 2 ? 'Olabilir' : 'Gerek Yok') ?></span>
                <?php else: ?>
                <div class="status-control">
                  <input type="range" min="1" max="3" step="1" value="<?= (int)$g['status'] ?>" class="status-slider status-<?= (int)$g['status'] ?>" data-id="<?= (int)$g['id'] ?>">
                  <span class="status-label text-xs text-slate-600 mt-1 inline-block"><?= (int)$g['status'] ?> - <span class="status-text"><?= (int)$g['status'] === 1 ? 'Mutlaka' : ((int)$g['status'] === 2 ? 'Olabilir' : 'Gerek Yok') ?></span></span>
                </div>
                <?php endif; ?>
              </td>
              <td class="px-4 py-3 guest-cell-kullanici text-slate-600 whitespace-nowrap"><?php $kb = (string)($g['kullanici'] ?? ''); echo $kb !== '' ? htmlspecialchars($kb, ENT_QUOTES, 'UTF-8') : '—'; ?></td>
              <?php if (!$readOnly): ?>
              <td class="px-4 py-3 guest-cell-actions align-top">
                <?php if ($canManage): ?>
                <div class="guest-actions">
                  <button type="button" class="guest-edit-btn px-2 py-1 rounded text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700">Duzenle</button>
                  <button type="button" class="guest-delete-btn px-2 py-1 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-700">Sil</button>
                </div>
                <?php endif; ?>
              </td>
              <?php endif; ?>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
  const READ_ONLY = <?= $readOnly ? 'true' : 'false' ?>;
  const GUEST_API = { editUrl: 'edit_guest.php', deleteUrl: 'delete_guest.php' };
  const statusTextMap = {1:'Mutlaka',2:'Olabilir',3:'Gerek Yok'};
  const CURRENT_USER_ID = <?= (int)$currentUserId ?>;
  const IS_ADMIN = <?= $isAdmin ? 'true' : 'false' ?>;
  let editingRow = null;

  function canManageGuestRow(tr){
    if(IS_ADMIN) return true;
    return tr.dataset.canManage === '1';
  }
  function canSeeContactRow(tr){
    if(IS_ADMIN) return true;
    return tr.dataset.canManage === '1';
  }

  function updateSliderStyle(slider, status){ slider.classList.remove('status-1','status-2','status-3'); slider.classList.add(`status-${status}`); }
  function updateStats(stats){ document.getElementById('count-1').textContent=stats.count_1; document.getElementById('count-2').textContent=stats.count_2; document.getElementById('count-3').textContent=stats.count_3; document.getElementById('total-guests').textContent=stats.total_guests; document.getElementById('occupancy-rate').textContent=`${stats.occupancy_rate}%`; }

  function guestRowNameForSort(tr){
    const cell = tr.querySelector('.guest-cell-name');
    if(!cell) return '';
    const inp = cell.querySelector('input.guest-inline-field');
    if(inp) return String(inp.value || '').trim();
    return String(cell.textContent || '').trim();
  }
  function guestRowCityForSort(tr){
    const cell = tr.querySelector('.guest-cell-city');
    if(!cell) return '';
    const inp = cell.querySelector('input.guest-inline-field');
    if(inp) return String(inp.value || '').trim();
    return String(cell.textContent || '').trim();
  }
  const sortState = { key: 'name', direction: 'asc' };

  function guestRowStatusForSort(tr){
    return Number(tr.dataset.status || 0);
  }
  function sortDirectionFactor(){
    return sortState.direction === 'asc' ? 1 : -1;
  }
  function compareGuestRows(a,b){
    if(sortState.key === 'status'){
      const diff = (guestRowStatusForSort(a) - guestRowStatusForSort(b)) * sortDirectionFactor();
      if(diff !== 0) return diff;
      return guestRowNameForSort(a).localeCompare(guestRowNameForSort(b), 'tr', { sensitivity: 'base' });
    }
    if(sortState.key === 'city'){
      const cmp = guestRowCityForSort(a).localeCompare(guestRowCityForSort(b), 'tr', { sensitivity: 'base' }) * sortDirectionFactor();
      if(cmp !== 0) return cmp;
      return guestRowNameForSort(a).localeCompare(guestRowNameForSort(b), 'tr', { sensitivity: 'base' });
    }
    return guestRowNameForSort(a).localeCompare(guestRowNameForSort(b), 'tr', { sensitivity: 'base' }) * sortDirectionFactor();
  }
  function refreshSortIndicators(){
    const buttons = document.querySelectorAll('.sort-btn');
    buttons.forEach((btn)=>{
      const key = btn.dataset.sortKey;
      const indicator = btn.querySelector('.sort-indicator');
      if(!indicator) return;
      if(key !== sortState.key){
        indicator.textContent = '';
        btn.classList.remove('text-indigo-700');
        return;
      }
      if(key === 'name') indicator.textContent = sortState.direction === 'asc' ? 'A-Z' : 'Z-A';
      if(key === 'city') indicator.textContent = sortState.direction === 'asc' ? 'A-Z' : 'Z-A';
      if(key === 'status') indicator.textContent = sortState.direction === 'asc' ? '1-3' : '3-1';
      btn.classList.add('text-indigo-700');
    });
  }
  function sortGuestTable(){
    if(editingRow) return;
    const tbody = document.querySelector('#tableWrap tbody');
    if(!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr.guest-row'));
    rows.sort(compareGuestRows);
    for(const r of rows) tbody.appendChild(r);
    refreshSortIndicators();
  }
  function setSort(key){
    if(sortState.key === key){
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    }else{
      sortState.key = key;
      sortState.direction = 'asc';
    }
    sortGuestTable();
    applyTableFilter();
  }

  function statusCellHtml(id, status){
    return `<div class="status-control">
      <input type="range" min="1" max="3" step="1" value="${status}" class="status-slider status-${status}" data-id="${id}">
      <span class="status-label text-xs text-slate-600 mt-1 inline-block">${status} - <span class="status-text">${statusTextMap[status]}</span></span>
    </div>`;
  }
  function actionsCellHtml(){
    return `<div class="guest-actions">
      <button type="button" class="guest-edit-btn px-2 py-1 rounded text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700">Duzenle</button>
      <button type="button" class="guest-delete-btn px-2 py-1 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-700">Sil</button>
    </div>`;
  }

  function cancelInlineEdit(tr){
    if(!tr || !tr._inlineBackup) return;
    const b = tr._inlineBackup;
    tr.querySelector('.guest-cell-name').innerHTML = b.name;
    tr.querySelector('.guest-cell-phone').innerHTML = b.phone;
    tr.querySelector('.guest-cell-email').innerHTML = b.email;
    tr.querySelector('.guest-cell-city').innerHTML = b.city;
    tr.querySelector('.guest-cell-status').innerHTML = b.status;
    tr.querySelector('.guest-cell-actions').innerHTML = b.actions;
    delete tr._inlineBackup;
    if(editingRow === tr) editingRow = null;
    tr.classList.remove('guest-row-editing');
  }

  function statusBadgeHtml(status){
    return `<span class="inline-block text-xs font-medium px-2 py-1 rounded status-badge status-${status}">${status} - ${statusTextMap[status]}</span>`;
  }

  function startInlineEdit(tr){
    if(!canManageGuestRow(tr)) return;
    if(tr._inlineBackup) return;
    if(editingRow && editingRow !== tr) cancelInlineEdit(editingRow);
    const nameTd = tr.querySelector('.guest-cell-name');
    const phoneTd = tr.querySelector('.guest-cell-phone');
    const emailTd = tr.querySelector('.guest-cell-email');
    const cityTd = tr.querySelector('.guest-cell-city');
    const statusTd = tr.querySelector('.guest-cell-status');
    const actionsTd = tr.querySelector('.guest-cell-actions');
    tr._inlineBackup = { name: nameTd.innerHTML, phone: phoneTd.innerHTML, email: emailTd.innerHTML, city: cityTd.innerHTML, status: statusTd.innerHTML, actions: actionsTd.innerHTML };
    editingRow = tr;
    tr.classList.add('guest-row-editing');

    const inpName = document.createElement('input');
    inpName.type = 'text';
    inpName.required = true;
    inpName.className = 'guest-inline-field w-full min-w-[10rem] rounded border border-indigo-200 px-2 py-1 text-sm font-medium';
    inpName.value = tr.dataset.name || '';
    nameTd.replaceChildren(inpName);

    const inpPhone = document.createElement('input');
    inpPhone.type = 'text';
    inpPhone.className = 'guest-inline-field w-full min-w-[7rem] rounded border border-indigo-200 px-2 py-1 text-sm';
    inpPhone.value = tr.dataset.phone || '';
    phoneTd.replaceChildren(inpPhone);

    const inpEmail = document.createElement('input');
    inpEmail.type = 'email';
    inpEmail.className = 'guest-inline-field w-full min-w-[10rem] rounded border border-indigo-200 px-2 py-1 text-sm';
    inpEmail.value = tr.dataset.email || '';
    emailTd.replaceChildren(inpEmail);

    const inpCity = document.createElement('input');
    inpCity.type = 'text';
    inpCity.className = 'guest-inline-field w-full min-w-[7rem] rounded border border-indigo-200 px-2 py-1 text-sm';
    inpCity.value = tr.dataset.city || '';
    cityTd.replaceChildren(inpCity);

    const sel = document.createElement('select');
    sel.className = 'guest-inline-status w-full max-w-[12rem] rounded border border-indigo-200 px-2 py-1 text-sm';
    [[1,'1 - Mutlaka'],[2,'2 - Olabilir'],[3,'3 - Gerek Yok']].forEach(([v,t])=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); });
    sel.value = String(tr.dataset.status || '2');
    statusTd.replaceChildren(sel);

    const wrap = document.createElement('div');
    wrap.className = 'guest-actions';
    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'guest-inline-save px-2 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700';
    btnSave.textContent = 'Kaydet';
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'guest-inline-cancel px-2 py-1 rounded text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50';
    btnCancel.textContent = 'Iptal';
    wrap.append(btnSave, btnCancel);
    actionsTd.replaceChildren(wrap);
    inpName.focus();
  }

  async function saveInlineEdit(tr){
    const id = Number(tr.dataset.id);
    const name = tr.querySelector('.guest-cell-name input')?.value.trim() || '';
    const phone = tr.querySelector('.guest-cell-phone input')?.value.trim() || '';
    const email = tr.querySelector('.guest-cell-email input')?.value.trim() || '';
    const city = tr.querySelector('.guest-cell-city input')?.value.trim() || '';
    const status = Number(tr.querySelector('.guest-inline-status')?.value || 0);
    if(!name){ alert('Ad Soyad zorunludur'); return; }
    const res = await fetch(GUEST_API.editUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, name, phone, email, city, status }) });
    const data = await res.json();
    if(!res.ok || !data.success){ alert(data.message || 'Kayit guncellenemedi'); return; }
    delete tr._inlineBackup;
    editingRow = null;
    tr.classList.remove('guest-row-editing');
    tr.dataset.name = name;
    if(canSeeContactRow(tr)){
      tr.dataset.phone = phone;
      tr.dataset.email = email;
    }
    tr.dataset.canManage = '1';
    tr.dataset.city = city;
    tr.dataset.status = String(status);
    tr.querySelector('.guest-cell-name').textContent = name;
    tr.querySelector('.guest-cell-phone').textContent = canSeeContactRow(tr) ? phone : '—';
    tr.querySelector('.guest-cell-email').textContent = canSeeContactRow(tr) ? email : '—';
    tr.querySelector('.guest-cell-city').textContent = city;
    tr.querySelector('.guest-cell-status').innerHTML = canManageGuestRow(tr) ? statusCellHtml(id, status) : statusBadgeHtml(status);
    tr.querySelector('.guest-cell-actions').innerHTML = actionsCellHtml();
    updateStats(data.stats);
    sortGuestTable();
    applyTableFilter();
  }

  async function updateGuestStatus(id,status,slider){
    const res = await fetch('update.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status})});
    const data = await res.json();
    if(!res.ok || !data.success){ alert(data.message || 'Guncelleme basarisiz'); return; }
    const wrap = slider.closest('.status-control');
    wrap.querySelector('.status-label').firstChild.textContent = `${status} - `;
    wrap.querySelector('.status-text').textContent = statusTextMap[status];
    const tr = slider.closest('.guest-row');
    if(tr) tr.dataset.status = String(status);
    updateStats(data.stats);
  }

  const tableWrap = document.getElementById('tableWrap');
  if (!READ_ONLY) tableWrap.addEventListener('input', (e)=>{
    const slider = e.target.closest('.status-slider');
    if(!slider) return;
    updateSliderStyle(slider, slider.value);
  });
  if (!READ_ONLY) tableWrap.addEventListener('change', (e)=>{
    const slider = e.target.closest('.status-slider');
    if(!slider) return;
    const tr = slider.closest('.guest-row');
    if(tr && !canManageGuestRow(tr)) return;
    const status = Number(slider.value);
    const id = Number(slider.dataset.id);
    updateSliderStyle(slider, status);
    updateGuestStatus(id, status, slider);
  });

  if (!READ_ONLY) tableWrap.addEventListener('click', async (e)=>{
    if(e.target.closest('.guest-inline-save')){
      await saveInlineEdit(e.target.closest('.guest-row'));
      return;
    }
    if(e.target.closest('.guest-inline-cancel')){
      cancelInlineEdit(e.target.closest('.guest-row'));
      return;
    }
    if(e.target.closest('.guest-edit-btn')){
      startInlineEdit(e.target.closest('.guest-row'));
      return;
    }
    const delBtn = e.target.closest('.guest-delete-btn');
    if(delBtn){
      const tr = delBtn.closest('.guest-row');
      const id = Number(tr.dataset.id);
      if(!id || !confirm('Bu davetliyi silmek istediginize emin misiniz?')) return;
      const res = await fetch(GUEST_API.deleteUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
      const data = await res.json();
      if(!res.ok || !data.success){ alert(data.message || 'Silme basarisiz'); return; }
      if(editingRow === tr) editingRow = null;
      tr.remove();
      updateStats(data.stats);
      applyTableFilter();
    }
  });

  const tableSearch = document.getElementById('tableSearch');
  const tableSearchClear = document.getElementById('tableSearchClear');
  const userFilter = document.getElementById('userFilter');
  const cityFilter = document.getElementById('cityFilter');
  const filteredGuestCountEl = document.getElementById('filteredGuestCount');
  const tableRows = () => document.querySelectorAll('#tableWrap tbody tr.guest-row');
  function applyTableFilter(){
    const q = (tableSearch && tableSearch.value || '').trim().toLowerCase();
    const userId = userFilter ? userFilter.value : '';
    const city = cityFilter ? cityFilter.value : '';
    if (tableSearchClear) tableSearchClear.classList.toggle('is-visible', q.length > 0);
    let visible = 0;
    const rows = tableRows();
    rows.forEach((tr) => {
      const hay = tr.innerText.toLowerCase().replace(/\s+/g, ' ');
      const matchSearch = !q || hay.includes(q);
      const rowUserId = tr.dataset.userId || '';
      const matchUser = !userId || (userId === '__none__' ? !rowUserId : rowUserId === userId);
      const rowCity = tr.dataset.city || '';
      const matchCity = !city || (city === '__none__' ? !rowCity : rowCity === city);
      const show = matchSearch && matchUser && matchCity;
      tr.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });
    if (filteredGuestCountEl) {
      const total = rows.length;
      filteredGuestCountEl.textContent = total ? `${visible} / ${total}` : '';
    }
  }
  if (tableSearch) {
    tableSearch.addEventListener('input', applyTableFilter);
    tableSearch.addEventListener('search', applyTableFilter);
  }
  if (tableSearchClear && tableSearch) {
    tableSearchClear.addEventListener('click', () => {
      tableSearch.value = '';
      tableSearch.focus();
      applyTableFilter();
    });
  }
  if (userFilter) {
    userFilter.addEventListener('change', applyTableFilter);
  }
  if (cityFilter) {
    cityFilter.addEventListener('change', applyTableFilter);
  }
  document.querySelectorAll('.sort-btn').forEach((btn)=>{
    btn.addEventListener('click', ()=> setSort(btn.dataset.sortKey));
  });
  sortGuestTable();
  applyTableFilter();
  </script>
</body>
</html>
