// خطة الديون: دين واحد مستهدف في كل مرة (SPEC §6.7). دوال نقية.
import { round2 } from './money.js';

export const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** الديون المرشحة مرتبة: الأولوية ثم الرصيد الأصغر. المستهدف = الأول. */
export function rankDebts(debts) {
  return debts
    .filter((d) => d.status === 'active' && !d.installmentItemId && d.balance > 0)
    .sort((a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || a.balance - b.balance);
}

export const targetDebt = (debts) => rankDebts(debts)[0] ?? null;

/** يطبّق دفعة على دين ويعيد نسخة جديدة. */
export function applyDebtPayment(debt, amount) {
  const balance = round2(Math.max(0, debt.balance - amount));
  return { ...debt, balance, status: balance === 0 ? 'paid' : debt.status };
}

/**
 * توقع إغلاق الديون بمبلغ إضافي شهري ثابت (بلا فوائد، للديون الشخصية).
 * @returns {{ id, closesInMonth }[]}  رقم الشهر (1 = الشهر القادم)، أو null إن تجاوز الحد.
 */
export function payoffProjection(debts, extraMonthly, maxMonths = 120) {
  const queue = rankDebts(debts).map((d) => ({ id: d.id, left: d.balance }));
  const out = [];
  if (!extraMonthly || extraMonthly <= 0) return queue.map((d) => ({ id: d.id, closesInMonth: null }));
  let month = 0;
  let carry = 0;
  while (queue.length && month < maxMonths) {
    month += 1;
    let budget = extraMonthly + carry;
    carry = 0;
    while (queue.length && budget > 0) {
      const d = queue[0];
      const pay = Math.min(budget, d.left);
      d.left = round2(d.left - pay);
      budget = round2(budget - pay);
      if (d.left === 0) { out.push({ id: d.id, closesInMonth: month }); queue.shift(); }
    }
  }
  return [...out, ...queue.map((d) => ({ id: d.id, closesInMonth: null }))];
}
