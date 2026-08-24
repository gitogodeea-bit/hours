/* Hours — clock in/out timesheet. All data lives in this phone's localStorage. */
'use strict';

const KEY = 'hours.v1';

/* Fresh objects, built from plain literals every time.
   Deliberately NOT structuredClone(): it is missing below Chromium 98, and since this is
   the first thing that runs it took the whole script down with it on Samsung Internet. */
function defaultSettings() {
  return {
    rate: 0, currency: '£', breakMin: 0, weekStart: 1,
    yourName: '', yourContact: '', billTo: '', payDetails: '',
    invoicePrefix: 'INV-', nextInvoiceNo: 1
  };
}

function defaultState() {
  return {
    v: 1,
    settings: defaultSettings(),
    active: null,        // { startISO } while clocked in
    // { id, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', breakMin, rate, note }
    // once billed a shift also carries invoiceNo, and once settled paidOn:'YYYY-MM-DD'
    shifts: [],
    // { no, issued, from, to, shiftIds, mins, total, and a snapshot of the invoice details }
    invoices: []
  };
}

let state = load();
let ticker = null;
let installEvent = null;
let editingId = null;
let period = 'month';

/* ───────────────────────── storage ───────────────────────── */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return {
      v: 1,
      settings: Object.assign(defaultSettings(), data.settings || {}),
      active: data.active || null,
      shifts: Array.isArray(data.shifts) ? data.shifts : [],
      invoices: Array.isArray(data.invoices) ? data.invoices : []
    };
  } catch (err) {
    console.error('Could not read saved data', err);
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    toast('Could not save — phone storage is full?');
    console.error(err);
  }
}

/* ───────────────────────── helpers ───────────────────────── */

const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time (never UTC — that shifts the date after 11pm). */
function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function toMin(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Paid minutes for a shift, wrapping past midnight and taking the break off. */
function shiftMinutes(s) {
  let d = toMin(s.end) - toMin(s.start);
  if (d < 0) d += 1440;
  d -= (s.breakMin || 0);
  return Math.max(0, d);
}

const shiftPay = (s) => (shiftMinutes(s) / 60) * (s.rate || 0);

function fmtHM(mins) {
  const m = Math.max(0, Math.round(mins));
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

function money(n) {
  const sym = state.settings.currency || '£';
  const v = Math.abs(n).toFixed(2);
  return (n < 0 ? '-' : '') + sym + v;
}

const fmtDay   = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const fmtDow   = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d) {
  const ws = Number(state.settings.weekStart);
  return addDays(d, -(((d.getDay() - ws) + 7) % 7));
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Shifts falling inside an inclusive ISO date range, oldest first. */
function shiftsBetween(from, to) {
  return state.shifts
    .filter((s) => s.date >= from && s.date <= to)
    .sort((a, b) => (a.date === b.date ? toMin(a.start) - toMin(b.start) : a.date < b.date ? -1 : 1));
}

/* ── invoicing state ──
   A shift is "billed" once it carries an invoiceNo, and "settled" once it has a paidOn
   date. Nothing is ever deleted to clear the slate - that is the whole point. */

const isBilled  = (s) => !!s.invoiceNo;
const isSettled = (s) => !!s.paidOn;

/** Everything worked but not yet paid for, oldest first. */
function outstanding() {
  return state.shifts
    .filter((s) => !isSettled(s))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const sumMins = (list) => list.reduce((a, s) => a + shiftMinutes(s), 0);
const sumPay  = (list) => list.reduce((a, s) => a + shiftPay(s), 0);

/** Live minutes on the shift in progress, if any. */
function activeMinutes() {
  if (!state.active) return 0;
  return Math.max(0, (Date.now() - new Date(state.active.startISO).getTime()) / 60000);
}

/* ───────────────────────── navigation ───────────────────────── */

const TITLES = { now: 'Now', shifts: 'Shifts', report: 'Report', settings: 'Settings' };

function updateTopNote() {
  $('topNote').textContent = state.settings.rate > 0 ? '' : 'Set your rate →';
}

function showView(name) {
  for (const el of document.querySelectorAll('.view')) el.hidden = (el.id !== 'view-' + name);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-on', t.dataset.view === name);
  $('viewTitle').textContent = TITLES[name];
  updateTopNote();
  window.scrollTo(0, 0);
  if (name === 'shifts') renderShifts();
  if (name === 'report') renderReport();
  if (name === 'settings') renderSettings();
  if (name === 'now') renderNow();
}

for (const t of document.querySelectorAll('.tab')) {
  t.addEventListener('click', () => showView(t.dataset.view));
}

/* ───────────────────────── the Now screen ───────────────────────── */

function renderNow() {
  const on = !!state.active;
  const btn = $('clockBtn');

  btn.classList.toggle('is-on', on);
  $('clockBtnLabel').textContent = on ? 'Clock out' : 'Clock in';
  $('clockState').textContent = on ? 'Clocked in' : 'Not clocked in';

  if (on) {
    const started = new Date(state.active.startISO);
    const sameDay = isoDate(started) === isoDate(new Date());
    $('clockSince').textContent = `Since ${hhmm(started)}${sameDay ? '' : ' on ' + fmtDay.format(started)}`;
  } else {
    $('clockSince').textContent = 'Tap to start your shift';
  }

  const rate = state.settings.rate;
  $('clockRate').textContent = rate > 0
    ? `Paid at ${money(rate)} an hour`
    : 'No hourly rate set yet — add one in Settings';

  tickElapsed();
  renderTotals();
  renderStale();

  clearInterval(ticker);
  if (on) ticker = setInterval(() => { tickElapsed(); renderTotals(); renderStale(); }, 1000);
}

function tickElapsed() {
  if (!state.active) { $('clockElapsed').textContent = '00:00:00'; return; }
  const secs = Math.max(0, Math.floor((Date.now() - new Date(state.active.startISO).getTime()) / 1000));
  $('clockElapsed').textContent =
    `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
}

function renderTotals() {
  const now = new Date();
  const today = isoDate(now);
  const wkFrom = isoDate(startOfWeek(now));
  const wkTo = isoDate(addDays(startOfWeek(now), 6));
  const mFrom = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const mTo = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const live = activeMinutes();
  const liveDate = state.active ? isoDate(new Date(state.active.startISO)) : null;
  const inRange = (from, to) => (liveDate && liveDate >= from && liveDate <= to ? live : 0);

  const sum = (from, to) => {
    const list = shiftsBetween(from, to);
    const mins = list.reduce((a, s) => a + shiftMinutes(s), 0) + inRange(from, to);
    const pay = list.reduce((a, s) => a + shiftPay(s), 0) + (inRange(from, to) / 60) * state.settings.rate;
    return { mins, pay };
  };

  const t = sum(today, today), w = sum(wkFrom, wkTo), m = sum(mFrom, mTo);
  $('totalToday').textContent = fmtHM(t.mins);  $('payToday').textContent = money(t.pay);
  $('totalWeek').textContent  = fmtHM(w.mins);  $('payWeek').textContent  = money(w.pay);
  $('totalMonth').textContent = fmtHM(m.mins);  $('payMonth').textContent = money(m.pay);

  renderOwed();
}

/** The running balance - what you have worked and not been paid for, all time. */
function renderOwed() {
  const owed = outstanding();
  const strip = $('owedStrip');

  // nothing recorded yet: no balance to talk about
  if (!state.shifts.length) { strip.hidden = true; return; }
  strip.hidden = false;

  // say so explicitly rather than silently vanishing - that is the whole reassurance
  if (!owed.length) {
    strip.classList.add('is-clear');
    $('owedLabel').textContent = 'Nothing outstanding';
    $('owedValue').textContent = 'All settled';
    $('owedSub').textContent =
      `${state.shifts.length} shift${state.shifts.length === 1 ? '' : 's'} recorded, all paid for`;
    return;
  }

  strip.classList.remove('is-clear');
  $('owedLabel').textContent = 'Still owed to you';

  const billed = owed.filter(isBilled).length;
  const bits = [`${fmtHM(sumMins(owed))} over ${owed.length} shift${owed.length === 1 ? '' : 's'}`];
  bits.push(billed ? `${billed} already invoiced` : 'none invoiced yet');
  bits.push(`since ${fmtDay.format(fromISO(owed[0].date))}`);

  $('owedValue').textContent = money(sumPay(owed));
  $('owedSub').textContent = bits.join(' · ');
}

/** Nag if a shift has been running more than 16 hours — almost always a forgotten clock-out. */
function renderStale() {
  const stale = state.active && activeMinutes() > 16 * 60;
  $('staleWarn').hidden = !stale;
  if (stale) {
    const started = new Date(state.active.startISO);
    $('staleWarnText').textContent =
      `Running since ${hhmm(started)} on ${fmtDay.format(started)}. Did you forget to clock out?`;
  }
}

$('clockBtn').addEventListener('click', () => {
  if (state.active) {
    const shift = closeActive(new Date());
    renderNow();
    toast(`Clocked out — ${fmtHM(shiftMinutes(shift))}`);
  } else {
    state.active = { startISO: new Date().toISOString() };
    save();
    renderNow();
    toast('Clocked in');
  }
});

/** Turn the running shift into a saved one ending at `end`. Returns the new shift. */
function closeActive(end) {
  const started = new Date(state.active.startISO);
  const shift = {
    id: uid(),
    date: isoDate(started),
    start: hhmm(started),
    end: hhmm(end),
    breakMin: Number(state.settings.breakMin) || 0,
    rate: Number(state.settings.rate) || 0,
    note: ''
  };
  state.shifts.push(shift);
  state.active = null;
  save();
  return shift;
}

$('fixStale').addEventListener('click', () => {
  const shift = closeActive(new Date());
  renderNow();
  openShift(shift.id);
  toast('Set the right finish time');
});

$('addShiftNow').addEventListener('click', () => openShift(null));

/* ───────────────────────── the Shifts screen ───────────────────────── */

function renderShifts() {
  const box = $('shiftList');
  box.textContent = '';

  const all = [...state.shifts].sort(
    (a, b) => (a.date === b.date ? toMin(b.start) - toMin(a.start) : a.date < b.date ? 1 : -1)
  );

  // the filter is only worth showing once something has actually been paid
  const anyPaid = all.some(isSettled);
  document.querySelector('.switch').hidden = !anyPaid;
  const list = ($('hidePaid').checked && anyPaid) ? all.filter((s) => !isSettled(s)) : all;

  const empty = $('shiftsEmpty');
  empty.hidden = list.length > 0;
  if (!all.length) {
    empty.innerHTML = 'No shifts yet.<br><span>Clock in on the Now tab, or add one by hand.</span>';
  } else if (!list.length) {
    empty.innerHTML = 'Nothing outstanding.<br><span>Every shift has been paid for. Untick above to see them.</span>';
  }

  const add = document.createElement('button');
  add.className = 'btn wide';
  add.type = 'button';
  add.textContent = '+ Add a shift';
  add.addEventListener('click', () => openShift(null));
  box.append(add);

  let month = null;
  for (const s of list) {
    const key = s.date.slice(0, 7);
    if (key !== month) {
      month = key;
      const mins = list.filter((x) => x.date.startsWith(key)).reduce((a, x) => a + shiftMinutes(x), 0);
      const pay = list.filter((x) => x.date.startsWith(key)).reduce((a, x) => a + shiftPay(x), 0);
      const head = document.createElement('div');
      head.className = 'month-head';
      head.innerHTML = `<span>${fmtMonth.format(fromISO(s.date))}</span><strong>${fmtHM(mins)} · ${money(pay)}</strong>`;
      box.append(head);
    }
    box.append(shiftRow(s));
  }
}

function shiftRow(s) {
  const d = fromISO(s.date);
  const row = document.createElement('button');
  row.className = 'shift' + (isSettled(s) ? ' is-paid' : '');
  row.type = 'button';

  const bits = [];
  if (s.breakMin) bits.push(`${s.breakMin}m break`);
  bits.push(`${money(s.rate)}/hr`);
  if (s.invoiceNo) bits.push(s.invoiceNo);
  if (s.note) bits.push(s.note);

  const pill = isSettled(s) ? '<span class="pill is-paid">PAID</span>'
             : isBilled(s)  ? '<span class="pill is-billed">INVOICED</span>' : '';

  row.innerHTML =
    `<span class="shift-day"><span class="dow">${fmtDow.format(d)}</span><span class="dom">${d.getDate()}</span></span>` +
    `<span class="shift-mid"><span class="shift-times">${s.start} – ${s.end}${pill}</span>` +
    `<span class="shift-meta">${escapeHtml(bits.join(' · '))}</span></span>` +
    `<span class="shift-right"><span class="shift-hrs">${fmtHM(shiftMinutes(s))}</span>` +
    `<span class="shift-pay">${money(shiftPay(s))}</span></span>`;

  row.addEventListener('click', () => openShift(s.id));
  return row;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ───────────────────────── the shift editor ───────────────────────── */

const shiftDialog = $('shiftDialog');

function openShift(id) {
  editingId = id;
  const s = id ? state.shifts.find((x) => x.id === id) : null;
  const now = new Date();

  $('shiftDialogTitle').textContent = s ? 'Edit shift' : 'Add a shift';
  $('fDate').value = s ? s.date : isoDate(now);
  $('fStart').value = s ? s.start : '09:00';
  $('fEnd').value = s ? s.end : '17:00';
  $('fBreak').value = s ? (s.breakMin || 0) : (Number(state.settings.breakMin) || 0);
  $('fRate').value = s ? s.rate : (Number(state.settings.rate) || 0);
  $('fNote').value = s ? (s.note || '') : '';
  $('fPaid').checked = s ? isSettled(s) : false;
  $('fDelete').hidden = !s;

  const invNote = $('fInvoiceNote');
  invNote.hidden = !(s && s.invoiceNo);
  if (s && s.invoiceNo) {
    invNote.textContent = `On invoice ${s.invoiceNo}` +
      (s.paidOn ? ` · paid ${fmtDay.format(fromISO(s.paidOn))}` : ' · not paid yet');
  }

  updateCalc();
  shiftDialog.showModal();
}

function updateCalc() {
  const draft = {
    start: $('fStart').value,
    end: $('fEnd').value,
    breakMin: Number($('fBreak').value) || 0,
    rate: Number($('fRate').value) || 0
  };
  const mins = shiftMinutes(draft);
  const overnight = toMin(draft.end) < toMin(draft.start);
  $('fCalc').textContent =
    `${fmtHM(mins)} · ${money((mins / 60) * draft.rate)}${overnight ? ' · finishes next day' : ''}`;
}

for (const id of ['fStart', 'fEnd', 'fBreak', 'fRate']) {
  $(id).addEventListener('input', updateCalc);
}

shiftDialog.addEventListener('close', () => {
  const action = shiftDialog.returnValue;

  if (action === 'delete' && editingId) {
    state.shifts = state.shifts.filter((x) => x.id !== editingId);
    save();
    toast('Shift deleted');
  } else if (action === 'save') {
    const prev = editingId ? state.shifts.find((x) => x.id === editingId) : null;
    const shift = {
      id: editingId || uid(),
      date: $('fDate').value,
      start: $('fStart').value,
      end: $('fEnd').value,
      breakMin: Math.max(0, Number($('fBreak').value) || 0),
      rate: Math.max(0, Number($('fRate').value) || 0),
      note: $('fNote').value.trim()
    };
    // billing state is not editable here, but it must survive an edit
    if (prev && prev.invoiceNo) shift.invoiceNo = prev.invoiceNo;
    if ($('fPaid').checked) shift.paidOn = (prev && prev.paidOn) || isoDate(new Date());

    const i = state.shifts.findIndex((x) => x.id === shift.id);
    if (i >= 0) state.shifts[i] = shift; else state.shifts.push(shift);
    save();
    toast(editingId ? 'Shift saved' : 'Shift added');
  }

  editingId = null;
  renderShifts();
  renderNow();
});

/* ───────────────────────── the Report screen ───────────────────────── */

function periodRange() {
  const now = new Date();
  if (period === 'week') {
    const a = startOfWeek(now);
    return [isoDate(a), isoDate(addDays(a, 6))];
  }
  if (period === 'month') {
    return [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
            isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  }
  if (period === 'lastmonth') {
    return [isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
            isoDate(new Date(now.getFullYear(), now.getMonth(), 0))];
  }
  return [$('rangeFrom').value, $('rangeTo').value];
}

for (const chip of document.querySelectorAll('#periodChips .chip')) {
  chip.addEventListener('click', () => {
    period = chip.dataset.period;
    for (const c of document.querySelectorAll('#periodChips .chip')) c.classList.toggle('is-on', c === chip);
    $('customRange').hidden = period !== 'custom';
    if (period === 'custom' && !$('rangeFrom').value) {
      const now = new Date();
      $('rangeFrom').value = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
      $('rangeTo').value = isoDate(now);
    }
    renderReport();
  });
}
$('rangeFrom').addEventListener('change', renderReport);
$('rangeTo').addEventListener('change', renderReport);

function renderReport() {
  const [from, to] = periodRange();
  const table = $('repTable');
  table.textContent = '';

  if (!from || !to || from > to) {
    $('rangeLabel').textContent = 'Pick a start and end date.';
    $('repHours').textContent = '0h 00m';
    $('repPay').textContent = money(0);
    $('repSub').textContent = '';
    table.innerHTML = '<p class="rt-none">No dates chosen.</p>';
    updateInvoiceButton([]);
    return;
  }

  const list = shiftsBetween(from, to);
  const mins = list.reduce((a, s) => a + shiftMinutes(s), 0);
  const pay = list.reduce((a, s) => a + shiftPay(s), 0);
  const rates = [...new Set(list.map((s) => s.rate))];

  $('rangeLabel').textContent = `${fmtDay.format(fromISO(from))} – ${fmtDay.format(fromISO(to))}`;
  $('repHours').textContent = fmtHM(mins);
  $('repPay').textContent = money(pay);

  const parts = [`${list.length} shift${list.length === 1 ? '' : 's'}`];
  if (list.length) parts.push(`average ${fmtHM(mins / list.length)}`);
  parts.push(rates.length > 1 ? 'mixed rates' : `${money(rates[0] || state.settings.rate)}/hr`);
  if (mins) parts.push(`${(mins / 60).toFixed(2)} decimal hours`);
  $('repSub').textContent = parts.join(' · ');
  updateInvoiceButton(list);

  if (!list.length) {
    table.innerHTML = '<p class="rt-none">No shifts in this period.</p>';
    return;
  }

  table.append(row(['Date', 'Times', 'Hours', 'Pay'], 'rt-head'));
  for (const s of list) {
    const label = fmtDay.format(fromISO(s.date));
    const times = `${s.start}–${s.end}${s.breakMin ? ` (−${s.breakMin}m)` : ''}`;
    table.append(row([label, times, fmtHM(shiftMinutes(s)), money(shiftPay(s))]));
  }
  table.append(row(['Total', '', fmtHM(mins), money(pay)], 'rt-foot'));

  function row(cells, cls) {
    const el = document.createElement('div');
    el.className = 'rt-row' + (cls ? ' ' + cls : '');
    el.innerHTML = cells.map((c) => `<span>${escapeHtml(c)}</span>`).join('');
    return el;
  }
}

function reportText() {
  const [from, to] = periodRange();
  const list = shiftsBetween(from, to);
  const mins = list.reduce((a, s) => a + shiftMinutes(s), 0);
  const pay = list.reduce((a, s) => a + shiftPay(s), 0);

  const lines = [
    `Hours ${fmtDay.format(fromISO(from))} – ${fmtDay.format(fromISO(to))}`,
    ''
  ];
  for (const s of list) {
    lines.push(`${fmtDay.format(fromISO(s.date))}  ${s.start}–${s.end}` +
      `${s.breakMin ? ` (−${s.breakMin}m)` : ''}  ${fmtHM(shiftMinutes(s))}  ${money(shiftPay(s))}` +
      `${s.note ? '  ' + s.note : ''}`);
  }
  lines.push('');
  lines.push(`Total: ${fmtHM(mins)} (${(mins / 60).toFixed(2)} hrs) over ${list.length} shift${list.length === 1 ? '' : 's'}`);
  lines.push(`Gross pay: ${money(pay)}`);
  return lines.join('\n');
}

if (navigator.share) $('btnShare').hidden = false;

$('btnShare').addEventListener('click', async () => {
  try {
    await navigator.share({ title: 'My hours', text: reportText() });
  } catch (err) {
    if (err.name !== 'AbortError') toast('Could not share');
  }
});

$('btnCopy').addEventListener('click', async () => {
  const text = reportText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied');
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Summary copied');
  }
});

$('btnCsv').addEventListener('click', () => {
  const [from, to] = periodRange();
  const list = shiftsBetween(from, to);
  if (!list.length) { toast('Nothing to export'); return; }

  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['Date', 'Start', 'End', 'Break (min)', 'Hours', 'Rate', 'Pay', 'Invoice', 'Paid on', 'Note']];
  for (const s of list) {
    rows.push([s.date, s.start, s.end, s.breakMin || 0,
      (shiftMinutes(s) / 60).toFixed(2), (s.rate || 0).toFixed(2), shiftPay(s).toFixed(2),
      s.invoiceNo || '', s.paidOn || '', s.note || '']);
  }
  const mins = sumMins(list);
  rows.push([]);
  rows.push(['Total', '', '', '', (mins / 60).toFixed(2), '',
    sumPay(list).toFixed(2), '', '', '']);

  const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv' }), `hours_${from}_to_${to}.csv`);
  toast('CSV saved to Downloads');
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ───────────────────────── invoices ─────────────────────────
   An invoice claims a set of shifts by stamping them with its number, so the same hours
   can never be billed twice. Marking it paid stamps a date on those shifts, which is what
   takes them out of the outstanding balance - nothing is deleted to clear the slate. */

let viewingInvoice = null;

function updateInvoiceButton(list) {
  const billable = (list || []).filter((s) => !isBilled(s));
  $('btnInvoice').disabled = billable.length === 0;

  $('invoiceHint').textContent =
    !list || !list.length ? 'Nothing in this period to invoice.'
    : !billable.length    ? 'Every shift in this period is already on an invoice.'
    : `${billable.length} shift${billable.length === 1 ? '' : 's'} not yet invoiced · ` +
      `${fmtHM(sumMins(billable))} · ${money(sumPay(billable))}`;
}

function invoiceShifts(inv) {
  return inv.shiftIds
    .map((id) => state.shifts.find((s) => s.id === id))
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.start) - toMin(b.start)));
}

const invoiceIsPaid = (shifts) => shifts.length > 0 && shifts.every(isSettled);

$('btnInvoice').addEventListener('click', () => {
  const [from, to] = periodRange();
  if (!from || !to || from > to) { toast('Pick a period first'); return; }

  const billable = shiftsBetween(from, to).filter((s) => !isBilled(s));
  if (!billable.length) { toast('Nothing left to invoice in this period'); return; }

  const st = state.settings;
  const no = (st.invoicePrefix || 'INV-') + String(Number(st.nextInvoiceNo) || 1).padStart(3, '0');

  const inv = {
    no,
    issued: isoDate(new Date()),
    from, to,
    shiftIds: billable.map((s) => s.id),
    mins: sumMins(billable),
    total: sumPay(billable),
    currency: st.currency,
    yourName: st.yourName,
    yourContact: st.yourContact,
    billTo: st.billTo,
    payDetails: st.payDetails
  };

  for (const s of billable) s.invoiceNo = no;
  state.invoices.push(inv);
  st.nextInvoiceNo = (Number(st.nextInvoiceNo) || 1) + 1;
  save();

  renderReport();
  renderShifts();
  renderNow();
  openInvoice(no);
  toast(`${no} created`);
});

function openInvoice(no) {
  const inv = state.invoices.find((i) => i.no === no);
  if (!inv) { toast('That invoice no longer exists'); return; }

  viewingInvoice = no;
  $('invTitle').textContent = inv.no;
  $('invoiceSheet').innerHTML = invoiceHtml(inv);
  $('invPaid').textContent = invoiceIsPaid(invoiceShifts(inv)) ? 'Mark as unpaid' : 'Mark as paid';
  $('invoiceOverlay').hidden = false;
  document.body.classList.add('no-scroll');
}

function closeInvoice() {
  $('invoiceOverlay').hidden = true;
  document.body.classList.remove('no-scroll');
  viewingInvoice = null;
}

/** Figures are recomputed from the shifts rather than the stored snapshot, so correcting
    a mistyped shift also corrects the invoice instead of leaving the two disagreeing. */
function invoiceHtml(inv) {
  const shifts = invoiceShifts(inv);
  const sym = inv.currency || state.settings.currency || '£';
  const cash = (n) => sym + Math.abs(Number(n) || 0).toFixed(2);
  const block = (t) => escapeHtml(t || '').replace(/\n/g, '<br>');
  const mins = sumMins(shifts);
  const total = sumPay(shifts);

  const rows = shifts.map((s) =>
    `<tr><td>${escapeHtml(fmtDay.format(fromISO(s.date)))}</td>` +
    `<td>${s.start}–${s.end}${s.breakMin ? ` <span class="muted">(−${s.breakMin}m)</span>` : ''}</td>` +
    `<td class="num">${(shiftMinutes(s) / 60).toFixed(2)}</td>` +
    `<td class="num">${cash(s.rate)}</td>` +
    `<td class="num">${cash(shiftPay(s))}</td></tr>`
  ).join('');

  const stamp = invoiceIsPaid(shifts)
    ? `<p class="inv-stamp">PAID${shifts[0].paidOn ? ' · ' + escapeHtml(fmtDay.format(fromISO(shifts[0].paidOn))) : ''}</p>`
    : '';

  const from = inv.yourName
    ? `<strong>${escapeHtml(inv.yourName)}</strong>${inv.yourContact ? '<br>' + block(inv.yourContact) : ''}`
    : block(inv.yourContact) || '<span class="muted">add your details in Settings</span>';

  return `
    <div class="inv-head">
      <div><h1>Invoice</h1><p class="inv-no">${escapeHtml(inv.no)}</p></div>
      <div class="inv-meta">
        <p><span>Issued</span>${escapeHtml(fmtDay.format(fromISO(inv.issued)))}</p>
        <p><span>Period</span>${escapeHtml(fmtDay.format(fromISO(inv.from)))} – ${escapeHtml(fmtDay.format(fromISO(inv.to)))}</p>
      </div>
    </div>
    ${stamp}
    <div class="inv-parties">
      <div><h2>From</h2><p>${from}</p></div>
      <div><h2>Bill to</h2><p>${block(inv.billTo) || '<span class="muted">add this in Settings</span>'}</p></div>
    </div>
    <table class="inv-table">
      <thead><tr><th>Date</th><th>Worked</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${(mins / 60).toFixed(2)}</td><td></td><td class="num">${cash(total)}</td></tr></tfoot>
    </table>
    <p class="inv-due">Amount due <strong>${cash(total)}</strong></p>
    ${inv.payDetails ? `<div class="inv-pay"><h2>Payment</h2><p>${block(inv.payDetails)}</p></div>` : ''}
  `;
}

function invoiceText(inv) {
  const shifts = invoiceShifts(inv);
  const sym = inv.currency || state.settings.currency || '£';
  const cash = (n) => sym + Math.abs(Number(n) || 0).toFixed(2);

  const lines = [`Invoice ${inv.no}`, `Issued ${fmtDay.format(fromISO(inv.issued))}`];
  if (inv.yourName) lines.push(`From: ${inv.yourName}`);
  lines.push(`Period: ${fmtDay.format(fromISO(inv.from))} – ${fmtDay.format(fromISO(inv.to))}`, '');
  for (const s of shifts) {
    lines.push(`${fmtDay.format(fromISO(s.date))}  ${s.start}–${s.end}` +
      `${s.breakMin ? ` (−${s.breakMin}m)` : ''}  ${(shiftMinutes(s) / 60).toFixed(2)}h  ${cash(shiftPay(s))}`);
  }
  lines.push('', `Total ${(sumMins(shifts) / 60).toFixed(2)} hours`, `Amount due ${cash(sumPay(shifts))}`);
  if (inv.payDetails) lines.push('', inv.payDetails);
  return lines.join('\n');
}

$('invClose').addEventListener('click', closeInvoice);
$('invPrint').addEventListener('click', () => window.print());

$('invShare').addEventListener('click', async () => {
  const inv = state.invoices.find((i) => i.no === viewingInvoice);
  if (!inv) return;
  const text = invoiceText(inv);
  if (navigator.share) {
    try { await navigator.share({ title: inv.no, text }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Invoice copied'); }
  catch (err) { toast('Could not share'); }
});

$('invPaid').addEventListener('click', () => {
  const inv = state.invoices.find((i) => i.no === viewingInvoice);
  if (!inv) return;

  const shifts = invoiceShifts(inv);
  if (!shifts.length) { toast('This invoice has no shifts left on it'); return; }

  const wasPaid = invoiceIsPaid(shifts);
  const today = isoDate(new Date());
  for (const s of shifts) {
    if (wasPaid) delete s.paidOn; else s.paidOn = today;
  }
  save();

  openInvoice(inv.no);
  renderShifts();
  renderNow();
  renderReport();
  toast(wasPaid
    ? `${inv.no} back to unpaid`
    : `${shifts.length} shift${shifts.length === 1 ? '' : 's'} marked paid`);
});

$('invDelete').addEventListener('click', () => {
  const inv = state.invoices.find((i) => i.no === viewingInvoice);
  if (!inv) return;
  if (!confirm(`Delete invoice ${inv.no}?\n\nThe shifts on it are kept — they go back to being uninvoiced and unpaid, so you can bill them again.`)) return;

  for (const s of invoiceShifts(inv)) { delete s.invoiceNo; delete s.paidOn; }
  state.invoices = state.invoices.filter((i) => i.no !== inv.no);
  save();

  closeInvoice();
  renderShifts();
  renderNow();
  renderReport();
  renderInvoiceList();
  toast(`${inv.no} deleted`);
});

$('owedStrip').addEventListener('click', () => showView('report'));

$('hidePaid').addEventListener('change', renderShifts);

function renderInvoiceList() {
  const box = $('invoiceList');
  box.textContent = '';

  if (!state.invoices.length) {
    box.innerHTML = '<p class="hint">None yet. Create one from the Report tab.</p>';
    return;
  }

  for (const inv of [...state.invoices].reverse()) {
    const shifts = invoiceShifts(inv);
    const paid = invoiceIsPaid(shifts);
    const b = document.createElement('button');
    b.className = 'inv-row';
    b.type = 'button';
    b.innerHTML =
      `<span class="inv-row-main"><span class="inv-row-no">${escapeHtml(inv.no)}` +
      `${paid ? '<span class="pill is-paid">PAID</span>' : ''}</span>` +
      `<span class="inv-row-meta">${escapeHtml(fmtDay.format(fromISO(inv.issued)))} · ` +
      `${shifts.length} shift${shifts.length === 1 ? '' : 's'} · ${fmtHM(sumMins(shifts))}</span></span>` +
      `<span class="inv-row-total">${money(sumPay(shifts))}</span>`;
    b.addEventListener('click', () => openInvoice(inv.no));
    box.append(b);
  }
}

/* ───────────────────────── the Settings screen ───────────────────────── */

function renderSettings() {
  const st = state.settings;
  $('setRate').value = st.rate;
  $('setCurrency').value = st.currency;
  $('setBreak').value = st.breakMin;
  $('setWeekStart').value = String(st.weekStart);

  $('setYourName').value = st.yourName || '';
  $('setYourContact').value = st.yourContact || '';
  $('setBillTo').value = st.billTo || '';
  $('setPayDetails').value = st.payDetails || '';
  $('setInvPrefix').value = st.invoicePrefix || '';
  $('setInvNext').value = st.nextInvoiceNo || 1;

  renderInvoiceList();
  $('installCard').hidden = !installEvent;
}

$('setRate').addEventListener('change', () => {
  state.settings.rate = Math.max(0, Number($('setRate').value) || 0);
  save();
  toast('Rate saved — used for new shifts');
  updateTopNote();
  renderNow();
});
$('setCurrency').addEventListener('change', () => {
  state.settings.currency = $('setCurrency').value.trim() || '£';
  save();
  renderNow();
});
$('setBreak').addEventListener('change', () => {
  state.settings.breakMin = Math.max(0, Number($('setBreak').value) || 0);
  save();
});
$('setWeekStart').addEventListener('change', () => {
  state.settings.weekStart = Number($('setWeekStart').value);
  save();
  renderNow();
});

/* free-text invoice details - they only ever get printed, so no validation needed */
const TEXT_SETTINGS = {
  setYourName: 'yourName',
  setYourContact: 'yourContact',
  setBillTo: 'billTo',
  setPayDetails: 'payDetails'
};
for (const id of Object.keys(TEXT_SETTINGS)) {
  $(id).addEventListener('change', () => {
    state.settings[TEXT_SETTINGS[id]] = $(id).value.trim();
    save();
    toast('Invoice details saved');
  });
}

$('setInvPrefix').addEventListener('change', () => {
  state.settings.invoicePrefix = $('setInvPrefix').value.trim();
  save();
});

$('setInvNext').addEventListener('change', () => {
  state.settings.nextInvoiceNo = Math.max(1, Math.floor(Number($('setInvNext').value) || 1));
  $('setInvNext').value = state.settings.nextInvoiceNo;
  save();
});

/* backdated pay rises: push the current rate onto shifts already saved */
const bulkDialog = $('bulkDialog');

$('btnBulkRate').addEventListener('click', () => {
  const now = new Date();
  $('bulkHint').textContent =
    `Every shift between these dates will be changed to ${money(state.settings.rate)} an hour.`;
  $('bFrom').value = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  $('bTo').value = isoDate(now);
  bulkDialog.showModal();
});

bulkDialog.addEventListener('close', () => {
  if (bulkDialog.returnValue !== 'apply') return;
  const from = $('bFrom').value, to = $('bTo').value;
  if (!from || !to || from > to) { toast('Check those dates'); return; }
  let n = 0;
  for (const s of state.shifts) {
    if (s.date >= from && s.date <= to) { s.rate = state.settings.rate; n++; }
  }
  save();
  toast(n ? `${n} shift${n === 1 ? '' : 's'} updated` : 'No shifts in that range');
});

$('btnExport').addEventListener('click', () => {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
    `hours-backup_${isoDate(new Date())}.json`);
  toast('Backup saved to Downloads');
});

$('btnImport').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.shifts)) throw new Error('not an Hours backup');
    if (!confirm(`Replace everything with this backup (${data.shifts.length} shifts)?`)) return;
    state = {
      v: 1,
      settings: Object.assign(defaultSettings(), data.settings || {}),
      active: data.active || null,
      shifts: data.shifts,
      invoices: Array.isArray(data.invoices) ? data.invoices : []
    };
    save();
    showView('now');
    toast('Backup restored');
  } catch (err) {
    toast('That file is not an Hours backup');
    console.error(err);
  } finally {
    e.target.value = '';
  }
});

$('btnWipe').addEventListener('click', () => {
  if (!confirm('Delete every shift and setting on this phone? This cannot be undone.')) return;
  if (!confirm('Really erase everything?')) return;
  state = defaultState();
  save();
  showView('now');
  toast('Everything erased');
});

/* ───────────────────────── install / service worker ───────────────────────── */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('installCard').hidden = false;
});

$('btnInstall').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('installCard').hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache:'none' - otherwise the browser can hand back a stale sw.js from its
    // own HTTP cache, and a superseded worker keeps serving a superseded app.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch((err) => console.warn('SW failed', err));
  });
}

/* keep the running clock honest when the phone wakes or the app comes back */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('view-now').hidden) renderNow();
});

/* ───────────────────────── go ───────────────────────── */

showView('now');
