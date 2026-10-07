// السداد والتخطي والتراجع، وتحديد الدورة الحالية وصفوفها (SPEC §6.1، §7.1). دوال نقية.
import { addMonths, diffDays, parseISO } from './dates.js';
import { cycleIdFor, cycleRange, cycleStart, shiftCycle } from './cycles.js';
import { generateOccurrences, occurrenceKey } from './occurrences.js';
import { round2, sum } from './money.js';

/** الدورة التي يبدأها راتب وصل في تاريخ معين: الراتب المبكر حتى 7 أيام يُحسب للدورة القادمة. */
export function cycleForSalary(dateISO, salaryDay) {
  const cid = cycleIdFor(dateISO, salaryDay);
  const next = shiftCycle(cid, 1);
  return diffDays(dateISO, cycleStart(next, salaryDay)) <= 7 ? next : cid;
}

/** الدورة الحالية: حسب التاريخ، أو دورة أحدث بدأت بتأكيد راتب مبكر. */
export function currentCycleId(todayISO, salaryDay, cycles = []) {
  const base = cycleIdFor(todayISO, salaryDay);
  const recorded = cycles
    .filter((c) => c.salaryReceivedAt && c.salaryReceivedAt <= todayISO)
    .map((c) => c.id)
    .sort()
    .pop();
  return recorded && recorded > base ? recorded : base;
}

/** المبالغ الفعلية السابقة لكل بند، مرتبة بالتاريخ (لتقدير المتغير). */
export function buildHistory(stored) {
  const h = {};
  for (const o of [...stored].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))) {
    if (o.status === 'paid' && o.actualAmount != null) (h[o.itemId] ??= []).push(o.actualAmount);
  }
  return h;
}

/** أثر السداد أو التخطي على قالب البند. */
function advanceItem(item, occ, nowISO) {
  const next = { ...item, updatedAt: nowISO };
  if (item.kind === 'one_time') {
    next.status = 'ended';
  } else if (item.kind === 'periodic') {
    next.sinkingBalance = 0;
    if (item.calendar !== 'hijri') {
      const interval = item.intervalMonths;
      const base = item.nextDue === 'now' ? nowISO : occ.dueDate;
      next.nextDue = interval ? addMonths(base, interval, item.dueDay ?? parseISO(base).d) : null;
    }
  } else {
    if (item.nextDue === 'now') next.nextDue = null; // متأخر شهري سُوّي
    if (typeof item.remainingCount === 'number') {
      next.remainingCount = Math.max(0, item.remainingCount - 1);
      if (next.remainingCount === 0) next.status = 'ended';
    }
  }
  return next;
}

/**
 * @param {object} p { item, occ, amount, nowISO, status: 'paid' | 'skipped' }
 * @returns {{ item, occurrence, payment|null }}
 *   occurrence.prevItem يحفظ القالب قبل التغيير للتراجع.
 */
export function settleOccurrence({ item, occ, amount, nowISO, status = 'paid' }) {
  if (status === 'paid' && !(amount >= 0)) throw new Error('أدخل المبلغ المسدد');
  const id = occ.key ?? occurrenceKey(occ.itemId, occ.dueDate);
  const occurrence = {
    id, itemId: item.id, cycleId: occ.cycleId, dueDate: occ.dueDate,
    expectedAmount: occ.expectedAmount ?? null,
    actualAmount: status === 'paid' ? round2(amount) : null,
    status, paidAt: nowISO, prevItem: item, note: '',
  };
  const payment = status === 'paid' ? {
    id: `pay:${id}`, date: nowISO, amount: round2(amount), account: item.account,
    occurrenceId: id, debtId: null, kind: 'bill', note: item.name,
  } : null;
  return { item: advanceItem(item, occ, nowISO), occurrence, payment };
}

/** التراجع: يعيد القالب كما كان، ويحذف الاستحقاق المخزّن ودفعته. */
export function undoOccurrence(occurrence) {
  return {
    item: occurrence.prevItem ?? null,
    removeOccurrenceId: occurrence.id,
    removePaymentId: `pay:${occurrence.id}`,
  };
}

/**
 * صفوف دورة واحدة لحساب الالتزامات: غير المسدد (مولَّد) + المسدد/المتخطى (مخزّن).
 * @returns {{ cycle, rows, totals }}
 */
export function cycleRows({ items, stored, settings, cycleId, todayISO }) {
  const cycle = cycleRange(cycleId, settings.salaryDay);
  const history = buildHistory(stored);
  const byId = new Map(items.map((i) => [i.id, i]));
  const storedHere = stored.filter((o) => o.cycleId === cycleId);
  const storedKeys = new Set(stored.map((o) => o.id));

  const { occurrences } = generateOccurrences(items, cycle.start, 1, { salaryDay: settings.salaryDay, history });
  const open = occurrences
    .filter((o) => o.account === 'obligations' && o.cycleId === cycleId && !storedKeys.has(o.key))
    .map((o) => {
      const item = byId.get(o.itemId);
      // بند بلا يوم محدد يستحق "خلال الدورة"، فلا يُعدّ متأخراً قبل نهايتها
      const dated = item.dueDay != null || item.calendar === 'hijri' || Boolean(item.nextDue && item.nextDue !== 'now');
      return { ...o, item, status: 'open', dated, late: o.overdue || (dated ? o.dueDate < todayISO : cycle.end < todayISO) };
    });
  const done = storedHere.map((o) => ({
    key: o.id, itemId: o.itemId, cycleId, dueDate: o.dueDate, expectedAmount: o.expectedAmount,
    actualAmount: o.actualAmount, status: o.status, paidAt: o.paidAt,
    item: byId.get(o.itemId) ?? o.prevItem, stored: o,
  }));

  const byDate = (a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  const rows = [
    ...open.filter((r) => r.late).sort(byDate),
    ...open.filter((r) => !r.late).sort(byDate),
    ...done.sort(byDate),
  ];
  const paid = sum(done.filter((r) => r.status === 'paid').map((r) => r.actualAmount));
  const remaining = sum(open.map((r) => r.expectedAmount));
  return {
    cycle,
    rows,
    totals: {
      paid, remaining, total: round2(paid + remaining),
      openCount: open.length, doneCount: done.length,
      missingAmounts: open.filter((r) => r.expectedAmount == null).length,
      fixedReady: open.filter((r) => r.item?.amountMode !== 'variable' && r.expectedAmount != null).length,
    },
  };
}

/** التحويلات الثلاثة المقترحة يوم الراتب (SPEC §7.2 الخطوة 3). */
export function proposeTransfers({ salary, settings, recommended, envelopes }) {
  const savings = round2(salary * (settings.split?.savings ?? 0) / 100);
  const obligations = round2(recommended);
  const consumption = round2(salary - obligations - savings);
  return {
    obligations, savings, consumption,
    consumptionShort: round2(Math.max(0, envelopes - consumption)),
  };
}
