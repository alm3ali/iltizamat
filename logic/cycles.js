// الدورة = من يوم الراتب حتى اليوم السابق للراتب التالي. معرّفها "YYYY-MM" بشهر بدايتها.
import { parseISO, clampedDate, addDays, addMonths } from './dates.js';

export function cycleIdFor(iso, salaryDay) {
  const { y, m, d } = parseISO(iso);
  const startThisMonth = parseISO(clampedDate(y, m, salaryDay)).d;
  if (d >= startThisMonth) return `${y}-${String(m).padStart(2, '0')}`;
  const prev = addMonths(`${y}-${String(m).padStart(2, '0')}-01`, -1);
  return prev.slice(0, 7);
}

export function cycleStart(cycleId, salaryDay) {
  const [y, m] = cycleId.split('-').map(Number);
  return clampedDate(y, m, salaryDay);
}

export function shiftCycle(cycleId, n) {
  return addMonths(`${cycleId}-01`, n).slice(0, 7);
}

export function cycleRange(cycleId, salaryDay) {
  return {
    id: cycleId,
    start: cycleStart(cycleId, salaryDay),
    end: addDays(cycleStart(shiftCycle(cycleId, 1), salaryDay), -1),
  };
}

/** الدورات من دورة التاريخ المعطى ولعدد n. */
export function cyclesFrom(iso, salaryDay, n) {
  const first = cycleIdFor(iso, salaryDay);
  return Array.from({ length: n }, (_, i) => cycleRange(shiftCycle(first, i), salaryDay));
}
