// صناديق الإغراق للبنود الدورية (SPEC §6.3). دوال نقية.
import { addDays, findHijriDates } from './dates.js';
import { cycleIdFor, cycleStart, shiftCycle } from './cycles.js';
import { sinkingStatus } from './transfer.js';
import { round2 } from './money.js';

const LIVE = new Set(['active', 'to_verify']);

/** عدد الدورات من الدورة a إلى الدورة b (سالب إن كانت b قبل a). */
export function cycleDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** هل للبند صندوق إغراق؟ دوري نشط بمبلغ معروف وتكرار أطول من شهر. */
export function hasSinking(item) {
  if (item.kind !== 'periodic' || !LIVE.has(item.status) || !(item.amount > 0)) return false;
  return item.calendar === 'hijri' ? Boolean(item.hijriMonth) : item.intervalMonths > 1;
}

/** الموعد القادم للبند من تاريخ معين (الهجري يُحسب، و"now" = اليوم). */
export function nextDueOf(item, fromISO) {
  if (item.calendar === 'hijri' && item.hijriMonth) {
    return findHijriDates(item.hijriMonth, item.hijriDay ?? 1, fromISO, addDays(fromISO, 400))[0] ?? null;
  }
  if (item.nextDue === 'now') return fromISO;
  return item.nextDue ?? null;
}

/** حالة صندوق البند منسوبة إلى دورة معينة: الجاهزية، والأشهر حتى الموعد، والمساهمة. */
export function sinkingFor(item, cycleId, salaryDay) {
  const due = nextDueOf(item, cycleStart(cycleId, salaryDay));
  const index = due ? Math.max(0, cycleDiff(cycleId, cycleIdFor(due, salaryDay))) : null;
  return { ...sinkingStatus(item, index), dueDate: due, cycleIndex: index };
}

/**
 * يضيف مساهمة كل دورة إلى رصيد الصندوق عند بدء الدورة (طقس الراتب).
 * المساهمة = التعويضية إن كان الرصيد ناقصاً والموعد قريباً، ولا يتجاوز الرصيد مبلغ البند.
 * `sinkingThrough` = آخر دورة أُضيفت مساهمتها، فلا تُضاف مرتين، وتُستدرك الدورات الفائتة.
 * @returns {object[]} البنود التي تغيّرت فقط.
 */
export function accrueSinking(items, cycleId, { salaryDay, nowISO, maxCatchUp = 24 }) {
  const out = [];
  for (const it of items) {
    if (!hasSinking(it)) continue;
    if (it.sinkingThrough && it.sinkingThrough >= cycleId) continue;
    let first = it.sinkingThrough ? shiftCycle(it.sinkingThrough, 1) : cycleId;
    if (cycleDiff(first, cycleId) >= maxCatchUp) first = shiftCycle(cycleId, -(maxCatchUp - 1));
    let balance = it.sinkingBalance ?? 0;
    for (let c = first; c <= cycleId; c = shiftCycle(c, 1)) {
      const s = sinkingFor({ ...it, sinkingBalance: balance }, c, salaryDay);
      balance = round2(balance + Math.min(s.catchUp, Math.max(0, it.amount - balance)));
    }
    out.push({ ...it, sinkingBalance: balance, sinkingThrough: cycleId, updatedAt: nowISO });
  }
  return out;
}
