let shortcuts = [];
let editIdx = -1;

const scList   = document.getElementById('sc-list');
const emptySc  = document.getElementById('empty-sc');
const overlay  = document.getElementById('overlay');
const delayEl  = document.getElementById('delay');
const delayVal = document.getElementById('delay-val');
const savedEl  = document.getElementById('saved');

// Load
chrome.storage.sync.get(['shortcuts','autoFireDelay'], data => {
  shortcuts = data.shortcuts || [];
  delayEl.value = data.autoFireDelay ?? 300;
  delayVal.textContent = delayEl.value;
  renderList();
});

delayEl.addEventListener('input', () => { delayVal.textContent = delayEl.value; });

function renderList() {
  emptySc.style.display = shortcuts.length ? 'none' : 'block';
  scList.innerHTML = '';
  shortcuts.forEach((sc, i) => {
    const row = document.createElement('div');
    row.className = 'sc-row';
    row.innerHTML = `
      <div class="sc-key">${esc(sc.key||'?')}</div>
      <div class="sc-info">
        <div class="sc-name">${esc(sc.label||sc.url)}</div>
        <div class="sc-url">${esc(sc.url)}</div>
      </div>
      <div class="sc-acts">
        <button class="sc-btn" data-edit="${i}">Edit</button>
        <button class="sc-btn del" data-del="${i}">Remove</button>
      </div>`;
    scList.appendChild(row);
  });
  scList.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(+b.dataset.edit)));
  scList.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { shortcuts.splice(+b.dataset.del,1); renderList(); }));
}

// Modal
function openModal(idx = -1) {
  editIdx = idx;
  document.getElementById('modal-title').textContent = idx >= 0 ? 'Edit Shortcut' : 'Add Shortcut';
  const sc = idx >= 0 ? shortcuts[idx] : {};
  document.getElementById('f-label').value = sc.label || '';
  document.getElementById('f-url').value   = sc.url   || '';
  document.getElementById('f-key').value   = sc.key   || '';
  overlay.style.display = 'flex';
  setTimeout(() => document.getElementById('f-label').focus(), 50);
}
function closeModal() { overlay.style.display = 'none'; }

document.getElementById('btn-add').addEventListener('click', () => openModal());
document.getElementById('btn-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.getElementById('f-key').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
});

document.getElementById('btn-confirm').addEventListener('click', () => {
  const label = document.getElementById('f-label').value.trim();
  const url   = document.getElementById('f-url').value.trim();
  const key   = document.getElementById('f-key').value.trim().toLowerCase();
  if (!url) { document.getElementById('f-url').focus(); return; }
  if (!key) { document.getElementById('f-key').focus(); return; }
  if (shortcuts.some((s,i) => s.key === key && i !== editIdx)) {
    alert(`Key "${key.toUpperCase()}" is already used.`); return;
  }
  const entry = { label: label || url, url, key };
  if (editIdx >= 0) shortcuts[editIdx] = entry; else shortcuts.push(entry);
  renderList();
  closeModal();
});

document.getElementById('btn-save').addEventListener('click', () => {
  chrome.storage.sync.set({ shortcuts, autoFireDelay: +delayEl.value }, () => {
    savedEl.classList.add('show');
    setTimeout(() => savedEl.classList.remove('show'), 2000);
  });
});

document.getElementById('change-hotkey').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
