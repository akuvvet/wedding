<?php
declare(strict_types=1);
session_start();
require_once __DIR__ . '/config.php';
requireLogin();

$readOnly = isViewer();
$pdo = getPdo();
$success = '';
$error = '';

if (!$readOnly && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $tarih = trim((string)($_POST['tarih'] ?? ''));
    $saatBaslangic = trim((string)($_POST['saat_baslangic'] ?? ''));
    $saatBitis = trim((string)($_POST['saat_bitis'] ?? ''));
    $aksiyon = trim((string)($_POST['aksiyon'] ?? ''));
    $aciklama = trim((string)($_POST['aciklama'] ?? ''));
    $sahis = trim((string)($_POST['sahis'] ?? ''));

    if ($tarih === '' || $saatBaslangic === '' || $saatBitis === '' || $aksiyon === '') {
        $error = 'Tarih, baslangic/bitis saati ve aksiyon zorunludur.';
    } elseif ($saatBitis < $saatBaslangic) {
        $error = 'Bitis saati baslangic saatinden once olamaz.';
    } else {
        try {
            $stmt = $pdo->prepare('INSERT INTO gun_akisi (tarih, saat_baslangic, saat_bitis, aksiyon, aciklama, sahis) VALUES (:tarih,:saat_baslangic,:saat_bitis,:aksiyon,:aciklama,:sahis)');
            $stmt->execute([
                'tarih' => $tarih,
                'saat_baslangic' => $saatBaslangic,
                'saat_bitis' => $saatBitis,
                'aksiyon' => $aksiyon,
                'aciklama' => $aciklama !== '' ? $aciklama : null,
                'sahis' => $sahis !== '' ? $sahis : null,
            ]);
            header('Location: gun_akisi.php?ok=1');
            exit;
        } catch (PDOException $e) {
            $error = 'Kayit hatasi: ' . $e->getMessage();
        }
    }
}

if (isset($_GET['ok'])) {
    $success = 'Kayit basariyla eklendi.';
}

$entries = $pdo->query('SELECT id, tarih, saat_baslangic, saat_bitis, aksiyon, aciklama, sahis FROM gun_akisi ORDER BY tarih ASC, saat_baslangic ASC, saat_bitis ASC, id ASC')->fetchAll();

function formatTarih(string $raw): string
{
    if (preg_match('/^\d{4}-\d{2}-\d{2}/', $raw, $m)) {
        return substr($m[0], 0, 10);
    }
    return substr($raw, 0, 10);
}

function formatSaat(string $raw): string
{
    $parts = explode(':', $raw);
    $h = (int)($parts[0] ?? 0);
    $m = (int)($parts[1] ?? 0);
    return sprintf('%02d:%02d', $h, $m);
}

function isLongAciklama(string $text): bool
{
    return strlen($text) > 80 || str_contains($text, "\n");
}

function aciklamaRows(string $text): int
{
    return min(6, max(2, (int)ceil(strlen($text) / 50) ?: 1));
}
?>
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gun Akisi</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="min-h-screen bg-slate-100">
  <?php require __DIR__ . '/includes/nav.php'; ?>

  <main class="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <?php if ($success !== ''): ?><div class="rounded bg-emerald-100 text-emerald-700 px-3 py-2 text-sm"><?= htmlspecialchars($success, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
    <?php if ($error !== ''): ?><div class="rounded bg-red-100 text-red-700 px-3 py-2 text-sm"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
    <?php if ($readOnly): ?><div class="rounded bg-slate-200 text-slate-700 px-3 py-2 text-sm">Salt okunur: Gun akisi tablosunu goruntuleyebilirsiniz.</div><?php endif; ?>

    <?php if (!$readOnly): ?>
    <section class="bg-white border rounded-2xl p-4 sm:p-5">
      <h1 class="text-lg font-semibold mb-4">Yeni Gun Akisi Kaydi</h1>
      <form method="post" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
        <div class="lg:col-span-2"><label class="text-xs font-medium text-slate-600">Tarih</label><input type="date" name="tarih" required class="mt-1 w-full rounded border px-2 py-2 text-sm"></div>
        <div class="lg:col-span-2"><label class="text-xs font-medium text-slate-600">Baslangic</label><input type="time" name="saat_baslangic" required class="mt-1 w-full rounded border px-2 py-2 text-sm"></div><div class="lg:col-span-2"><label class="text-xs font-medium text-slate-600">Bitis</label><input type="time" name="saat_bitis" required class="mt-1 w-full rounded border px-2 py-2 text-sm"></div>
        <div class="lg:col-span-2"><label class="text-xs font-medium text-slate-600">Aksiyon</label><input type="text" name="aksiyon" required maxlength="120" class="mt-1 w-full rounded border px-2 py-2 text-sm"></div>
        <div class="lg:col-span-3"><label class="text-xs font-medium text-slate-600">Aciklama</label><textarea name="aciklama" maxlength="500" rows="2" class="flow-aciklama-field mt-1 w-full text-sm"></textarea></div>
        <div class="lg:col-span-2"><label class="text-xs font-medium text-slate-600">Sahis</label><input type="text" name="sahis" maxlength="120" class="mt-1 w-full rounded border px-2 py-2 text-sm"></div>
        <div class="lg:col-span-1"><button type="submit" class="w-full rounded bg-teal-600 text-white px-3 py-2 text-sm font-semibold hover:bg-teal-700">Ekle</button></div>
      </form>
    </section>
    <?php endif; ?>

    <section class="bg-white rounded-2xl overflow-hidden border">
      <div class="p-4 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-lg font-semibold">Gun Akisi Tablosu</h2>
        <div class="table-search ml-auto w-full sm:w-auto">
          <input type="search" id="tableSearch" class="table-search-input" placeholder="Tabloda ara..." autocomplete="off" spellcheck="false">
          <button type="button" id="tableSearchClear" class="table-search-clear" aria-label="Aramayi temizle" title="Temizle">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" fill="none" d="m3 3 8 8M11 3l-8 8"/></svg>
          </button>
        </div>
      </div>
      <div id="tableWrap" class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-50"><tr><th class="px-4 py-3 text-left">Tarih</th><th class="px-4 py-3 text-left">Baslangic</th><th class="px-4 py-3 text-left">Bitis</th><th class="px-4 py-3 text-left">Aksiyon</th><th class="px-4 py-3 text-left">Aciklama</th><th class="px-4 py-3 text-left" title="Sahise gore siralama"><button type="button" class="sort-btn inline-flex items-center gap-1 font-semibold text-left text-slate-800 hover:text-indigo-700" data-sort-key="sahis" aria-label="Sahis sirala">Sahis <span class="sort-indicator text-slate-400" aria-hidden="true"></span></button></th><?php if (!$readOnly): ?><th class="px-4 py-3 text-left whitespace-nowrap">Islem</th><?php endif; ?></tr></thead>
          <tbody>
            <?php if (!$entries): ?>
            <tr><td colspan="8" class="px-4 py-8 text-center text-slate-500">Henuz kayit yok.</td></tr>
            <?php endif; ?>
            <?php foreach ($entries as $e):
              $tarihVal = formatTarih((string)$e['tarih']);
              $baslangicVal = formatSaat((string)($e['saat_baslangic'] ?? $e['saat'] ?? ''));
              $bitisVal = formatSaat((string)($e['saat_bitis'] ?? $e['saat'] ?? ''));
              $aciklamaVal = (string)($e['aciklama'] ?? '');
              $aciklamaLong = isLongAciklama($aciklamaVal);
            ?>
            <tr class="border-t flow-row" data-id="<?= (int)$e['id'] ?>" data-tarih="<?= htmlspecialchars($tarihVal, ENT_QUOTES, 'UTF-8') ?>" data-saat-baslangic="<?= htmlspecialchars($baslangicVal, ENT_QUOTES, 'UTF-8') ?>" data-saat-bitis="<?= htmlspecialchars($bitisVal, ENT_QUOTES, 'UTF-8') ?>" data-aksiyon="<?= htmlspecialchars((string)$e['aksiyon'], ENT_QUOTES, 'UTF-8') ?>" data-aciklama="<?= htmlspecialchars((string)($e['aciklama'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" data-sahis="<?= htmlspecialchars((string)($e['sahis'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
              <td class="px-4 py-3 flow-cell-tarih whitespace-nowrap"><?= htmlspecialchars($tarihVal, ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3 flow-cell-saat-baslangic whitespace-nowrap"><?= htmlspecialchars($baslangicVal, ENT_QUOTES, 'UTF-8') ?></td><td class="px-4 py-3 flow-cell-saat-bitis whitespace-nowrap"><?= htmlspecialchars($bitisVal, ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3 flow-cell-aksiyon font-medium"><?= htmlspecialchars((string)$e['aksiyon'], ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3 flow-cell-aciklama"><?php if ($aciklamaLong): ?><textarea readonly rows="<?= aciklamaRows($aciklamaVal) ?>" class="flow-aciklama-view"><?= htmlspecialchars($aciklamaVal, ENT_QUOTES, 'UTF-8') ?></textarea><?php else: ?><?= htmlspecialchars($aciklamaVal, ENT_QUOTES, 'UTF-8') ?><?php endif; ?></td>
              <td class="px-4 py-3 flow-cell-sahis"><?= htmlspecialchars((string)($e['sahis'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>
              <td class="px-4 py-3 flow-cell-actions align-top">
                <?php if ($readOnly): ?>
                <span class="text-slate-400 text-xs">—</span>
                <?php else: ?>
                <div class="guest-actions">
                  <button type="button" class="flow-edit-btn px-2 py-1 rounded text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700">Duzenle</button>
                  <button type="button" class="flow-delete-btn px-2 py-1 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-700">Sil</button>
                </div>
                <?php endif; ?>
              </td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
  const READ_ONLY = <?= $readOnly ? 'true' : 'false' ?>;
  const FLOW_API = { editUrl: 'edit_flow.php', deleteUrl: 'delete_flow.php' };
  let editingRow = null;
  const ACILIK_LIMIT=80;
  function isLongAciklama(t){const s=String(t||'');return s.length>ACILIK_LIMIT||s.includes('
');}
  function aciklamaRows(t){const s=String(t||'');return Math.min(6,Math.max(2,Math.ceil(s.length/50)||1));}
  function renderAciklamaCell(td,text){const s=String(text||'');td.replaceChildren();if(!s)return;if(isLongAciklama(s)){const ta=document.createElement('textarea');ta.readOnly=true;ta.rows=aciklamaRows(s);ta.className='flow-aciklama-view';ta.value=s;td.appendChild(ta);}else{td.textContent=s;}}
  function createAciklamaInput(v){const s=String(v||'');if(isLongAciklama(s)){const ta=document.createElement('textarea');ta.maxLength=500;ta.rows=aciklamaRows(s);ta.className='flow-aciklama-field flow-inline-field';ta.value=s;return ta;}const inp=document.createElement('input');inp.type='text';inp.maxLength=500;inp.className='flow-inline-field w-full min-w-[10rem] rounded border border-indigo-200 px-2 py-1 text-sm';inp.value=s;return inp;}
  function readAciklamaValue(td){const f=td.querySelector('textarea,input');return f?String(f.value||'').trim():'';}
  function actionsCellHtml(){ return `<div class="guest-actions"><button type="button" class="flow-edit-btn px-2 py-1 rounded text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700">Duzenle</button><button type="button" class="flow-delete-btn px-2 py-1 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-700">Sil</button></div>`; }
  function cancelInlineEdit(tr){ if(!tr||!tr._inlineBackup)return; const b=tr._inlineBackup; tr.querySelector('.flow-cell-tarih').innerHTML=b.tarih; tr.querySelector('.flow-cell-saat-baslangic').innerHTML=b.saatBaslangic; tr.querySelector('.flow-cell-saat-bitis').innerHTML=b.saatBitis; tr.querySelector('.flow-cell-aksiyon').innerHTML=b.aksiyon; tr.querySelector('.flow-cell-aciklama').innerHTML=b.aciklama; tr.querySelector('.flow-cell-sahis').innerHTML=b.sahis; tr.querySelector('.flow-cell-actions').innerHTML=b.actions; delete tr._inlineBackup; if(editingRow===tr)editingRow=null; tr.classList.remove('guest-row-editing'); }
  function startInlineEdit(tr){ if(tr._inlineBackup)return; if(editingRow&&editingRow!==tr)cancelInlineEdit(editingRow); const tarihTd=tr.querySelector('.flow-cell-tarih'), saatBaslangicTd=tr.querySelector('.flow-cell-saat-baslangic'), saatBitisTd=tr.querySelector('.flow-cell-saat-bitis'), aksiyonTd=tr.querySelector('.flow-cell-aksiyon'), aciklamaTd=tr.querySelector('.flow-cell-aciklama'), sahisTd=tr.querySelector('.flow-cell-sahis'), actionsTd=tr.querySelector('.flow-cell-actions'); tr._inlineBackup={tarih:tarihTd.innerHTML,saatBaslangic:saatBaslangicTd.innerHTML,saatBitis:saatBitisTd.innerHTML,aksiyon:aksiyonTd.innerHTML,aciklama:aciklamaTd.innerHTML,sahis:sahisTd.innerHTML,actions:actionsTd.innerHTML}; editingRow=tr; tr.classList.add('guest-row-editing'); const inpTarih=document.createElement('input'); inpTarih.type='date'; inpTarih.required=true; inpTarih.className='flow-inline-field w-full min-w-[9rem] rounded border border-indigo-200 px-2 py-1 text-sm'; inpTarih.value=tr.dataset.tarih||''; tarihTd.replaceChildren(inpTarih); const inpBaslangic=document.createElement('input'); inpBaslangic.type='time'; inpBaslangic.required=true; inpBaslangic.className='flow-inline-field w-full min-w-[7rem] rounded border border-indigo-200 px-2 py-1 text-sm'; inpBaslangic.value=tr.dataset.saatBaslangic||''; saatBaslangicTd.replaceChildren(inpBaslangic); const inpBitis=document.createElement('input'); inpBitis.type='time'; inpBitis.required=true; inpBitis.className='flow-inline-field w-full min-w-[7rem] rounded border border-indigo-200 px-2 py-1 text-sm'; inpBitis.value=tr.dataset.saatBitis||''; saatBitisTd.replaceChildren(inpBitis); const inpAksiyon=document.createElement('input'); inpAksiyon.type='text'; inpAksiyon.required=true; inpAksiyon.maxLength=120; inpAksiyon.className='flow-inline-field w-full min-w-[8rem] rounded border border-indigo-200 px-2 py-1 text-sm font-medium'; inpAksiyon.value=tr.dataset.aksiyon||''; aksiyonTd.replaceChildren(inpAksiyon); aciklamaTd.replaceChildren(createAciklamaInput(tr.dataset.aciklama||'')); const inpSahis=document.createElement('input'); inpSahis.type='text'; inpSahis.maxLength=120; inpSahis.className='flow-inline-field w-full min-w-[7rem] rounded border border-indigo-200 px-2 py-1 text-sm'; inpSahis.value=tr.dataset.sahis||''; sahisTd.replaceChildren(inpSahis); const wrap=document.createElement('div'); wrap.className='guest-actions'; const btnSave=document.createElement('button'); btnSave.type='button'; btnSave.className='flow-inline-save px-2 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700'; btnSave.textContent='Kaydet'; const btnCancel=document.createElement('button'); btnCancel.type='button'; btnCancel.className='flow-inline-cancel px-2 py-1 rounded text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50'; btnCancel.textContent='Iptal'; wrap.append(btnSave,btnCancel); actionsTd.replaceChildren(wrap); inpTarih.focus(); }
  async function saveInlineEdit(tr){ const id=Number(tr.dataset.id); const tarih=tr.querySelector('.flow-cell-tarih input')?.value.trim()||''; const saatBaslangic=tr.querySelector('.flow-cell-saat-baslangic input')?.value.trim()||''; const saatBitis=tr.querySelector('.flow-cell-saat-bitis input')?.value.trim()||''; const aksiyon=tr.querySelector('.flow-cell-aksiyon input')?.value.trim()||''; const aciklama=readAciklamaValue(tr.querySelector('.flow-cell-aciklama')); const sahis=tr.querySelector('.flow-cell-sahis input')?.value.trim()||''; if(!tarih||!saatBaslangic||!saatBitis||!aksiyon){alert('Tarih, baslangic/bitis saati ve aksiyon zorunludur');return;} if(padSaat(saatBitis)<padSaat(saatBaslangic)){alert('Bitis saati baslangic saatinden once olamaz');return;} const res=await fetch(FLOW_API.editUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,tarih,saat_baslangic:saatBaslangic,saat_bitis:saatBitis,aksiyon,aciklama,sahis})}); const data=await res.json(); if(!res.ok||!data.success){alert(data.message||'Kayit guncellenemedi');return;} delete tr._inlineBackup; editingRow=null; tr.classList.remove('guest-row-editing'); tr.dataset.tarih=tarih; tr.dataset.saatBaslangic=padSaat(saatBaslangic); tr.dataset.saatBitis=padSaat(saatBitis); tr.dataset.aksiyon=aksiyon; tr.dataset.aciklama=aciklama; tr.dataset.sahis=sahis; tr.querySelector('.flow-cell-tarih').textContent=tarih; tr.querySelector('.flow-cell-saat-baslangic').textContent=padSaat(saatBaslangic); tr.querySelector('.flow-cell-saat-bitis').textContent=padSaat(saatBitis); tr.querySelector('.flow-cell-aksiyon').textContent=aksiyon; renderAciklamaCell(tr.querySelector('.flow-cell-aciklama'),aciklama); tr.querySelector('.flow-cell-sahis').textContent=sahis; tr.querySelector('.flow-cell-actions').innerHTML=actionsCellHtml(); sortFlowTable(); applyTableFilter(); }
  function padSaat(v){ const p=String(v||'').split(':'); return `${String(parseInt(p[0],10)||0).padStart(2,'0')}:${String(parseInt(p[1],10)||0).padStart(2,'0')}`; }
  const sortState={key:'tarih',direction:'asc'};
  function flowRowSahisForSort(tr){const cell=tr.querySelector('.flow-cell-sahis');if(!cell)return '';const inp=cell.querySelector('input.flow-inline-field');if(inp)return String(inp.value||'').trim();return String(cell.textContent||'').trim();}
  function compareFlowRowsDefault(a,b){const td=String(a.dataset.tarih||'').localeCompare(String(b.dataset.tarih||''));if(td!==0)return td;const sb=padSaat(a.dataset.saatBaslangic).localeCompare(padSaat(b.dataset.saatBaslangic));if(sb!==0)return sb;return padSaat(a.dataset.saatBitis).localeCompare(padSaat(b.dataset.saatBitis));}
  function compareFlowRows(a,b){const factor=sortState.direction==='asc'?1:-1;if(sortState.key==='sahis'){const cmp=flowRowSahisForSort(a).localeCompare(flowRowSahisForSort(b),'tr',{sensitivity:'base'});if(cmp!==0)return cmp*factor;return compareFlowRowsDefault(a,b);}return compareFlowRowsDefault(a,b)*factor;}
  function refreshSortIndicators(){document.querySelectorAll('.sort-btn').forEach(btn=>{const key=btn.dataset.sortKey;const indicator=btn.querySelector('.sort-indicator');if(!indicator)return;if(key!==sortState.key){indicator.textContent='';btn.classList.remove('text-indigo-700');return;}indicator.textContent=sortState.direction==='asc'?'A-Z':'Z-A';btn.classList.add('text-indigo-700');});}
  function sortFlowTable(){if(editingRow)return;const tbody=document.querySelector('#tableWrap tbody');if(!tbody)return;const rows=Array.from(tbody.querySelectorAll('tr.flow-row'));rows.sort(compareFlowRows);for(const r of rows)tbody.appendChild(r);refreshSortIndicators();}
  function setSort(key){if(sortState.key===key){sortState.direction=sortState.direction==='asc'?'desc':'asc';}else{sortState.key=key;sortState.direction='asc';}sortFlowTable();applyTableFilter();}
  const tableWrap=document.getElementById('tableWrap');
  if(!READ_ONLY&&tableWrap)tableWrap.addEventListener('click',async(e)=>{ if(e.target.closest('.flow-inline-save')){await saveInlineEdit(e.target.closest('.flow-row'));return;} if(e.target.closest('.flow-inline-cancel')){cancelInlineEdit(e.target.closest('.flow-row'));return;} if(e.target.closest('.flow-edit-btn')){startInlineEdit(e.target.closest('.flow-row'));return;} const delBtn=e.target.closest('.flow-delete-btn'); if(delBtn){ const tr=delBtn.closest('.flow-row'); const id=Number(tr.dataset.id); if(!id||!confirm('Bu kaydi silmek istediginize emin misiniz?'))return; const res=await fetch(FLOW_API.deleteUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); const data=await res.json(); if(!res.ok||!data.success){alert(data.message||'Silme basarisiz');return;} if(editingRow===tr)editingRow=null; tr.remove(); }});
  const tableSearch=document.getElementById('tableSearch'), tableSearchClear=document.getElementById('tableSearchClear');
  const tableRows=()=>document.querySelectorAll('#tableWrap tbody tr');
  function applyTableFilter(){ const q=(tableSearch&&tableSearch.value||'').trim().toLowerCase(); if(tableSearchClear)tableSearchClear.classList.toggle('is-visible',q.length>0); tableRows().forEach(tr=>{ const hay=tr.innerText.toLowerCase().replace(/\s+/g,' '); tr.style.display=!q||hay.includes(q)?'':'none'; }); }
  if(tableSearch){tableSearch.addEventListener('input',applyTableFilter);tableSearch.addEventListener('search',applyTableFilter);}
  if(tableSearchClear&&tableSearch){tableSearchClear.addEventListener('click',()=>{tableSearch.value='';tableSearch.focus();applyTableFilter();});}
  document.querySelectorAll('.sort-btn').forEach(btn=>{btn.addEventListener('click',()=>setSort(btn.dataset.sortKey));});
  sortFlowTable(); applyTableFilter();
  </script>
</body>
</html>
