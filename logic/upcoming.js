// شاشة "القادم": التنبؤ لـ12 دورة، وأحداثها، وأثر الطارئ قبل تأكيده (SPEC §7.3، §8). دوال نقية.
import { addMonths, diffDays, parseISO } from './dates.js';
import { cycleRange } from './cycles.js';
import { computeTransfer } from './transfer.js';
import { currentCycleId, buildHistory, carriedOverdue } from './payments.js';
import { payoffProjection, rankDebts } from './debts.js';
import { planEmergency } from './emergency.js';
import { sinkingFor, hasSinking } from './sinking.js';
import { round2, sum } from './money.js';

/**
 * رصيد حساب الالتزامات المقدَّر الآن.
 * = (رصيد بداية الدورة + المحوَّل فيها، من طقس الراتب) − المسدد منه في الدورة.
 * المسدد لطارئ معوَّض لا يُخصم: بند التعويض يمثّل كلفته في المحاكاة.
 * وإن لم يُعرف الرصيد، فطارئ "من الفائض" لا يُخصم: الفائض موجود لكن مقداره مجهول.
 */
export function balanceEstimate({ record, stored, items, cycleId }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const known = record?.obligationsOpeningBalance != null;
  const excluded = new Set(items.filter((i) => i.kind === 'recovery' && i.sourceItemId).map((i) => i.sourceItemId));
  if (!known) items.filter((i) => i.emergency && i.kind === 'one_time').forEach((i) => excluded.add(i.id));
  const paid = sum(stored
    .filter((o) => o.cycleId === cycleId && o.status === 'paid' && !excluded.has(o.itemId))
    .filter((o) => (byId.get(o.itemId) ?? o.prevItem)?.account === 'obligations')
    .map((o) => o.actualAmount));
  const base = record ? (record.obligationsOpeningBalance ?? 0) + (record.transfers?.obligations ?? 0) : 0;
  return {
    balance: round2(base - paid),
    known,
    transferred: Boolean(record),
    paid,
  };
}

/** التنبؤ من الدورة الحالية بالحالة الكاملة. */
export function forecast({ items, settings, stored, cycles, todayISO }) {
  const cycleId = currentCycleId(todayISO, settings.salaryDay, cycles);
  const record = cycles.find((c) => c.id === cycleId) ?? null;
  const cycle = cycleRange(cycleId, settings.salaryDay);
  const bal = balanceEstimate({ record, stored, items, cycleId });
  const t = computeTransfer({
    items, settings, fromISO: cycle.start, openingBalance: bal.balance,
    paidKeys: new Set(stored.map((o) => o.id)), history: buildHistory(stored),
    extraOccurrences: carriedOverdue({ items, stored, settings, cycleId, cycles }),
    firstTransferDone: Boolean(record),
  });
  return { cycleId, cycle, record, bal, t };
}

/** هل هذا آخر استحقاق لقسط محدود؟ */
function isFinalInstallment(item, occ, countInHorizon) {
  if (item.kind !== 'installment') return false;
  if (item.endDate) {
    const next = addMonths(occ.dueDate, 1, item.dueDay ?? parseISO(occ.dueDate).d);
    if (next > item.endDate) return true;
  }
  return item.remainingCount != null && countInHorizon === item.remainingCount;
}

/**
 * نموذج شاشة "القادم".
 * @returns {{ cycleId, bal, t, timeline, funds, freed }}
 *   timeline[i] = { ...perCycle[i], periodic, events }
 *   funds = كل صناديق الإغراق مرتبة بالموعد
 *   freed = أقساط انتهت مؤخراً ولم يُقرَّر مصير مبلغها
 */
export function upcomingModel({ items, debts = [], settings, stored, cycles, todayISO }) {
  const f = forecast({ items, settings, stored, cycles, todayISO });
  const { t, cycleId } = f;
  const byId = new Map(items.map((i) => [i.id, i]));
  const sd = settings.salaryDay;

  // آخر استحقاق لكل قسط داخل الأفق
  const all = t.perCycle.flatMap((c) => c.occurrences);
  const counts = {};
  const lastOf = {};
  for (const o of all) { counts[o.itemId] = (counts[o.itemId] ?? 0) + 1; lastOf[o.itemId] = o; }

  // إغلاق الديون: الشهر 1 = الدورة الحالية (المبلغ الإضافي يُحسب من الدورة الأولى)
  const closes = new Map(payoffProjection(debts, settings.debtExtraMonthly ?? 0)
    .filter((p) => p.closesInMonth != null).map((p) => [p.id, p.closesInMonth - 1]));
  const debtById = new Map(debts.map((d) => [d.id, d]));

  const seenFund = new Set();
  const timeline = t.perCycle.map((c, i) => {
    const periodic = c.occurrences
      .filter((o) => o.kind === 'periodic')
      .map((o) => {
        const item = byId.get(o.itemId);
        const first = !seenFund.has(o.itemId);
        seenFund.add(o.itemId);
        const s = first && item && hasSinking(item) ? sinkingFor(item, cycleId, sd) : null;
        return { item, dueDate: o.dueDate, amount: o.expectedAmount, overdue: o.overdue, fund: s, repeat: !first };
      });
    const events = [];
    for (const o of c.occurrences) {
      const item = byId.get(o.itemId);
      if (item && lastOf[o.itemId] === o && isFinalInstallment(item, o, counts[o.itemId])) {
        events.push({ type: 'installment_end', item, amount: o.expectedAmount ?? item.amount ?? 0, lastDue: o.dueDate, cycleIndex: i });
      }
    }
    for (const [id, idx] of closes) if (idx === i) events.push({ type: 'debt_close', debt: debtById.get(id) });
    if (c.deposit) events.push({ type: 'bonus', amount: c.deposit });
    return { ...c, index: i, periodic, events };
  });

  const funds = items.filter(hasSinking)
    .map((item) => ({ item, ...sinkingFor(item, cycleId, sd) }))
    .sort((a, b) => ((a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1));

  const freed = items.filter((i) => i.kind === 'installment' && i.status === 'ended' && !i.freedDecision
    && i.amount > 0 && i.updatedAt && diffDays(i.updatedAt.slice(0, 10), todayISO) <= 62);

  return { ...f, timeline, funds, fundsTotal: sum(funds.map((x) => x.balance)), freed };
}

/** سياق planEmergency من الحالة: الدورة الحالية وهل حُوِّل لها. */
export function emergencyContext({ settings, cycles, todayISO }) {
  const cycleId = currentCycleId(todayISO, settings.salaryDay, cycles);
  return { salaryDay: settings.salaryDay, nowISO: todayISO, cycleId, transferDone: cycles.some((c) => c.id === cycleId) };
}

/**
 * أثر الطارئ قبل تأكيده: يقارن التنبؤ قبل الإضافة وبعدها.
 * @returns {{ mode, before, after, lowBefore, lowAfter, months, debtRank, debtCount, closesInMonth }}
 */
export function emergencyImpact({ e, items, debts = [], settings, stored, cycles, todayISO }) {
  let n = 0;
  const plan = planEmergency(e, { ...emergencyContext({ settings, cycles, todayISO }), newId: () => `preview-${++n}` });
  const ctx = { settings, cycles, todayISO };
  const before = forecast({ ...ctx, items, stored });
  const after = forecast({ ...ctx, items: [...items, ...plan.items], stored: [...stored, ...plan.occurrences] });
  const out = {
    mode: e.mode,
    before: before.t.recommended,
    after: after.t.recommended,
    lowBefore: before.t.lowest?.balanceAfter ?? 0,
    lowAfter: after.t.lowest?.balanceAfter ?? 0,
    balanceKnown: before.bal.known,
    months: e.mode === 'pay_recover' ? Math.max(1, Math.round(e.months ?? 1)) : null,
    debtRank: null, debtCount: null, closesInMonth: null,
  };
  if (e.mode === 'defer_debt') {
    const all = [...debts, ...plan.debts];
    const ranked = rankDebts(all);
    const id = plan.debts[0].id;
    out.debtRank = ranked.findIndex((d) => d.id === id) + 1;
    out.debtCount = ranked.length;
    out.closesInMonth = payoffProjection(all, settings.debtExtraMonthly ?? 0).find((p) => p.id === id)?.closesInMonth ?? null;
  }
  return out;
}
