import { syncSchedule, toClasses, diffSchedules } from './js/sync.js';
import * as store from './js/store.js';

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PLAN_LABEL = { kurs: 'Kursplan', team: 'Teamtraining' };
const BRANDS = { LESMILLS: 'Les Mills', SUPERFIT: 'Superfit', TEAMTRAINING: 'Teamtraining', 'ZUMBA FITNESS': 'Zumba Fitness' };
const brandLabel = b => BRANDS[b] || (b || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
const isoDay = d => (d.getDay() + 6) % 7 + 1;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => { const d = parseYmd(s); return `${DAYS[isoDay(d) - 1]} ${d.getDate()}.${d.getMonth() + 1}.`; };
const todayYmd = () => ymd(new Date());
const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fullName = c => [c.name, ...(c.tags || [])].join(' ');

// actions: [{ label, act, id }] rendered as buttons handled by the normal data-act click handler.
function toast(msg, actions = []) {
  const t = $('#toast');
  t.innerHTML = `<span>${h(msg)}</span>` + actions.map(a => `<button class="toast-act" data-act="${a.act}" data-id="${h(a.id)}">${h(a.label)}</button>`).join('');
  t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), actions.length ? 6000 : 2600);
}

// ---------- state (all local; versioned and migrated by js/store.js) ----------
const loaded = store.load(localStorage);
let S = loaded.state;
const save = () => { try { store.save(localStorage, S); } catch (e) { toast('Could not save: storage full?'); } };
// Persist an upgrade right away (the original was already backed up by store.load).
if (!loaded.fresh && !loaded.corrupt && !loaded.newer && loaded.from < store.SCHEMA_VERSION) save();

let schedule = { studios: [], classes: [] };
let info = [];
const studioById = id => schedule.studios.find(s => s.id === id) || { id, name: id };

async function loadData() {
  const [bundled, ci] = await Promise.all([
    fetch('data/schedule.json').then(r => r.json()).catch(() => null),
    fetch('data/classinfo.json').then(r => r.json()).catch(() => ({ entries: [] })),
  ]);
  info = ci.entries;
  // Use whichever schedule is newer: one synced on this device, or the one shipped with the app.
  const local = S.schedule;
  schedule = local && (!bundled || (local.generated || '') >= (bundled.generated || '')) ? local : bundled || { studios: [], classes: [] };
}

function classInfo(c) {
  const name = `${c.brand || ''} ${fullName(c)}`.toUpperCase();
  return info.find(e => e.keys.some(k => new RegExp(`(^|[^A-ZÄÖÜ])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name))) || null;
}

// ---------- links: maps, calendar, messaging ----------
const studioQuery = st => st.address || `Superfit ${st.name} Berlin`;
const routeUrl = st => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(studioQuery(st))}`;
const compact = (date, hm) => date.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';

function eventOf(e) {
  const st = studioById(e.studio);
  return {
    title: `${e.name} @ Superfit ${st.name}`,
    location: st.address ? `Superfit ${st.name}, ${st.address}` : `Superfit ${st.name}, Berlin`,
    start: compact(e.date, e.start), end: compact(e.date, e.end), st,
  };
}

function gcalUrl(e, emails = []) {
  const ev = eventOf(e);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${ev.start}/${ev.end}`, ctz: 'Europe/Berlin', location: ev.location, details: `Route: ${routeUrl(ev.st)}` });
  if (emails.length) p.set('add', emails.join(','));
  return `https://calendar.google.com/calendar/render?${p}`;
}

const VTZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];

function icsFor(e) {
  const ev = eventOf(e);
  const esc = s => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Superfit Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...VTZ,
    'BEGIN:VEVENT', `UID:${e.id}@superfit-planner`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Berlin:${ev.start}`, `DTEND;TZID=Europe/Berlin:${ev.end}`,
    `SUMMARY:${esc(ev.title)}`, `LOCATION:${esc(ev.location)}`, `DESCRIPTION:${esc('Route: ' + routeUrl(ev.st))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:Workout in 1 hour', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function downloadIcs(e) {
  const blob = new Blob([icsFor(e)], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${e.name.replace(/\W+/g, '-')}-${e.date}.ics` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function inviteText(e) {
  const ev = eventOf(e);
  return `Join me for ${e.name} at Superfit ${ev.st.name} on ${fmtDate(e.date)} ${e.start}–${e.end}! 💪\n` +
    `Add to calendar: ${gcalUrl(e)}\nRoute: ${routeUrl(ev.st)}`;
}

// German numbers default: 0151… -> 49151…
const waPhone = p => { let d = (p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '49' + d.slice(1); return d; };

// ---------- schedule queries ----------
function nextDates(day, start, n = 4) {
  const out = [], d = new Date();
  for (let i = 0; out.length < n && i < 28; i++, d.setDate(d.getDate() + 1)) {
    if (isoDay(d) !== day) continue;
    if (i === 0 && start <= nowHm()) continue;
    out.push(ymd(d));
  }
  return out;
}

// ---------- views ----------
let tab = 'search';
const TITLES = { search: 'Classes', agenda: 'Agenda', friends: 'Friends', progress: 'Progress', settings: 'Settings' };

function render() {
  $('#view-title').textContent = TITLES[tab];
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ({ search: renderSearch, agenda: renderAgenda, friends: renderFriends, progress: renderProgress, settings: renderSettings })[tab]();
}

const TOD = { morning: ['00:00', '12:00'], midday: ['12:00', '17:00'], evening: ['17:00', '24:00'] };
const TOD_LABEL = { morning: 'Morning', midday: 'Midday', evening: 'Evening' };
const DAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

// Studios you train at: the ones you picked, else the ones in your agenda/log history.
function myStudios() {
  if (S.prefs.studios.length) return S.prefs.studios;
  const seen = [...new Set([...S.log, ...S.agenda].map(e => e.studio).filter(Boolean))];
  return seen.filter(id => schedule.studios.some(s => s.id === id));
}
// Studios shown on the dashboard; [] = all.
const shownStudios = () => (S.prefs.allStudios ? [] : myStudios());

function filteredClasses() {
  const p = S.prefs, q = (p.q || '').trim().toUpperCase(), studios = shownStudios();
  return schedule.classes.filter(c =>
    (!studios.length || studios.includes(c.studio)) &&
    (!p.plans.length || p.plans.includes(c.plan)) &&
    (!p.days.length || p.days.includes(c.day)) &&
    (!p.tods.length || p.tods.some(t => TOD[t] && c.start >= TOD[t][0] && c.start < TOD[t][1])) &&
    (!q || fullName(c).toUpperCase().includes(q) || brandLabel(c.brand).toUpperCase().includes(q) || (classInfo(c)?.title || '').toUpperCase().includes(q)));
}

// One-tap suggestion: your most frequent class (by history), else the next BODYPUMP at your studios.
function suggestNext() {
  const taken = new Set(S.agenda.filter(a => a.status === 'planned').map(a => `${a.classId}|${a.date}`));
  const freeDate = c => nextDates(c.day, c.start, 4).find(d => !taken.has(`${c.id}|${d}`));
  const score = new Map(), today = parseYmd(todayYmd());
  const add = (e, w) => {
    if (!e.classId || !e.date) return;
    const ago = Math.max(0, (today - parseYmd(e.date)) / 864e5);
    score.set(e.classId, (score.get(e.classId) || 0) + w + Math.max(0, 1 - ago / 90));
  };
  S.log.forEach(l => add(l, 2));
  S.agenda.filter(a => a.status !== 'missed').forEach(a => add(a, 1));
  for (const [id] of [...score].sort((a, b) => b[1] - a[1])) {
    const c = schedule.classes.find(x => x.id === id), date = c && freeDate(c);
    if (date) return { c, date, why: 'your usual' };
  }
  const mine = myStudios();
  const pick = list => list.map(c => ({ c, date: freeDate(c) })).filter(x => x.date)
    .sort((a, b) => (a.date + a.c.start).localeCompare(b.date + b.c.start))[0];
  const pump = schedule.classes.filter(c => c.name === 'BODYPUMP');
  const found = pick(pump.filter(c => !mine.length || mine.includes(c.studio))) || pick(pump);
  return found && { ...found, why: 'next BODYPUMP' };
}

const relDay = (date, start) => {
  const diff = Math.round((parseYmd(date) - parseYmd(todayYmd())) / 864e5);
  return diff === 0 ? `today ${start}` : diff === 1 ? `tomorrow ${start}` : `${fmtDate(date)} ${start} · in ${diff} days`;
};

function snapshotHtml() {
  const s = stats(), today = todayYmd(), now = nowHm();
  const byTime = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);
  const planned = S.agenda.filter(e => e.status === 'planned');
  const ended = e => e.date < today || (e.date === today && (e.end || e.start) <= now);
  const next = planned.filter(e => !ended(e)).sort(byTime)[0];
  const pending = planned.filter(ended).sort(byTime).slice(-2);
  const nb = s.nextBadge;
  return `<div class="card snap">
    <div class="snap-line">
      <div class="grow"><span class="muted small">Next up</span>
        ${next ? `<span class="name">${h(next.name)}</span><span class="small muted">${relDay(next.date, next.start)} · ${h(next.studioName)}</span>`
          : `<span class="name">Nothing planned yet</span><span class="small muted">Pick a class below</span>`}</div>
      <button class="icon-btn" data-act="goto" data-id="agenda" aria-label="Open agenda" title="Agenda">📅</button>
    </div>
    <div class="snap-stats">
      <div class="grow stats-wrap">
        <span>🔥 <b>${s.streak}</b> wk streak <span class="muted">(best ${s.longestStreak})</span></span>
        <span>This week <b>${s.thisWeek}/${s.goal}</b> <span class="minibar"><i style="width:${Math.min(100, (s.thisWeek / s.goal) * 100)}%"></i></span></span>
        ${nb ? `<span>Next badge ${nb.ico} ${h(nb.name)} <b>${nb.have}/${nb.need}</b></span>` : `<span>All badges earned</span>`}
      </div>
      <button class="icon-btn" data-act="goto" data-id="progress" aria-label="Open progress" title="Progress">🏆</button>
    </div>
    ${pending.map(e => `<div class="pending"><span class="grow">Did you go? <b>${h(e.name)}</b> · ${fmtDate(e.date)} ${e.start}</span>
      <button class="btn sm" data-act="done" data-id="${e.id}" aria-label="I went">✓</button>
      <button class="btn sm plain" data-act="missed" data-id="${e.id}" aria-label="Missed it">✗</button></div>`).join('')}
  </div>`;
}

function quickActionsHtml() {
  const sug = suggestNext();
  const st = sug && studioById(sug.c.studio);
  return `<div class="quick">
    ${sug ? `<button class="suggest" data-act="quick-plan" data-id="${h(sug.c.id)}" data-date="${sug.date}"
        aria-label="Add ${h(fullName(sug.c))} ${fmtDate(sug.date)} ${sug.c.start} at ${h(st.name)} to agenda">
      <span class="grow"><span class="cap">Suggested · ${h(sug.why)}</span><span class="what">${h(fullName(sug.c))}</span><span class="when">${fmtDate(sug.date)} ${sug.c.start} · ${h(st.name)}</span></span>
      <span class="add-pill">＋ Add</span>
    </button>` : ''}
    <button class="btn plain log-btn" data-act="log-manual">＋ Log<br>workout</button>
  </div>`;
}

function renderSearch() {
  const p = S.prefs, mine = myStudios(), all = p.allStudios || !mine.length;
  const seg = (act, val, on, label) => `<button class="seg ${on ? 'on' : ''}" aria-pressed="${on}" data-act="${act}" data-id="${val}">${label}</button>`;
  $('#view').innerHTML = `
    ${snapshotHtml()}
    ${quickActionsHtml()}
    <input id="q" type="search" placeholder="Search, e.g. BODYPUMP, Yoga, Rücken" value="${h(p.q)}" autocomplete="off">
    <div class="chips" style="margin-top:8px">
      ${mine.length ? `<button class="chip ${all ? '' : 'on'}" data-act="studio-mine">My studios</button>` : ''}
      <button class="chip ${all ? 'on' : ''}" data-act="studio-all">All studios</button>
      ${(all ? schedule.studios : [...mine.map(studioById), ...schedule.studios.filter(s => !mine.includes(s.id))])
        .map(s => `<button class="chip ${!all && mine.includes(s.id) ? 'on' : ''}" data-act="studio" data-id="${h(s.id)}">${h(s.name)}</button>`).join('')}
    </div>
    <div class="segrow" role="group" aria-label="Days">${DAY_SHORT.map((d, i) => seg('toggle-day', i + 1, p.days.includes(i + 1), d)).join('')}</div>
    <div class="segrow" role="group" aria-label="Time and plan">${Object.keys(TOD).map(t => seg('toggle-tod', t, p.tods.includes(t), TOD_LABEL[t])).join('')}<span class="sep"></span>${seg('toggle-plan', 'kurs', p.plans.includes('kurs'), 'Kurs')}${seg('toggle-plan', 'team', p.plans.includes('team'), 'Team')}</div>
    <div id="results"></div>`;
  renderResults();
}

const expandedDays = new Set();
const DAY_CAP = 6;

function renderResults() {
  if (!schedule.classes.length) {
    $('#results').innerHTML = `<div class="empty">No schedule data yet.<br><br><button class="btn" data-act="goto-settings">Check for updates</button></div>`;
    return;
  }
  const list = filteredClasses(), now = nowHm(), base = new Date();
  const multi = shownStudios().length !== 1;
  const planned = new Set(S.agenda.filter(a => a.status === 'planned').map(a => `${a.classId}|${a.date}`));
  const cards = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const day = isoDay(d), date = ymd(d);
    const rows = list.filter(c => c.day === day && (i > 0 || c.end > now)).sort((a, b) => a.start.localeCompare(b.start));
    if (!rows.length) continue;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAYS_LONG[day - 1];
    const open = expandedDays.has(date), shown = open ? rows : rows.slice(0, DAY_CAP);
    const canExpand = rows.length > DAY_CAP;
    cards.push(`<section class="daycard ${open ? 'wide' : ''}" data-day="${date}">
      <button class="dayhead" ${canExpand ? `data-act="expand-day" data-id="${date}" aria-expanded="${open}"` : ''}><b>${label}</b><span class="muted small">${d.getDate()}.${d.getMonth() + 1}. · ${rows.length}${canExpand ? (open ? ' ▴' : ' ▾') : ''}</span></button>
      ${shown.map(c => classRow(c, date, multi, planned.has(`${c.id}|${date}`))).join('')}
      ${canExpand ? `<button class="more" data-act="expand-day" data-id="${date}">${open ? 'Show less ▴' : `+${rows.length - shown.length} more ▾`}</button>` : ''}
    </section>`);
  }
  $('#results').innerHTML = cards.length ? `<div class="daygrid">${cards.join('')}</div>` : `<div class="empty">No classes match these filters.</div>`;
}

function classRow(c, date, multi, isPlanned) {
  return `<button class="crow ${c.plan}" data-act="open-class" data-id="${h(c.id)}" data-date="${date}" title="${h(fullName(c))} · ${c.start}–${c.end} · ${PLAN_LABEL[c.plan]}">
    <span class="t">${c.start}</span><span class="n">${h(fullName(c))}${isPlanned ? ' 📌' : ''}</span>
    ${multi ? `<span class="s">${h(studioById(c.studio).name)}</span>` : ''}
  </button>`;
}

function openClass(id, prefDate) {
  const c = schedule.classes.find(x => x.id === id);
  if (!c) return;
  const st = studioById(c.studio), ci = classInfo(c);
  const dates = nextDates(c.day, c.start);
  const dots = n => '●'.repeat(n) + '○'.repeat(5 - n);
  modal(`
    <h3>${h(fullName(c))}</h3>
    <div class="muted">${c.brand ? h(brandLabel(c.brand)) + ' · ' : ''}<span class="badge ${c.plan === 'team' ? 'team' : ''}">${PLAN_LABEL[c.plan]}</span></div>
    <p><b>${DAYS_LONG[c.day - 1]} ${c.start}–${c.end}</b><br>Superfit ${h(st.name)}${st.address ? ' · ' + h(st.address) : ''}</p>
    ${ci ? `<div class="card">
      <div class="row between"><b>${h(ci.title)}</b><span class="small" title="Intensity">${dots(ci.intensity)}</span></div>
      <p class="small">${h(ci.what)}</p>
      <div class="small muted">${ci.focus.map(h).join(' · ')}${ci.duration ? ' · ' + h(ci.duration) : ''}</div>
      ${ci.bring ? `<p class="small"><b>Bring:</b> ${h(ci.bring)}</p>` : ''}
      ${ci.tip ? `<p class="small"><b>Tip:</b> ${h(ci.tip)}</p>` : ''}
      ${ci.source ? `<a class="small" href="${h(ci.source)}" target="_blank" rel="noopener">More about this class ↗</a>` : ''}
    </div>` : ''}
    <label>Date</label>
    <select id="class-date">${dates.map(d => `<option value="${d}" ${d === prefDate ? 'selected' : ''}>${fmtDate(d)}</option>`).join('')}</select>
    <div class="actions">
      <button class="btn" data-act="add-agenda" data-id="${h(c.id)}">＋ Add to agenda</button>
      <button class="btn ghost" data-act="add-invite" data-id="${h(c.id)}">Add &amp; invite</button>
      <a class="btn plain" href="${h(routeUrl(st))}" target="_blank" rel="noopener">🗺️ Route</a>
    </div>`);
}

function addToAgenda(classId, date) {
  const c = schedule.classes.find(x => x.id === classId);
  const st = studioById(c.studio);
  let e = S.agenda.find(a => a.classId === classId && a.date === date);
  if (!e) {
    e = { id: uid(), classId, name: fullName(c), studio: c.studio, studioName: st.name, plan: c.plan, date, start: c.start, end: c.end, friends: [], status: 'planned' };
    S.agenda.push(e); save();
    toast('Added to agenda');
  } else toast('Already in your agenda');
  return e;
}

let showAllDone = false;
function renderAgenda() {
  const today = todayYmd();
  const sorted = [...S.agenda].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const upcoming = sorted.filter(e => e.status === 'planned' && e.date >= today);
  const pending = sorted.filter(e => e.status === 'planned' && e.date < today);
  const friendNames = e => (e.friends || []).map(id => S.friends.find(f => f.id === id)?.name).filter(Boolean);
  const done = [...S.log].sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
  const card = (e, past) => `<div class="card">
    <div class="row between"><div class="grow">
      <div class="name">${h(e.name)}</div>
      <div class="muted small">${fmtDate(e.date)} ${e.start}–${e.end} · ${h(e.studioName)}</div>
      ${friendNames(e).length ? `<div class="small">👥 ${friendNames(e).map(h).join(', ')}</div>` : ''}
    </div><span class="badge ${e.plan === 'team' ? 'team' : ''}">${PLAN_LABEL[e.plan] || ''}</span></div>
    <div class="actions">
      ${past
        ? `<button class="btn sm" data-act="done" data-id="${e.id}">✓ I went</button><button class="btn sm plain" data-act="missed" data-id="${e.id}">Missed it</button>`
        : `<button class="btn sm" data-act="invite" data-id="${e.id}">Invite</button>
           <button class="btn sm ghost" data-act="cal" data-id="${e.id}">📅 Calendar</button>
           <a class="btn sm plain" href="${h(routeUrl(studioById(e.studio)))}" target="_blank" rel="noopener">🗺️</a>
           ${e.date === today ? `<button class="btn sm ghost" data-act="done" data-id="${e.id}">✓ Done</button>` : ''}
           <button class="btn sm plain" data-act="remove" data-id="${e.id}">✕</button>`}
    </div></div>`;
  $('#view').innerHTML = `
    ${pending.length ? `<h2>Did you go?</h2>${pending.map(e => card(e, true)).join('')}` : ''}
    <h2>Upcoming</h2>
    ${upcoming.length ? upcoming.map(e => card(e, false)).join('') : `<div class="empty">Nothing planned. Find a class and tap “Add to agenda”.</div>`}
    <div class="actions"><button class="btn plain block" data-act="log-manual">＋ Log another workout</button></div>
    <h2>Completed</h2>
    ${done.length ? done.slice(0, showAllDone ? done.length : 10).map(l => `<div class="card row"><div class="grow"><div class="name">✓ ${h(l.name)}</div>
      <div class="muted small">${fmtDate(l.date)}${l.start ? ' ' + l.start : ''}${l.studioName ? ' · ' + h(l.studioName) : ''}${(l.friends || []).length ? ' · 👥 ' + l.friends.length : ''}</div></div>
      <button class="btn sm plain" data-act="log-del" data-id="${l.id}" aria-label="Delete workout">✕</button></div>`).join('')
      : `<div class="empty">No workouts yet. Tap “I went” after a class, or log one.</div>`}
    ${done.length > 10 && !showAllDone ? `<button class="btn plain block" data-act="show-all-done">Show all (${done.length})</button>` : ''}`;
}

function calendarSheet(e) {
  const emails = e.friends.map(id => S.friends.find(f => f.id === id)?.email).filter(Boolean);
  modal(`<h3>Add to calendar</h3>
    <p class="small muted">${h(e.name)} · ${fmtDate(e.date)} ${e.start}</p>
    <div class="actions" style="flex-direction:column">
      <a class="btn" href="${h(gcalUrl(e, emails))}" target="_blank" rel="noopener">Google Calendar${emails.length ? ` (invites ${emails.length} friend${emails.length > 1 ? 's' : ''})` : ''}</a>
      <button class="btn ghost" data-act="ics" data-id="${e.id}">Download .ics (any calendar app)</button>
    </div>
    <p class="small muted">${emails.length ? 'Saving the Google Calendar event sends real invites to your friends’ email addresses.' : 'Add friends with an email address to send calendar invites.'}</p>`);
}

function inviteSheet(e) {
  modal(`<h3>Invite friends</h3>
    <p class="small muted">${h(e.name)} · ${fmtDate(e.date)} ${e.start} · ${h(e.studioName)}</p>
    ${S.friends.length ? S.friends.map(f => `<label class="check"><input type="checkbox" data-friend="${f.id}" ${e.friends.includes(f.id) ? 'checked' : ''}> <span class="grow">${h(f.name)}</span>
      <span class="row">
        ${f.phone ? `<a class="btn sm plain" target="_blank" rel="noopener" href="https://wa.me/${waPhone(f.phone)}?text=${encodeURIComponent(inviteText(e))}" data-act="mark-invited" data-id="${e.id}" data-friend="${f.id}">WhatsApp</a>
                     <a class="btn sm plain" href="sms:${h(f.phone)}?body=${encodeURIComponent(inviteText(e))}" data-act="mark-invited" data-id="${e.id}" data-friend="${f.id}">SMS</a>` : ''}
        ${f.email ? `<a class="btn sm plain" href="mailto:${h(f.email)}?subject=${encodeURIComponent('Workout: ' + e.name)}&body=${encodeURIComponent(inviteText(e))}" data-act="mark-invited" data-id="${e.id}" data-friend="${f.id}">Email</a>` : ''}
      </span></label>`).join('')
      : `<p class="muted">No friends yet. Add some in the Friends tab, or just share:</p>`}
    <div class="actions" style="flex-direction:column">
      <button class="btn" data-act="share" data-id="${e.id}">Share via… (any app)</button>
      <button class="btn ghost" data-act="cal" data-id="${e.id}">Send calendar invite</button>
    </div>`, () => {
    document.querySelectorAll('#modal-body input[data-friend]').forEach(cb => cb.addEventListener('change', () => {
      e.friends = cb.checked ? [...new Set([...e.friends, cb.dataset.friend])] : e.friends.filter(id => id !== cb.dataset.friend);
      save();
    }));
  });
}

function renderFriends() {
  const supportsContacts = 'contacts' in navigator && 'select' in navigator.contacts;
  $('#view').innerHTML = `
    <div class="card">
      <b>Add a friend</b>
      <label>Name</label><input id="fr-name" placeholder="Alex">
      <label>Phone (for WhatsApp / SMS)</label><input id="fr-phone" type="tel" placeholder="0151 2345678">
      <label>Email (for calendar invites)</label><input id="fr-email" type="email" placeholder="alex@example.com">
      <div class="actions">
        <button class="btn" data-act="friend-add">Add</button>
        ${supportsContacts ? `<button class="btn ghost" data-act="friend-contacts">Pick from contacts</button>` : ''}
      </div>
    </div>
    <h2>Your friends</h2>
    ${S.friends.length ? S.friends.map(f => {
      const n = S.log.filter(l => (l.friends || []).includes(f.id)).length;
      return `<div class="card row"><div class="grow"><div class="name">${h(f.name)}</div>
        <div class="muted small">${h([f.phone, f.email].filter(Boolean).join(' · ') || 'no contact info')}${n ? ` · ${n} workout${n > 1 ? 's' : ''} together` : ''}</div></div>
        <button class="btn sm plain" data-act="friend-del" data-id="${f.id}">✕</button></div>`;
    }).join('') : `<div class="empty">No friends yet.</div>`}`;
}

// ---------- gamification ----------
function weekKey(s) {
  const d = parseYmd(s); d.setDate(d.getDate() + 4 - isoDay(d)); // Thursday of ISO week
  const y = d.getFullYear(), start = new Date(y, 0, 1);
  return `${y}-W${String(Math.ceil(((d - start) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}
function stats() {
  const log = [...S.log].sort((a, b) => a.date.localeCompare(b.date));
  const goal = S.prefs.weeklyGoal;
  const perWeek = {};
  for (const l of log) perWeek[weekKey(l.date)] = (perWeek[weekKey(l.date)] || 0) + 1;
  const thisWeek = perWeek[weekKey(todayYmd())] || 0;
  // Streak of weeks that met the goal, counting back from this week (or last week if this one isn't done yet).
  let streak = 0;
  const d = new Date();
  if (thisWeek < goal) d.setDate(d.getDate() - 7);
  while ((perWeek[weekKey(ymd(d))] || 0) >= goal) { streak++; d.setDate(d.getDate() - 7); }
  // Longest run of goal-meeting weeks, from the first logged week to this one.
  let longestStreak = 0, run = 0;
  if (log.length) {
    const w = parseYmd(log[0].date), end = weekKey(todayYmd());
    for (let guard = 0; guard < 600; guard++, w.setDate(w.getDate() + 7)) {
      run = (perWeek[weekKey(ymd(w))] || 0) >= goal ? run + 1 : 0;
      longestStreak = Math.max(longestStreak, run);
      if (weekKey(ymd(w)) === end) break;
    }
  }
  longestStreak = Math.max(longestStreak, streak);
  const seen = new Set();
  let points = 0;
  for (const l of log) {
    points += 10;
    if ((l.friends || []).length) points += 5;
    const t = l.name.toUpperCase();
    if (!seen.has(t)) { seen.add(t); points += 15; }
  }
  points += streak * 20;
  const studios = new Set(log.map(l => l.studio).filter(Boolean));
  const LEVELS = ['Rookie', 'Regular', 'Committed', 'Athlete', 'Machine', 'Legend'];
  const level = Math.floor(points / 150);
  const weekends = new Set(), satWeeks = new Set(log.filter(l => isoDay(parseYmd(l.date)) === 6).map(l => weekKey(l.date)));
  log.filter(l => isoDay(parseYmd(l.date)) === 7 && satWeeks.has(weekKey(l.date))).forEach(l => weekends.add(weekKey(l.date)));
  const total = log.length;
  // [icon, name, earned, progress?]; streak badges use the best streak so an earned badge is never lost.
  const count = (have, need) => [have >= need, [Math.min(have, need), need]];
  const badges = [
    ['🌱', 'First workout', ...count(total, 1)], ['🔥', '5 workouts', ...count(total, 5)], ['💪', '10 workouts', ...count(total, 10)],
    ['🏅', '25 workouts', ...count(total, 25)], ['🏆', '50 workouts', ...count(total, 50)], ['👑', '100 workouts', ...count(total, 100)],
    ['📆', '3-week streak', ...count(longestStreak, 3)], ['⚡', '8-week streak', ...count(longestStreak, 8)],
    ['🤝', 'Brought a friend', log.some(l => (l.friends || []).length)],
    ['🎨', '5 class types', ...count(seen.size, 5)], ['🧭', '2 studios', ...count(studios.size, 2)],
    ['🌅', 'Early bird (before 9)', log.some(l => l.start && l.start < '09:00')],
    ['🦉', 'Night owl (20:00+)', log.some(l => l.start && l.start >= '20:00')],
    ['🎯', 'Weekend warrior', weekends.size > 0],
  ];
  const nextBadge = badges.filter(b => !b[2] && b[3]).map(([ico, name, , [have, need]]) => ({ ico, name, have, need }))
    .sort((a, b) => b.have / b.need - a.have / a.need)[0] || null;
  return { total, thisWeek, goal, streak, longestStreak, nextBadge, points, level: LEVELS[Math.min(level, LEVELS.length - 1)], levelProgress: (points % 150) / 150, badges, types: seen.size };
}

function renderProgress() {
  const s = stats();
  const recent = [...S.log].sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || ''))).slice(0, 15);
  $('#view').innerHTML = `
    <div class="card">
      <div class="row between"><b>This week</b><span>${s.thisWeek} / ${s.goal}</span></div>
      <div class="bar"><div style="width:${Math.min(100, (s.thisWeek / s.goal) * 100)}%"></div></div>
      <p class="small muted">${s.thisWeek >= s.goal ? 'Weekly goal reached 🎉' : `${s.goal - s.thisWeek} more to hit your weekly goal`}</p>
    </div>
    <div class="card stat-grid">
      <div class="stat"><b>${s.streak}</b><span class="small muted">week streak · best ${s.longestStreak}</span></div>
      <div class="stat"><b>${s.total}</b><span class="small muted">workouts</span></div>
      <div class="stat"><b>${s.points}</b><span class="small muted">points</span></div>
    </div>
    <div class="card"><div class="row between"><b>Level: ${s.level}</b><span class="small muted">${s.types} class types tried</span></div>
      <div class="bar"><div style="width:${s.levelProgress * 100}%"></div></div></div>
    <h2>Badges</h2>
    <div class="badges">${s.badges.map(([ico, name, ok, prog]) => `<div class="badge-tile ${ok ? '' : 'locked'}"><span class="ico">${ico}</span>${h(name)}${!ok && prog ? `<span class="prog">${prog[0]}/${prog[1]}</span>` : ''}</div>`).join('')}</div>
    <h2>Recent workouts</h2>
    ${recent.length ? recent.map(l => `<div class="card row"><div class="grow"><div class="name">${h(l.name)}</div>
      <div class="muted small">${fmtDate(l.date)}${l.start ? ' ' + l.start : ''}${l.studioName ? ' · ' + h(l.studioName) : ''}${(l.friends || []).length ? ' · 👥 ' + l.friends.length : ''}</div></div>
      <button class="btn sm plain" data-act="log-del" data-id="${l.id}">✕</button></div>`).join('') : `<div class="empty">Mark agenda classes as done to start tracking.</div>`}
    <div class="actions"><button class="btn plain block" data-act="log-manual">＋ Log a workout</button></div>
    <p class="small muted">Points: 10 per workout, +5 with a friend, +15 for a new class type, +20 per streak week.</p>`;
}

function logWorkout(entry) {
  S.log.push({ id: uid(), ...entry });
  save();
  const s = stats();
  const earned = s.badges.filter(b => b[2]).length;
  if (earned > (S.badgeCount || 0)) { toast(`🏅 New badge! (${earned} earned)`); S.badgeCount = earned; save(); }
  else toast(`+ workout logged · ${s.thisWeek}/${s.goal} this week`);
}

// ---------- settings & sync ----------
function renderSettings() {
  const plans = schedule.studios.map(st => `<div class="small">${h(st.name)}: ${Object.entries(st.plans || {}).map(([k, p]) => `${PLAN_LABEL[k]} ${p.validFrom ? 'from ' + p.validFrom.split('-').reverse().join('.') : ''}${p.unknownGlyphs ? ' ⚠️' : ''}`).join(', ') || 'no plans'}</div>`).join('');
  const unknownNames = [...new Set(schedule.classes.filter(c => c.name.includes('?')).map(c => c.name))];
  $('#view').innerHTML = `
    <div class="card">
      <b>Schedules</b>
      <p class="small muted">${schedule.studios.length} studios · ${schedule.classes.length} classes${S.lastSync ? ` · last checked ${new Date(S.lastSync).toLocaleString()}` : ''}</p>
      ${plans}
      <div class="actions">
        <button class="btn" data-act="sync">🔄 Check superfit.club for changes</button>
        <label class="btn ghost" style="margin:0;color:var(--accent)">📄 Import plan PDFs<input id="pdf-input" type="file" accept="application/pdf" multiple hidden></label>
      </div>
      <div id="sync-status" class="small" style="margin-top:8px"></div>
    </div>
    ${unknownNames.length ? `<div class="card"><b>Fix unreadable class names</b>
      <p class="small muted">These names contain letters the PDF reader doesn't know yet. Type the correct name and it will be remembered.</p>
      ${unknownNames.map(n => `<label>${h(n)}</label><input data-fix="${h(n)}" placeholder="Correct name">`).join('')}
      <div class="actions"><button class="btn" data-act="save-fixes">Save names</button></div></div>` : ''}
    <div class="card">
      <b>Weekly goal</b>
      <select id="goal">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option ${n === S.prefs.weeklyGoal ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </div>
    <div class="card">
      <b>Backup</b>
      <p class="small muted">Everything is stored on this device only. Export a backup to move to a new phone.</p>
      <div class="actions">
        <button class="btn plain" data-act="export">Export backup</button>
        <label class="btn plain" style="margin:0;color:var(--text)">Import backup<input id="backup-input" type="file" accept="application/json" hidden></label>
      </div>
    </div>`;
}

let pdfjsP;
async function getParser() {
  pdfjsP ||= (async () => {
    const [pdfjs, { parseSchedulePdf }, glyphs] = await Promise.all([
      import('./vendor/pdf.min.mjs'), import('./js/pdfparse.js'), fetch('data/glyphs.json').then(r => r.json()),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
    return data => parseSchedulePdf(pdfjs, data, glyphs.glyphs);
  })();
  return pdfjsP;
}

function applySchedule(next, changes) {
  schedule = next; S.schedule = next; S.lastSync = new Date().toISOString(); save();
  const lines = changes.map(c => {
    if (c.kind === 'error') return `⚠️ ${h(c.studio)}: ${h(c.msg)}`;
    if (c.kind === 'removed') return `➖ ${h(c.studio)} ${PLAN_LABEL[c.plan]}: plan no longer listed`;
    const diff = c.kind === 'new' ? `${c.added.length} classes` : `+${c.added.length} / −${c.removed.length} classes`;
    return `${c.kind === 'new' ? '🆕' : '✏️'} ${h(c.studio)} ${PLAN_LABEL[c.plan]}${c.validFrom ? ` (from ${c.validFrom.split('-').reverse().join('.')})` : ''}: ${diff}${c.unknown ? ' ⚠️ some names unreadable' : ''}`;
  });
  return lines.length ? lines.join('<br>') : 'No changes, you are up to date ✓';
}

// In the Android (Capacitor) build, native HTTP can read superfit.club directly.
const isNative = () => !!window.Capacitor?.isNativePlatform?.();

async function runSync() {
  const status = $('#sync-status');
  try {
    if (!isNative()) throw new TypeError('browser: use the published feed');
    const parsePdf = await getParser();
    const r = await syncSchedule({
      fetchText: async u => { const res = await fetch(u); if (!res.ok) throw new Error(res.status); return res.text(); },
      fetchBytes: async u => { const res = await fetch(u); if (!res.ok) throw new Error(res.status); return new Uint8Array(await res.arrayBuffer()); },
      parsePdf, previous: schedule, nameFixes: S.nameFixes, onProgress: m => (status.textContent = m),
    });
    const msg = applySchedule(r.schedule, r.changes);
    renderSettings(); $('#sync-status').innerHTML = msg;
  } catch (e) {
    if (!(e instanceof TypeError)) { status.innerHTML = `Update failed: ${h(e.message)}`; return; }
    // Browsers can't read superfit.club pages (CORS), so use the schedule feed published
    // next to this app (refreshed daily by the GitHub Action).
    status.textContent = 'Checking the published schedule…';
    try {
      const feed = await fetch('data/schedule.json', { cache: 'no-store' }).then(r => r.json());
      if ((feed.generated || '') <= (schedule.generated || '')) { S.lastSync = new Date().toISOString(); save(); renderSettings(); $('#sync-status').innerHTML = `Up to date ✓ (schedule last changed ${new Date(feed.generated).toLocaleString()}; refreshed daily)`; return; }
      const msg = applySchedule(feed, diffSchedules(schedule, feed));
      renderSettings(); $('#sync-status').innerHTML = `${msg}<br><span class="muted">Source: published schedule from ${new Date(feed.generated).toLocaleString()}</span>`;
    } catch {
      status.innerHTML = `Couldn't check for updates (offline?). You can also download plan PDFs from <a href="https://superfit.club/studios-ubersicht" target="_blank" rel="noopener">superfit.club</a> and use “Import plan PDFs”.`;
    }
  }
}

async function importPdfs(files) {
  const status = $('#sync-status');
  const parsePdf = await getParser();
  let next = { ...schedule, studios: [...schedule.studios], classes: [...schedule.classes], generated: new Date().toISOString() };
  const changes = [];
  for (const f of files) {
    status.textContent = `Reading ${f.name}…`;
    try {
      const parsed = await parsePdf(new Uint8Array(await f.arrayBuffer()));
      const id = parsed.studioName.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
      let st = next.studios.find(s => s.id === id);
      if (!st) { st = { id, name: parsed.studioName[0] + parsed.studioName.slice(1).toLowerCase(), url: `https://superfit.club/studios/${id}`, address: '', plans: {} }; next.studios.push(st); }
      const fresh = toClasses(id, parsed, S.nameFixes);
      const key = c => `${c.day} ${c.start} ${c.name}`;
      const before = next.classes.filter(c => c.studio === id && c.plan === parsed.plan);
      next.classes = next.classes.filter(c => !(c.studio === id && c.plan === parsed.plan)).concat(fresh);
      // A manual import has no site URL, so a later site check will re-read this plan once.
      st.plans = { ...st.plans, [parsed.plan]: { pdf: `file:${f.name}`, validFrom: parsed.validFrom, unknownGlyphs: parsed.unknownGlyphs } };
      changes.push({ studio: st.name, plan: parsed.plan, kind: before.length ? 'updated' : 'new', validFrom: parsed.validFrom,
        added: fresh.filter(c => !before.some(b => key(b) === key(c))), removed: before.filter(b => !fresh.some(c => key(b) === key(c))), unknown: parsed.unknownGlyphs });
    } catch (e) { changes.push({ studio: f.name, kind: 'error', msg: e.message }); }
  }
  const msg = applySchedule(next, changes);
  renderSettings(); $('#sync-status').innerHTML = msg;
}

// ---------- modal ----------
function modal(html, after) {
  $('#modal-body').innerHTML = html + `<div class="actions"><button class="btn plain block" data-act="close">Close</button></div>`;
  const d = $('#modal');
  if (!d.open) d.showModal();
  after?.();
}
const closeModal = () => $('#modal').open && $('#modal').close();
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- events ----------
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') { S.prefs.q = e.target.value; save(); renderResults(); }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'goal') { S.prefs.weeklyGoal = +t.value; save(); toast('Goal saved'); }
  else if (t.id === 'pdf-input') { if (t.files.length) importPdfs([...t.files]); }
  else if (t.id === 'backup-input') importBackup(t.files[0]);
});

const agendaEntry = id => S.agenda.find(a => a.id === id);

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  const p = S.prefs;
  switch (act) {
    case 'close': closeModal(); break;
    case 'studio-all': p.allStudios = true; save(); renderSearch(); break;
    case 'studio-mine': p.allStudios = false; save(); renderSearch(); break;
    case 'studio': {
      // Newly selected studios go to the front of the row; deselected ones drop back into place.
      const cur = myStudios();
      p.studios = cur.includes(id) ? cur.filter(x => x !== id) : [id, ...cur];
      p.allStudios = !p.studios.length;
      save(); renderSearch(); break;
    }
    case 'toggle-day': p.days = toggle(p.days, Number(id)); save(); renderSearch(); break;
    case 'toggle-tod': p.tods = toggle(p.tods, id); save(); renderSearch(); break;
    case 'toggle-plan': p.plans = toggle(p.plans, id); save(); renderSearch(); break;
    case 'expand-day': {
      const closing = expandedDays.has(id);
      closing ? expandedDays.delete(id) : expandedDays.add(id);
      renderResults();
      if (closing) document.querySelector(`.daycard[data-day="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      break;
    }
    case 'goto': tab = id; render(); window.scrollTo(0, 0); break;
    case 'quick-plan': {
      const ent = addToAgenda(id, el.dataset.date);
      render();
      toast(`Planned ${ent.name} · ${fmtDate(ent.date)} ${ent.start}`, [{ label: 'Undo', act: 'undo-plan', id: ent.id }, { label: 'Invite', act: 'invite', id: ent.id }]);
      break;
    }
    case 'undo-plan': S.agenda = S.agenda.filter(a => a.id !== id); save(); render(); toast('Removed from agenda'); break;
    case 'open-class': openClass(id, el.dataset.date); break;
    case 'goto-settings': tab = 'settings'; render(); break;
    case 'add-agenda': { const d = $('#class-date')?.value; if (!d) return toast('No upcoming date'); addToAgenda(id, d); closeModal(); if (tab === 'search') renderSearch(); break; }
    case 'add-invite': { const d = $('#class-date')?.value; if (!d) return toast('No upcoming date'); const ent = addToAgenda(id, d); inviteSheet(ent); break; }
    case 'invite': inviteSheet(agendaEntry(id)); break;
    case 'cal': calendarSheet(agendaEntry(id)); break;
    case 'ics': downloadIcs(agendaEntry(id)); break;
    case 'mark-invited': { const ent = agendaEntry(id); if (!ent.friends.includes(el.dataset.friend)) { ent.friends.push(el.dataset.friend); save(); } break; }
    case 'share': {
      const ent = agendaEntry(id), text = inviteText(ent);
      if (navigator.share) { try { await navigator.share({ title: ent.name, text }); } catch { /* cancelled */ } }
      else { await navigator.clipboard?.writeText(text); toast('Invite copied to clipboard'); }
      break;
    }
    case 'remove': S.agenda = S.agenda.filter(a => a.id !== id); save(); render(); break;
    case 'done': {
      const ent = agendaEntry(id); ent.status = 'done'; save();
      logWorkout({ date: ent.date, start: ent.start, name: ent.name, studio: ent.studio, studioName: ent.studioName, classId: ent.classId, friends: ent.friends });
      render(); break;
    }
    case 'missed': agendaEntry(id).status = 'missed'; save(); render(); break;
    case 'log-manual': modal(`<h3>Log a workout</h3>
        <label>What did you do?</label><input id="lm-name" placeholder="e.g. Free weights, Run">
        <label>Date</label><input id="lm-date" type="date" value="${todayYmd()}">
        <label>Studio</label><select id="lm-studio"><option value="">(none)</option>${schedule.studios.map(s => `<option value="${h(s.id)}">${h(s.name)}</option>`).join('')}</select>
        <div class="actions"><button class="btn block" data-act="log-save">Save</button></div>`); break;
    case 'log-save': {
      const name = $('#lm-name').value.trim(); if (!name) return toast('Enter a name');
      const sid = $('#lm-studio').value;
      logWorkout({ date: $('#lm-date').value || todayYmd(), name, studio: sid, studioName: sid ? studioById(sid).name : '', friends: [] });
      closeModal(); render(); break;
    }
    case 'log-del': S.log = S.log.filter(l => l.id !== id); save(); render(); break;
    case 'show-all-done': showAllDone = true; renderAgenda(); break;
    case 'friend-add': {
      const name = $('#fr-name').value.trim(); if (!name) return toast('Enter a name');
      S.friends.push({ id: uid(), name, phone: $('#fr-phone').value.trim(), email: $('#fr-email').value.trim() }); save(); renderFriends(); break;
    }
    case 'friend-contacts': {
      try {
        const picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
        for (const c of picked) S.friends.push({ id: uid(), name: c.name?.[0] || c.tel?.[0] || 'Friend', phone: c.tel?.[0] || '', email: c.email?.[0] || '' });
        save(); renderFriends();
      } catch { /* cancelled */ }
      break;
    }
    case 'friend-del': S.friends = S.friends.filter(f => f.id !== id); save(); renderFriends(); break;
    case 'sync': runSync(); break;
    case 'save-fixes': {
      document.querySelectorAll('[data-fix]').forEach(i => { if (i.value.trim()) S.nameFixes[i.dataset.fix] = i.value.trim().toUpperCase(); });
      for (const c of schedule.classes) if (S.nameFixes[c.name]) c.name = S.nameFixes[c.name];
      S.schedule = schedule; save(); renderSettings(); toast('Names saved'); break;
    }
    case 'export': {
      const { schedule: _, ...rest } = S;
      const blob = new Blob([JSON.stringify(rest, null, 1)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `superfit-planner-backup-${todayYmd()}.json` });
      document.body.append(a); a.click(); a.remove(); break;
    }
  }
});

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.agenda) || !Array.isArray(data.friends)) throw new Error('Not a Superfit Planner backup');
    // Backups from any app version are upgraded the same way as stored data.
    S = store.migrate({ ...S, ...data }).state; save(); toast('Backup restored'); render();
  } catch (e) { toast(e.message); }
}

// ---------- boot ----------
await loadData();
render();
if (loaded.corrupt) toast('Saved data could not be read; a copy was kept. Restore a backup in Settings.');
else if (loaded.newer) toast('This data is from a newer app version. Reload to update the app.');
// Ask the browser not to evict our local data (matters most on iPhone).
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
