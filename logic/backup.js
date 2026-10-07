// التحقق من ملف النسخة الاحتياطية قبل الاستيراد. دالة نقية.

export const SCHEMA_VERSION = 1;
export const COLLECTIONS = ['items', 'occurrences', 'debts', 'payments', 'cycles'];

export const DEFAULT_SETTINGS = Object.freeze({
  currency: 'SAR',
  salaryDay: 27,
  incomes: [],
  split: { consumption: 33, savings: 24, obligations: 43 },
  bonus: { amount: 0, month: null, split: { consumption: 5, savings: 20, obligations: 75 } },
  obligationsBuffer: 0,
  debtExtraMonthly: 0,
  forecastMonths: 12,
  lastBackupAt: null,
});

const ITEM_KINDS = new Set(['envelope', 'bill', 'installment', 'periodic', 'one_time', 'recovery']);

/** يعيد { ok, data, errors } — data نسخة منظَّفة جاهزة للتخزين. */
export function validateBackup(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['الملف ليس JSON صالحاً'] };
  if ((raw.schemaVersion ?? 1) > SCHEMA_VERSION) errors.push('الملف من إصدار أحدث من الأداة');

  const data = { schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) } };
  for (const c of COLLECTIONS) {
    const list = raw[c] ?? [];
    if (!Array.isArray(list)) { errors.push(`"${c}" يجب أن تكون قائمة`); continue; }
    const ids = new Set();
    list.forEach((r, i) => {
      if (!r?.id) errors.push(`${c}[${i}] بلا معرّف`);
      else if (ids.has(r.id)) errors.push(`${c}: معرّف مكرر ${r.id}`);
      ids.add(r?.id);
    });
    data[c] = list;
  }
  (data.items ?? []).forEach((it) => {
    if (!ITEM_KINDS.has(it.kind)) errors.push(`نوع غير معروف للبند "${it.name}": ${it.kind}`);
  });
  const s = data.settings.split;
  if (s && Math.round((s.consumption ?? 0) + (s.savings ?? 0) + (s.obligations ?? 0)) !== 100) {
    errors.push('مجموع نسب التقسيم ليس 100');
  }
  return { ok: errors.length === 0, data, errors };
}
