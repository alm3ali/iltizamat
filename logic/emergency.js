// معالجة الطارئ بخياراته الثلاثة (SPEC §8). يعيد السجلات الجديدة دون أي تخزين.
import { round2 } from './money.js';
import { cycleIdFor, cycleStart, cycleRange, shiftCycle } from './cycles.js';

export const EMERGENCY_MODES = ['pay_now', 'pay_recover', 'defer_debt'];

/**
 * @param {object} e  { name, amount, date, mode, months? }
 * @param {object} ctx { salaryDay, newId: () => string, nowISO, cycleId?, transferDone? }
 *   cycleId: الدورة الحالية إن بدأت براتب مبكر (وإلا تُحسب من التاريخ)
 *   transferDone: هل حُوِّل لهذه الدورة؟ إن لم يُحوَّل بعد، يبدأ التعويض من الدورة نفسها
 *   لأن تحويلها القادم هو أول فرصة للتعويض.
 * @returns {{ items: object[], occurrences: object[], payments: object[], debts: object[] }}
 */
export function planEmergency(e, { salaryDay, newId, nowISO, cycleId: current, transferDone = true }) {
  if (!(e.amount > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  if (!EMERGENCY_MODES.includes(e.mode)) throw new Error(`خيار غير معروف: ${e.mode}`);
  const out = { items: [], occurrences: [], payments: [], debts: [] };
  const stamp = { createdAt: nowISO, updatedAt: nowISO };

  if (e.mode === 'defer_debt') {
    out.debts.push({
      id: newId(), name: e.name, type: 'personal', originalAmount: e.amount, balance: e.amount,
      installmentItemId: null, priority: 'high', status: 'active', note: `طارئ بتاريخ ${e.date}`, ...stamp,
    });
    return out;
  }

  // يُدفع الآن: بند مرة واحدة + استحقاق مسدد + دفعة
  const itemId = newId();
  const byDate = cycleIdFor(e.date, salaryDay);
  const cycleId = current && shiftCycle(byDate, 1) === current ? current : byDate;
  out.items.push({
    id: itemId, name: e.name, kind: 'one_time', account: 'obligations', amount: e.amount,
    amountMode: 'fixed', intervalMonths: null, calendar: 'gregorian', dueDay: null, nextDue: e.date,
    endDate: e.date, remainingCount: 1, priority: 'high', status: 'ended', note: 'طارئ', emergency: true, ...stamp,
  });
  const occId = newId();
  out.occurrences.push({
    id: occId, itemId, cycleId, dueDate: e.date, expectedAmount: e.amount, actualAmount: e.amount,
    status: 'paid', paidAt: nowISO, note: '',
  });
  out.payments.push({
    id: newId(), date: e.date, amount: e.amount, account: 'obligations', occurrenceId: occId,
    debtId: null, kind: 'bill', note: e.name,
  });

  if (e.mode === 'pay_recover') {
    const n = Math.max(1, Math.round(e.months ?? 1));
    const first = transferDone ? 1 : 0;
    // تاريخ انتهاء ثابت بدل عدّاد، حتى يبقى التنبؤ صحيحاً من أي تاريخ لاحق
    out.items.push({
      id: newId(), name: `تعويض: ${e.name}`, kind: 'recovery', account: 'obligations',
      amount: round2(e.amount / n), amountMode: 'fixed', intervalMonths: 1, calendar: 'gregorian',
      dueDay: null, nextDue: cycleStart(shiftCycle(cycleId, first), salaryDay),
      endDate: cycleRange(shiftCycle(cycleId, first + n - 1), salaryDay).end,
      remainingCount: null, priority: 'high', status: 'active', note: `يعوّض ${e.amount} على ${n} أشهر`,
      sourceItemId: itemId, ...stamp,
    });
  }
  return out;
}
