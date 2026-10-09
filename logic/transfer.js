// التحويل الشهري المطلوب لحساب الالتزامات (SPEC §6.3–6.5). دوال نقية.
import { generateOccurrences, estimateAmount } from './occurrences.js';
import { round2, roundUpTo, sum } from './money.js';

const LIVE = new Set(['active', 'to_verify']);

export const totalIncome = (settings) => sum((settings.incomes ?? []).map((i) => i.amount));

/** المساهمة الشهرية "الدائمة" لبند واحد في حساب الالتزامات. */
export function monthlyShare(item, actuals) {
  if (!LIVE.has(item.status) || item.account !== 'obligations') return 0;
  if (item.kind === 'recovery' || item.kind === 'one_time') return 0; // مؤقتة، تظهر في المحاكاة فقط
  const amount = estimateAmount(item, actuals) ?? 0;
  const interval = item.calendar === 'hijri' ? 12 : item.intervalMonths;
  if (!interval) return 0;
  return amount / interval;
}

/** حالة صندوق الإغراق لبند دوري (SPEC §6.3). */
export function sinkingStatus(item, nextDueCycleIndex) {
  const interval = item.calendar === 'hijri' ? 12 : item.intervalMonths;
  const amount = item.amount ?? 0;
  const balance = item.sinkingBalance ?? 0;
  const monthly = interval ? round2(amount / interval) : 0;
  const monthsUntilDue = nextDueCycleIndex == null ? null : Math.max(1, nextDueCycleIndex + 1);
  const missing = Math.max(0, amount - balance);
  return {
    monthly,
    balance,
    readiness: amount ? Math.min(1, balance / amount) : 0,
    monthsUntilDue,
    catchUp: monthsUntilDue ? round2(Math.max(monthly, missing / monthsUntilDue)) : monthly,
  };
}

/**
 * @param {object} p
 * @param {object[]} p.items
 * @param {object}   p.settings
 * @param {string}   p.fromISO        تاريخ اليوم
 * @param {number}   [p.openingBalance] رصيد حساب الالتزامات الحالي (B0)
 * @param {Set}      [p.paidKeys]     مفاتيح الاستحقاقات المسددة (تُستبعد)
 * @param {object}   [p.history]      itemId → [مبالغ فعلية]
 * @param {object[]} [p.extraOccurrences] متأخرات منقولة من الدورة السابقة (تُضاف للدورة الأولى)
 * @param {boolean}  [p.firstTransferDone] حُوِّل للدورة الأولى فعلاً (الرصيد يشمله)، فالموصى به يبدأ من الثانية
 */
export function computeTransfer({
  items, settings, fromISO, openingBalance = 0, paidKeys = new Set(), history = {},
  extraOccurrences = [], firstTransferDone = false,
}) {
  const months = settings.forecastMonths ?? 12;
  const buffer = settings.obligationsBuffer ?? 0;
  const extra = settings.debtExtraMonthly ?? 0;
  const { occurrences, unscheduled, cycles } = generateOccurrences(items, fromISO, months, {
    salaryDay: settings.salaryDay, history, skipKeys: paidKeys,
  });

  const obligations = [
    ...extraOccurrences.map((o) => ({ ...o, cycleId: cycles[0].id })),
    ...occurrences.filter((o) => o.account === 'obligations' && !paidKeys.has(o.key)),
  ];
  const incomplete = new Set(obligations.filter((o) => o.expectedAmount == null).map((o) => o.itemId));

  const bonus = settings.bonus;
  const bonusDeposit = bonus?.month && bonus.amount
    ? round2(bonus.amount * (bonus.split?.obligations ?? 0) / 100) : 0;

  const perCycle = cycles.map((c) => {
    const occ = obligations.filter((o) => o.cycleId === c.id);
    const deposit = bonusDeposit && Number(c.id.slice(5)) === bonus.month ? bonusDeposit : 0;
    const outflow = round2(sum(occ.map((o) => o.expectedAmount)) + extra);
    return { ...c, occurrences: occ, outflow, deposit, net: round2(outflow - deposit) };
  });

  // minimalTransfer = max_k ((Σ_{i≤k} D_i) + buffer − B0) / k
  // وإن حُوِّل للدورة الأولى فعلاً، فعدد التحويلات القادمة حتى الدورة k هو k − 1
  const offset = firstTransferDone ? 1 : 0;
  let cum = 0;
  let minimal = 0;
  perCycle.forEach((c, i) => {
    cum += c.net;
    const k = i + 1 - offset;
    if (k > 0) minimal = Math.max(minimal, (cum + buffer - openingBalance) / k);
  });
  minimal = round2(minimal);

  const steady = round2(sum(items.map((it) => monthlyShare(it, history[it.id]))) + extra);
  const recommended = roundUpTo(Math.max(minimal, steady));

  // منحنى الرصيد المتوقع
  let bal = openingBalance;
  for (const [i, c] of perCycle.entries()) {
    bal = round2(bal + (i < offset ? 0 : recommended) - c.net);
    c.balanceAfter = bal;
    c.belowBuffer = bal < buffer;
  }

  const income = totalIncome(settings);
  const ratioTarget = round2(income * (settings.split?.obligations ?? 0) / 100);

  return {
    perCycle,
    minimalTransfer: minimal,
    steadyState: steady,
    recommended,
    deficit: minimal > steady,
    firstTransferDone,
    openingBalance,
    lowest: perCycle.reduce((lo, c) => (lo == null || c.balanceAfter < lo.balanceAfter ? c : lo), null),
    income,
    ratioTarget,
    ratioDiff: round2(ratioTarget - recommended),
    actualPct: income ? round2((recommended / income) * 100) : null,
    incompleteItemIds: [...incomplete],
    unscheduled,
  };
}

/** ما يحتاجه الحساب الاستهلاكي: مجموع المظاريف مقابل نسبته. */
export function consumptionCheck(items, settings) {
  const envelopes = sum(items.filter((i) => i.kind === 'envelope' && LIVE.has(i.status)).map((i) => i.amount));
  const target = round2(totalIncome(settings) * (settings.split?.consumption ?? 0) / 100);
  return { envelopes, target, diff: round2(target - envelopes) };
}
