import * as D from './dates.js';
import { load, save, uid } from './store.js';
import {
  plan, buildChunks, chunkLabel, suggestFixes, slotTimes, habitsForDay, suggestHabitDays,
  weekSummary, unplacedMinutes,
} from './scheduler.js';
import { parseDictation } from './parser.js';
import { buildICS, deliverICS } from './ics.js';
import { aiParse, aiSteps } from './ai.js';
import * as Cloud from './cloud.js';

let state = load();
let today = D.todayStr();
const ui = { drafts: [], results: null, dictation: '', busy: false, listening: false, editing: null, confirmDelete: false };

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const MIC = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const WARM = [
  'Nice. That bit is done.',
  'Good work. That counts.',
  'Done. One less thing on your mind.',
  'Little by little. Well done.',
  'That’s progress. Take a breath.',
  'Lovely. You showed up for it.',
];
const MINUTE_OPTIONS = [10, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 900, 1200];
const PREF_TIMES = { morning: 'Morning', lunch: 'Lunchtime', evening: 'Evening' };
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- state helpers ----------

const persist = () => save(state);

// Each task and habit keeps its own colour, like the coloured tiles in a clay deck.
const TINTS = ['pink', 'amber', 'green', 'blue', 'violet'];
// new tasks and habits take the next colour in turn, so neighbours rarely match
function nextTint() {
  const used = [...state.tasks, ...state.habits].map((x) => x.tint).filter(Boolean);
  return TINTS[used.length % TINTS.length];
}
function tint(id) {
  const owner = state.tasks.find((t) => t.id === id) || state.habits.find((h) => h.id === id);
  if (owner?.tint) return `--c:var(--${owner.tint})`;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `--c:var(--${TINTS[h % TINTS.length]})`;
}
function replan() {
  plan(state, today);
  persist();
}
function findChunk(id) {
  for (const t of state.tasks) for (const c of t.chunks) if (c.id === id) return { t, c };
  return {};
}
const taskById = (id) => state.tasks.find((t) => t.id === id);
const doneMinutes = (t) => t.chunks.filter((c) => c.done).reduce((a, c) => a + c.minutes, 0);
const percent = (t) => (t.totalMinutes ? Math.round((100 * doneMinutes(t)) / t.totalMinutes) : 0);

function dayCheck() {
  const now = D.todayStr();
  if (now === today && state.lastPlanned === today) return false;
  today = now;
  const missed = state.tasks.some((t) => t.chunks.some((c) => !c.done && c.date && c.date < today));
  plan(state, today);
  if (missed) {
    state.notice = { date: today, text: 'A few bits from earlier have been spread gently across the coming days. Nothing to catch up on today.' };
  }
  persist();
  return true;
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

// ---------- shared fragments ----------

function minuteOptions(selected) {
  const list = [...MINUTE_OPTIONS];
  if (selected && !list.includes(+selected)) list.push(+selected);
  list.sort((a, b) => a - b);
  return `<option value="" ${selected ? '' : 'selected'} disabled>Choose…</option>` +
    list.map((m) => `<option value="${m}" ${+selected === m ? 'selected' : ''}>${D.fmtMinutes(m)}</option>`).join('');
}

function seg(act, current, options, extra = '') {
  return `<div class="seg" role="group">${options
    .map(([v, label]) => `<button type="button" data-act="${act}" data-v="${v}" ${extra} aria-pressed="${String(current) === String(v)}">${label}</button>`)
    .join('')}</div>`;
}

function fitNote(t) {
  if (t.overdue && t.chunks.some((c) => !c.done)) {
    return `<div class="note note-warm"><p>The deadline for this one has passed. That’s okay. What’s left is spread over the next few days. Pick a new date whenever you’re ready.</p></div>`;
  }
  if (!t.unplaced) return '';
  const mins = unplacedMinutes(t);
  const fx = suggestFixes(state, t.id, today);
  const buttons = [
    fx.deadline ? `<button class="btn btn-sm" data-act="fix-deadline" data-id="${t.id}" data-v="${fx.deadline}">Move deadline to ${D.fmtDay(fx.deadline)}</button>` : '',
    fx.limit ? `<button class="btn btn-sm" data-act="fix-limit" data-v="${fx.limit}">Let days hold up to ${D.fmtMinutes(fx.limit)}</button>` : '',
  ].join('');
  return `<div class="note note-warm">
    <p>This one is a bit big for the days before ${D.fmtDay(t.deadline)}. About ${D.fmtMinutes(mins)} doesn’t fit yet. Easy to sort:</p>
    ${buttons ? `<div class="row">${buttons}</div>` : '<p>Try a later deadline or fewer days off in Settings.</p>'}
  </div>`;
}

const GRADIENT = (id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pink)"/><stop offset="1" stop-color="var(--amber)"/></linearGradient></defs>`;

function ring(done, total, size = 96) {
  const r = size / 2 - 12;
  const circ = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  const label = total ? `${Math.round(frac * 100)}%<small>of today</small>` : `Free<small>today</small>`;
  return `<div class="ring" role="img" aria-label="${total ? `${Math.round(frac * 100)} percent of today done` : 'Nothing planned today'}">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${GRADIENT('g-day')}
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="7"/>
      <circle class="fill" stroke="url(#g-day)" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - frac)}" ${frac === 0 ? 'opacity="0"' : ''}/>
    </svg>
    <span class="ring-label">${label}</span>
  </div>`;
}

// ---------- Today ----------

function todayChunks() {
  const times = slotTimes(state, today);
  const items = [];
  for (const t of state.tasks) for (const c of t.chunks) if (c.date === today) items.push({ t, c, time: times[c.id] });
  items.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return items;
}

function renderToday() {
  const items = todayChunks();
  const habits = habitsForDay(state, today);
  let total = 0;
  let done = 0;
  for (const { c } of items) { total += c.minutes; if (c.done) done += c.minutes; }
  for (const h of habits) { total += h.minutes; if (h.log?.[today]) done += h.minutes; }

  const notice = state.notice?.date === today
    ? `<div class="note"><p>${esc(state.notice.text)}</p><div><button class="btn-text" data-act="dismiss-notice">Okay</button></div></div>` : '';
  const needsRoom = state.tasks.some((t) => t.unplaced && t.chunks.some((c) => !c.done));
  const roomNote = needsRoom
    ? `<div class="note note-warm"><p>One task needs a little more room. Have a look in All tasks when you’re ready.</p></div>` : '';

  let list;
  if (!state.tasks.length && !state.habits.length) {
    list = `<div class="card empty">
      <h2>Nothing planned yet</h2>
      <p class="muted">Tell the app what’s pending and when it’s due. It does the splitting.</p>
      <button class="btn btn-primary" data-act="seed-audit">Plan my first task: Audits at work</button>
      <a class="btn-text" href="#add">Add something else</a>
    </div>`;
  } else if (!items.length && !habits.length) {
    const next = state.tasks.flatMap((t) => t.chunks).filter((c) => !c.done && c.date && c.date > today).map((c) => c.date).sort()[0];
    list = `<div class="card empty"><h2>Nothing planned for today</h2>
      <p class="muted">Rest counts too.${next ? ` Your next bit is ${D.fmtDay(next, today).toLowerCase() === 'tomorrow' ? 'tomorrow' : `on ${D.fmtDay(next)}`}.` : ''}</p></div>`;
  } else {
    list = `<ul class="items">
      ${items.map(({ t, c, time }) => `
        <li class="card item ${c.done ? 'is-done' : ''}" style="${tint(t.id)}">
          <button class="tick" data-act="tick" data-id="${c.id}" aria-pressed="${!!c.done}" aria-label="${c.done ? 'Mark not done' : 'Mark done'}: ${esc(t.name)}">${CHECK}</button>
          <div class="item-body">
            <p class="item-title">${esc(t.name)} ${t.priority === 'high' ? '<span class="badge">High</span>' : ''}</p>
            <p class="item-meta">${esc(chunkLabel(t, c))} · ${c.minutes} min${time && !c.done ? ` · around ${time}` : ''}</p>
            <div class="item-actions">
              <button class="btn btn-sm btn-quiet" data-act="timer" data-id="${c.id}">Start ${c.minutes}-minute timer</button>
              <button class="btn btn-sm" data-act="too-much" data-id="${c.id}">Too much today</button>
            </div>
          </div>
        </li>`).join('')}
      ${habits.map((h) => `
        <li class="card item ${h.log?.[today] ? 'is-done' : ''}" style="${tint(h.id)}">
          <button class="tick" data-act="habit-tick" data-id="${h.id}" aria-pressed="${!!h.log?.[today]}" aria-label="${h.log?.[today] ? 'Mark not done' : 'Mark done'}: ${esc(h.name)}">${CHECK}</button>
          <div class="item-body">
            <p class="item-title">${esc(h.name)}</p>
            <p class="item-meta">Habit · ${h.minutes} min</p>
            <div class="item-actions"><button class="btn btn-sm btn-quiet" data-act="habit-timer" data-id="${h.id}">Start ${h.minutes}-minute timer</button></div>
          </div>
        </li>`).join('')}
    </ul>`;
  }

  const open = items.some(({ c }) => !c.done);
  const w = weekSummary(state, today);
  return `
    <section class="today-head">
      <div>
        <p class="eyebrow">${D.fmtLong(today)}</p>
        <h1>Today you only need to do this.</h1>
        <p class="lede">Everything else is handled.</p>
      </div>
      ${ring(done, total)}
    </section>
    ${notice}
    ${list}
    ${roomNote}
    ${open ? `<button class="btn btn-block" data-act="export-today">Add today’s chunks to calendar</button>` : ''}
    <section class="card week" aria-label="This week">
      <p class="eyebrow">This week</p>
      <p class="week-line">${esc(w.line)}</p>
      <div class="week-stats">
        <div class="stat"><b>${w.chunks}</b><span>chunks done</span></div>
        <div class="stat"><b>${D.fmtMinutes(w.minutes).replace(' min', 'm').replace(' h', 'h')}</b><span>of focus</span></div>
        <div class="stat"><b>${w.habitSessions}</b><span>habit sessions</span></div>
      </div>
      ${w.moved.length || w.habits.length ? `<p class="muted small">Moved forward: ${esc([...w.moved, ...w.habits].join(', '))}</p>` : ''}
    </section>`;
}

// ---------- Add ----------

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

function deadlineChips(i) {
  const fri = D.addDays(today, (5 - D.weekday(today) + 7) % 7 || 7);
  const opts = [
    ['Tomorrow', D.addDays(today, 1)],
    [`Fri ${D.fromStr(fri).getDate()}`, fri],
    ['In a week', D.addDays(today, 7)],
    ['In 2 weeks', D.addDays(today, 14)],
  ];
  return `<div class="row">${opts.map(([l, v]) => `<button type="button" class="chip" data-act="d-set" data-i="${i}" data-k="deadline" data-v="${v}" aria-pressed="${ui.drafts[i].deadline === v}">${l}</button>`).join('')}</div>`;
}
function minuteChips(i) {
  return `<div class="row">${[30, 60, 120, 180, 300].map((m) => `<button type="button" class="chip" data-act="d-set" data-i="${i}" data-k="minutes" data-v="${m}" aria-pressed="${+ui.drafts[i].minutes === m}">${D.fmtMinutes(m)}</button>`).join('')}</div>`;
}

function draftCard(d, i) {
  let question = '';
  if (!d.deadline) question = `<p class="question">When does this need to be done by?</p>${deadlineChips(i)}`;
  else if (!d.minutes) question = `<p class="question">Roughly how long will it take altogether?</p>${minuteChips(i)}`;
  return `<form class="card draft" data-draft="${i}">
    ${question}
    <label class="field">Task<input class="input" id="d-name-${i}" name="name" value="${esc(d.name)}" placeholder="e.g. Shoulder dislocation audit" autocomplete="off"></label>
    <div class="two">
      <label class="field">Deadline<input class="input" id="d-deadline-${i}" name="deadline" type="date" min="${today}" value="${d.deadline || ''}"></label>
      <label class="field">Total time<select class="input" id="d-minutes-${i}" name="minutes">${minuteOptions(d.minutes)}</select></label>
    </div>
    <div class="row" style="justify-content:space-between">
      <div class="stack" style="gap:6px"><span class="small muted">Chunk size</span>${seg('d-set', d.chunkSize, [[10, '10 min'], [30, '30 min']], `data-i="${i}" data-k="chunkSize"`)}</div>
      <div class="stack" style="gap:6px"><span class="small muted">Priority</span>${seg('d-set', d.priority, [['normal', 'Normal'], ['high', 'High']], `data-i="${i}" data-k="priority"`)}</div>
    </div>
    <div class="row" style="justify-content:space-between">
      <button class="btn btn-primary" type="submit">Plan it</button>
      <button class="btn-text" type="button" data-act="d-remove" data-i="${i}">Remove</button>
    </div>
  </form>`;
}

function resultCard(t) {
  const planned = t.chunks.filter((c) => !c.done && c.date).map((c) => c.date).sort();
  const first = planned[0];
  const last = planned[planned.length - 1];
  const days = new Set(planned).size;
  let when = '';
  if (first) {
    when = first === last
      ? `${planned.length} ${planned.length === 1 ? 'chunk' : 'chunks'} of ${t.chunkSize} min, ${D.fmtDay(first, today).toLowerCase() === 'today' ? 'today' : `on ${D.fmtDay(first)}`}.`
      : `${planned.length} chunks of up to ${t.chunkSize} min, spread over ${days} days from ${D.fmtDay(first)} to ${D.fmtDay(last)}.`;
  }
  const buffer = last && last < t.deadline
    ? `Finished by ${D.fmtDay(last)}, with room to spare before the deadline.`
    : last ? 'This one runs right up to the deadline, as there wasn’t room a day earlier.' : '';
  return `<div class="card stack">
    <p class="eyebrow">Planned</p>
    <h2>${esc(t.name)}</h2>
    ${when ? `<p>${when}</p>` : ''}
    ${buffer ? `<p class="muted">${buffer}</p>` : ''}
    ${fitNote(t)}
  </div>`;
}

function renderAdd() {
  if (ui.results) {
    const tasks = ui.results.map(taskById).filter(Boolean);
    return `<h1>All set</h1>
      ${tasks.map(resultCard).join('')}
      <a class="btn btn-primary btn-block" href="#today" data-act="clear-results">See today</a>
      <button class="btn btn-block" data-act="add-another">Add another</button>`;
  }
  if (ui.drafts.length) {
    return `<section class="stack">
        <h1>${ui.drafts.length > 1 ? `Check these ${ui.drafts.length}` : 'Check the details'}</h1>
        <p class="lede">Fix anything that looks off, then plan it.</p>
      </section>
      ${ui.drafts.map(draftCard).join('')}
      <button class="btn-text" data-act="start-over">Start over</button>`;
  }
  return `
    <section class="stack">
      <h1>What’s on your plate?</h1>
      <p class="lede">Say it like you’d tell a friend, for example: “Finish the shoulder dislocation audit by Friday, about three hours.”</p>
    </section>
    <div class="dictate">
      <label for="dictation" class="eyebrow" style="display:block;margin-bottom:8px">Tap the box and use the dictation key, or the mic</label>
      <textarea id="dictation" class="input" placeholder="What’s pending, when it’s due, and roughly how long it’ll take…">${esc(ui.dictation)}</textarea>
      ${SR ? `<button class="mic" type="button" data-act="mic" aria-pressed="${ui.listening}" aria-label="${ui.listening ? 'Stop listening' : 'Start listening'}">${MIC}</button>` : ''}
    </div>
    <div class="row">
      <button class="btn btn-primary" data-act="parse" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Reading…' : 'Read it'}</button>
      <button class="btn-text" data-act="manual">Use a form instead</button>
    </div>`;
}

function newDraft(over = {}) {
  return { name: '', deadline: null, minutes: null, chunkSize: state.settings.defaultChunk, priority: 'normal', ...over };
}

async function parseInput() {
  const text = ($('#dictation')?.value || ui.dictation).trim();
  ui.dictation = text;
  if (!text) { toast('Say or type a task first.'); return; }
  let drafts = null;
  if (state.settings.aiKey) {
    ui.busy = true; render();
    try { drafts = await aiParse(state.settings.aiKey, text, today); }
    catch { toast('Couldn’t reach the AI, so the simple reader was used.'); }
    ui.busy = false;
  }
  if (!drafts || !drafts.length) drafts = parseDictation(text, today);
  if (!drafts.length) drafts = [{ name: text }];
  ui.drafts = drafts.map((d) => newDraft({
    ...d,
    deadline: d.deadline || null,
    chunkSize: d.minutes && d.minutes <= 30 ? 10 : state.settings.defaultChunk,
  }));
  render();
}

function createTask(d) {
  const t = {
    id: uid(), name: d.name.trim(), deadline: d.deadline, totalMinutes: +d.minutes,
    chunkSize: +d.chunkSize, priority: d.priority, createdAt: today, chunks: [], tint: nextTint(),
  };
  t.chunks = buildChunks(t.totalMinutes, t.chunkSize);
  state.tasks.push(t);
  return t;
}

function addStepNames(t) {
  const key = state.settings.aiKey;
  const open = t.chunks.filter((c) => !c.step);
  if (!key || !open.length) return;
  aiSteps(key, t.name, t.chunks.length, t.chunkSize)
    .then((steps) => {
      if (!steps) return;
      const live = taskById(t.id);
      if (!live) return;
      live.chunks.forEach((c, i) => { if (!c.step) c.step = steps[i]; });
      persist();
      render();
    })
    .catch(() => {});
}

function submitDraft(i) {
  const d = ui.drafts[i];
  if (!d.name?.trim()) return toast('Give the task a short name first.');
  if (!d.deadline) return toast('Just need the deadline first.');
  if (!d.minutes) return toast('Just need a rough total time first.');
  const t = createTask(d);
  replan();
  addStepNames(t);
  ui.drafts.splice(i, 1);
  ui.planned = [...(ui.planned || []), t.id];
  if (ui.drafts.length) {
    // more dictated tasks still to confirm; show the results once they're all planned
    toast(`Planned “${t.name}”.`);
  } else {
    ui.results = ui.planned;
    ui.planned = [];
    ui.dictation = '';
  }
  render();
}

let rec = null;
function toggleMic() {
  if (ui.listening && rec) { rec.stop(); return; }
  try {
    rec = new SR();
    rec.lang = 'en-GB';
    rec.interimResults = true;
    rec.continuous = true;
    const base = ($('#dictation')?.value || '').trimEnd();
    rec.onresult = (e) => {
      let txt = '';
      for (const r of e.results) txt += r[0].transcript;
      ui.dictation = (base ? `${base} ` : '') + txt;
      const ta = $('#dictation');
      if (ta) ta.value = ui.dictation;
    };
    rec.onerror = () => toast('The mic isn’t available here. The dictation key on your keyboard works too.');
    rec.onend = () => { ui.listening = false; const b = $('.mic'); if (b) b.setAttribute('aria-pressed', 'false'); };
    rec.start();
    ui.listening = true;
    $('.mic')?.setAttribute('aria-pressed', 'true');
  } catch {
    toast('The mic isn’t available here. The dictation key on your keyboard works too.');
  }
}

// ---------- All tasks ----------

function renderTasks() {
  const open = state.tasks.filter((t) => t.chunks.some((c) => !c.done)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const finished = state.tasks.filter((t) => t.chunks.length && t.chunks.every((c) => c.done));
  const card = (t) => {
    const left = t.chunks.filter((c) => !c.done);
    const next = left.map((c) => c.date).filter(Boolean).sort()[0];
    return `<button class="card task" data-act="open-task" data-id="${t.id}" style="${tint(t.id)}">
      <div class="task-top">
        <span class="task-name">${esc(t.name)} ${t.priority === 'high' ? '<span class="badge">High</span>' : ''}${t.unplaced ? ' <span class="badge badge-warm">Needs room</span>' : ''}</span>
        <span class="task-due">${left.length ? `Due ${D.fmtDay(t.deadline)}` : 'Finished'}</span>
      </div>
      <div class="bar" aria-hidden="true"><span style="width:${percent(t)}%"></span></div>
      <div class="task-meta"><span>${percent(t)}% done</span><span>${left.length ? `${left.length} ${left.length === 1 ? 'chunk' : 'chunks'} left${next ? ` · next ${/^(Today|Tomorrow)$/.test(D.fmtDay(next, today)) ? D.fmtDay(next, today).toLowerCase() : D.fmtDay(next)}` : ''}` : 'All done'}</span></div>
    </button>`;
  };
  const habitCard = (h) => {
    const days = WEEK.filter((d) => h.days.includes(d)).map((d) => SHORT_DAY[d]).join(', ');
    return `<button class="card task" data-act="open-habit" data-id="${h.id}" style="${tint(h.id)}">
      <div class="task-top"><span class="task-name">${esc(h.name)}</span><span class="task-due">${h.minutes} min</span></div>
      <div class="task-meta"><span>${days}</span></div>
    </button>`;
  };
  return `
    <div class="section-head"><h1>All tasks</h1></div>
    ${open.length ? open.map(card).join('') : `<div class="card empty"><h2>No tasks waiting</h2><p class="muted">Nice and clear.</p><a class="btn btn-primary" href="#add">Add a task</a></div>`}
    ${open.length ? `<button class="btn btn-block" data-act="export-all">Add all upcoming to calendar</button>` : ''}
    <div class="section-head"><h2>Little habits</h2><button class="btn btn-sm btn-quiet" data-act="new-habit">Add a habit</button></div>
    ${state.habits.length ? state.habits.map(habitCard).join('') : '<p class="muted small">Small things you’d like a bit of each week, like the gym three times or 20 minutes of your course. They show up in Today on their days.</p>'}
    ${finished.length ? `<div class="section-head"><h2>Finished</h2></div>${finished.map(card).join('')}` : ''}`;
}

// ---------- Sheets ----------

function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  ui.editing = null;
  ui.confirmDelete = false;
  render();
}
const sheetHead = (title) => `<div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="icon-btn" data-close aria-label="Close">${CLOSE}</button></div>`;

function taskSheet() {
  const e = ui.editing;
  const t = taskById(e.id);
  if (!t) return closeSheet();
  const times = {};
  const chunks = t.chunks.map((c) => {
    if (c.date && !times[c.date]) Object.assign(times, slotTimes(state, c.date));
    const when = c.done ? `Done ${D.fmtDay(c.doneOn, today)}` : c.date ? `${D.fmtDay(c.date, today)}${times[c.id] ? `, ${times[c.id]}` : ''}` : 'Waiting for room';
    return `<li>
      <button class="tick" data-act="tick" data-id="${c.id}" aria-pressed="${!!c.done}" aria-label="${c.done ? 'Mark not done' : 'Mark done'}">${CHECK}</button>
      <span>${esc(chunkLabel(t, c))} · ${c.minutes} min</span>
      <span class="chunk-when">${when}</span>
    </li>`;
  }).join('');
  openSheet(`${sheetHead('Edit task')}
    <form id="task-form" class="stack">
      <label class="field">Task<input class="input" id="e-name" name="name" value="${esc(e.name)}"></label>
      <div class="two">
        <label class="field">Deadline<input class="input" id="e-deadline" name="deadline" type="date" value="${e.deadline}"></label>
        <label class="field">Total time<select class="input" id="e-minutes" name="totalMinutes">${minuteOptions(e.totalMinutes)}</select></label>
      </div>
      <div class="row" style="justify-content:space-between">
        <div class="stack" style="gap:6px"><span class="small muted">Chunk size</span>${seg('e-set', e.chunkSize, [[10, '10 min'], [30, '30 min']], 'data-k="chunkSize"')}</div>
        <div class="stack" style="gap:6px"><span class="small muted">Priority</span>${seg('e-set', e.priority, [['normal', 'Normal'], ['high', 'High']], 'data-k="priority"')}</div>
      </div>
      ${fitNote(t)}
      <button class="btn btn-primary btn-block" type="submit">Save and re-plan</button>
    </form>
    <div class="stack" style="margin-top:24px">
      <h3>Chunks</h3>
      <ul class="chunk-list" style="${tint(t.id)}">${chunks}</ul>
    </div>
    <div style="margin-top:20px">
      ${ui.confirmDelete
        ? `<div class="note"><p>Delete “${esc(t.name)}” and its chunks? This can’t be undone.</p><div class="row"><button class="btn btn-sm" data-act="delete-task" data-id="${t.id}">Delete it</button><button class="btn btn-sm btn-quiet" data-act="cancel-delete">Keep it</button></div></div>`
        : `<button class="btn-text" data-act="ask-delete">Delete this task</button>`}
    </div>`);
}

function saveTask() {
  const e = ui.editing;
  const t = taskById(e.id);
  if (!e.name.trim() || !e.deadline || !e.totalMinutes) return toast('A name, a deadline and a total time are all it needs.');
  const resplit = +e.totalMinutes !== t.totalMinutes || +e.chunkSize !== t.chunkSize;
  Object.assign(t, { name: e.name.trim(), deadline: e.deadline, totalMinutes: +e.totalMinutes, chunkSize: +e.chunkSize, priority: e.priority });
  if (resplit) t.chunks = buildChunks(t.totalMinutes, t.chunkSize, t.chunks);
  replan();
  if (resplit) addStepNames(t);
  toast('Saved. The plan has been rebalanced.');
  taskSheet();
}

function habitSheet() {
  const h = ui.editing;
  openSheet(`${sheetHead(h.isNew ? 'New habit' : 'Edit habit')}
    <form id="habit-form" class="stack">
      <label class="field">Habit<input class="input" id="h-name" name="name" value="${esc(h.name)}" placeholder="e.g. Gym, Cook a proper meal, Course"></label>
      <div class="two">
        <label class="field">How long<select class="input" id="h-minutes" name="minutes">${[10, 15, 20, 30, 45, 60, 90].map((m) => `<option value="${m}" ${+h.minutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        <label class="field">Times a week<select class="input" id="h-times" name="times">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${h.days.length === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="stack" style="gap:6px"><span class="small muted">On these days</span>
        <div class="days">${WEEK.map((d) => `<button type="button" class="chip" data-act="h-day" data-v="${d}" aria-pressed="${h.days.includes(d)}">${SHORT_DAY[d]}</button>`).join('')}</div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${h.isNew ? 'Add habit' : 'Save'}</button>
      ${h.isNew ? '' : `<button class="btn-text" type="button" data-act="delete-habit">Remove this habit</button>`}
    </form>`);
}

function saveHabit() {
  const h = ui.editing;
  if (!h.name.trim()) return toast('Give the habit a name first.');
  if (!h.days.length) return toast('Pick at least one day.');
  const existing = state.habits.find((x) => x.id === h.id);
  const data = { id: h.id, name: h.name.trim(), minutes: +h.minutes, days: [...h.days], log: existing?.log || {}, tint: existing?.tint || nextTint() };
  if (existing) Object.assign(existing, data); else state.habits.push(data);
  persist();
  closeSheet();
  toast(existing ? 'Saved.' : 'Habit added. It’ll show up in Today on its days.');
}

function prefsSheet() {
  const s = state.settings;
  const limits = [30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
  if (!limits.includes(s.dailyLimit)) limits.push(s.dailyLimit);
  const off = [...s.unavailableDates].filter((d) => d >= today).sort();
  openSheet(`${sheetHead('Settings')}
    <div class="stack" style="gap:22px">
      <label class="field">Most task time on any one day
        <select class="input" id="p-limit" data-pref="dailyLimit">${limits.sort((a, b) => a - b).map((m) => `<option value="${m}" ${s.dailyLimit === m ? 'selected' : ''}>${D.fmtMinutes(m)}</option>`).join('')}</select>
      </label>
      <div class="stack" style="gap:8px">
        <span class="field">Best time of day for chunks</span>
        ${seg('pref-time', s.preferredTime, Object.entries(PREF_TIMES))}
        <div class="two">
          ${Object.entries(PREF_TIMES).map(([k, l]) => `<label class="field small">${l} starts at<input class="input" type="time" id="p-slot-${k}" data-slot="${k}" value="${s.slotTimes[k]}"></label>`).join('')}
        </div>
      </div>
      <div class="stack" style="gap:8px">
        <span class="field">Usual days off</span>
        <div class="days">${WEEK.map((d) => `<button type="button" class="chip" data-act="pref-weekday" data-v="${d}" aria-pressed="${s.offWeekdays.includes(d)}">${SHORT_DAY[d]}</button>`).join('')}</div>
        <p class="small muted">No chunks are planned on these days.</p>
      </div>
      <div class="stack" style="gap:8px">
        <span class="field">Unavailable dates (on call, leave)</span>
        <div class="two">
          <label class="field small">From<input class="input" type="date" id="p-off-from" min="${today}"></label>
          <label class="field small">To (optional)<input class="input" type="date" id="p-off-to" min="${today}"></label>
        </div>
        <button class="btn btn-sm" data-act="pref-add-off" style="justify-self:start">Add dates</button>
        ${off.length ? `<div class="days">${off.map((d) => `<button class="chip" data-act="pref-remove-off" data-v="${d}" aria-label="Remove ${D.fmtDay(d)}">${D.fmtDay(d)} ✕</button>`).join('')}</div>` : ''}
      </div>
      <div class="stack" style="gap:8px"><span class="field">Default chunk size</span>${seg('pref-chunk', s.defaultChunk, [[10, '10 min'], [30, '30 min']])}</div>
      <div class="stack" style="gap:8px"><span class="field">Appearance</span>${seg('pref-theme', s.theme, [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="stack" style="gap:8px"><span class="field">Focus timer</span>${focusPanel()}</div>
      ${syncSection()}
      <label class="field">Anthropic API key (optional)
        <input class="input" type="password" id="p-ai" data-pref="aiKey" value="${esc(s.aiKey)}" placeholder="sk-ant-…" autocomplete="off">
        <span class="small muted" style="font-weight:400">With a key, dictation is read by Claude and chunks get step names like “Collect data”. The key stays on this phone and is only sent to Anthropic.</span>
      </label>
    </div>`);
}

function syncSection() {
  const st = Cloud.getStatus();
  if (!st.available) return '';
  const when = st.lastSync ? new Date(st.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  let body;
  if (st.signedIn) {
    body = `<p>Signed in as <b>${esc(st.email)}</b>.</p>
      <p class="small muted">${st.syncing ? 'Syncing…' : st.error ? esc(st.error) : when ? `Last synced at ${when}.` : 'Getting ready…'}</p>
      <div class="row"><button class="btn btn-sm" data-act="sync-now">Sync now</button><button class="btn-text" data-act="sync-signout">Sign out</button></div>`;
  } else if (st.pendingEmail) {
    body = `<p class="small">We emailed a code to <b>${esc(st.pendingEmail)}</b>. Type it here, or tap the link in the email.</p>
      <form id="code-form" class="row"><input class="input" id="sync-code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" style="flex:1;min-width:8rem"><button class="btn btn-primary btn-sm" type="submit">Sign in</button></form>
      <button class="btn-text" data-act="sync-cancel">Use a different email</button>`;
  } else {
    body = `<p class="small muted" style="font-weight:400">Sign in with the same account as Bibliophile and your tasks, ticks and habits follow you between iPhone, iPad and Mac.</p>
      <form id="email-form" class="row"><input class="input" id="sync-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" style="flex:1;min-width:12rem"><button class="btn btn-sm" type="submit">Email me a code</button></form>
      ${st.google ? '<button class="btn btn-block" data-act="sync-google">Continue with Google</button>' : ''}
      ${st.error ? `<p class="small muted">${esc(st.error)}</p>` : ''}`;
  }
  return `<div class="stack" id="sync-box" style="gap:10px"><span class="field">Sync across devices</span>${body}</div>`;
}

// Redraw wherever the focus settings are showing (timer screen or Settings).
function redrawFocus() {
  if (timer) drawTimer();
  if (!$('#sheet').hidden && $('#sheet-title')?.textContent === 'Settings') prefsSheet();
}

function refreshSyncBox() {
  const box = document.getElementById('sync-box');
  if (!box || $('#sheet').hidden) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = syncSection();
  if (tmp.firstElementChild) box.replaceWith(tmp.firstElementChild);
}

function setPref(key, value, replanNeeded = true) {
  state.settings[key] = value;
  if (replanNeeded) replan(); else persist();
}

// ---------- Focus timer ----------
// Counts down a chunk. With Focus blocks on (Pomodoro, as in Bibliophile) you work in blocks: a soft
// "ting ting ting" starts a short break, one "ting" ends it, and every few blocks the break is longer.
// Break time never counts towards the chunk. Everything is based on timestamps and saved, so the timer
// keeps the right time if you lock the phone or close the app.

const FOCUS_PRESETS = { '25/5': { work: 25, brk: 5 }, '50/10': { work: 50, brk: 10 }, '90/15': { work: 90, brk: 15 } };
const focusCfg = () => ({ on: false, work: 25, brk: 5, longBrk: 15, every: 4, auto: true, ...(state.settings.focus || {}) });

let timer = null;
let timerInterval = null;
let wakeLock = null;
let audioCtx = null;

function audio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* sound is optional */ }
  return audioCtx;
}

// A soft bell: "ting ting ting" to start a break, one "ting" to get going again.
function bell(strikes = 3, gap = 0.8) {
  const ctx = audio();
  if (!ctx) return;
  const out = ctx.createGain();
  out.gain.value = 0.22;
  out.connect(ctx.destination);
  const partials = [[1, 1], [2.01, 0.45], [2.76, 0.28], [5.4, 0.12], [8.93, 0.05]]; // bell-like overtones
  for (let i = 0; i < strikes; i++) {
    const t0 = ctx.currentTime + 0.05 + i * gap;
    const f0 = 988 * (i === strikes - 1 && strikes > 1 ? 0.89 : 1); // last strike a touch lower
    for (const [ratio, amp] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f0 * ratio;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.8 / Math.sqrt(ratio));
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 3);
    }
  }
}

function notify(title, body) {
  try { navigator.vibrate?.([180, 90, 180]); } catch { /* optional */ }
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icons/icon-192.png', tag: 'chunker-focus', silent: true };
  if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(() => {});
  else { try { new Notification(title, opts); } catch { /* not supported here */ } }
}

const focusedMs = () => (timer ? timer.elapsed + (timer.startedAt ? Date.now() - timer.startedAt : 0) : 0);
const chunkLeft = () => timer.minutes * 60000 - focusedMs();
function newFocus() {
  const c = focusCfg();
  return { work: c.work, brk: c.brk, longBrk: c.longBrk, every: c.every, auto: c.auto, round: 1, phase: 'work', blockStart: focusedMs() };
}
// Time left in the current focus block, or in the break.
function focusLeft() {
  const f = timer?.focus;
  if (!f) return 0;
  if (f.phase === 'break') return f.breakEndsAt - Date.now();
  if (f.phase === 'breakover') return 0;
  return f.work * 60000 - (focusedMs() - f.blockStart);
}
const isLongNext = (f) => f.round % f.every === 0;

function saveTimer() {
  state.timer = timer;
  persist();
}

function keepAwake() {
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 500);
  try { if (!wakeLock) navigator.wakeLock?.request('screen').then((l) => (wakeLock = l)).catch(() => {}); } catch { /* optional */ }
}

function startTimer({ id, kind, title, sub, minutes }, carryFocus = null) {
  audio(); // unlock sound while we have your tap
  timer = { id, kind, title, sub, minutes, elapsed: 0, startedAt: Date.now(), focus: null, reached: false, finished: false, min: false };
  if (carryFocus) timer.focus = carryFocus;
  else if (focusCfg().on) timer.focus = newFocus();
  keepAwake();
  saveTimer();
  drawTimer();
  $('#timer').scrollTop = 0;
}

function startNextBlock() {
  const f = timer?.focus;
  if (!f) return;
  if (f.phase === 'break') f.round += 1; // leaving a break (on time or skipped) starts the next block
  f.phase = 'work';
  delete f.breakEndsAt;
  if (!timer.startedAt) timer.startedAt = Date.now();
  f.blockStart = focusedMs();
  saveTimer();
  drawTimer();
}

function tickTimer() {
  if (!timer) return;
  const f = timer.focus;
  if (f && f.phase === 'work' && timer.startedAt && focusLeft() <= 0) {
    // Block finished. If the phone was locked past the bell, only the block itself counts.
    const over = -focusLeft();
    timer.elapsed += Date.now() - timer.startedAt - over;
    timer.startedAt = null;
    f.long = isLongNext(f);
    f.breakLen = f.long ? f.longBrk : f.brk;
    f.phase = 'break';
    f.breakEndsAt = Date.now() - over + f.breakLen * 60000;
    if (!timer.reached && chunkLeft() <= 0) timer.reached = true;
    saveTimer();
    bell(3);
    notify('Time for a break', `${f.breakLen}-minute ${f.long ? 'long ' : ''}break. Stretch, look away, have some water.`);
    drawTimer();
    return;
  }
  if (f && f.phase === 'break' && focusLeft() <= 0) {
    bell(1, 0);
    notify('Break’s over', f.auto ? `Back to ${timer.title}.` : 'Start your next block when you’re ready.');
    if (f.auto) startNextBlock();
    else { f.round += 1; f.phase = 'breakover'; saveTimer(); drawTimer(); }
    return;
  }
  if (f && !timer.reached && chunkLeft() <= 0) {
    timer.reached = true;
    saveTimer();
    bell(1, 0);
    notify(`${timer.minutes} minutes done`, 'That’s this chunk’s time. Mark it done when you’re ready.');
    drawTimer();
    return;
  }
  if (!f && !timer.finished && timer.startedAt && chunkLeft() <= 0) {
    timer.elapsed = timer.minutes * 60000;
    timer.startedAt = null;
    timer.finished = true;
    saveTimer();
    bell(2);
    notify('Time’s up', `${timer.title}: how did it go?`);
    drawTimer();
    return;
  }
  updateTimerFace();
}

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// What the big clock shows, and how full the ring is.
function face() {
  const f = timer.focus;
  if (f?.phase === 'break') return { ms: focusLeft(), frac: Math.max(0, focusLeft()) / (f.breakLen * 60000) };
  if (f?.phase === 'breakover') return { ms: 0, frac: 0 };
  if (f) return { ms: focusLeft(), frac: Math.max(0, focusLeft()) / (f.work * 60000) };
  return { ms: chunkLeft(), frac: Math.max(0, chunkLeft()) / (timer.minutes * 60000) };
}
const chunkLine = () => `${Math.min(timer.minutes, Math.floor(focusedMs() / 60000))} of ${timer.minutes} min of this ${timer.kind === 'habit' ? 'habit' : 'chunk'}`;

function updateTimerFace() {
  if (!timer) return;
  const { ms, frac } = face();
  const t = $('#timer-time');
  if (t) t.textContent = mmss(ms);
  const fill = $('#timer-fill');
  if (fill) fill.setAttribute('stroke-dashoffset', 2 * Math.PI * 130 * (1 - frac));
  const line = $('#chunk-line');
  if (line) line.textContent = chunkLine();
  const bar = $('#chunk-bar');
  if (bar) bar.style.width = `${Math.min(100, (100 * focusedMs()) / (timer.minutes * 60000))}%`;
  const mini = $('#tb-time');
  if (mini) mini.textContent = mmss(ms);
}

function focusPanel() {
  const c = focusCfg();
  const f = timer?.focus;
  const on = f ? true : c.on;
  const preset = Object.entries(FOCUS_PRESETS).find(([, v]) => v.work === c.work && v.brk === c.brk)?.[0];
  return `<section class="focus-card">
    <label class="switch-row">
      <span><b>Focus blocks</b><small>${on ? `${c.work} min focus · ${c.brk} min breaks · ${c.longBrk} min every ${c.every}` : 'Work in blocks with a bell for short breaks'}</small></span>
      <input type="checkbox" class="switch" id="focus-toggle" data-focus="toggle" ${on ? 'checked' : ''}>
    </label>
    ${on ? `
    <div class="row">${Object.keys(FOCUS_PRESETS).map((k) => `<button type="button" class="chip" data-act="focus-preset" data-v="${k}" aria-pressed="${preset === k && !ui.focusCustom}">${k.replace('/', ' / ')}</button>`).join('')}
      <button type="button" class="chip" data-act="focus-custom" aria-pressed="${!preset || !!ui.focusCustom}">Custom</button></div>
    ${!preset || ui.focusCustom ? `<div class="focus-custom">
      <label>Focus <input class="input" type="number" min="5" max="180" id="focus-work" data-focus="work" value="${c.work}"> min</label>
      <label>Break <input class="input" type="number" min="1" max="60" id="focus-brk" data-focus="brk" value="${c.brk}"> min</label>
      <label>Long break <input class="input" type="number" min="1" max="90" id="focus-long" data-focus="longBrk" value="${c.longBrk}"> min every <input class="input" type="number" min="2" max="10" id="focus-every" data-focus="every" value="${c.every}"> blocks</label>
    </div>` : ''}
    <label class="check-row"><input type="checkbox" id="focus-auto" data-focus="auto" ${c.auto ? 'checked' : ''}> Start the next block by itself after a break</label>` : ''}
  </section>`;
}

// Focus settings are remembered for next time and applied to the timer that's running.
function focusSetting(el) {
  const c = focusCfg();
  const k = el.dataset.focus;
  if (k === 'toggle') {
    c.on = el.checked;
    if (c.on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    if (timer && !timer.finished) {
      if (c.on && !timer.focus) {
        timer.focus = newFocus();
        if (!timer.startedAt) { timer.startedAt = Date.now(); timer.focus.blockStart = focusedMs(); }
      }
      if (!c.on && timer.focus) {
        const wasBreak = timer.focus.phase !== 'work';
        timer.focus = null;
        if (wasBreak) timer.startedAt = Date.now();
      }
    }
  } else if (k === 'auto') c.auto = el.checked;
  else {
    const n = Math.round(Number(el.value));
    const lim = { work: [5, 180], brk: [1, 60], longBrk: [1, 90], every: [2, 10] }[k];
    if (!n || !lim) return;
    c[k] = Math.min(lim[1], Math.max(lim[0], n));
  }
  state.settings.focus = c;
  const f = timer?.focus;
  if (f && k !== 'toggle') Object.assign(f, { work: c.work, brk: c.brk, longBrk: c.longBrk, every: c.every, auto: c.auto });
  if (timer) saveTimer(); else persist();
}

function timerButtons() {
  const f = timer.focus;
  if (timer.finished) {
    return `<p class="lede">How did it go?</p>
      <div class="row center"><button class="btn btn-primary" data-act="timer-done">Mark it done</button><button class="btn" data-act="timer-close">Not quite, that’s fine</button></div>`;
  }
  if (f?.phase === 'break') {
    return `<div class="row center"><button class="btn btn-primary" data-act="focus-skip">Skip break, keep going</button><button class="btn" data-act="timer-done">Mark done</button><button class="btn" data-act="timer-close">Stop</button></div>`;
  }
  if (f?.phase === 'breakover') {
    return `<div class="row center"><button class="btn btn-primary" data-act="focus-skip">Start the next block</button><button class="btn" data-act="timer-done">Mark done</button><button class="btn" data-act="timer-close">Stop</button></div>`;
  }
  return `<div class="row center">
      <button class="btn btn-quiet" data-act="timer-pause">${timer.startedAt ? 'Pause' : 'Resume'}</button>
      <button class="btn btn-primary" data-act="timer-done">${timer.reached ? 'Mark done' : 'Finished early'}</button>
      <button class="btn" data-act="timer-close">Stop</button>
    </div>`;
}

function nextChunkToday() {
  return todayChunks().find(({ c }) => !c.done && c.id !== timer?.id) || null;
}

function drawTimer() {
  const el = $('#timer');
  const bar = $('#timer-bar');
  if (!timer) { el.hidden = true; bar.hidden = true; return; }
  const f = timer.focus;
  const style = tint(timer.kind === 'habit' ? timer.id : findChunk(timer.id).t?.id);
  const { ms, frac } = face();
  const onBreak = f?.phase === 'break';
  const over = f?.phase === 'breakover';

  // the little bar that follows you around the app
  bar.setAttribute('style', style);
  bar.innerHTML = `<button class="tb-main" data-act="timer-open"><span class="tb-dot ${timer.startedAt ? 'live' : ''}"></span>
      <span class="tb-title">${onBreak ? 'Break' : over ? 'Break’s over' : esc(timer.title)}</span><span class="tb-time" id="tb-time">${mmss(ms)}</span></button>
    ${onBreak || over ? '<button class="btn-text" data-act="focus-skip">Keep going</button>' : `<button class="btn-text" data-act="timer-pause">${timer.startedAt ? 'Pause' : 'Resume'}</button>`}`;
  bar.hidden = !timer.min;

  const r = 130;
  const circ = 2 * Math.PI * r;
  const next = timer.kind === 'chunk' ? nextChunkToday() : null;
  const eyebrow = timer.finished ? 'Time’s up'
    : onBreak ? `${f.long ? 'Long break' : 'Break'} · after block ${f.round}`
      : over ? 'Break’s over'
        : f ? `${timer.startedAt ? 'Focus' : 'Paused'} · block ${f.round}` : timer.startedAt ? 'Just this bit' : 'Paused';
  el.setAttribute('style', style);
  el.innerHTML = `<div class="timer-inner">
    <div class="timer-top"><button class="icon-btn" data-act="timer-min" aria-label="Minimise the timer">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
    <p class="eyebrow">${eyebrow}</p>
    <h2>${onBreak ? 'Rest your eyes' : over ? 'Ready when you are' : esc(timer.title)}</h2>
    <p class="muted">${onBreak ? 'Stand up, stretch, look at something far away, have some water.' : over ? `${esc(timer.title)} is waiting.` : esc(timer.sub)}</p>
    ${over ? '' : `<div class="timer-ring ${onBreak ? 'on-break' : ''}">
      <svg viewBox="0 0 280 280" aria-hidden="true">${GRADIENT('g-timer')}
        <circle class="ticks" cx="140" cy="140" r="${r - 20}" fill="none" stroke-width="10" stroke-dasharray="1.2 5.6"/>
        <circle class="track" cx="140" cy="140" r="${r}" fill="none" stroke-width="10"/>
        <circle class="fill" stroke="${onBreak ? 'var(--green)' : 'url(#g-timer)'}" id="timer-fill" cx="140" cy="140" r="${r}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - frac)}"/>
      </svg>
      <span class="timer-time ${timer.startedAt || onBreak ? '' : 'paused'}" id="timer-time" role="timer">${mmss(ms)}</span>
    </div>`}
    ${f ? `<div class="chunk-progress"><div class="bar"><span id="chunk-bar" style="width:${Math.min(100, (100 * focusedMs()) / (timer.minutes * 60000))}%"></span></div>
      <p class="small muted"><span id="chunk-line">${chunkLine()}</span>${onBreak ? ' · breaks aren’t counted' : ''}</p></div>` : ''}
    ${f && timer.reached && !timer.finished ? `<div class="note"><p>That’s this ${timer.kind === 'habit' ? 'habit’s' : 'chunk’s'} ${timer.minutes} minutes. Nicely done.</p>
      <div class="row"><button class="btn btn-sm btn-primary" data-act="timer-done">Mark done</button>
      ${next ? `<button class="btn btn-sm" data-act="timer-done-next">Mark done, start the next chunk</button>` : ''}</div></div>` : ''}
    ${timerButtons()}
    ${timer.finished ? '' : focusPanel()}
  </div>`;
  el.hidden = !!timer.min;
}

function closeTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timer = null;
  state.timer = null;
  persist();
  drawTimer();
  try { wakeLock?.release(); } catch { /* optional */ }
  wakeLock = null;
}

function markTimerDone() {
  if (timer.kind === 'habit') {
    const h = state.habits.find((x) => x.id === timer.id);
    if (h) { h.log = h.log || {}; h.log[today] = true; }
  } else {
    const { c } = findChunk(timer.id);
    if (c) { c.done = true; c.doneOn = today; c.date = today; }
  }
}

// After a restart: pick the timer up where it was, unless its chunk or habit has gone.
function restoreTimer() {
  const t = state.timer;
  if (!t) return;
  const exists = t.kind === 'habit' ? state.habits.some((h) => h.id === t.id) : findChunk(t.id).c && !findChunk(t.id).c.done;
  if (!exists) { state.timer = null; persist(); return; }
  timer = t;
  keepAwake();
  tickTimer();
  drawTimer();
}

// ---------- Calendar ----------

function eventsFor(dates) {
  const events = [];
  for (const date of dates) {
    const times = slotTimes(state, date);
    for (const t of state.tasks) {
      for (const c of t.chunks) {
        if (c.date !== date || c.done) continue;
        events.push({
          uid: c.id, date, time: times[c.id], minutes: c.minutes,
          title: `${t.name} · ${chunkLabel(t, c)}`,
          description: `${c.minutes} minutes. Just this bit. Due ${D.fmtDay(t.deadline)}.`,
        });
      }
    }
  }
  return events;
}

async function exportCalendar(scope) {
  const dates = scope === 'today'
    ? [today]
    : [...new Set(state.tasks.flatMap((t) => t.chunks).filter((c) => !c.done && c.date && c.date >= today).map((c) => c.date))].sort();
  const events = eventsFor(dates);
  if (!events.length) return toast('Nothing left to add.');
  const text = buildICS(events);
  const name = scope === 'today' ? `chunks-${today}.ics` : 'daily-chunker-upcoming.ics';
  const how = await deliverICS(text, name);
  if (how === 'downloaded') toast(`Calendar file ready with ${events.length} ${events.length === 1 ? 'event' : 'events'}. Open it to add them.`);
  else if (how === 'failed') toast('Couldn’t make the calendar file in this browser.');
}

// ---------- render & events ----------

const VIEWS = { today: renderToday, add: renderAdd, tasks: renderTasks };
function currentView() {
  const h = location.hash.slice(1);
  return VIEWS[h] ? h : 'today';
}
function render() {
  const name = currentView();
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#view').innerHTML = VIEWS[name]();
}

const actions = {
  tick(el) {
    const { c } = findChunk(el.dataset.id);
    if (!c) return;
    c.done = !c.done;
    if (c.done) {
      c.doneOn = today;
      c.date = today;
      toast(WARM[Math.floor(Math.random() * WARM.length)]);
    } else {
      delete c.doneOn;
    }
    persist();
    if (ui.editing && !$('#sheet').hidden) taskSheet();
    render();
  },
  'habit-tick'(el) {
    const h = state.habits.find((x) => x.id === el.dataset.id);
    h.log = h.log || {};
    if (h.log[today]) delete h.log[today];
    else { h.log[today] = true; toast(WARM[Math.floor(Math.random() * WARM.length)]); }
    persist();
    render();
  },
  'too-much'(el) {
    const { c } = findChunk(el.dataset.id);
    c.notBefore = D.addDays(today, 1);
    state.lockedDay = today;
    replan();
    toast(c.date ? `Moved to ${D.fmtDay(c.date, today).toLowerCase() === 'tomorrow' ? 'tomorrow' : D.fmtDay(c.date)}. The rest has been rebalanced.` : 'Moved off today. It’s waiting for some room.');
    render();
  },
  timer(el) {
    const { t, c } = findChunk(el.dataset.id);
    startTimer({ id: c.id, kind: 'chunk', title: t.name, sub: chunkLabel(t, c), minutes: c.minutes });
  },
  'habit-timer'(el) {
    const h = state.habits.find((x) => x.id === el.dataset.id);
    startTimer({ id: h.id, kind: 'habit', title: h.name, sub: 'Habit', minutes: h.minutes });
  },
  'timer-pause'() {
    if (timer.startedAt) { timer.elapsed += Date.now() - timer.startedAt; timer.startedAt = null; }
    else timer.startedAt = Date.now();
    saveTimer();
    drawTimer();
  },
  'timer-done'() {
    markTimerDone();
    closeTimer();
    toast(WARM[Math.floor(Math.random() * WARM.length)]);
    render();
  },
  // keep the focus session going on the next of today's chunks
  'timer-done-next'() {
    const next = nextChunkToday();
    const f = timer.focus;
    markTimerDone();
    if (!next) { closeTimer(); toast('That was the last one for today. Lovely work.'); render(); return; }
    let carry = null;
    if (f) {
      carry = { ...f };
      if (f.phase === 'work') carry.blockStart = -(focusedMs() - f.blockStart); // the block carries on where it was
    }
    const wasRunning = !!timer.startedAt;
    startTimer({ id: next.c.id, kind: 'chunk', title: next.t.name, sub: chunkLabel(next.t, next.c), minutes: next.c.minutes }, carry);
    if (carry && carry.phase !== 'work' || !wasRunning) { timer.startedAt = null; saveTimer(); drawTimer(); }
    toast('Done. On to the next one.');
    render();
  },
  'timer-close'() { closeTimer(); },
  'timer-min'() { timer.min = true; saveTimer(); drawTimer(); },
  'timer-open'() { timer.min = false; saveTimer(); drawTimer(); $('#timer').scrollTop = 0; },
  'focus-skip'() { startNextBlock(); },
  'focus-preset'(el) {
    const p = FOCUS_PRESETS[el.dataset.v];
    ui.focusCustom = false;
    for (const [k, v] of [['work', p.work], ['brk', p.brk]]) focusSetting({ dataset: { focus: k }, value: v });
    redrawFocus();
  },
  'focus-custom'() { ui.focusCustom = true; redrawFocus(); },
  'dismiss-notice'() { state.notice = null; persist(); render(); },
  'seed-audit'() {
    ui.drafts = [newDraft({ name: 'Audits at work, nearest deadline first', minutes: 120, chunkSize: 30 })];
    ui.results = null;
    location.hash = '#add';
    render();
  },
  'export-today'() { exportCalendar('today'); },
  'export-all'() { exportCalendar('all'); },
  parse() { parseInput(); },
  manual() { ui.drafts.push(newDraft()); render(); setTimeout(() => $(`#d-name-${ui.drafts.length - 1}`)?.focus(), 0); },
  mic() { toggleMic(); },
  'd-set'(el) {
    const d = ui.drafts[+el.dataset.i];
    const k = el.dataset.k;
    d[k] = k === 'minutes' || k === 'chunkSize' ? +el.dataset.v : el.dataset.v;
    render();
  },
  'd-remove'(el) {
    ui.drafts.splice(+el.dataset.i, 1);
    if (!ui.drafts.length && ui.planned?.length) { ui.results = ui.planned; ui.planned = []; }
    render();
  },
  'start-over'() { ui.drafts = []; render(); },
  'clear-results'() { ui.results = null; },
  'add-another'() { ui.results = null; render(); },
  'fix-deadline'(el) {
    const t = taskById(el.dataset.id);
    t.deadline = el.dataset.v;
    if (ui.editing?.id === t.id) ui.editing.deadline = t.deadline;
    replan();
    toast(`Deadline moved to ${D.fmtDay(t.deadline)}. Everything fits now.`);
    if (ui.editing && !$('#sheet').hidden) taskSheet();
    render();
  },
  'fix-limit'(el) {
    setPref('dailyLimit', +el.dataset.v);
    toast(`Days can now hold up to ${D.fmtMinutes(+el.dataset.v)}.`);
    if (ui.editing && !$('#sheet').hidden) taskSheet();
    render();
  },
  'open-task'(el) {
    const t = taskById(el.dataset.id);
    ui.editing = { id: t.id, name: t.name, deadline: t.deadline, totalMinutes: t.totalMinutes, chunkSize: t.chunkSize, priority: t.priority };
    ui.confirmDelete = false;
    taskSheet();
  },
  'e-set'(el) {
    const k = el.dataset.k;
    ui.editing[k] = k === 'chunkSize' ? +el.dataset.v : el.dataset.v;
    taskSheet();
  },
  'ask-delete'() { ui.confirmDelete = true; taskSheet(); },
  'cancel-delete'() { ui.confirmDelete = false; taskSheet(); },
  'delete-task'(el) {
    state.tasks = state.tasks.filter((t) => t.id !== el.dataset.id);
    replan();
    closeSheet();
    toast('Task deleted.');
  },
  'new-habit'() {
    ui.editing = { id: uid(), isNew: true, name: '', minutes: 20, days: suggestHabitDays(3, state.settings.offWeekdays) };
    habitSheet();
  },
  'open-habit'(el) {
    const h = state.habits.find((x) => x.id === el.dataset.id);
    ui.editing = { ...h, days: [...h.days] };
    habitSheet();
  },
  'h-day'(el) {
    const d = +el.dataset.v;
    const days = ui.editing.days;
    ui.editing.days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    habitSheet();
  },
  'delete-habit'() {
    state.habits = state.habits.filter((h) => h.id !== ui.editing.id);
    persist();
    closeSheet();
    toast('Habit removed.');
  },
  'pref-time'(el) { setPref('preferredTime', el.dataset.v, false); prefsSheet(); },
  'pref-chunk'(el) { setPref('defaultChunk', +el.dataset.v, false); prefsSheet(); },
  'pref-theme'(el) { setPref('theme', el.dataset.v, false); applyTheme(); prefsSheet(); },
  'pref-weekday'(el) {
    const d = +el.dataset.v;
    const list = state.settings.offWeekdays;
    setPref('offWeekdays', list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);
    prefsSheet();
  },
  'pref-add-off'() {
    const from = $('#p-off-from').value;
    const to = $('#p-off-to').value || from;
    if (!from) return toast('Pick a date first.');
    const set = new Set(state.settings.unavailableDates);
    for (let d = from; d <= to && set.size < 1000; d = D.addDays(d, 1)) set.add(d);
    setPref('unavailableDates', [...set].sort());
    toast('Dates added. The plan has been rebalanced.');
    prefsSheet();
  },
  'sync-now'() { Cloud.syncNow(); },
  async 'sync-signout'() { await Cloud.signOut(); toast('Signed out. Everything stays on this device.'); },
  'sync-cancel'() { Cloud.cancelEmail(); },
  'sync-google'() { Cloud.signInWithGoogle(); },
  'pref-remove-off'(el) {
    setPref('unavailableDates', state.settings.unavailableDates.filter((d) => d !== el.dataset.v));
    prefsSheet();
  },
};

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeSheet(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON') e.preventDefault();
  fn(el);
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.draft != null) submitDraft(+form.dataset.draft);
  else if (form.id === 'task-form') saveTask();
  else if (form.id === 'habit-form') saveHabit();
  else if (form.id === 'email-form') {
    const btn = form.querySelector('button');
    btn.disabled = true;
    Cloud.sendEmailCode(form.email.value).then(() => toast('Code sent. Check your email.')).catch((err) => { toast(err.message); btn.disabled = false; });
  } else if (form.id === 'code-form') {
    Cloud.verifyEmailCode(form.code.value).then((r) => toast(`Signed in as ${r.email}. Syncing now.`)).catch((err) => toast(err.message));
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'dictation') { ui.dictation = el.value; return; }
  const draft = el.closest('[data-draft]');
  if (draft && el.name) {
    const d = ui.drafts[+draft.dataset.draft];
    d[el.name] = el.name === 'minutes' ? (+el.value || null) : el.value || (el.name === 'deadline' ? null : '');
    return;
  }
  if (ui.editing && el.closest('#task-form') && el.name) {
    ui.editing[el.name] = el.name === 'totalMinutes' ? +el.value : el.value;
    return;
  }
  if (ui.editing && el.closest('#habit-form')) {
    if (el.name === 'name') ui.editing.name = el.value;
    if (el.name === 'minutes') ui.editing.minutes = +el.value;
    if (el.name === 'times') {
      ui.editing.days = suggestHabitDays(+el.value, state.settings.offWeekdays);
      habitSheet();
    }
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  // a picked deadline or total time may answer the draft's question, so redraw it
  const draft = el.closest('[data-draft]');
  if (draft && (el.name === 'deadline' || el.name === 'minutes')) { render(); return; }
  if (el.dataset.pref === 'dailyLimit') { setPref('dailyLimit', +el.value); toast('Daily limit saved. The plan has been rebalanced.'); }
  if (el.dataset.pref === 'aiKey') { setPref('aiKey', el.value.trim(), false); toast(el.value.trim() ? 'Key saved on this phone.' : 'Key removed.'); }
  if (el.dataset.focus) { focusSetting(el); redrawFocus(); return; }
  if (el.dataset.slot && el.value) { state.settings.slotTimes[el.dataset.slot] = el.value; persist(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (timer && !timer.min) { timer.min = true; saveTimer(); drawTimer(); }
  else if (!$('#sheet').hidden) closeSheet();
});

$('#open-prefs').addEventListener('click', () => { prefsSheet(); Cloud.loadProviders(); });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (dayCheck()) render();
    if (timer) tickTimer();
  }
});
setInterval(() => { if (dayCheck()) render(); }, 60000);

applyTheme();
dayCheck();
render();
restoreTimer();

Cloud.init({
  getState: () => state,
  // something arrived from another device: re-plan around it and redraw
  onPulled: () => { replan(); render(); if (ui.editing?.id && !$('#sheet').hidden && taskById(ui.editing.id)) taskSheet(); },
  onStatus: refreshSyncBox,
});
if (Cloud.isRedirect()) {
  Cloud.handleRedirect().then((r) => { if (r) toast(r.ok ? `Signed in as ${r.email}. Syncing now.` : r.message); render(); });
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
