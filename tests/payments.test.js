import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleForSalary, currentCycleId, buildHistory, settleOccurrence, undoOccurrence, cycleRows, proposeTransfers,
} from '../logic/index.js';

const base = {
  status: 'active', account: 'obligations', amountMode: 'fixed', calendar: 'gregorian',
  dueDay: null, nextDue: null, endDate: null, remainingCount: null, priority: 'high',
};
const bill = (id, amount, extra = {}) => ({ ...base, id, name: id, kind: 'bill', amount, intervalMonths: 1, ...extra });
const settings = { salaryDay: 25, split: { consumption: 33, savings: 24, obligations: 43 } };

test('الراتب المبكر حتى 7 أيام يبدأ الدورة القادمة', () => {
  assert.equal(cycleForSalary('2026-10-25', 25), '2026-10');
  assert.equal(cycleForSalary('2026-10-22', 25), '2026-10');
  assert.equal(cycleForSalary('2026-10-26', 25), '2026-10');
  assert.equal(cycleForSalary('2026-10-10', 25), '2026-09');
});

test('الدورة الحالية تتقدم بتأكيد راتب مبكر', () => {
  assert.equal(currentCycleId('2026-10-23', 25, []), '2026-09');
  assert.equal(currentCycleId('2026-10-23', 25, [{ id: '2026-10', salaryReceivedAt: '2026-10-22' }]), '2026-10');
  // تأكيد بتاريخ مستقبلي لا يُحتسب بعد
  assert.equal(currentCycleId('2026-10-20', 25, [{ id: '2026-10', salaryReceivedAt: '2026-10-22' }]), '2026-09');
});

test('معيار 2: السداد يختم التاريخ مرة واحدة ويُنشئ دفعة', () => {
  const item = bill('b', 230, { dueDay: 1 });
  const r = settleOccurrence({ item, occ: { key: 'b|2026-11-01', itemId: 'b', cycleId: '2026-10', dueDate: '2026-11-01', expectedAmount: 230 }, amount: 230, nowISO: '2026-10-28' });
  assert.equal(r.occurrence.paidAt, '2026-10-28');
  assert.equal(r.occurrence.status, 'paid');
  assert.equal(r.payment.amount, 230);
  assert.deepEqual(r.occurrence.prevItem, item);
});

test('سداد بند دوري يقدّم موعده القادم ويصفّر صندوقه', () => {
  const item = { ...base, id: 'ins', kind: 'periodic', amount: 1300, intervalMonths: 12, nextDue: '2026-11-10', sinkingBalance: 900 };
  const r = settleOccurrence({ item, occ: { itemId: 'ins', cycleId: '2026-10', dueDate: '2026-11-10' }, amount: 1250, nowISO: '2026-11-09' });
  assert.equal(r.item.nextDue, '2027-11-10');
  assert.equal(r.item.sinkingBalance, 0);
});

test('سداد بند متأخر "now" يحسب الموعد القادم من تاريخ السداد', () => {
  const item = { ...base, id: 'f', kind: 'periodic', amount: 84, intervalMonths: 12, nextDue: 'now' };
  const r = settleOccurrence({ item, occ: { itemId: 'f', cycleId: '2026-10', dueDate: '2026-10-25' }, amount: 84, nowISO: '2026-10-30' });
  assert.equal(r.item.nextDue, '2027-10-30');
});

test('مرة واحدة ينتهي، والقسط ينقص عدّاده', () => {
  const one = settleOccurrence({ item: { ...base, id: 'o', kind: 'one_time', amount: 5, nextDue: '2026-10-30' },
    occ: { itemId: 'o', cycleId: '2026-10', dueDate: '2026-10-30' }, amount: 5, nowISO: '2026-10-30' });
  assert.equal(one.item.status, 'ended');
  const inst = settleOccurrence({ item: bill('t', 351.58, { kind: 'installment', remainingCount: 1 }),
    occ: { itemId: 't', cycleId: '2026-10', dueDate: '2026-10-25' }, amount: 351.58, nowISO: '2026-10-26' });
  assert.equal(inst.item.remainingCount, 0);
  assert.equal(inst.item.status, 'ended');
});

test('التخطي بلا دفعة، والتراجع يعيد القالب', () => {
  const item = { ...base, id: 'ins', kind: 'periodic', amount: 100, intervalMonths: 6, nextDue: '2026-11-01' };
  const r = settleOccurrence({ item, occ: { itemId: 'ins', cycleId: '2026-10', dueDate: '2026-11-01' }, nowISO: '2026-10-26', status: 'skipped' });
  assert.equal(r.payment, null);
  assert.equal(r.occurrence.actualAmount, null);
  const u = undoOccurrence(r.occurrence);
  assert.deepEqual(u.item, item);
  assert.equal(u.removePaymentId, `pay:${r.occurrence.id}`);
});

test('السداد بلا مبلغ يُرفض', () => {
  assert.throws(() => settleOccurrence({ item: bill('b', null), occ: { itemId: 'b', dueDate: '2026-10-25' }, nowISO: '2026-10-25' }));
});

test('buildHistory يجمع المبالغ الفعلية بالترتيب', () => {
  const h = buildHistory([
    { itemId: 'e', dueDate: '2026-11-01', status: 'paid', actualAmount: 300 },
    { itemId: 'e', dueDate: '2026-10-01', status: 'paid', actualAmount: 250 },
    { itemId: 'e', dueDate: '2026-12-01', status: 'skipped', actualAmount: null },
  ]);
  assert.deepEqual(h, { e: [250, 300] });
});

test('cycleRows: المتأخر أولاً، ثم المفتوح بالتاريخ، ثم المسدد، والمجاميع صحيحة', () => {
  const items = [
    bill('a', 100, { dueDay: 28 }),
    bill('b', 200, { dueDay: 5 }),
    bill('v', 300, { dueDay: 26, amountMode: 'variable' }),
    { ...base, id: 'late', kind: 'periodic', amount: 84, intervalMonths: 12, nextDue: 'now' },
    { ...base, id: 'env', kind: 'envelope', account: 'consumption', amount: 500, intervalMonths: 1 },
  ];
  const stored = [{ id: 'a|2026-10-28', itemId: 'a', cycleId: '2026-10', dueDate: '2026-10-28', expectedAmount: 100, actualAmount: 100, status: 'paid', paidAt: '2026-10-28' }];
  const { rows, totals, cycle } = cycleRows({ items, stored, settings, cycleId: '2026-10', todayISO: '2026-10-29' });
  assert.deepEqual(cycle, { id: '2026-10', start: '2026-10-25', end: '2026-11-24' });
  assert.deepEqual(rows.map((r) => r.itemId), ['late', 'v', 'b', 'a']);
  assert.equal(rows[1].late, true); // 26 قبل اليوم 29
  assert.equal(totals.paid, 100);
  assert.equal(totals.remaining, 584);
  assert.equal(totals.fixedReady, 2); // late و b (v متغير)
});

test('proposeTransfers يقسم الراتب وينبّه إن لم يكفِ الاستهلاك', () => {
  const p = proposeTransfers({ salary: 18500, settings, recommended: 9000, envelopes: 5000 });
  assert.deepEqual(p, { obligations: 9000, savings: 4440, consumption: 5060, consumptionShort: 0 });
  const tight = proposeTransfers({ salary: 18500, settings, recommended: 11000, envelopes: 5000 });
  assert.equal(tight.consumptionShort, 1940);
});

test('بند بلا يوم استحقاق لا يُعدّ متأخراً داخل دورته', () => {
  const items = [bill('n', 100), bill('d', 50, { dueDay: 26 })];
  const { rows } = cycleRows({ items, stored: [], settings, cycleId: '2026-10', todayISO: '2026-11-03' });
  const n = rows.find((r) => r.itemId === 'n');
  const d = rows.find((r) => r.itemId === 'd');
  assert.equal(n.dated, false);
  assert.equal(n.late, false);
  assert.equal(d.late, true);
  const after = cycleRows({ items, stored: [], settings, cycleId: '2026-10', todayISO: '2026-11-25' });
  assert.equal(after.rows.find((r) => r.itemId === 'n').late, true);
});
