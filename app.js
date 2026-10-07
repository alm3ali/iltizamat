// نقطة الدخول: تحميل الحالة، التنقل، وربط الأحداث.
import * as db from './store/db.js';
import { renderItems } from './ui/items-view.js';
import { openItemForm, openDebtForm, openSettingsForm } from './ui/forms.js';
import { todayISO } from './logic/index.js';

const state = { tab: 'items', settings: null, items: [], debts: [], occurrences: [], payments: [], cycles: [] };
const view = document.getElementById('view');
const TITLES = { cycle: 'هذه الدورة', upcoming: 'القادم', items: 'البنود' };

async function load() {
  const [settings, items, debts, occurrences, payments, cycles] = await Promise.all([
    db.getSettings(), db.getAll('items'), db.getAll('debts'), db.getAll('occurrences'), db.getAll('payments'), db.getAll('cycles'),
  ]);
  Object.assign(state, { settings, items, debts, occurrences, payments, cycles });
}

function placeholder(title, text) {
  return `<div class="empty"><h2>${title}</h2><p>${text}</p>
    <button class="btn" type="button" data-tab-go="items">اذهب إلى البنود</button></div>`;
}

function render() {
  document.getElementById('screen-title').textContent = TITLES[state.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (state.tab === 'items') view.innerHTML = renderItems(state);
  else if (state.tab === 'cycle') view.innerHTML = placeholder('قيد البناء', 'هنا ستظهر استحقاقات هذه الدورة مع مربعات التأشير، والتحويل الموصى به لحساب الالتزامات.');
  else view.innerHTML = placeholder('قيد البناء', 'هنا سيظهر الخط الزمني للأشهر الـ12 القادمة ومنحنى رصيد حساب الالتزامات.');
}

async function refresh() { await load(); render(); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- النسخ الاحتياطي ----

async function exportBackup() {
  const data = await db.exportAll();
  const name = `iltizamat-${todayISO()}.backup.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) {
    if (e.name === 'AbortError') return; // ألغى المستخدم نافذة المشاركة
    throw e;
  }
  await db.saveSettings({ ...(await db.getSettings()), lastBackupAt: new Date().toISOString() });
  await refresh();
  toast('صُدّرت النسخة الاحتياطية');
}

const importInput = document.getElementById('import-file');

function pickImportFile() {
  importInput.value = ''; // حتى يعمل اختيار الملف نفسه مرة ثانية
  importInput.click();
}

importInput.addEventListener('change', async () => {
  const f = importInput.files?.[0];
  if (!f) return;
  let raw;
  try {
    const text = (await f.text()).replace(/^﻿/, '');
    raw = JSON.parse(text);
  } catch {
    alert(`الملف "${f.name}" ليس نسخة احتياطية من التزاماتي.\nاختر ملفاً ينتهي بـ .json صدّرته الأداة.`);
    return;
  }
  try {
    if (!(await db.isEmpty()) && !confirm('الاستيراد يستبدل كل البيانات الحالية على هذا الجهاز. متابعة؟')) return;
    await db.importAll(raw);
    await refresh();
    toast(`استُورد ${state.items.length} بنداً و${state.debts.length} ديناً`);
  } catch (e) {
    alert(`تعذّر الاستيراد:\n${e.message}`);
  }
});

// ---- الأحداث ----

const itemHandlers = {
  onSave: async (r) => { await db.put('items', r); await refresh(); toast('حُفظ البند'); },
  onDelete: async (r) => { await db.remove('items', r.id); await refresh(); toast('حُذف البند'); },
};
const debtHandlers = () => ({
  items: state.items,
  onSave: async (r) => { await db.put('debts', r); await refresh(); toast('حُفظ الدين'); },
  onDelete: async (r) => { await db.remove('debts', r.id); await refresh(); toast('حُذف الدين'); },
});

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-tab-go]');
  if (!el) return;
  if (el.dataset.tabGo) { state.tab = el.dataset.tabGo; render(); return; }
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'new-item': return openItemForm(null, itemHandlers);
    case 'edit-item': return openItemForm(state.items.find((i) => i.id === id), itemHandlers);
    case 'new-debt': return openDebtForm(null, debtHandlers());
    case 'edit-debt': return openDebtForm(state.debts.find((d) => d.id === id), debtHandlers());
    case 'import': return pickImportFile();
  }
});

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  render();
  window.scrollTo({ top: 0 });
});

document.getElementById('open-settings').addEventListener('click', () => openSettingsForm(state.settings, {
  onSave: async (s) => { await db.saveSettings(s); await refresh(); toast('حُفظت الإعدادات'); },
  onExport: () => exportBackup().catch((e) => alert(e.message)),
  onImport: pickImportFile,
  onClear: async () => { await db.clearAll(); await refresh(); toast('مُسحت البيانات'); },
}));

// إغلاق الورقة عند الضغط خارجها
document.getElementById('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') e.target.close(); });

refresh().catch((e) => {
  view.innerHTML = '<div class="empty"><h2>تعذّر فتح البيانات</h2><p></p></div>';
  view.querySelector('p').textContent = e.message;
});
