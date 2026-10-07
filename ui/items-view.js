// شاشة "البنود": القوالب مجمّعة حسب النوع، وقسم "للتأكد" في الأعلى.
import { esc, money, fmtNum, itemMeta, ring, needsVerify, DEBT_TYPES, PRIORITY_LABELS } from './format.js';
import { computeTransfer, consumptionCheck, rankDebts, todayISO } from '../logic/index.js';

const GROUPS = [
  { kind: 'bill', title: 'الفواتير الشهرية' },
  { kind: 'installment', title: 'الأقساط' },
  { kind: 'periodic', title: 'الدوري والسنوي' },
  { kind: 'recovery', title: 'تعويض الطوارئ' },
  { kind: 'one_time', title: 'مرة واحدة' },
  { kind: 'envelope', title: 'مظاريف الاستهلاك', note: 'تُحوَّل لحساب الاستهلاك ولا تُتابع بنداً بنداً.' },
];

function itemRow(item) {
  const amt = money(item.amount);
  return `<button class="row" type="button" data-action="edit-item" data-id="${esc(item.id)}">
    ${ring(item)}
    <span class="row-main"><span class="row-name">${esc(item.name)}</span><span class="row-meta">${itemMeta(item)}</span></span>
    ${amt ? `<span class="amount">${amt}</span>` : '<span class="amount missing">أدخل المبلغ</span>'}
  </button>`;
}

function debtRing(d) {
  const r = 10, c = 2 * Math.PI * r;
  const left = d.originalAmount ? Math.min(1, d.balance / d.originalAmount) : 1;
  return `<svg class="ring" viewBox="0 0 26 26" data-account="obligations" role="img" aria-label="متبقٍ ${Math.round(left * 100)}٪"><circle class="track" cx="13" cy="13" r="${r}"/><circle class="arc" cx="13" cy="13" r="${r}" stroke-dasharray="${(c * left).toFixed(2)} ${c.toFixed(2)}"/></svg>`;
}

function debtRow(d, isTarget) {
  const meta = [DEBT_TYPES[d.type] ?? '', PRIORITY_LABELS[d.priority] ? `أولوية ${PRIORITY_LABELS[d.priority]}` : ''];
  if (isTarget) meta.unshift('<span class="flag">المستهدف الآن</span>');
  if (d.installmentItemId) meta.push('يُسدَّد بقسط');
  if (d.status === 'paid') meta.push('مسدد');
  return `<button class="row" type="button" data-action="edit-debt" data-id="${esc(d.id)}">
    ${debtRing(d)}
    <span class="row-main"><span class="row-name">${esc(d.name)}</span><span class="row-meta">${meta.filter(Boolean).join('، ')}</span></span>
    <span class="amount">${money(d.balance)}</span>
  </button>`;
}

const section = (title, body, { total, cls = '', note } = {}) => `
  <section class="section">
    <div class="section-head"><h2>${title}</h2>${total ? `<span class="total">${total}</span>` : ''}</div>
    <div class="group ${cls}">${body}</div>
    ${note ? `<p class="note">${note}</p>` : ''}
  </section>`;

export function renderItems(state) {
  const { items, debts, settings } = state;
  const visible = items.filter((i) => i.status !== 'ended');
  if (!visible.length && !debts.length) {
    return `<div class="empty">
      <h2>لا توجد بنود بعد</h2>
      <p>ابدأ باستيراد نسختك الاحتياطية، أو أضف أول فاتورة أو قسط.</p>
      <button class="btn primary" type="button" data-action="import">استيراد ملف</button>
      <button class="btn" type="button" data-action="new-item">إضافة بند</button>
    </div>`;
  }

  const verifyItems = visible.filter(needsVerify);
  const verifyDebts = debts.filter((d) => d.status === 'to_verify');
  const rest = visible.filter((i) => !needsVerify(i));
  const t = computeTransfer({ items, settings, fromISO: todayISO() });
  const cons = consumptionCheck(items, settings);

  let html = `<div class="summary">
    <p>ما يحتاجه حساب الالتزامات شهرياً بشكل دائم</p>
    <span class="big">${fmtNum(t.steadyState)} <small>ر.س</small></span>
    <p>${t.income ? `نسبة الالتزامات (${settings.split.obligations}٪) = ${fmtNum(t.ratioTarget)} ر.س` : 'أدخل دخلك في الإعدادات للمقارنة بالنسبة.'}${
      verifyItems.length ? `. الرقم غير مكتمل: ${verifyItems.length} بنود تنتظر التأكد.` : ''}</p>
  </div>
  <div class="add-row">
    <button class="btn" type="button" data-action="new-item">إضافة بند</button>
    <button class="btn" type="button" data-action="new-debt">إضافة دين</button>
  </div>`;

  if (verifyItems.length || verifyDebts.length) {
    html += section(`للتأكد (${verifyItems.length + verifyDebts.length})`,
      verifyItems.map(itemRow).join('') + verifyDebts.map((d) => debtRow(d, false)).join(''),
      { cls: 'verify', note: 'أكمل بيانات هذه البنود حتى يُحسب التحويل الشهري بدقة.' });
  }

  for (const g of GROUPS) {
    const list = rest.filter((i) => i.kind === g.kind);
    if (!list.length) continue;
    let total;
    if (g.kind === 'envelope') total = `${fmtNum(cons.envelopes)} من ${fmtNum(cons.target)} ر.س`;
    html += section(g.title, list.map(itemRow).join(''), { total, note: g.note });
  }

  const ranked = rankDebts(debts);
  const targetId = ranked[0]?.id;
  const activeDebts = [...ranked, ...debts.filter((d) => d.status === 'active' && !ranked.includes(d))];
  if (activeDebts.length) {
    const total = activeDebts.reduce((a, d) => a + d.balance, 0);
    html += section('الديون', activeDebts.map((d) => debtRow(d, d.id === targetId)).join(''),
      { total: `${fmtNum(total)} ر.س`, note: 'الترتيب: الأولوية ثم الرصيد الأصغر. الديون المقسطة تُسدَّد بأقساطها.' });
  }
  const paid = debts.filter((d) => d.status === 'paid');
  if (paid.length) html += section('ديون مسددة', paid.map((d) => debtRow(d, false)).join(''));
  return html;
}
