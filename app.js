// نقطة الدخول: تحميل الحالة، التنقل، وربط الأحداث.
import * as db from './store/db.js';
import { renderItems } from './ui/items-view.js';
import { openItemForm, openDebtForm, openSettingsForm } from './ui/forms.js';
import { renderCycle, cycleModel } from './ui/cycle-view.js';
import { openOccurrenceSheet, openRitual } from './ui/cycle-sheets.js';
import { renderUpcoming, showCurvePoint } from './ui/upcoming-view.js';
import { openEmergencySheet } from './ui/emergency-sheet.js';
import {
  todayISO, settleOccurrence, undoOccurrence, accrueSinking, planEmergency, emergencyContext, round2,
} from './logic/index.js';

const state = { tab: 'cycle', settings: null, items: [], debts: [], occurrences: [], payments: [], cycles: [] };
const view = document.getElementById('view');
const TITLES = { cycle: 'هذه الدورة', upcoming: 'القادم', items: 'البنود' };

async function load() {
  const [settings, items, debts, occurrences, payments, cycles] = await Promise.all([
    db.getSettings(), db.getAll('items'), db.getAll('debts'), db.getAll('occurrences'), db.getAll('payments'), db.getAll('cycles'),
  ]);
  Object.assign(state, { settings, items, debts, occurrences, payments, cycles });
}

function render() {
  document.getElementById('screen-title').textContent = TITLES[state.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (state.tab === 'items') view.innerHTML = renderItems(state);
  else if (state.tab === 'cycle') view.innerHTML = renderCycle(state, todayISO());
  else view.innerHTML = renderUpcoming(state, todayISO());
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

// ---- الدورة: السداد والتخطي والتراجع ----

const findRow = (key) => cycleModel(state, todayISO()).rows.find((r) => r.key === key);

async function settle(r, { amount, status }) {
  const item = state.items.find((i) => i.id === r.itemId);
  if (!item) return;
  const res = settleOccurrence({ item, occ: r, amount, nowISO: todayISO(), status });
  await db.putMany({ items: [res.item], occurrences: [res.occurrence], payments: res.payment ? [res.payment] : [] });
  await refresh();
}

async function undo(r) {
  const u = undoOccurrence(r.stored);
  if (u.item) await db.put('items', u.item);
  await db.remove('occurrences', u.removeOccurrenceId);
  await db.remove('payments', u.removePaymentId);
  await refresh();
  toast('تراجعت');
}

const occHandlers = {
  onPay: (r, amount) => settle(r, { amount, status: 'paid' }).then(() => toast('سُدّد')),
  onSkip: (r) => settle(r, { status: 'skipped' }).then(() => toast('تُخطّي هذه المرة')),
  onUndo: undo,
};

async function toggle(key) {
  const r = findRow(key);
  if (!r) return;
  if (r.status !== 'open') return undo(r);
  if (r.item?.amountMode === 'variable' || r.expectedAmount == null) return openOccurrenceSheet(r, occHandlers);
  await settle(r, { amount: r.expectedAmount, status: 'paid' });
}

async function confirmFixed() {
  const { rows } = cycleModel(state, todayISO());
  const ready = rows.filter((r) => r.status === 'open' && r.item?.amountMode !== 'variable' && r.expectedAmount != null);
  if (!ready.length || !confirm(`تأشير ${ready.length} بنود ثابتة كمسددة اليوم؟`)) return;
  const now = todayISO();
  const batch = { items: [], occurrences: [], payments: [] };
  for (const r of ready) {
    const item = batch.items.find((i) => i.id === r.itemId) ?? state.items.find((i) => i.id === r.itemId);
    const res = settleOccurrence({ item, occ: r, amount: r.expectedAmount, nowISO: now, status: 'paid' });
    batch.items = [...batch.items.filter((i) => i.id !== res.item.id), res.item];
    batch.occurrences.push(res.occurrence);
    batch.payments.push(res.payment);
  }
  await db.putMany(batch);
  await refresh();
  toast(`سُدّد ${ready.length} بنود`);
}

function startRitual() {
  openRitual(state, todayISO(), {
    onFinish: async (cycle) => {
      // بدء الدورة يضيف مساهمتها لكل صندوق إغراق
      const items = accrueSinking(state.items, cycle.id, { salaryDay: state.settings.salaryDay, nowISO: todayISO() });
      await db.putMany({ cycles: [cycle], items });
      await refresh();
      toast('بدأت الدورة');
    },
  });
}

// ---- الطارئ ----

function startEmergency() {
  openEmergencySheet(state, todayISO(), {
    onSave: async (e) => {
      const ctx = emergencyContext({ settings: state.settings, cycles: state.cycles, todayISO: todayISO() });
      const plan = planEmergency(e, { ...ctx, newId: () => crypto.randomUUID() });
      await db.putMany(plan);
      await refresh();
      toast(e.mode === 'defer_debt' ? 'أُضيف إلى الديون' : 'سُجّل الطارئ');
    },
  });
}

// ---- قسط انتهى: توجيه مبلغه للديون ----

async function decideFreed(id, toDebt) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  if (toDebt) {
    const s = { ...state.settings, debtExtraMonthly: round2((state.settings.debtExtraMonthly ?? 0) + item.amount) };
    await db.saveSettings(s);
  }
  await db.put('items', { ...item, freedDecision: toDebt ? 'debt' : 'kept', updatedAt: new Date().toISOString() });
  await refresh();
  toast(toDebt ? `المبلغ الإضافي للديون صار ${state.settings.debtExtraMonthly} ر.س` : 'تم');
}

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
    case 'toggle': return toggle(el.dataset.key);
    case 'occ': { const r = findRow(el.dataset.key); if (r) openOccurrenceSheet(r, occHandlers); return; }
    case 'confirm-fixed': return confirmFixed();
    case 'ritual': return startRitual();
    case 'curve-pt': return showCurvePoint(el);
    case 'freed-debt': return decideFreed(id, true);
    case 'freed-keep': return decideFreed(id, false);
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

document.getElementById('add-emergency').addEventListener('click', startEmergency);

// إغلاق الورقة عند الضغط خارجها
document.getElementById('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') e.target.close(); });

let ritualOffered = false;
/** يفتح طقس الراتب تلقائياً مرة واحدة في الأيام السبعة الأولى من دورة لم تبدأ بعد. */
function maybeOfferRitual() {
  if (ritualOffered || state.tab !== 'cycle' || !state.items.length) return;
  const m = cycleModel(state, todayISO());
  if (!m.record && m.daysIntoCycle <= 7) { ritualOffered = true; startRitual(); }
}

refresh().then(maybeOfferRitual).catch((e) => {
  view.innerHTML = '<div class="empty"><h2>تعذّر فتح البيانات</h2><p></p></div>';
  view.querySelector('p').textContent = e.message;
});
