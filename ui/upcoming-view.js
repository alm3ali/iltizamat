// شاشة "القادم": منحنى الرصيد، والخط الزمني لـ12 دورة، وصناديق الإغراق (SPEC §7.3).
import { esc, money, fmtNum, fmtDate } from './format.js';
import { upcomingModel } from '../logic/index.js';

const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', timeZone: 'UTC' });
const monthYearFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const d = (iso) => { const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
const monthOf = (iso) => monthFmt.format(d(iso));
const monthYear = (iso) => monthYearFmt.format(d(iso));

/** "بعد N أشهر" بصيغة عربية سليمة. */
export function inMonths(n) {
  if (n == null) return 'موعده غير معروف';
  if (n <= 0) return 'في هذه الدورة';
  if (n === 1) return 'بعد شهر';
  if (n === 2) return 'بعد شهرين';
  if (n <= 10) return `بعد ${n} أشهر`;
  return `بعد ${n} شهراً`;
}

function fundRing(readiness) {
  const r = 10, c = 2 * Math.PI * r;
  const len = Math.max(c * Math.min(1, readiness), readiness > 0 ? 2.2 : 0);
  return `<svg class="ring" viewBox="0 0 26 26" data-account="obligations" role="img" aria-label="جاهز ${Math.round(readiness * 100)}٪">
    <circle class="track" cx="13" cy="13" r="${r}"/>${len ? `<circle class="arc" cx="13" cy="13" r="${r}" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}"/>` : ''}</svg>`;
}

const eventIcon = (cls) => `<svg class="event-dot ${cls}" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="5"/></svg>`;

// ---------- المنحنى ----------

/** منحنى الرصيد المتوقع: الزمن يجري من اليمين لليسار، والنقاط تحت الحد الأدنى بلون تحذيري. */
function curve(m, buffer) {
  const pts = [
    { label: 'الآن', value: m.t.openingBalance, start: m.cycle.start, now: true },
    ...m.timeline.map((c) => ({ label: `نهاية دورة ${monthOf(c.start)}`, value: c.balanceAfter, start: c.start })),
  ];
  const W = 340, H = 168, padX = 14, padTop = 16, padBottom = 26;
  const vals = pts.map((p) => p.value);
  let lo = Math.min(0, buffer, ...vals);
  let hi = Math.max(buffer, ...vals);
  if (hi - lo < 1) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const step = (W - padX * 2) / (pts.length - 1);
  const x = (i) => W - padX - i * step;
  const y = (v) => padTop + (hi - v) / (hi - lo) * (H - padTop - padBottom);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const base = y(Math.max(lo, Math.min(hi, 0)));
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;

  const refs = [];
  if (lo < 0) refs.push(`<line class="ref zero" x1="${padX}" x2="${W - padX}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`);
  if (buffer > 0) {
    refs.push(`<line class="ref buffer" x1="${padX}" x2="${W - padX}" y1="${y(buffer).toFixed(1)}" y2="${y(buffer).toFixed(1)}"/>
      <text class="ref-label" x="${padX}" y="${(y(buffer) - 4).toFixed(1)}" text-anchor="start">الحد الأدنى ${fmtNum(buffer)}</text>`);
  }
  const labels = [0, 4, 8, 12].filter((i) => i < pts.length)
    .map((i) => `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'end' : i === pts.length - 1 ? 'start' : 'middle'}">${i === 0 ? 'الآن' : monthOf(pts[i].start)}</text>`);

  const lowIdx = vals.indexOf(Math.min(...vals));
  const dots = pts.map((p, i) => {
    const below = p.value < buffer;
    const show = below || i === lowIdx || i === 0;
    return show ? `<circle class="pt${below ? ' below' : ''}" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"/>` : '';
  }).join('');
  const hits = pts.map((p, i) => `<rect class="hit" data-action="curve-pt" data-i="${i}"
      data-text="${esc(`${p.label}: ${fmtNum(p.value)} ر.س${p.value < buffer ? ' — تحت الحد الأدنى' : ''}`)}"
      x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}"/>`).join('');
  const low = pts[lowIdx];

  return `<figure class="curve">
    <figcaption class="curve-head"><span>رصيد حساب الالتزامات المتوقع</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="منحنى الرصيد المتوقع لـ${pts.length - 1} دورة، أدناه ${fmtNum(low.value)} ر.س">
      ${refs.join('')}
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      <line class="cursor" x1="0" x2="0" y1="${padTop}" y2="${H - padBottom}" hidden/>
      ${dots}${labels.join('')}${hits}
    </svg>
    <p class="curve-readout" aria-live="polite">أدنى نقطة: ${esc(low.label)}، ${fmtNum(low.value)} ر.س</p>
  </figure>`;
}

/** تفاعل المنحنى: لمس نقطة يعرض قيمتها ويحرّك المؤشر. */
export function showCurvePoint(el) {
  const fig = el.closest('.curve');
  fig.querySelector('.curve-readout').textContent = el.dataset.text;
  const cur = fig.querySelector('.cursor');
  const cx = Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2;
  cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.removeAttribute('hidden');
}

// ---------- الخط الزمني ----------

function eventRow(e) {
  if (e.type === 'installment_end') {
    return `<div class="row event">${eventIcon('freed')}<span class="row-main"><span class="row-name">آخر قسط: ${esc(e.item.name)}</span>
      <span class="row-meta">سيتحرر ${fmtNum(e.amount)} ر.س شهرياً بعد ${fmtDate(e.lastDue)}</span></span></div>`;
  }
  if (e.type === 'debt_close') {
    return `<div class="row event">${eventIcon('debt')}<span class="row-main"><span class="row-name">إغلاق متوقع: ${esc(e.debt?.name ?? 'دين')}</span>
      <span class="row-meta">بالمبلغ الإضافي الشهري للديون</span></span></div>`;
  }
  return `<div class="row event">${eventIcon('bonus')}<span class="row-main"><span class="row-name">شهر المكافأة</span>
    <span class="row-meta">حصة الالتزامات منها تدخل الحساب</span></span><span class="amount plus">+${money(e.amount)}</span></div>`;
}

function periodicRow(p) {
  const name = esc(p.item?.name ?? 'بند');
  let meta;
  if (p.fund) meta = `جاهز ${Math.round(p.fund.readiness * 100)}٪، ${p.overdue ? '<span class="late">متأخر</span>' : `يستحق ${fmtDate(p.dueDate)}`}`;
  else if (p.repeat) meta = `يستحق ${fmtDate(p.dueDate)}، صندوقه يبدأ بعد السداد السابق`;
  else meta = `يستحق ${fmtDate(p.dueDate)}`;
  return `<div class="row">${p.fund ? fundRing(p.fund.readiness) : fundRing(0)}
    <span class="row-main"><span class="row-name">${name}</span><span class="row-meta">${meta}</span></span>
    ${p.amount == null ? '<span class="amount missing">بلا مبلغ</span>' : `<span class="amount">${money(p.amount)}</span>`}</div>`;
}

function allRow(o, byId) {
  const it = byId.get(o.itemId);
  return `<div class="row mini"><span class="row-main"><span class="row-name">${esc(it?.name ?? 'بند')}</span>
    <span class="row-meta">${o.carriedFrom ? '<span class="late">متأخر من الدورة السابقة</span>' : fmtDate(o.dueDate)}</span></span>
    ${o.expectedAmount == null ? '<span class="amount missing">بلا مبلغ</span>' : `<span class="amount">${money(o.expectedAmount)}</span>`}</div>`;
}

function cycleBlock(c, byId, buffer) {
  const title = c.index === 0 ? 'هذه الدورة' : `دورة ${monthYear(c.start)}`;
  const outflow = c.occurrences.length || c.outflow ? `${fmtNum(c.outflow)} ر.س` : '';
  const below = c.balanceAfter < buffer;
  const body = [
    ...c.events.map(eventRow),
    ...c.periodic.map(periodicRow),
    c.occurrences.length ? `<details class="all-occ"><summary>كل الاستحقاقات (${c.occurrences.length})</summary>
      ${c.occurrences.map((o) => allRow(o, byId)).join('')}</details>` : '',
    `<div class="row balance-row${below ? ' below' : ''}"><span class="row-main"><span class="row-meta">الرصيد المتوقع في نهايتها${below ? '، تحت الحد الأدنى' : ''}</span></span>
      <span class="amount">${money(c.balanceAfter)}</span></div>`,
  ].join('');
  return `<section class="section">
    <div class="section-head"><h2>${title}</h2><span class="total">${outflow}</span></div>
    <div class="group">${body}</div>
  </section>`;
}

function fundsSection(m) {
  if (!m.funds.length) return '';
  const rows = m.funds.map((f) => {
    const need = f.catchUp > f.monthly ? `، يحتاج ${fmtNum(Math.ceil(f.catchUp))} شهرياً للّحاق` : '';
    return `<div class="row">${fundRing(f.readiness)}
      <span class="row-main"><span class="row-name">${esc(f.item.name)}</span>
      <span class="row-meta">جاهز ${Math.round(f.readiness * 100)}٪، يستحق ${inMonths(f.cycleIndex)}${need}</span></span>
      <span class="amount">${fmtNum(f.balance)}<small>من ${fmtNum(f.item.amount)}</small></span></div>`;
  }).join('');
  return `<section class="section">
    <div class="section-head"><h2>صناديق الإغراق</h2><span class="total">${fmtNum(m.fundsTotal)} ر.س محجوزة</span></div>
    <div class="group">${rows}</div>
    <p class="note">تزيد كل صناديق البنود الدورية بمساهمتها عند بدء كل دورة، وتُصفَّر عند السداد. هي حصص افتراضية من رصيد حساب الالتزامات.</p>
  </section>`;
}

function freedCards(m) {
  return m.freed.map((it) => `<div class="freed">
    <p><strong>انتهى قسط ${esc(it.name)}.</strong> تحرّر ${fmtNum(it.amount)} ر.س شهرياً. توجّهه لسداد الديون؟</p>
    <div class="freed-actions">
      <button class="btn primary" type="button" data-action="freed-debt" data-id="${esc(it.id)}">نعم، أضفه للديون</button>
      <button class="btn" type="button" data-action="freed-keep" data-id="${esc(it.id)}">لا</button>
    </div></div>`).join('');
}

export function renderUpcoming(state, todayISO) {
  if (!state.items.length) {
    return `<div class="empty"><h2>لا شيء للتنبؤ به بعد</h2><p>أضف فواتيرك وأقساطك ودوريّك من "البنود" ليظهر هنا ما سيأتي.</p>
      <button class="btn" type="button" data-tab-go="items">اذهب إلى البنود</button></div>`;
  }
  const { items, debts, settings, occurrences: stored, cycles } = state;
  const m = upcomingModel({ items, debts, settings, stored, cycles, todayISO });
  const byId = new Map(items.map((i) => [i.id, i]));
  const buffer = settings.obligationsBuffer ?? 0;
  const t = m.t;

  const balanceLine = m.bal.known
    ? `الرصيد الآن نحو ${fmtNum(m.bal.balance)} ر.س.`
    : 'رصيد الحساب غير مُدخل، فالمنحنى يبدأ من الصفر. أدخله في طقس الراتب ليكون أدق.';
  const summary = `<div class="summary">
    <p>${m.record ? 'التحويل الموصى به من الدورة القادمة' : 'التحويل الموصى به لحساب الالتزامات'}</p>
    <span class="big">${fmtNum(t.recommended)} <small>ر.س</small></span>
    <p>${balanceLine}</p>
  </div>
  ${t.deficit ? `<p class="warn">استحقاقات كبيرة قريبة تتجاوز ما في الحساب، فالموصى به أعلى من المستوى الدائم (${fmtNum(Math.ceil(t.steadyState))} ر.س) حتى يُغطّى العجز، ثم ينزل.</p>` : ''}
  ${t.incompleteItemIds.length ? `<p class="warn">${t.incompleteItemIds.length} بنود بلا مبلغ لم تدخل الحساب، فالأرقام الفعلية أعلى.</p>` : ''}`;

  return `${freedCards(m)}${summary}
    ${curve(m, buffer)}
    ${m.timeline.map((c) => cycleBlock(c, byId, buffer)).join('')}
    ${fundsSection(m)}`;
}
