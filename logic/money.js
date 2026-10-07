export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** تقريب للأعلى لأقرب خطوة (50 ريال افتراضياً). */
export function roundUpTo(x, step = 50) {
  if (x <= 0) return 0;
  return Math.ceil(round2(x) / step) * step;
}

export const sum = (xs) => round2(xs.reduce((a, b) => a + (b ?? 0), 0));
