// توليد الاستحقاقات من قوالب البنود (SPEC §6.2). دوال نقية.
import { addMonths, clampedDate, parseISO, findHijriDates } from './dates.js';
import { cyclesFrom, cycleIdFor } from './cycles.js';
import { round2 } from './money.js';

const LIVE = new Set(['active', 'to_verify']);

export const occurrenceKey = (itemId, dueDate) => `${itemId}|${dueDate}`;

/** المبلغ المتوقع: للمتغير متوسط آخر 3 مبالغ فعلية، وإلا مبلغ القالب (قد يكون null). */
export function estimateAmount(item, actuals = []) {
  if (item.amountMode === 'variable' && actuals.length) {
    const last = actuals.slice(-3);
    return round2(last.reduce((a, b) => a + b, 0) / last.length);
  }
  return item.amount ?? null;
}

/** تاريخ يوم الاستحقاق داخل دورة معينة (الدورة تمتد على شهرين ميلاديين). */
export function dateInCycle(cycle, dueDay) {
  if (!dueDay) return cycle.start;
  const { y, m } = parseISO(cycle.start);
  const first = clampedDate(y, m, dueDay);
  if (first >= cycle.start) return first <= cycle.end ? first : cycle.end;
  const next = addMonths(`${y}-${String(m).padStart(2, '0')}-01`, 1, dueDay);
  return next <= cycle.end ? next : cycle.end;
}

/**
 * يولّد الاستحقاقات من تاريخ `fromISO` لعدد `months` من الدورات.
 * @returns {{ occurrences: object[], unscheduled: object[] }}
 *   unscheduled = بنود دورية بلا موعد قادم معروف (تظهر في "للتأكد").
 */
export function generateOccurrences(items, fromISO, months, { salaryDay, history = {}, skipKeys = null }) {
  const cycles = cyclesFrom(fromISO, salaryDay, months);
  const horizonStart = cycles[0].start;
  const horizonEnd = cycles[cycles.length - 1].end;
  const occurrences = [];
  const unscheduled = [];

  for (const item of items) {
    if (!LIVE.has(item.status)) continue;
    const amount = estimateAmount(item, history[item.id]);
    const push = (dueDate, extra = {}) => {
      if (item.endDate && dueDate > item.endDate) return false;
      occurrences.push({
        key: occurrenceKey(item.id, dueDate),
        itemId: item.id,
        account: item.account,
        kind: item.kind,
        cycleId: dueDate < horizonStart ? cycles[0].id : cycleIdFor(dueDate, salaryDay),
        dueDate,
        expectedAmount: amount,
        overdue: dueDate < fromISO,
        ...extra,
      });
      return true;
    };
    let limit = item.remainingCount ?? Infinity;
    const take = (dueDate, extra) => {
      if (limit <= 0) return false;
      // استحقاق مسدد/متخطى: لا يُولَّد ولا يستهلك العدد المتبقي (العدّاد نقص عند السداد)
      if (skipKeys?.has(occurrenceKey(item.id, dueDate))) return true;
      if (push(dueDate, extra)) { limit -= 1; return true; }
      return false;
    };

    // بند هجري: يُحسب من الشهر واليوم الهجريين
    if (item.calendar === 'hijri' && item.hijriMonth) {
      for (const d of findHijriDates(item.hijriMonth, item.hijriDay ?? 1, horizonStart, horizonEnd)) take(d);
      continue;
    }

    const interval = item.intervalMonths;
    const nextDue = item.nextDue;

    // شهري: استحقاق واحد في كل دورة
    if (interval === 1) {
      if (nextDue === 'now') take(fromISO, { overdue: true });
      const minCycle = nextDue && nextDue !== 'now' ? cycleIdFor(nextDue, salaryDay) : null;
      for (const c of cycles) {
        if (minCycle && c.id < minCycle) continue;
        const d = minCycle === c.id ? nextDue : dateInCycle(c, item.dueDay);
        take(d);
      }
      continue;
    }

    // دوري أو مرة واحدة: يحتاج موعداً قادماً
    if (!nextDue) { unscheduled.push(item); continue; }
    const anchor = nextDue === 'now' ? fromISO : nextDue;
    const anchorDay = item.dueDay ?? parseISO(anchor).d;
    if (!take(anchor, nextDue === 'now' ? { overdue: true } : undefined) && limit <= 0) continue;
    if (!interval) continue; // مرة واحدة
    for (let i = 1; ; i++) {
      const d = addMonths(anchor, interval * i, anchorDay);
      if (d > horizonEnd) break;
      if (!take(d)) break;
    }
  }

  occurrences.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { occurrences, unscheduled, cycles };
}
