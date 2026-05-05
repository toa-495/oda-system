const GAS_BASE_URL = window.APP_CONFIG?.GAS_BASE_URL || '';
const state = { expenses: [], masters: { payers: [], types: [] }, payerFilter: 'all', monthFilter: 'all', search: '' };
window.receiptUploading = false;
window.pendingReceiptPromise = null;

const $ = (id) => document.getElementById(id);
const yen = (n) => Number(n || 0).toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);

function toast(message){ const el=$('toast'); el.textContent=message; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),2200); }
function assertGas(){ if(!GAS_BASE_URL || GAS_BASE_URL.includes('ここに')) throw new Error('config.js の GAS_BASE_URL を設定してください。'); }
async function api(action, payload={}){
  assertGas();
  const res = await fetch(GAS_BASE_URL, { method:'POST', body: JSON.stringify({ action, ...payload }) });
  const json = await res.json();
  if(!json.ok) throw new Error(json.message || 'GAS処理に失敗しました');
  return json;
}

function escapeHtml(v){ return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function normalizeAmount(value){ return String(value || '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0)-0xFEE0)).replace(/[^0-9]/g,''); }

async function loadAll(){
  $('list-count').textContent = '読み込み中';
  try{
    const json = await api('getInitialData');
    state.expenses = json.expenses || [];
    state.masters = json.masters || { payers: [], types: [] };
    renderMasterInputs(); renderPayerFilter(); renderMonthFilter(); renderList();
  }catch(e){ toast(e.message); $('expense-list').innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`; }
}

function renderMasterInputs(){
  $('payer-input').innerHTML = '<option value="">選択してください</option>' + state.masters.payers.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  $('type-input').innerHTML = '<option value="">未選択</option>' + state.masters.types.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}
function renderPayerFilter(){
  const buttons = ['all', ...state.masters.payers].map(v => `<button class="chip ${state.payerFilter===v?'active':''}" data-payer="${escapeHtml(v)}">${v==='all'?'すべて':escapeHtml(v)}</button>`).join('');
  $('payer-filter').innerHTML = buttons;
  document.querySelectorAll('[data-payer]').forEach(btn => btn.addEventListener('click', () => { state.payerFilter = btn.dataset.payer; renderPayerFilter(); renderList(); }));
}

function renderMonthFilter(){
  const months = [...new Set(
    state.expenses
      .map(x => String(x.date || '').slice(0, 7))
      .filter(v => /^\d{4}-\d{2}$/.test(v))
  )].sort().reverse();

  $('month-filter').innerHTML =
    '<option value="all">すべての月</option>' +
    months.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

  $('month-filter').value = state.monthFilter;
}

function filteredExpenses(){
  const q = state.search.trim().toLowerCase();
  return state.expenses.filter(x => {
    if(state.payerFilter !== 'all' && x.payer !== state.payerFilter) return false;
    if(state.monthFilter !== 'all' && !String(x.date || '').startsWith(state.monthFilter)) return false;
    if(!q) return true;
    return [x.title,x.payer,x.type,x.amount].some(v => String(v||'').toLowerCase().includes(q));
  });
}
function renderList(){
  const items = filteredExpenses();
  $('list-count').textContent = `${items.length}件`;
  const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthTotal = state.expenses.filter(x => String(x.date||'').startsWith(ym)).reduce((s,x)=>s+Number(x.amount||0),0);
  const unsettled = state.expenses.filter(x => !x.settled).reduce((s,x)=>s+Number(x.amount||0),0);
  $('month-total').textContent = yen(monthTotal); $('unsettled-total').textContent = yen(unsettled);
  if(!items.length){ $('expense-list').innerHTML = '<p class="empty">該当する経費がありません。</p>'; return; }
  $('expense-list').innerHTML = items.map(x => `
    <button class="expense-item" data-no="${escapeHtml(x.no)}">
      <div class="expense-main"><div><div class="expense-title">${escapeHtml(x.title || '無題の経費')}</div><div class="meta">${escapeHtml(x.date || '日付未登録')}</div></div><div class="expense-amount">${x.amount ? yen(x.amount) : '金額未登録'}</div></div>
      <div class="expense-sub"><span class="tag">${escapeHtml(x.payer || '支払者なし')}</span><span class="tag">${escapeHtml(x.type || '種別なし')}</span><span class="tag gray">${x.settled ? '精算済み' : '未精算'}</span>${x.receiptUrl ? '<span class="tag gray">レシートあり</span>' : ''}</div>
    </button>`).join('');
  document.querySelectorAll('.expense-item').forEach(btn => btn.addEventListener('click', () => openEdit(btn.dataset.no)));
}

function resetForm(){
  $('expense-form').reset(); $('expense-no').value=''; $('receipt-url').value=''; $('receipt-id').value=''; $('date-input').value=today();
  $('receipt-status').textContent='未アップロード';
$('receipt-link').classList.add('hidden');
$('receipt-preview-wrap').classList.add('hidden');
$('receipt-preview').src = '';
$('delete-btn').classList.add('hidden');
  $('modal-mode').textContent='New'; $('modal-title').textContent='経費を追加';
  $('delete-receipt-btn').classList.add('hidden');
}
function openModal(){ $('modal').classList.remove('hidden'); }
function closeModal(){ $('modal').classList.add('hidden'); }
function openNew(){ resetForm(); openModal(); }
function openEdit(no){
  const x = state.expenses.find(e => String(e.no) === String(no)); if(!x) return;
  resetForm(); $('modal-mode').textContent=`No.${x.no}`; $('modal-title').textContent='経費を編集'; $('expense-no').value=x.no;
  $('title-input').value=x.title||''; $('amount-input').value=x.amount||''; $('payer-input').value=x.payer||''; $('type-input').value=x.type||''; $('date-input').value=x.date||''; $('settled-input').checked=!!x.settled;
  $('receipt-url').value=x.receiptUrl||''; $('receipt-id').value=x.receiptId||'';
  if(x.receiptUrl){
  $('receipt-status').textContent='アップロード済み';
  $('receipt-link').href=x.receiptUrl;
  $('receipt-link').classList.remove('hidden');

  $('delete-receipt-btn').classList.remove('hidden');

  if(x.receiptId){
    loadReceiptPreview(x.receiptId);
  }
}
  $('delete-btn').classList.remove('hidden'); openModal();
}
function getPayload(){
  const title = $('title-input').value.trim(); const amount = normalizeAmount($('amount-input').value);
  $('amount-input').value = amount;
  const payload = {
  no: $('expense-no').value,
  title,
  amount,
  payer: $('payer-input').value,
  type: $('type-input').value,
  date: $('date-input').value,
  settled: $('settled-input').checked,
  receiptUrl: $('receipt-url').value,
  receiptId: $('receipt-id').value,
  receiptUploading: window.receiptUploading === true
};
  if(!payload.payer) throw new Error('支払者は必須です。');
  const hasReceipt = payload.receiptUrl || window.receiptUploading === true;

if(!(payload.title && payload.amount) && !hasReceipt) {
  throw new Error('タイトル＋金額、またはレシートのどちらかを入力してください。');
}
  return payload;
}

async function saveExpense(e){
  e.preventDefault();

  const beforeExpenses = state.expenses.map(x => ({ ...x }));

  try{
    $('save-btn').disabled = true;

    const payload = getPayload();
    const isUpdate = !!payload.no;
    const tempNo = isUpdate ? payload.no : 'temp_' + Date.now();

    if (isUpdate) {
      state.expenses = state.expenses.map(x =>
        String(x.no) === String(payload.no)
          ? { ...x, ...payload }
          : x
      );
    } else {
      state.expenses.unshift({
        ...payload,
        no: tempNo
      });
    }

    renderMonthFilter();
    renderList();
    closeModal();

    const json = await api(isUpdate ? 'updateExpense' : 'addExpense', { expense: payload });

    const savedNo = isUpdate
      ? payload.no
      : String(json.expense?.no || '');

    if (!isUpdate && savedNo) {
      state.expenses = state.expenses.map(x =>
        String(x.no) === String(tempNo)
          ? { ...x, no: savedNo }
          : x
      );
      renderList();
    }

    if (window.pendingReceiptPromise && !payload.receiptUrl) {
      try {
        const receipt = await window.pendingReceiptPromise;

        if (receipt && savedNo) {
          const updatedPayload = {
            ...payload,
            no: savedNo,
            receiptUrl: receipt.receiptUrl,
            receiptId: receipt.receiptId,
            receiptUploading: false
          };

          state.expenses = state.expenses.map(x =>
            String(x.no) === String(savedNo)
              ? { ...x, receiptUrl: receipt.receiptUrl, receiptId: receipt.receiptId }
              : x
          );
          renderList();

          await api('updateExpense', { expense: updatedPayload });
        }
      } catch(uploadErr) {
        toast('項目は保存しましたが、レシートアップロードに失敗しました。');
      }
    }

    toast('保存しました');

  } catch(err) {
    state.expenses = beforeExpenses;
    renderMonthFilter();
    renderList();
    toast('保存に失敗しました。元に戻しました。' + err.message);

  } finally {
    $('save-btn').disabled = false;
  }
}
async function deleteExpense(){
  const no = $('expense-no').value; if(!no) return;
  if(!confirm('この経費を削除しますか？')) return;
  try{ await api('deleteExpense', { no }); state.expenses = state.expenses.filter(x => String(x.no)!==String(no)); renderList(); closeModal(); toast('削除しました'); }catch(e){ toast(e.message); }
}
async function uploadReceipt(file){
  if(!file) return;

  window.receiptUploading = true;

  const uploadTask = (async () => {
    $('receipt-status').textContent = 'アップロード中...';

    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

    const json = await api('uploadReceipt', {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64,
      date: $('date-input').value,
      title: $('title-input').value,
      payer: $('payer-input').value
    });

    $('receipt-url').value = json.url;
    $('receipt-id').value = json.fileId;
    $('receipt-status').textContent = 'アップロード済み';
    $('receipt-link').href = json.url;
    $('receipt-link').classList.remove('hidden');

    if (file.type && file.type.startsWith('image/')) {
      $('receipt-preview').src = URL.createObjectURL(file);
      $('receipt-preview-wrap').classList.remove('hidden');
    }

    toast('レシートを保存しました');

    return {
      receiptUrl: json.url,
      receiptId: json.fileId
    };
  })();

  window.pendingReceiptPromise = uploadTask;

  try {
    return await uploadTask;
  } catch(e) {
    $('receipt-status').textContent = 'アップロード失敗';
    toast('レシートアップロードに失敗しました。' + e.message);
    throw e;
  } finally {
    window.receiptUploading = false;
  }
}

$('add-btn').addEventListener('click', openNew);
$('refresh-btn').addEventListener('click', loadAll);
$('expense-form').addEventListener('submit', saveExpense);
$('delete-btn').addEventListener('click', deleteExpense);
$('amount-input').addEventListener('input', e => e.target.value = normalizeAmount(e.target.value));
$('receipt-input').addEventListener('change', e => uploadReceipt(e.target.files?.[0]));
$('search-input').addEventListener('input', e => { state.search = e.target.value; renderList(); });
$('month-filter').addEventListener('change', e => {
  state.monthFilter = e.target.value;
  renderList();
});
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
loadAll();

async function deleteReceiptOnly(){
  const receiptId = $('receipt-id').value;
  if(!receiptId) return;

  if(!confirm('レシート画像だけ削除しますか？')) return;

  const beforeExpenses = state.expenses.map(x => ({ ...x }));
  const no = $('expense-no').value;

  $('receipt-url').value = '';
  $('receipt-id').value = '';
  $('receipt-status').textContent = '未アップロード';
  $('receipt-link').classList.add('hidden');
  $('receipt-preview-wrap').classList.add('hidden');
  $('receipt-preview').src = '';
  $('delete-receipt-btn').classList.add('hidden');

  if(no){
    state.expenses = state.expenses.map(x =>
      String(x.no) === String(no)
        ? { ...x, receiptUrl: '', receiptId: '' }
        : x
    );
    renderList();
  }

  try{
    await api('deleteReceipt', { no, receiptId });
    toast('レシートを削除しました');
  }catch(e){
    state.expenses = beforeExpenses;
    renderList();
    toast('レシート削除に失敗しました。' + e.message);
  }
}

$('delete-receipt-btn').addEventListener('click', deleteReceiptOnly);

async function loadReceiptPreview(receiptId){
  try{
    const json = await api('getReceiptImage', { receiptId });
    if(json.dataUrl){
      $('receipt-preview').src = json.dataUrl;
      $('receipt-preview-wrap').classList.remove('hidden');
    }
  }catch(e){
    console.warn(e.message);
  }
}

$('receipt-preview').addEventListener('click', () => {
  if(!$('receipt-preview').src) return;
  $('image-viewer-img').src = $('receipt-preview').src;
  $('image-viewer').classList.remove('hidden');
});

$('image-viewer-close').addEventListener('click', () => {
  $('image-viewer').classList.add('hidden');
  $('image-viewer-img').src = '';
});
