// تنسيق العرض: مبالغ، تواريخ، تسميات، وحلقة الإيقاع.
import { parseISO } from '../logic/dates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

const num = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
export const fmtNum = (n) => num.format(n ?? 0);
export const money = (n) => (n == null ? null : `${num.format(n)}<small>ر.س</small>`);

const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const toDate = (iso) => { const { y, m, d } = parseISO(iso); return new Date(Date.UTC(y, m - 1, d)); };
export const fmtDate = (iso) => dateFmt.format(toDate(iso));
export const fmtMonth = (iso) => monthFmt.format(toDate(iso));

export const KIND_LABELS = {
  envelope: 'مظروف', bill: 'فاتورة', installment: 'قسط', periodic: 'دوري', one_time: 'مرة واحدة', recovery: 'تعويض',
};
export const PRIORITY_LABELS = { critical: 'حرج', high: 'عالٍ', medium: 'متوسط', low: 'منخفض' };
export const STATUS_LABELS = { active: 'نشط', to_verify: 'للتأكد', paused: 'موقوف', ended: 'منتهٍ' };
export const DEBT_TYPES = { personal: 'شخصي', bank: 'بنكي', settlement: 'تسوية', government: 'حكومي' };
export const DEBT_STATUS = { active: 'نشط', to_verify: 'للتأكد', paid: 'مسدد' };
export const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
export const GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const INTERVALS = [
  [3, 'كل 3 أشهر'], [6, 'كل 6 أشهر'], [12, 'سنوي'], [24, 'كل سنتين'], [36, 'كل 3 سنوات'], [60, 'كل 5 سنوات'],
];

export function intervalLabel(n) {
  if (n === 1) return 'شهري';
  const known = INTERVALS.find(([v]) => v === n);
  if (known) return known[1];
  return n ? `كل ${n} شهراً` : 'التكرار غير محدد';
}

/** هل يحتاج البند إلى تأكيد قبل أن يدخل الحساب بدقة؟ */
export function needsVerify(item) {
  if (item.status === 'to_verify') return true;
  if (item.amount == null) return true;
  const hijriOk = item.calendar === 'hijri' && item.hijriMonth;
  if ((item.kind === 'periodic' || item.kind === 'one_time') && !item.nextDue && !hijriOk) return true;
  if (item.kind === 'periodic' && !item.intervalMonths && !hijriOk) return true;
  return false;
}

/** سطر الوصف تحت اسم البند. */
export function itemMeta(item) {
  const parts = [];
  if (item.calendar === 'hijri' && item.hijriMonth) {
    parts.push(`سنوي هجري، ${item.hijriDay ?? 1} ${HIJRI_MONTHS[item.hijriMonth - 1]}`);
  } else if (item.kind === 'one_time') {
    parts.push('مرة واحدة');
  } else {
    let s = intervalLabel(item.intervalMonths);
    if (item.intervalMonths === 1 && item.dueDay) s += `، يوم ${item.dueDay}`;
    parts.push(s);
  }
  if (item.amountMode === 'variable') parts.push('مبلغ متغير');
  if (item.nextDue === 'now') parts.push('<span class="late">متأخر</span>');
  else if (item.nextDue && item.intervalMonths !== 1) parts.push(`القادم ${fmtDate(item.nextDue)}`);
  if (item.endDate && item.kind === 'installment') parts.push(`حتى ${fmtMonth(item.endDate)}`);
  if (item.endDate && item.kind === 'recovery') parts.push(`حتى ${fmtDate(item.endDate)}`);
  if (item.status === 'paused') parts.push('<span class="flag">موقوف</span>');
  return parts.join('، ');
}

/** حلقة الإيقاع: القوس = 1 ÷ عدد أشهر الدورة. شهري = حلقة كاملة، مرة واحدة = نقطة. */
export function ring(item) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const interval = item.calendar === 'hijri' ? 12 : item.intervalMonths;
  const account = esc(item.account);
  const label = item.kind === 'one_time' ? 'مرة واحدة' : intervalLabel(interval);
  if (item.kind === 'one_time') {
    return `<svg class="ring" viewBox="0 0 26 26" data-account="${account}" role="img" aria-label="${label}"><circle class="track" cx="13" cy="13" r="${r}"/><circle class="dot" cx="13" cy="13" r="4"/></svg>`;
  }
  if (!interval) {
    return `<svg class="ring unknown" viewBox="0 0 26 26" data-account="${account}" role="img" aria-label="${label}"><circle class="track" cx="13" cy="13" r="${r}"/></svg>`;
  }
  const len = Math.max(c / interval, 2.2);
  return `<svg class="ring" viewBox="0 0 26 26" data-account="${account}" role="img" aria-label="${label}"><circle class="track" cx="13" cy="13" r="${r}"/><circle class="arc" cx="13" cy="13" r="${r}" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}"/></svg>`;
}
