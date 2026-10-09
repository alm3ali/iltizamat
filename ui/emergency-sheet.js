// نموذج "+ طارئ" بخياراته الثلاثة ومعاينة أثره قبل التأكيد (SPEC §8).
import { openSheet, showError, field, numInput, parseNumber } from './forms.js';
import { fmtNum } from './format.js';
import { emergencyImpact, currentCycleId, cycleRange } from '../logic/index.js';
import { inMonths } from './upcoming-view.js';

const MODES = [
  ['pay_now', 'يُدفع الآن من الفائض', 'لا أثر بعده سوى نقص رصيد حساب الالتزامات.'],
  ['pay_recover', 'يُدفع الآن ويُعوَّض على أشهر', 'يُضاف قسط مؤقت يعيد المبلغ للحساب، ثم ينتهي وحده.'],
  ['defer_debt', 'يُؤجَّل كدين', 'يدخل خطة الديون بأولوية عالية.'],
];

/** جملة الأثر الواحدة (SPEC §8). */
export function impactSentence(r) {
  const same = r.after === r.before;
  if (r.mode === 'defer_debt') {
    const rank = r.debtCount > 1 ? `ترتيبه ${r.debtRank} من ${r.debtCount} في خطة الديون` : 'هو الدين الوحيد في الخطة';
    const close = r.closesInMonth ? `، ويُتوقع إغلاقه ${inMonths(r.closesInMonth - 1)}` : '، وحدد مبلغاً إضافياً للديون في الإعدادات ليُجدوَل سداده';
    return `لا يتغير التحويل الموصى به (${fmtNum(r.before)} ر.س). ${rank}${close}.`;
  }
  if (r.mode === 'pay_recover') {
    return same
      ? `يبقى التحويل الموصى به ${fmtNum(r.before)} ر.س، فالرصيد يكفي لتعويضه.`
      : `التحويل الموصى به سيصبح ${fmtNum(r.after)} ر.س لمدة ${r.months} ${r.months === 1 ? 'شهر' : r.months === 2 ? 'شهرين' : r.months <= 10 ? 'أشهر' : 'شهراً'} (بدل ${fmtNum(r.before)})، ثم يعود.`;
  }
  if (!r.balanceKnown) return `لا يتغير التحويل الموصى به (${fmtNum(r.before)} ر.س). أدخل رصيد الحساب في طقس الراتب لترى أثره على الرصيد.`;
  return same
    ? `يبقى التحويل الموصى به ${fmtNum(r.before)} ر.س، وأدنى رصيد متوقع ينزل من ${fmtNum(r.lowBefore)} إلى ${fmtNum(r.lowAfter)} ر.س.`
    : `الرصيد لا يكفي، فالتحويل الموصى به سيصبح ${fmtNum(r.after)} ر.س (بدل ${fmtNum(r.before)}).`;
}

export function openEmergencySheet(state, todayISO, { onSave }) {
  const { settings, cycles } = state;
  const cycle = cycleRange(currentCycleId(todayISO, settings.salaryDay, cycles), settings.salaryDay);
  const minDate = cycles.find((c) => c.id === cycle.id)?.salaryReceivedAt ?? cycle.start;
  const body = `
    ${field('الاسم', '<input name="name" required autocomplete="off" placeholder="مثل: صيانة السيارة">')}
    <div class="field-pair">
      ${field('المبلغ (ر.س)', numInput('amount', ''))}
      ${field('التاريخ', `<input name="date" type="date" value="${todayISO}" min="${minDate < todayISO ? minDate : todayISO}" max="${todayISO}">`)}
    </div>
    <fieldset class="choices"><legend>كيف يُعالَج؟</legend>
      ${MODES.map(([v, t, h], i) => `<label class="choice"><input type="radio" name="mode" value="${v}" ${i === 0 ? 'checked' : ''}>
        <span><strong>${t}</strong><small>${h}</small></span></label>`).join('')}
    </fieldset>
    <div data-months hidden>${field('عدد أشهر التعويض', numInput('months', 3, 'inputmode="numeric"'))}</div>
    <p class="impact" aria-live="polite"></p>`;
  const form = openSheet('طارئ', body, { saveLabel: 'سجّل' });
  const el = form.elements;
  const impact = form.querySelector('.impact');
  const monthsBox = form.querySelector('[data-months]');

  function read() {
    const amount = parseNumber(el.amount.value);
    const months = parseNumber(el.months.value);
    return {
      name: el.name.value.trim() || 'طارئ',
      amount, date: el.date.value || todayISO, mode: el.mode.value,
      months: months == null || Number.isNaN(months) ? null : Math.round(months),
    };
  }

  function update() {
    const e = read();
    monthsBox.hidden = e.mode !== 'pay_recover';
    if (!(e.amount > 0) || (e.mode === 'pay_recover' && !(e.months >= 1))) { impact.textContent = ''; impact.hidden = true; return; }
    try {
      impact.textContent = impactSentence(emergencyImpact({
        e, items: state.items, debts: state.debts, settings, stored: state.occurrences, cycles, todayISO,
      }));
      impact.hidden = false;
    } catch { impact.hidden = true; }
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
  setTimeout(() => el.name.focus(), 50);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = read();
    if (!el.name.value.trim()) return showError(form, 'أدخل اسم الطارئ.');
    if (e.amount == null || Number.isNaN(e.amount) || e.amount <= 0) return showError(form, 'أدخل مبلغاً أكبر من صفر.');
    if (e.mode === 'pay_recover' && !(e.months >= 1 && e.months <= 60)) return showError(form, 'عدد الأشهر بين 1 و60.');
    await onSave(e);
    document.getElementById('sheet').close();
  });
}
