// أوراق الدورة: سداد/تخطي/تراجع لاستحقاق واحد، وطقس يوم الراتب (SPEC §7.1–7.2).
import { openSheet, showError, field, numInput, parseNumber } from './forms.js';
import { esc, fmtNum, fmtDate, needsVerify } from './format.js';
import {
  cycleForSalary, cycleRange, computeTransfer, consumptionCheck, proposeTransfers, buildHistory,
  cycleRows, totalIncome, diffDays,
} from '../logic/index.js';

const sheet = () => document.getElementById('sheet');

// ---------- استحقاق واحد ----------

export function openOccurrenceSheet(r, { onPay, onSkip, onUndo }) {
  const it = r.item ?? { name: 'بند محذوف' };
  if (r.status !== 'open') {
    const what = r.status === 'paid' ? `سُدّد ${fmtNum(r.actualAmount)} ر.س في ${fmtDate(r.paidAt)}` : 'تُخطّي في هذه الدورة';
    const form = openSheet(esc(it.name), `<p class="step-lead">${what}.</p>
      <div class="sheet-actions"><button class="btn wide" type="button" data-undo>تراجع</button></div>`, { saveLabel: 'تم' });
    form.querySelector('[data-undo]').addEventListener('click', async () => { await onUndo(r); sheet().close(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); sheet().close(); });
    return;
  }
  const body = `
    <p class="step-lead">يستحق ${fmtDate(r.dueDate)}${r.late ? '، وهو متأخر' : ''}.</p>
    ${field('المبلغ المسدد (ر.س)', numInput('amount', r.expectedAmount, 'autofocus'),
      { hint: it.amountMode === 'variable' ? 'مبلغ متغير: أدخل ما دفعته فعلاً.' : '' })}
    <div class="sheet-actions">
      <button class="btn primary wide" type="submit">سُدّد</button>
      <button class="btn wide" type="button" data-skip>تخطي هذه المرة</button>
    </div>`;
  const form = openSheet(esc(it.name), body, { saveLabel: 'سُدّد' });
  form.querySelector('[data-skip]').addEventListener('click', async () => { await onSkip(r); sheet().close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseNumber(form.elements.amount.value);
    if (amount == null || Number.isNaN(amount) || amount < 0) return showError(form, 'أدخل المبلغ المسدد.');
    await onPay(r, amount);
    sheet().close();
  });
}

// ---------- طقس يوم الراتب ----------

export function openRitual(state, todayISO, { onFinish }) {
  const { settings, items } = state;
  const ctx = {
    step: 1,
    salaryDate: todayISO,
    salary: totalIncome(settings),
    opening: null,
    obligations: null,
  };
  const d = sheet();

  const compute = () => {
    const cycleId = cycleForSalary(ctx.salaryDate, settings.salaryDay);
    const cycle = cycleRange(cycleId, settings.salaryDay);
    const paidKeys = new Set(state.occurrences.map((o) => o.id));
    const t = computeTransfer({
      items, settings, fromISO: cycle.start, openingBalance: ctx.opening ?? 0, paidKeys, history: buildHistory(state.occurrences),
    });
    const envelopes = consumptionCheck(items, settings).envelopes;
    const p = proposeTransfers({ salary: ctx.salary, settings, recommended: ctx.obligations ?? t.recommended, envelopes });
    return { cycleId, cycle, t, p, envelopes };
  };

  const steps = (n) => `<div class="steps" aria-label="الخطوة ${n} من 4">${[1, 2, 3, 4].map((i) => `<span class="${i <= n ? 'on' : ''}"></span>`).join('')}</div>`;

  function render() {
    const c = compute();
    let body = steps(ctx.step);
    let next = 'التالي';
    if (ctx.step === 1) {
      body += `<h3 class="step-title">تأكيد استلام الراتب</h3>
        <p class="step-lead">تبدأ الدورة من يوم وصول الراتب.</p>
        ${field('تاريخ الوصول', `<input name="salaryDate" type="date" value="${ctx.salaryDate}" max="${todayISO}">`,
          { hint: `الدورة: ${fmtDate(c.cycle.start)} – ${fmtDate(c.cycle.end)}` })}
        ${field('المبلغ المستلم (ر.س)', numInput('salary', ctx.salary))}`;
    } else if (ctx.step === 2) {
      body += `<h3 class="step-title">رصيد حساب الالتزامات الآن</h3>
        <p class="step-lead">قبل تحويل هذا الشهر. يجعل الاقتراح أدق، ويمكنك تركه فارغاً.</p>
        ${field('الرصيد (ر.س)', numInput('opening', ctx.opening), { hint: 'فارغ = صفر.' })}`;
    } else if (ctx.step === 3) {
      const { t, p } = c;
      const pct = ctx.salary ? Math.round((p.obligations / ctx.salary) * 100) : 0;
      body += `<h3 class="step-title">التحويلات المقترحة</h3>
        <p class="step-lead">نفّذها من تطبيق البنك، ثم تابع.</p>
        <div class="group plan">
          <label class="row"><span class="row-main"><span class="row-name">حساب الالتزامات</span>
            <span class="row-meta">${pct}٪ من الراتب، ونسبتك ${settings.split.obligations}٪</span></span>
            ${numInput('obligations', p.obligations)}</label>
          <div class="row"><span class="row-main"><span class="row-name">الادخار والاستثمار</span>
            <span class="row-meta">${settings.split.savings}٪</span></span><span class="amount">${fmtNum(p.savings)}</span></div>
          <div class="row"><span class="row-main"><span class="row-name">يبقى في حساب الاستهلاك</span>
            <span class="row-meta">المظاريف ${fmtNum(c.envelopes)}</span></span><span class="amount">${fmtNum(p.consumption)}</span></div>
        </div>
        ${t.deficit ? `<p class="warn">الرصيد الحالي لا يغطي استحقاقات قريبة كبيرة، لذلك الاقتراح أعلى من المستوى الدائم (${fmtNum(t.steadyState)} ر.س) حتى يُغطّى العجز.</p>` : ''}
        ${p.consumptionShort ? `<p class="warn">الباقي للاستهلاك أقل من مجموع المظاريف بـ ${fmtNum(p.consumptionShort)} ر.س.</p>` : ''}
        ${t.incompleteItemIds.length ? `<p class="warn">${t.incompleteItemIds.length} بنود بلا مبلغ لم تدخل الحساب، فالرقم الفعلي أعلى.</p>` : ''}`;
    } else {
      const rows = cycleRows({ items, stored: state.occurrences, settings, cycleId: c.cycleId, todayISO });
      const variable = rows.rows.filter((r) => r.status === 'open' && r.item?.amountMode === 'variable').length;
      const verify = items.filter((i) => i.status !== 'ended' && needsVerify(i)).length;
      const last = settings.lastBackupAt?.slice(0, 10);
      const backupDue = !last || diffDays(last, todayISO) > 30;
      body += `<h3 class="step-title">مراجعة سريعة</h3>
        <ul class="checklist">
          <li>${rows.totals.openCount} استحقاقاً في هذه الدورة بمجموع ${fmtNum(rows.totals.remaining)} ر.س.</li>
          ${variable ? `<li>${variable} بنود متغيرة: أدخل مبلغها الفعلي عند السداد.</li>` : ''}
          ${verify ? `<li>${verify} بنود في "للتأكد" تنتظر بياناتها.</li>` : ''}
          ${backupDue ? `<li>${last ? `آخر نسخة احتياطية قبل ${diffDays(last, todayISO)} يوماً.` : 'لم تُصدَّر نسخة احتياطية بعد.'} صدّر واحدة من الإعدادات.</li>` : ''}
        </ul>`;
      next = 'ابدأ الدورة';
    }
    d.innerHTML = `<form method="dialog" novalidate>
      <div class="sheet-head">
        <button class="link cancel" type="button" data-back>${ctx.step === 1 ? 'إلغاء' : 'رجوع'}</button>
        <h2>يوم الراتب</h2>
        <button class="link" type="submit">${next}</button>
      </div>
      <div class="sheet-body">${body}<p class="error" hidden></p></div>
    </form>`;
    const form = d.querySelector('form');
    form.querySelector('[data-back]').addEventListener('click', () => {
      if (ctx.step === 1) d.close(); else { read(form); ctx.step -= 1; render(); }
    });
    form.elements.salaryDate?.addEventListener('change', () => { read(form); render(); });
    form.elements.obligations?.addEventListener('change', () => { if (!read(form)) render(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = read(form);
      if (err) return showError(form, err);
      if (ctx.step < 4) { ctx.step += 1; render(); return; }
      const fin = compute();
      await onFinish({
        id: fin.cycleId,
        salaryReceivedAt: ctx.salaryDate,
        salaryAmount: ctx.salary,
        obligationsOpeningBalance: ctx.opening,
        transfers: { obligations: fin.p.obligations, savings: fin.p.savings, consumption: fin.p.consumption },
        recommended: fin.t.recommended,
        createdAt: new Date().toISOString(),
        closedAt: null,
      });
      d.close();
    });
  }

  /** يقرأ حقول الخطوة الحالية؛ يعيد رسالة خطأ إن وُجد. */
  function read(form) {
    const el = form.elements;
    if (el.salaryDate) {
      if (!el.salaryDate.value) return 'اختر تاريخ وصول الراتب.';
      ctx.salaryDate = el.salaryDate.value;
      const s = parseNumber(el.salary.value);
      if (s == null || Number.isNaN(s) || s <= 0) return 'أدخل مبلغ الراتب.';
      ctx.salary = s;
    }
    if (el.opening) {
      const o = parseNumber(el.opening.value);
      if (Number.isNaN(o)) return 'الرصيد غير صالح.';
      if (o !== ctx.opening) ctx.obligations = null; // يُعاد اقتراح التحويل
      ctx.opening = o;
    }
    if (el.obligations) {
      const o = parseNumber(el.obligations.value);
      if (o == null || Number.isNaN(o) || o < 0) return 'أدخل مبلغ التحويل.';
      ctx.obligations = o;
    }
    return null;
  }

  render();
  if (!d.open) d.showModal();
}
