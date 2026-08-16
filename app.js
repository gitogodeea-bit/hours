/* Hours — clock in/out timesheet. All data lives in this phone's localStorage. */
'use strict';

const KEY = 'hours.v1';

/* Fresh objects, built from plain literals every time.
   Deliberately NOT structuredClone(): it is missing below Chromium 98, and since this is
   the first thing that runs it took the whole script down with it on Samsung Internet. */
function defaultSettings() {
  return { rate: 0, currency: '£', breakMin: 0, weekStart: 1 };
}

function defaultState() {
  return {
    v: 1,
    settings: defaultSettings(),
    active: null,        // { startISO } while clocked in
    shifts: []           // { id, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', breakMin, rate, note }
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
      shifts: Array.isArray(data.shifts) ? data.shifts : []
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

  const list = [...state.shifts].sort(
    (a, b) => (a.date === b.date ? toMin(b.start) - toMin(a.start) : a.date < b.date ? 1 : -1)
  );

  $('shiftsEmpty').hidden = list.length > 0;

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
  row.className = 'shift';
  row.type = 'button';

  const bits = [];
  if (s.breakMin) bits.push(`${s.breakMin}m break`);
  bits.push(`${money(s.rate)}/hr`);
  if (s.note) bits.push(s.note);

  row.innerHTML =
    `<span class="shift-day"><span class="dow">${fmtDow.format(d)}</span><span class="dom">${d.getDate()}</span></span>` +
    `<span class="shift-mid"><span class="shift-times">${s.start} – ${s.end}</span>` +
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
  $('fDelete').hidden = !s;

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
    const shift = {
      id: editingId || uid(),
      date: $('fDate').value,
      start: $('fStart').value,
      end: $('fEnd').value,
      breakMin: Math.max(0, Number($('fBreak').value) || 0),
      rate: Math.max(0, Number($('fRate').value) || 0),
      note: $('fNote').value.trim()
    };
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
  const rows = [['Date', 'Start', 'End', 'Break (min)', 'Hours', 'Rate', 'Pay', 'Note']];
  for (const s of list) {
    rows.push([s.date, s.start, s.end, s.breakMin || 0,
      (shiftMinutes(s) / 60).toFixed(2), (s.rate || 0).toFixed(2), shiftPay(s).toFixed(2), s.note || '']);
  }
  const mins = list.reduce((a, s) => a + shiftMinutes(s), 0);
  rows.push([]);
  rows.push(['Total', '', '', '', (mins / 60).toFixed(2), '',
    list.reduce((a, s) => a + shiftPay(s), 0).toFixed(2), '']);

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

/* ───────────────────────── the Settings screen ───────────────────────── */

function renderSettings() {
  $('setRate').value = state.settings.rate;
  $('setCurrency').value = state.settings.currency;
  $('setBreak').value = state.settings.breakMin;
  $('setWeekStart').value = String(state.settings.weekStart);
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
      shifts: data.shifts
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
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW failed', err));
  });
}

/* keep the running clock honest when the phone wakes or the app comes back */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('view-now').hidden) renderNow();
});

/* ───────────────────────── go ───────────────────────── */

showView('now');
