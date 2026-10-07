// تواريخ بصيغة ISO "YYYY-MM-DD" فقط، وكل الحساب بالتوقيت العالمي لتجنب فروق المناطق الزمنية.

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** يوم داخل الشهر مع القص لآخر يوم (31 في فبراير ← 28/29). */
export function clampedDate(y, m, day) {
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

/** يضيف أشهراً مع الحفاظ على اليوم الأصلي قدر الإمكان. */
export function addMonths(iso, n, preferredDay) {
  const { y, m, d } = parseISO(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return clampedDate(ny, nm, preferredDay ?? d);
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diffDays(a, b) {
  const pa = parseISO(a), pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ---- الهجري (أم القرى) ----

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
});

export function hijriParts(iso) {
  const { y, m, d } = parseISO(iso);
  const parts = hijriFmt.formatToParts(new Date(Date.UTC(y, m - 1, d)));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year') || get('relatedYear'), m: get('month'), d: get('day') };
}

/** كل التواريخ الميلادية ضمن [from, to] التي توافق شهراً ويوماً هجريين. */
export function findHijriDates(hMonth, hDay, fromISO, toISO_) {
  const out = [];
  let lastYear = null;
  for (let cur = fromISO; cur <= toISO_; cur = addDays(cur, 1)) {
    const h = hijriParts(cur);
    if (h.m !== hMonth || h.y === lastYear) continue;
    // نأخذ اليوم المطلوب أو آخر يوم متاح في الشهر إن كان أقصر
    if (h.d === hDay || (h.d < hDay && hijriParts(addDays(cur, 1)).m !== hMonth)) {
      out.push(cur);
      lastYear = h.y;
    }
  }
  return out;
}

const hijriLabelFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

export function hijriLabel(iso) {
  const { y, m, d } = parseISO(iso);
  return hijriLabelFmt.format(new Date(Date.UTC(y, m - 1, d)));
}
