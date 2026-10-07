// النماذج في ورقة سفلية: البند، الدين، الإعدادات.
import {
  esc, KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS, DEBT_TYPES, DEBT_STATUS, HIJRI_MONTHS, GREG_MONTHS, INTERVALS, fmtDate,
} from './format.js';

const sheet = () => document.getElementById('sheet');

function openSheet(title, body, { saveLabel = 'حفظ' } = {}) {
  const d = sheet();
  d.innerHTML = `<form method="dialog" novalidate>
    <div class="sheet-head">
      <button class="link cancel" type="button" data-close>إلغاء</button>
      <h2>${title}</h2>
      <button class="link" type="submit">${saveLabel}</button>
    </div>
    <div class="sheet-body">${body}<p class="error" hidden></p></div>
  </form>`;
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.showModal();
  return d.querySelector('form');
}

const showError = (form, msg) => { const e = form.querySelector('.error'); e.textContent = msg; e.hidden = !msg; };

const segmented = (name, options, value) => `<div class="segmented" role="radiogroup">${
  Object.entries(options).map(([v, label]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${v === String(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')
}</div>`;

const field = (label, control, { hint, attrs = '' } = {}) =>
  `<label class="field" ${attrs}><span>${label}</span>${control}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;

const numInput = (name, value, extra = '') =>
  `<input name="${name}" type="text" inputmode="decimal" dir="ltr" value="${value ?? ''}" ${extra}>`;

/** يقبل الأرقام العربية والفاصلة العشرية العربية. */
export function parseNumber(v) {
  if (v == null) return null;
  // الفاصلة (, و ٬) فاصل آلاف تُحذف، و٫ فاصلة عشرية عربية
  const s = String(v).trim()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[,٬\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/[^\d.-]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ---------- البند ----------

export function openItemForm(item, { onSave, onDelete }) {
  const isNew = !item;
  const it = item ?? { kind: 'bill', amountMode: 'fixed', intervalMonths: 1, calendar: 'gregorian', priority: 'high', status: 'active' };
  const kinds = { bill: KIND_LABELS.bill, installment: KIND_LABELS.installment, periodic: KIND_LABELS.periodic, envelope: KIND_LABELS.envelope, one_time: KIND_LABELS.one_time };
  if (it.kind === 'recovery') kinds.recovery = KIND_LABELS.recovery;
  const intervalValue = INTERVALS.some(([v]) => v === it.intervalMonths) ? String(it.intervalMonths) : (it.intervalMonths > 1 ? 'custom' : '');
  const overdue = it.nextDue === 'now';
  const dateVal = it.nextDue && it.nextDue !== 'now' ? it.nextDue : '';

  const body = `
    ${it.status === 'to_verify' ? '<p class="note">هذا البند للتأكد. بعد إكمال بياناته اختر الحالة "نشط".</p>' : ''}
    ${field('الاسم', `<input name="name" required value="${esc(it.name)}" autocomplete="off">`)}
    <div class="field"><span>النوع</span>${segmented('kind', kinds, it.kind)}</div>
    ${field('المبلغ (ر.س)', numInput('amount', it.amount), { hint: 'اتركه فارغاً إن لم تعرفه بعد، وسيظهر في "للتأكد".' })}
    <label class="check" data-show="bill installment periodic one_time recovery"><input type="checkbox" name="variable" ${it.amountMode === 'variable' ? 'checked' : ''}> المبلغ يتغير من مرة لأخرى (مثل الكهرباء)</label>

    <div data-show="bill installment envelope recovery">
      ${field('يوم الاستحقاق في الشهر', numInput('dueDay', it.dueDay, 'inputmode="numeric"'), { hint: 'فارغ = يوم الراتب.' })}
    </div>
    <div data-show="installment recovery">
      ${field('تاريخ آخر قسط', `<input name="endDate" type="date" value="${esc(it.endDate ?? '')}">`)}
    </div>

    <div data-show="periodic">
      <div class="field"><span>التقويم</span>${segmented('calendar', { gregorian: 'ميلادي', hijri: 'هجري' }, it.calendar ?? 'gregorian')}</div>
      <div data-cal="gregorian">
        ${field('التكرار', `<select name="interval">
            <option value="" ${intervalValue === '' ? 'selected' : ''}>غير محدد بعد</option>
            ${INTERVALS.map(([v, l]) => `<option value="${v}" ${intervalValue === String(v) ? 'selected' : ''}>${l}</option>`).join('')}
            <option value="custom" ${intervalValue === 'custom' ? 'selected' : ''}>عدد أشهر آخر</option>
          </select>`)}
        <div data-custom>${field('كل كم شهراً؟', numInput('intervalCustom', intervalValue === 'custom' ? it.intervalMonths : '', 'inputmode="numeric"'))}</div>
      </div>
      <div data-cal="hijri" class="field-pair">
        ${field('الشهر الهجري', `<select name="hijriMonth">${HIJRI_MONTHS.map((m, i) => `<option value="${i + 1}" ${it.hijriMonth === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
        ${field('اليوم', numInput('hijriDay', it.hijriDay ?? 1, 'inputmode="numeric"'))}
      </div>
    </div>

    <div data-show="periodic one_time" data-cal-only="gregorian">
      ${field('موعد الاستحقاق القادم', `<input name="nextDue" type="date" value="${esc(dateVal)}">`)}
      <label class="check"><input type="checkbox" name="overdue" ${overdue ? 'checked' : ''}> متأخر ولم يُسدَّد بعد</label>
    </div>

    <div class="field"><span>الحالة</span>${segmented('status', { active: STATUS_LABELS.active, to_verify: STATUS_LABELS.to_verify, paused: STATUS_LABELS.paused }, it.status === 'ended' ? 'paused' : it.status)}</div>

    <details class="more" ${it.note || it.priority !== 'high' ? 'open' : ''}>
      <summary>خيارات إضافية</summary>
      <div class="field"><span>الأولوية</span>${segmented('priority', PRIORITY_LABELS, it.priority ?? 'high')}</div>
      ${field('ملاحظة', `<textarea name="note">${esc(it.note ?? '')}</textarea>`)}
    </details>
    ${isNew ? '' : '<div class="sheet-actions"><button class="btn danger wide" type="button" data-delete>حذف البند</button></div>'}`;

  const form = openSheet(isNew ? 'بند جديد' : 'تعديل البند', body);
  const v = (n) => form.elements[n]?.value;

  const sync = () => {
    const kind = form.querySelector('input[name="kind"]:checked')?.value;
    const cal = form.querySelector('input[name="calendar"]:checked')?.value ?? 'gregorian';
    form.querySelectorAll('[data-show]').forEach((el) => {
      let show = el.dataset.show.split(' ').includes(kind);
      if (show && el.dataset.calOnly && kind === 'periodic') show = el.dataset.calOnly === cal;
      el.hidden = !show;
    });
    form.querySelectorAll('[data-cal]').forEach((el) => { el.hidden = el.dataset.cal !== cal; });
    form.querySelector('[data-custom]').hidden = v('interval') !== 'custom';
    form.elements.nextDue.disabled = form.elements.overdue.checked;
  };
  form.addEventListener('change', sync);
  sync();

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm(`حذف "${it.name}"؟ لا يمكن التراجع.`)) return;
    await onDelete(it);
    sheet().close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = form.querySelector('input[name="kind"]:checked').value;
    const name = v('name').trim();
    if (!name) return showError(form, 'اكتب اسم البند.');
    const amount = parseNumber(v('amount'));
    if (Number.isNaN(amount) || (amount != null && amount < 0)) return showError(form, 'المبلغ غير صالح.');
    const dueDay = parseNumber(v('dueDay'));
    if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) return showError(form, 'يوم الاستحقاق بين 1 و 31.');

    const calendar = kind === 'periodic' ? form.querySelector('input[name="calendar"]:checked').value : 'gregorian';
    let intervalMonths = 1;
    if (kind === 'periodic') {
      if (calendar === 'hijri') intervalMonths = 12;
      else if (v('interval') === 'custom') {
        intervalMonths = parseNumber(v('intervalCustom'));
        if (!Number.isInteger(intervalMonths) || intervalMonths < 2) return showError(form, 'عدد الأشهر يجب أن يكون 2 أو أكثر.');
      } else intervalMonths = v('interval') ? Number(v('interval')) : null;
    } else if (kind === 'one_time') intervalMonths = null;

    let nextDue = it.kind === kind ? (it.nextDue ?? null) : null;
    if (kind === 'periodic' || kind === 'one_time') {
      nextDue = form.elements.overdue.checked ? 'now' : (v('nextDue') || null);
      if (calendar === 'hijri') nextDue = null;
    } else if (kind !== 'recovery') nextDue = null;

    const hijriDay = parseNumber(v('hijriDay'));
    const record = {
      ...it,
      id: it.id ?? crypto.randomUUID(),
      name, kind, amount,
      account: kind === 'envelope' ? 'consumption' : 'obligations',
      amountMode: kind !== 'envelope' && form.elements.variable.checked ? 'variable' : 'fixed',
      intervalMonths, calendar,
      hijriMonth: calendar === 'hijri' ? Number(v('hijriMonth')) : null,
      hijriDay: calendar === 'hijri' ? Math.min(30, Math.max(1, hijriDay || 1)) : null,
      dueDay: ['bill', 'installment', 'envelope', 'recovery'].includes(kind) ? dueDay : null,
      nextDue,
      endDate: ['installment', 'recovery'].includes(kind) ? (v('endDate') || null) : null,
      remainingCount: kind === 'installment' || kind === 'recovery' ? (it.remainingCount ?? null) : null,
      status: form.querySelector('input[name="status"]:checked').value,
      priority: form.querySelector('input[name="priority"]:checked').value,
      note: v('note').trim(),
      updatedAt: new Date().toISOString(),
      createdAt: it.createdAt ?? new Date().toISOString(),
    };
    await onSave(record);
    sheet().close();
  });
}

// ---------- الدين ----------

export function openDebtForm(debt, { items, onSave, onDelete }) {
  const isNew = !debt;
  const d = debt ?? { type: 'personal', priority: 'high', status: 'active' };
  const installments = items.filter((i) => i.kind === 'installment');
  const body = `
    ${field('الاسم', `<input name="name" required value="${esc(d.name)}" autocomplete="off">`)}
    <div class="field"><span>النوع</span>${segmented('type', DEBT_TYPES, d.type)}</div>
    <div class="field-pair">
      ${field('المبلغ الأصلي', numInput('originalAmount', d.originalAmount))}
      ${field('المتبقي الآن', numInput('balance', d.balance))}
    </div>
    <div class="field"><span>الأولوية</span>${segmented('priority', PRIORITY_LABELS, d.priority)}</div>
    <div class="field"><span>الحالة</span>${segmented('status', DEBT_STATUS, d.status)}</div>
    ${installments.length ? field('يُسدَّد عبر قسط ثابت', `<select name="installmentItemId">
        <option value="">لا — يدخل خطة السداد</option>
        ${installments.map((i) => `<option value="${esc(i.id)}" ${d.installmentItemId === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}
      </select>`, { hint: 'الديون المرتبطة بقسط لا تدخل ترتيب السداد الإضافي.' }) : ''}
    ${field('ملاحظة', `<textarea name="note">${esc(d.note ?? '')}</textarea>`)}
    ${isNew ? '' : '<div class="sheet-actions"><button class="btn danger wide" type="button" data-delete>حذف الدين</button></div>'}`;
  const form = openSheet(isNew ? 'دين جديد' : 'تعديل الدين', body);
  const v = (n) => form.elements[n]?.value;

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm(`حذف "${d.name}"؟ لا يمكن التراجع.`)) return;
    await onDelete(d);
    sheet().close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = v('name').trim();
    if (!name) return showError(form, 'اكتب اسم الدين.');
    const original = parseNumber(v('originalAmount'));
    let balance = parseNumber(v('balance'));
    if (balance == null) balance = original;
    if ([original, balance].some((n) => Number.isNaN(n) || (n != null && n < 0))) return showError(form, 'المبالغ غير صالحة.');
    const status = form.querySelector('input[name="status"]:checked').value;
    await onSave({
      ...d,
      id: d.id ?? crypto.randomUUID(),
      name,
      type: form.querySelector('input[name="type"]:checked').value,
      originalAmount: original ?? balance ?? 0,
      balance: status === 'paid' ? 0 : (balance ?? 0),
      priority: form.querySelector('input[name="priority"]:checked').value,
      status,
      installmentItemId: v('installmentItemId') || null,
      note: v('note').trim(),
      updatedAt: new Date().toISOString(),
    });
    sheet().close();
  });
}

// ---------- الإعدادات ----------

export function openSettingsForm(settings, { onSave, onExport, onImport, onClear }) {
  const s = structuredClone(settings);
  const incomeRow = (inc) => `<div class="income-row" data-income="${esc(inc.id)}">
      <input name="incName" value="${esc(inc.name)}" placeholder="المصدر" aria-label="مصدر الدخل">
      <input name="incAmount" inputmode="decimal" dir="ltr" value="${inc.amount ?? ''}" placeholder="0" aria-label="المبلغ الشهري">
      <button class="icon-btn" type="button" data-remove-income aria-label="حذف">✕</button>
    </div>`;
  const body = `
    <div class="field"><span>الدخل الشهري</span>
      <div data-incomes>${(s.incomes ?? []).map(incomeRow).join('')}</div>
      <button class="btn" type="button" data-add-income>إضافة مصدر دخل</button>
    </div>
    ${field('يوم الراتب', numInput('salaryDay', s.salaryDay, 'inputmode="numeric"'), { hint: 'تبدأ الدورة من هذا اليوم وتنتهي قبل الراتب التالي.' })}
    <div class="field"><span>تقسيم الدخل (٪) — المجموع 100</span></div>
    <div class="field-pair">
      ${field('الاستهلاك', numInput('splitConsumption', s.split.consumption))}
      ${field('الالتزامات', numInput('splitObligations', s.split.obligations))}
    </div>
    ${field('الادخار والاستثمار', numInput('splitSavings', s.split.savings))}

    <details class="more">
      <summary>المكافأة والخطة</summary>
      <div class="field-pair">
        ${field('المكافأة السنوية', numInput('bonusAmount', s.bonus?.amount))}
        ${field('شهر صرفها', `<select name="bonusMonth"><option value="">غير محدد</option>${GREG_MONTHS.map((m, i) => `<option value="${i + 1}" ${s.bonus?.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
      </div>
      ${field('حصة الالتزامات من المكافأة (٪)', numInput('bonusObligations', s.bonus?.split?.obligations ?? 75))}
      ${field('حد أدنى لرصيد حساب الالتزامات', numInput('obligationsBuffer', s.obligationsBuffer), { hint: 'هامش أمان لا ينزل الرصيد تحته في التنبؤ.' })}
      ${field('مبلغ إضافي شهري لسداد الديون', numInput('debtExtraMonthly', s.debtExtraMonthly), { hint: 'يُوجَّه كاملاً للدين المستهدف.' })}
    </details>

    <div class="section-head section"><h2>النسخ الاحتياطي</h2></div>
    <p class="note">بياناتك محفوظة على هذا الجهاز فقط. ${s.lastBackupAt ? `آخر نسخة: ${fmtDate(s.lastBackupAt.slice(0, 10))}.` : 'لم تُصدَّر نسخة بعد.'}</p>
    <div class="sheet-actions">
      <button class="btn" type="button" data-export>تصدير نسخة احتياطية</button>
      <button class="btn" type="button" data-import>استيراد نسخة</button>
      <button class="btn danger" type="button" data-clear>مسح كل البيانات</button>
    </div>`;
  const form = openSheet('الإعدادات', body);
  const v = (n) => form.elements[n]?.value;
  const incomes = form.querySelector('[data-incomes]');

  form.querySelector('[data-add-income]').addEventListener('click', () => {
    incomes.insertAdjacentHTML('beforeend', incomeRow({ id: crypto.randomUUID(), name: '', amount: '' }));
    incomes.lastElementChild.querySelector('input').focus();
  });
  incomes.addEventListener('click', (e) => { if (e.target.closest('[data-remove-income]')) e.target.closest('.income-row').remove(); });
  form.querySelector('[data-export]').addEventListener('click', onExport);
  form.querySelector('[data-import]').addEventListener('click', () => { sheet().close(); onImport(); });
  form.querySelector('[data-clear]').addEventListener('click', async () => {
    if (!confirm('مسح كل البيانات من هذا الجهاز؟')) return;
    if (!confirm('تأكيد أخير: لا يمكن التراجع إلا من نسخة احتياطية.')) return;
    await onClear();
    sheet().close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = [...incomes.querySelectorAll('.income-row')].map((r) => ({
      id: r.dataset.income, name: r.querySelector('[name="incName"]').value.trim(),
      amount: parseNumber(r.querySelector('[name="incAmount"]').value),
      variable: (s.incomes ?? []).find((i) => i.id === r.dataset.income)?.variable ?? false,
    })).filter((r) => r.name || r.amount);
    if (rows.some((r) => r.amount == null || Number.isNaN(r.amount))) return showError(form, 'أدخل مبلغاً لكل مصدر دخل.');
    const split = {
      consumption: parseNumber(v('splitConsumption')) ?? 0,
      obligations: parseNumber(v('splitObligations')) ?? 0,
      savings: parseNumber(v('splitSavings')) ?? 0,
    };
    if (Math.round(split.consumption + split.obligations + split.savings) !== 100) return showError(form, 'مجموع النسب يجب أن يكون 100.');
    const salaryDay = parseNumber(v('salaryDay'));
    if (!Number.isInteger(salaryDay) || salaryDay < 1 || salaryDay > 31) return showError(form, 'يوم الراتب بين 1 و 31.');
    const ob = parseNumber(v('bonusObligations')) ?? 0;
    await onSave({
      ...s,
      incomes: rows,
      salaryDay,
      split,
      bonus: {
        amount: parseNumber(v('bonusAmount')) ?? 0,
        month: v('bonusMonth') ? Number(v('bonusMonth')) : null,
        split: { ...(s.bonus?.split ?? {}), obligations: ob },
      },
      obligationsBuffer: parseNumber(v('obligationsBuffer')) ?? 0,
      debtExtraMonthly: parseNumber(v('debtExtraMonthly')) ?? 0,
    });
    sheet().close();
  });
}
