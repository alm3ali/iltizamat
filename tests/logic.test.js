import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, cycleIdFor, cycleRange, dateInCycle, findHijriDates, hijriParts,
  generateOccurrences, computeTransfer, consumptionCheck, sinkingStatus,
  rankDebts, targetDebt, applyDebtPayment, payoffProjection, planEmergency, roundUpTo,
} from '../logic/index.js';

const base = {
  status: 'active', account: 'obligations', amountMode: 'fixed', calendar: 'gregorian',
  dueDay: null, nextDue: null, endDate: null, remainingCount: null, priority: 'high',
};
const bill = (id, amount, extra = {}) => ({ ...base, id, name: id, kind: 'bill', amount, intervalMonths: 1, ...extra });
const settings = (extra = {}) => ({
  salaryDay: 27, incomes: [{ id: 'i', amount: 10000 }],
  split: { consumption: 33, savings: 24, obligations: 43 },
  bonus: { amount: 0, month: null }, obligationsBuffer: 0, debtExtraMonthly: 0, forecastMonths: 12, ...extra,
});
let n = 0;
const newId = () => `id${++n}`;

// ---- التواريخ والدورات ----

test('addMonths يقص اليوم لآخر الشهر', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
});

test('الدورة تبدأ بيوم الراتب', () => {
  assert.equal(cycleIdFor('2026-10-27', 27), '2026-10');
  assert.equal(cycleIdFor('2026-10-26', 27), '2026-09');
  assert.equal(cycleIdFor('2026-01-05', 27), '2025-12');
  assert.deepEqual(cycleRange('2026-10', 27), { id: '2026-10', start: '2026-10-27', end: '2026-11-26' });
  // راتب يوم 30 في فبراير
  assert.deepEqual(cycleRange('2027-02', 30), { id: '2027-02', start: '2027-02-28', end: '2027-03-29' });
});

test('dateInCycle يضع يوم الاستحقاق داخل الدورة', () => {
  const c = cycleRange('2026-10', 27);
  assert.equal(dateInCycle(c, 28), '2026-10-28');
  assert.equal(dateInCycle(c, 5), '2026-11-05');
  assert.equal(dateInCycle(c, null), '2026-10-27');
});

test('الهجري: رمضان 1448 يقع في فبراير–مارس 2027', () => {
  const [d] = findHijriDates(9, 25, '2026-10-07', '2027-10-07');
  assert.ok(d >= '2027-02-01' && d <= '2027-03-31', d);
  const h = hijriParts(d);
  assert.equal(h.m, 9);
  assert.equal(h.d, 25);
});

// ---- توليد الاستحقاقات ----

test('البند الشهري: استحقاق واحد لكل دورة', () => {
  const { occurrences } = generateOccurrences([bill('b', 100, { dueDay: 1 })], '2026-10-07', 12, { salaryDay: 27 });
  assert.equal(occurrences.length, 12);
  assert.equal(occurrences[0].dueDate, '2026-10-01'); // دورة سبتمبر الحالية
  assert.equal(new Set(occurrences.map((o) => o.cycleId)).size, 12);
});

test('القسط يتوقف عند تاريخ الانتهاء وعند العدد المتبقي', () => {
  const byEnd = generateOccurrences([bill('a', 100, { kind: 'installment', endDate: '2027-01-31', dueDay: 1 })],
    '2026-10-07', 12, { salaryDay: 27 }).occurrences;
  assert.deepEqual(byEnd.map((o) => o.dueDate), ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
  const byCount = generateOccurrences([bill('a', 100, { remainingCount: 2 })], '2026-10-07', 12, { salaryDay: 27 }).occurrences;
  assert.equal(byCount.length, 2);
});

test('الدوري يتكرر بفترته، والمتأخر "now" يُدرج اليوم', () => {
  const items = [
    { ...base, id: 'ins', kind: 'periodic', amount: 1200, intervalMonths: 6, nextDue: '2026-12-10' },
    { ...base, id: 'fahs', kind: 'periodic', amount: 84, intervalMonths: 12, nextDue: 'now' },
    { ...base, id: 'lic', kind: 'periodic', amount: 200, intervalMonths: null },
  ];
  const { occurrences, unscheduled } = generateOccurrences(items, '2026-10-07', 12, { salaryDay: 27 });
  assert.deepEqual(occurrences.filter((o) => o.itemId === 'ins').map((o) => o.dueDate), ['2026-12-10', '2027-06-10']);
  const fahs = occurrences.filter((o) => o.itemId === 'fahs');
  assert.equal(fahs[0].dueDate, '2026-10-07');
  assert.equal(fahs[0].overdue, true);
  assert.deepEqual(unscheduled.map((i) => i.id), ['lic']);
});

test('المتغير يُقدَّر بمتوسط آخر 3 مبالغ فعلية', () => {
  const it = bill('elec', 300, { amountMode: 'variable' });
  const { occurrences } = generateOccurrences([it], '2026-10-07', 1, { salaryDay: 27, history: { elec: [100, 400, 200, 300] } });
  assert.equal(occurrences[0].expectedAmount, 300);
});

test('البنود الموقوفة والمنتهية لا تولّد استحقاقات', () => {
  const { occurrences } = generateOccurrences(
    [bill('p', 1, { status: 'paused' }), bill('e', 1, { status: 'ended' })], '2026-10-07', 3, { salaryDay: 27 });
  assert.equal(occurrences.length, 0);
});

// ---- التحويل الموصى به (معايير القبول 3 و 4) ----

test('معيار 3: بند سنوي 1200 يرفع steadyState بـ 100 بالضبط', () => {
  const s = settings();
  const before = computeTransfer({ items: [bill('b', 500)], settings: s, fromISO: '2026-10-27' });
  const annual = { ...base, id: 'y', kind: 'periodic', amount: 1200, intervalMonths: 12, nextDue: '2027-10-20' };
  const after = computeTransfer({ items: [bill('b', 500), annual], settings: s, fromISO: '2026-10-27' });
  assert.equal(before.steadyState, 500);
  assert.equal(after.steadyState, 600);
  assert.equal(after.recommended, 600);
});

test('العجز: دفعة سنوية قريبة ترفع الحد الأدنى فوق المستوى الدائم', () => {
  const annual = { ...base, id: 'y', kind: 'periodic', amount: 1200, intervalMonths: 12, nextDue: '2026-11-20' };
  const r = computeTransfer({ items: [bill('b', 500), annual], settings: settings(), fromISO: '2026-10-27' });
  assert.equal(r.minimalTransfer, 1700); // الدورة الأولى: 500 + 1200
  assert.equal(r.deficit, true);
  assert.equal(r.recommended, 1700);
  // الرصيد الافتتاحي يغطي العجز
  const covered = computeTransfer({ items: [bill('b', 500), annual], settings: settings(), fromISO: '2026-10-27', openingBalance: 1200 });
  assert.equal(covered.deficit, false);
  assert.equal(covered.recommended, 600);
});

test('معيار 4: طارئ 4000 معوَّض على 4 أشهر يرفع التحويل 1000 لأربع دورات ثم يعود', () => {
  const s = settings();
  const plan = planEmergency({ name: 'صيانة', amount: 4000, date: '2026-10-07', mode: 'pay_recover', months: 4 },
    { salaryDay: 27, newId, nowISO: '2026-10-07' });
  const items = [bill('b', 500), ...plan.items];
  const at = (from) => computeTransfer({ items, settings: s, fromISO: from }).recommended;
  assert.equal(at('2026-10-27'), 1500);
  assert.equal(at('2027-01-27'), 1500); // الدورة الرابعة
  assert.equal(at('2027-02-27'), 500);  // انتهى التعويض
});

test('المسدد يُستبعد، والمكافأة تُحسب إيداعاً في شهرها', () => {
  const s = settings({ bonus: { amount: 4000, month: 11, split: { obligations: 75 } } });
  const r = computeTransfer({ items: [bill('b', 500, { dueDay: 28 })], settings: s, fromISO: '2026-10-27',
    paidKeys: new Set(['b|2026-10-28']) });
  assert.equal(r.perCycle[0].outflow, 0);
  assert.equal(r.perCycle[1].deposit, 3000);
});

test('البند بلا مبلغ يُعدّ ناقصاً', () => {
  const r = computeTransfer({ items: [bill('x', null)], settings: settings(), fromISO: '2026-10-27' });
  assert.deepEqual(r.incompleteItemIds, ['x']);
});

test('المقارنة بنسبة الالتزامات', () => {
  const r = computeTransfer({ items: [bill('b', 5000)], settings: settings(), fromISO: '2026-10-27' });
  assert.equal(r.ratioTarget, 4300);
  assert.equal(r.ratioDiff, -700);
  assert.equal(r.actualPct, 50);
});

test('consumptionCheck يقارن المظاريف بنسبة الاستهلاك', () => {
  const env = { ...base, id: 'e', kind: 'envelope', account: 'consumption', amount: 3500, intervalMonths: 1 };
  assert.deepEqual(consumptionCheck([env], settings()), { envelopes: 3500, target: 3300, diff: -200 });
});

test('sinkingStatus: الجاهزية والمساهمة التعويضية', () => {
  const it = { amount: 1200, intervalMonths: 12, sinkingBalance: 600 };
  const s = sinkingStatus(it, 2);
  assert.equal(s.monthly, 100);
  assert.equal(s.readiness, 0.5);
  assert.equal(s.catchUp, 200); // 600 ناقصة على 3 أشهر
});

test('roundUpTo يقرّب للأعلى لأقرب 50', () => {
  assert.equal(roundUpTo(7401), 7450);
  assert.equal(roundUpTo(7450), 7450);
  assert.equal(roundUpTo(-5), 0);
});

// ---- الديون ----

const debt = (id, balance, priority = 'high', extra = {}) =>
  ({ id, name: id, balance, originalAmount: balance, priority, status: 'active', installmentItemId: null, ...extra });

test('ترتيب الديون: الأولوية ثم الرصيد الأصغر، وتُستبعد المقسطة وغير المؤكدة', () => {
  const ds = [debt('a', 6000), debt('b', 500), debt('c', 100, 'low'), debt('d', 10, 'high', { status: 'to_verify' }),
    debt('bank', 1, 'critical', { installmentItemId: 'x' })];
  assert.deepEqual(rankDebts(ds).map((d) => d.id), ['b', 'a', 'c']);
  assert.equal(targetDebt(ds).id, 'b');
});

test('معيار 6: سداد المستهدف كاملاً ينقل الاستهداف للتالي', () => {
  let ds = [debt('a', 6000), debt('b', 500)];
  ds = ds.map((d) => (d.id === 'b' ? applyDebtPayment(d, 500) : d));
  assert.equal(ds.find((d) => d.id === 'b').status, 'paid');
  assert.equal(targetDebt(ds).id, 'a');
});

test('payoffProjection بكرة الثلج', () => {
  const p = payoffProjection([debt('a', 1000), debt('b', 500)], 500);
  assert.deepEqual(p, [{ id: 'b', closesInMonth: 1 }, { id: 'a', closesInMonth: 3 }]);
});

// ---- الطارئ ----

test('الطارئ "يُدفع الآن" ينشئ بنداً منتهياً واستحقاقاً مسدداً ودفعة', () => {
  const p = planEmergency({ name: 'إطار', amount: 450, date: '2026-10-07', mode: 'pay_now' },
    { salaryDay: 27, newId, nowISO: '2026-10-07' });
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].status, 'ended');
  assert.equal(p.occurrences[0].status, 'paid');
  assert.equal(p.payments[0].amount, 450);
  assert.equal(p.debts.length, 0);
});

test('الطارئ "يُؤجَّل كدين" ينشئ ديناً نشطاً فقط', () => {
  const p = planEmergency({ name: 'سلفة', amount: 2000, date: '2026-10-07', mode: 'defer_debt' },
    { salaryDay: 27, newId, nowISO: '2026-10-07' });
  assert.equal(p.debts.length, 1);
  assert.equal(p.debts[0].balance, 2000);
  assert.equal(p.items.length + p.occurrences.length + p.payments.length, 0);
});

test('الطارئ بمبلغ غير صالح يُرفض', () => {
  assert.throws(() => planEmergency({ name: 'x', amount: 0, date: '2026-10-07', mode: 'pay_now' },
    { salaryDay: 27, newId, nowISO: '2026-10-07' }));
});

// ---- النسخ الاحتياطي ----
import { validateBackup } from '../logic/backup.js';

test('validateBackup يقبل ملفاً سليماً ويكمل الإعدادات الناقصة', () => {
  const r = validateBackup({ schemaVersion: 1, settings: { salaryDay: 25 }, items: [bill('a', 1)] });
  assert.equal(r.ok, true);
  assert.equal(r.data.settings.salaryDay, 25);
  assert.equal(r.data.settings.forecastMonths, 12);
  assert.deepEqual(r.data.debts, []);
});

test('validateBackup يرفض المعرّفات المكررة والأنواع المجهولة والنسب الخاطئة', () => {
  const r = validateBackup({
    settings: { split: { consumption: 50, savings: 50, obligations: 50 } },
    items: [bill('a', 1), bill('a', 2), { ...bill('b', 1), kind: 'xyz' }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
});
