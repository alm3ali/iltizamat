import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accrueSinking, sinkingFor, hasSinking, cycleDiff, computeTransfer, generateOccurrences,
  carriedOverdue, cycleRows, balanceEstimate, upcomingModel, emergencyImpact, planEmergency,
} from '../logic/index.js';

const base = {
  status: 'active', account: 'obligations', amountMode: 'fixed', calendar: 'gregorian',
  dueDay: null, nextDue: null, endDate: null, remainingCount: null, priority: 'high',
};
const bill = (id, amount, extra = {}) => ({ ...base, id, name: id, kind: 'bill', amount, intervalMonths: 1, ...extra });
const periodic = (id, amount, intervalMonths, nextDue, extra = {}) =>
  ({ ...base, id, name: id, kind: 'periodic', amount, intervalMonths, nextDue, sinkingBalance: 0, ...extra });
const settings = (extra = {}) => ({
  salaryDay: 25, incomes: [{ id: 'i', amount: 10000 }],
  split: { consumption: 33, savings: 24, obligations: 43 },
  bonus: { amount: 0, month: null }, obligationsBuffer: 0, debtExtraMonthly: 0, forecastMonths: 12, ...extra,
});
const ctx = { salaryDay: 25, nowISO: '2026-10-25' };

// ---- صناديق الإغراق ----

test('cycleDiff يعدّ الدورات بين معرّفين', () => {
  assert.equal(cycleDiff('2026-10', '2027-01'), 3);
  assert.equal(cycleDiff('2026-10', '2026-09'), -1);
});

test('صندوق سنوي بعيد الموعد يزيد بالمساهمة القياسية', () => {
  const [it] = accrueSinking([periodic('y', 1200, 12, '2027-10-20')], '2026-10', ctx);
  assert.equal(it.sinkingBalance, 100);
  assert.equal(it.sinkingThrough, '2026-10');
});

test('المساهمة التعويضية حين يقترب الموعد، ولا يتجاوز الرصيد مبلغ البند', () => {
  // يستحق بعد دورتين (index 2 = 3 أشهر): 1200 / 3
  const [a] = accrueSinking([periodic('y', 1200, 12, '2026-12-28')], '2026-10', ctx);
  assert.equal(a.sinkingBalance, 400);
  // يستحق في هذه الدورة ورصيده 1000: يكتمل بالضبط
  const [b] = accrueSinking([periodic('y', 1200, 12, '2026-11-01', { sinkingBalance: 1000 })], '2026-10', ctx);
  assert.equal(b.sinkingBalance, 1200);
});

test('الإضافة لا تتكرر في الدورة نفسها، وتستدرك الدورات الفائتة', () => {
  const it = periodic('y', 1200, 12, '2027-10-20', { sinkingBalance: 100, sinkingThrough: '2026-10' });
  assert.deepEqual(accrueSinking([it], '2026-10', ctx), []);
  const [later] = accrueSinking([it], '2027-01', ctx); // نوفمبر وديسمبر ويناير
  assert.equal(later.sinkingBalance, 400);
});

test('لا صندوق للفواتير ولا للدوري بلا مبلغ أو تكرار', () => {
  assert.equal(hasSinking(bill('b', 100)), false);
  assert.equal(hasSinking(periodic('p', null, 12, '2027-01-01')), false);
  assert.equal(hasSinking(periodic('p', 100, null, '2027-01-01')), false);
  assert.equal(hasSinking(periodic('z', 50, null, null, { calendar: 'hijri', hijriMonth: 9 })), true);
});

test('sinkingFor للهجري يجد الموعد القادم ويحسب الأشهر', () => {
  const z = periodic('z', 120, null, null, { calendar: 'hijri', hijriMonth: 9, hijriDay: 25 });
  const s = sinkingFor(z, '2026-10', 25);
  assert.ok(s.dueDate >= '2027-02-01' && s.dueDate <= '2027-03-31', s.dueDate);
  assert.equal(s.monthly, 10);
  assert.ok(s.cycleIndex >= 3 && s.cycleIndex <= 5);
});

// ---- التحويل بعد طقس الراتب ----

test('بعد التحويل للدورة الحالية يبدأ الموصى به من الدورة التالية', () => {
  const r = computeTransfer({ items: [bill('b', 500)], settings: settings(), fromISO: '2026-10-25', openingBalance: 1000, firstTransferDone: true });
  assert.equal(r.recommended, 500);
  assert.equal(r.perCycle[0].balanceAfter, 500); // بلا تحويل جديد في الدورة الأولى
  assert.equal(r.perCycle[1].balanceAfter, 500);
  assert.equal(r.lowest.balanceAfter, 500);
});

test('القسط المسدد لا يستهلك عدده المتبقي في التنبؤ', () => {
  // بقي 3 بعد سداد قسط هذه الدورة
  const it = bill('t', 100, { kind: 'installment', remainingCount: 3, dueDay: 28 });
  const { occurrences } = generateOccurrences([it], '2026-10-25', 12, { salaryDay: 25, skipKeys: new Set(['t|2026-10-28']) });
  assert.deepEqual(occurrences.map((o) => o.dueDate), ['2026-11-28', '2026-12-28', '2027-01-28']);
});

// ---- المتأخر المنقول ----

test('المتأخر من دورة سابقة مُتابَعة يُنقل للدورة الحالية', () => {
  const items = [bill('a', 100, { dueDay: 28 }), bill('b', 50, { dueDay: 1 })];
  const stored = [{ id: 'b|2026-10-01', itemId: 'b', cycleId: '2026-09', dueDate: '2026-10-01', status: 'paid', actualAmount: 50 }];
  const cycles = [{ id: '2026-09', salaryReceivedAt: '2026-09-25' }];
  const s = settings();
  const carried = carriedOverdue({ items, stored, settings: s, cycleId: '2026-10', cycles });
  assert.deepEqual(carried.map((o) => o.key), ['a|2026-09-28']);
  assert.equal(carried[0].cycleId, '2026-10');
  // بلا سجل للدورة السابقة: لا نقل
  assert.deepEqual(carriedOverdue({ items, stored, settings: s, cycleId: '2026-10', cycles: [] }), []);
  // يظهر أول القائمة متأخراً ويدخل المجموع
  const { rows, totals } = cycleRows({ items, stored, settings: s, cycleId: '2026-10', todayISO: '2026-10-26', cycles });
  assert.equal(rows[0].key, 'a|2026-09-28');
  assert.equal(rows[0].late, true);
  assert.equal(totals.remaining, 250);
});

test('البند المضاف بعد الدورة السابقة لا يُنقل متأخراً', () => {
  const items = [bill('n', 100, { dueDay: 28, createdAt: '2026-10-26T08:00:00Z' })];
  const r = carriedOverdue({ items, stored: [], settings: settings(), cycleId: '2026-10', cycles: [{ id: '2026-09' }] });
  assert.deepEqual(r, []);
});

// ---- الرصيد المقدَّر ----

test('balanceEstimate: الافتتاحي + المحوَّل − المسدد، والطارئ المعوَّض لا يُخصم', () => {
  const items = [bill('b', 1200), { ...base, id: 'e', kind: 'one_time', emergency: true }, { ...base, id: 'r', kind: 'recovery', sourceItemId: 'e' }];
  const stored = [
    { id: 'b|x', itemId: 'b', cycleId: '2026-10', status: 'paid', actualAmount: 1200 },
    { id: 'e|x', itemId: 'e', cycleId: '2026-10', status: 'paid', actualAmount: 4000 },
    { id: 'old', itemId: 'b', cycleId: '2026-09', status: 'paid', actualAmount: 1200 },
  ];
  const record = { id: '2026-10', obligationsOpeningBalance: 1000, transfers: { obligations: 5000 } };
  const r = balanceEstimate({ record, stored, items, cycleId: '2026-10' });
  assert.equal(r.balance, 4800);
  assert.equal(r.known, true);
  assert.equal(balanceEstimate({ record: null, stored, items, cycleId: '2026-10' }).balance, -1200);
});

// ---- نموذج "القادم" ----

test('القادم: انتهاء قسط، وشهر المكافأة، وإغلاق دين، وجاهزية الدوري', () => {
  const items = [
    bill('t', 300, { kind: 'installment', endDate: '2027-01-31', dueDay: 1 }),
    periodic('ins', 1200, 12, '2027-03-10', { sinkingBalance: 600 }),
  ];
  const debts = [{ id: 'd', name: 'd', balance: 1000, originalAmount: 1000, priority: 'high', status: 'active', installmentItemId: null }];
  const s = settings({ debtExtraMonthly: 500, bonus: { amount: 4000, month: 12, split: { obligations: 50 } } });
  const m = upcomingModel({ items, debts, settings: s, stored: [], cycles: [], todayISO: '2026-10-26' });
  assert.equal(m.timeline.length, 12);
  const at = (type) => m.timeline.findIndex((c) => c.events.some((e) => e.type === type));
  assert.equal(at('installment_end'), 2);          // دورة ديسمبر (قسط 1 يناير)
  assert.equal(m.timeline[2].events[0].amount, 300);
  assert.equal(at('debt_close'), 1);               // 500 + 500
  assert.equal(at('bonus'), 2);
  const ins = m.timeline.flatMap((c) => c.periodic).find((p) => p.item.id === 'ins');
  assert.equal(ins.fund.readiness, 0.5);
  assert.equal(m.funds.length, 1);
  assert.equal(m.fundsTotal, 600);
});

test('القسط المنتهي مؤخراً يظهر في "تحرّر" حتى يُقرَّر مصيره', () => {
  const ended = bill('t', 300, { kind: 'installment', status: 'ended', updatedAt: '2026-10-20T10:00:00Z' });
  const m = upcomingModel({ items: [ended], settings: settings(), stored: [], cycles: [], todayISO: '2026-10-26' });
  assert.deepEqual(m.freed.map((i) => i.id), ['t']);
  const done = upcomingModel({ items: [{ ...ended, freedDecision: 'debt' }], settings: settings(), stored: [], cycles: [], todayISO: '2026-10-26' });
  assert.equal(done.freed.length, 0);
});

// ---- معاينة الطارئ ----

const state = { items: [bill('b', 500)], debts: [], settings: settings(), stored: [], cycles: [], todayISO: '2026-10-26' };

test('معيار 4 في المعاينة: تعويض 4000 على 4 أشهر يرفع الموصى به 1000', () => {
  const r = emergencyImpact({ ...state, e: { name: 'صيانة', amount: 4000, date: '2026-10-26', mode: 'pay_recover', months: 4 } });
  assert.equal(r.before, 500);
  assert.equal(r.after, 1500);
  assert.equal(r.months, 4);
  // بعد طقس الراتب: التعويض يبدأ من الدورة القادمة، والزيادة 1000 كذلك
  const cycles = [{ id: '2026-10', salaryReceivedAt: '2026-10-25', obligationsOpeningBalance: 0, transfers: { obligations: 500 } }];
  const done = emergencyImpact({ ...state, cycles, e: { name: 'صيانة', amount: 4000, date: '2026-10-26', mode: 'pay_recover', months: 4 } });
  assert.equal(done.after - done.before, 1000);
});

test('المعاينة: "من الفائض" يخفض الرصيد المعروف، ولا أثر له إن كان الرصيد مجهولاً', () => {
  const e = { name: 'إطار', amount: 450, date: '2026-10-26', mode: 'pay_now' };
  const unknown = emergencyImpact({ ...state, e });
  assert.equal(unknown.after, unknown.before);
  assert.equal(unknown.balanceKnown, false);
  const cycles = [{ id: '2026-10', salaryReceivedAt: '2026-10-25', obligationsOpeningBalance: 3000, transfers: { obligations: 500 } }];
  const known = emergencyImpact({ ...state, cycles, e });
  assert.equal(known.lowBefore - known.lowAfter, 450);
});

test('المعاينة: التأجيل كدين لا يغيّر التحويل ويعطي ترتيبه وموعد إغلاقه', () => {
  const debts = [{ id: 'a', name: 'a', balance: 3000, originalAmount: 3000, priority: 'high', status: 'active', installmentItemId: null }];
  const r = emergencyImpact({ ...state, debts, settings: settings({ debtExtraMonthly: 1000 }),
    e: { name: 'سلفة', amount: 2000, date: '2026-10-26', mode: 'defer_debt' } });
  assert.equal(r.after, r.before);
  assert.equal(r.debtRank, 1);  // الرصيد الأصغر بالأولوية نفسها
  assert.equal(r.debtCount, 2);
  assert.equal(r.closesInMonth, 2);
});

test('الطارئ في دورة راتب مبكر يُنسب للدورة الحالية', () => {
  const p = planEmergency({ name: 'x', amount: 100, date: '2026-10-23', mode: 'pay_now' },
    { salaryDay: 25, newId: () => 'id', nowISO: '2026-10-23', cycleId: '2026-10' });
  assert.equal(p.occurrences[0].cycleId, '2026-10');
});
