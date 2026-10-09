// شاشة "هذه الدورة" (SPEC §7.1).
import { esc, money, fmtNum, fmtDate } from './format.js';
import {
  cycleRows, currentCycleId, forecast, diffDays,
} from '../logic/index.js';

const shortDate = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const short = (iso) => { const [y, m, d] = iso.split('-').map(Number); return shortDate.format(new Date(Date.UTC(y, m - 1, d))); };

/** يحسب كل ما تحتاجه الشاشة؛ يُستخدم أيضاً في app.js لقرار فتح الطقس تلقائياً. */
export function cycleModel(state, todayISO) {
  const { items, occurrences: stored, settings, cycles } = state;
  const cycleId = currentCycleId(todayISO, settings.salaryDay, cycles);
  const record = cycles.find((c) => c.id === cycleId) ?? null;
  const model = cycleRows({ items, stored, settings, cycleId, todayISO, cycles });
  return { ...model, record, cycleId, daysIntoCycle: diffDays(model.cycle.start, todayISO) };
}

function progressBar(paid, total) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  return `<svg class="progress" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label="سُدّد ${Math.round(pct)}٪">
    <rect class="progress-track" x="0" y="0" width="100" height="6" rx="3"/>
    <rect class="progress-fill" x="${(100 - pct).toFixed(2)}" y="0" width="${pct.toFixed(2)}" height="6" rx="3"/>
  </svg>`;
}

function row(r) {
  const it = r.item ?? { name: 'بند محذوف' };
  const done = r.status !== 'open';
  const meta = [];
  if (r.status === 'paid') meta.push(`سُدّد ${short(r.paidAt)}`);
  else if (r.status === 'skipped') meta.push('تُخطّي هذه المرة');
  else {
    if (r.late) meta.push(`<span class="late">${r.overdue || !r.dated ? 'متأخر' : `فات ${short(r.dueDate)}`}</span>`);
    else meta.push(r.dated ? short(r.dueDate) : 'خلال الدورة');
    if (it.amountMode === 'variable') meta.push('أدخل المبلغ الفعلي');
  }
  const amount = r.status === 'paid' ? r.actualAmount : r.expectedAmount;
  const amountHtml = r.status === 'skipped' ? '<span class="amount muted">—</span>'
    : amount == null ? '<span class="amount missing">أدخل المبلغ</span>'
      : `<span class="amount">${money(amount)}</span>`;
  return `<div class="row check-row${done ? ' done' : ''}">
    <button class="check-btn" type="button" data-action="toggle" data-key="${esc(r.key)}"
      aria-pressed="${r.status === 'paid'}" aria-label="${done ? `تراجع عن ${esc(it.name)}` : `تأشير ${esc(it.name)} كمسدد`}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>
    </button>
    <button class="row-body" type="button" data-action="occ" data-key="${esc(r.key)}">
      <span class="row-main"><span class="row-name">${esc(it.name)}</span><span class="row-meta">${meta.join('، ')}</span></span>
      ${amountHtml}
    </button>
  </div>`;
}

export function renderCycle(state, todayISO) {
  if (!state.items.length) {
    return `<div class="empty"><h2>لا توجد بنود بعد</h2><p>أضف فواتيرك وأقساطك من "البنود"، أو استورد نسختك الاحتياطية.</p>
      <button class="btn primary" type="button" data-action="import">استيراد ملف</button>
      <button class="btn" type="button" data-tab-go="items">اذهب إلى البنود</button></div>`;
  }
  const m = cycleModel(state, todayISO);
  const { cycle, rows, totals, record } = m;

  let card;
  if (record) {
    card = `<div class="summary">
      <p>حوّلت لحساب الالتزامات في هذه الدورة</p>
      <span class="big">${fmtNum(record.transfers?.obligations ?? 0)} <small>ر.س</small></span>
      ${progressBar(totals.paid, totals.total)}
      <p>سُدّد ${fmtNum(totals.paid)} من ${fmtNum(totals.total)} ر.س، والمتبقي ${fmtNum(totals.remaining)}.</p>
    </div>`;
  } else {
    const { t } = forecast({ items: state.items, settings: state.settings, stored: state.occurrences, cycles: state.cycles, todayISO });
    card = `<div class="summary">
      <p>التحويل الموصى به لحساب الالتزامات</p>
      <span class="big">${fmtNum(t.recommended)} <small>ر.س</small></span>
      ${progressBar(totals.paid, totals.total)}
      <p>سُدّد ${fmtNum(totals.paid)} من ${fmtNum(totals.total)} ر.س.${t.income ? ` نسبتك ${state.settings.split.obligations}٪ = ${fmtNum(t.ratioTarget)} ر.س.` : ''}</p>
    </div>
    <button class="btn primary wide ritual-cta" type="button" data-action="ritual">وصل الراتب؟ ابدأ الدورة</button>`;
  }

  const ready = totals.fixedReady;
  return `
    <p class="cycle-range">${short(cycle.start)} – ${fmtDate(cycle.end)}</p>
    ${card}
    ${ready > 1 ? `<button class="btn wide confirm-all" type="button" data-action="confirm-fixed">تأكيد كل الثابتة (${ready})</button>` : ''}
    <section class="section">
      <div class="section-head"><h2>المستحق في هذه الدورة</h2><span class="total">${totals.openCount} متبقٍ</span></div>
      <div class="group">${rows.length ? rows.map(row).join('') : '<p class="group-empty">لا شيء مستحق في هذه الدورة.</p>'}</div>
      ${totals.missingAmounts ? `<p class="note">${totals.missingAmounts} بنود بلا مبلغ. أدخل المبلغ عند السداد، أو أكمله من "البنود".</p>` : ''}
    </section>`;
}
