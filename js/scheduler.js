// Splitting and scheduling. Pure functions over the state object, so they can be tested in Node.
import { addDays, weekday, weekStart, addMinutesToTime } from './dates.js';
import { uid } from './store.js';

export function isOff(settings, d) {
  return settings.offWeekdays.includes(weekday(d)) || settings.unavailableDates.includes(d);
}

function workDays(settings, from, to, skip) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d !== skip && !isOff(settings, d)) out.push(d);
  }
  return out;
}

/**
 * Turn a total effort into chunks of `size` minutes. Chunks already done are kept,
 * only the remaining time is split again.
 */
export function buildChunks(totalMinutes, size, keepDone = []) {
  const done = keepDone.filter((c) => c.done);
  const doneMinutes = done.reduce((a, c) => a + c.minutes, 0);
  let remaining = Math.max(0, totalMinutes - doneMinutes);
  const out = [...done];
  while (remaining > 0) {
    let m = Math.min(size, remaining);
    // fold a tiny leftover (under 5 min) into the previous chunk
    if (remaining - m > 0 && remaining - m < 5) m = remaining;
    out.push({ id: uid(), minutes: m, date: null, done: false });
    remaining -= m;
  }
  out.forEach((c, i) => (c.index = i + 1));
  return out;
}

export function chunkLabel(task, chunk) {
  const base = `Part ${chunk.index} of ${task.chunks.length}`;
  return chunk.step ? `${base}: ${chunk.step}` : base;
}

/**
 * Re-plan every chunk that is not done.
 * - Chunks already planned for today stay where they are, so today never shifts under you.
 * - Everything else is spread evenly between today and the day before the deadline (buffer).
 * - High priority tasks are packed into the first half of their window.
 * - No day goes over settings.dailyLimit; off days and unavailable dates are skipped.
 * - If nothing fits before the buffer day, the deadline day itself is used as a last resort.
 * - Chunks that still don't fit are left unplaced and counted in task.unplaced.
 */
export function plan(state, today) {
  const s = state.settings;
  const limit = s.dailyLimit;
  const locked = state.lockedDay === today ? today : null;
  const used = new Map();
  const add = (d, m) => used.set(d, (used.get(d) || 0) + m);
  const room = (d, m) => (used.get(d) || 0) + m <= limit;

  const pending = new Map();
  for (const t of state.tasks) {
    const list = [];
    for (const c of t.chunks) {
      if (c.notBefore && c.notBefore <= today) delete c.notBefore;
      if (c.done) {
        if (c.doneOn && c.doneOn >= today) add(c.doneOn, c.minutes);
        continue;
      }
      if (c.date === today && !c.notBefore) {
        add(today, c.minutes);
        continue;
      }
      c.date = null;
      list.push(c);
    }
    pending.set(t.id, list);
  }

  const order = [...state.tasks].sort(
    (a, b) => a.deadline.localeCompare(b.deadline) || (b.priority === 'high') - (a.priority === 'high'),
  );

  for (const t of order) {
    const chunks = pending.get(t.id);
    t.unplaced = 0;
    t.overdue = t.deadline < today;
    if (!chunks.length) continue;

    let target = addDays(t.deadline, -1); // buffer: aim to finish a day early
    if (t.overdue) target = addDays(today, 6);
    else if (target < today) target = t.deadline;
    const days = workDays(s, today, target, locked);
    const bufferDay = !t.overdue && t.deadline > target ? t.deadline : null;
    const spread = t.priority === 'high' ? Math.max(1, Math.ceil(days.length / 2)) : days.length;

    const n = chunks.length;
    let last = 0;
    chunks.forEach((c, k) => {
      const earliest = c.notBefore || today;
      const fits = (d) => d >= earliest && room(d, c.minutes);
      const ideal = days.length ? Math.min(days.length - 1, Math.floor((k * spread) / n)) : 0;
      let idx = -1;
      for (let i = Math.max(ideal, last); i < days.length; i++) if (fits(days[i])) { idx = i; break; }
      if (idx < 0) for (let i = Math.min(ideal, days.length - 1); i >= 0; i--) if (fits(days[i])) { idx = i; break; }
      let d = null;
      if (idx >= 0) {
        d = days[idx];
        last = idx;
      } else if (bufferDay && bufferDay !== locked && !isOff(s, bufferDay) && fits(bufferDay)) {
        d = bufferDay;
      }
      if (d) {
        c.date = d;
        add(d, c.minutes);
      } else {
        t.unplaced++;
      }
    });

    // Keep "Part 1, Part 2 …" in date order. Only swap dates between chunks of equal length
    // so no day's total changes.
    const groups = new Map();
    for (const c of chunks) {
      if (!c.date || c.notBefore) continue;
      if (!groups.has(c.minutes)) groups.set(c.minutes, []);
      groups.get(c.minutes).push(c);
    }
    for (const g of groups.values()) {
      const dates = g.map((c) => c.date).sort();
      g.sort((a, b) => a.index - b.index).forEach((c, i) => (c.date = dates[i]));
    }
  }

  state.lastPlanned = today;
  return state;
}

export const unplacedMinutes = (task) =>
  task.chunks.filter((c) => !c.done && !c.date).reduce((a, c) => a + c.minutes, 0);

/**
 * When a task does not fit, find the smallest change that would make it fit:
 * a later deadline, or a higher daily limit. Tried on a copy, nothing is changed.
 */
export function suggestFixes(state, taskId, today) {
  const fits = (mutate) => {
    const copy = JSON.parse(JSON.stringify(state));
    mutate(copy);
    plan(copy, today);
    const t = copy.tasks.find((x) => x.id === taskId);
    return t && t.unplaced === 0;
  };
  const task = state.tasks.find((x) => x.id === taskId);
  let deadline = null;
  const from = task.deadline < today ? today : task.deadline;
  for (let i = 1; i <= 90; i++) {
    const d = addDays(from, i);
    if (fits((c) => (c.tasks.find((x) => x.id === taskId).deadline = d))) { deadline = d; break; }
  }
  let limit = null;
  for (let l = state.settings.dailyLimit + 15; l <= 480; l += 15) {
    if (fits((c) => (c.settings.dailyLimit = l))) { limit = l; break; }
  }
  return { deadline, limit };
}

/** Clock times for today's (or any day's) chunks, stacked from the preferred time with a 5-minute breather. */
export function slotTimes(state, date) {
  const s = state.settings;
  let t = s.slotTimes[s.preferredTime] || '07:00';
  const map = {};
  const list = [];
  for (const task of [...state.tasks].sort((a, b) => a.deadline.localeCompare(b.deadline))) {
    for (const c of task.chunks) if (c.date === date) list.push(c);
  }
  for (const c of list) {
    map[c.id] = t;
    t = addMinutesToTime(t, c.minutes + 5);
  }
  return map;
}

// ---------- Habits ----------

/** Spread n sessions over a Monday-to-Sunday week, avoiding off days where possible. */
export function suggestHabitDays(timesPerWeek, offWeekdays = []) {
  const n = Math.max(1, Math.min(7, timesPerWeek));
  const week = [1, 2, 3, 4, 5, 6, 0].filter((d) => !offWeekdays.includes(d));
  const pool = week.length >= n ? week : [1, 2, 3, 4, 5, 6, 0];
  const picks = [];
  for (let i = 0; i < n; i++) picks.push(pool[Math.floor((i * pool.length) / n)]);
  return [...new Set(picks)];
}

export const habitsForDay = (state, date) => state.habits.filter((h) => h.days.includes(weekday(date)));

// ---------- Weekly summary ----------

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => (n <= 10 ? WORDS[n] : String(n));

export function weekSummary(state, today) {
  const from = weekStart(today);
  const to = addDays(from, 6);
  let chunks = 0;
  let minutes = 0;
  const moved = [];
  for (const t of state.tasks) {
    const done = t.chunks.filter((c) => c.done && c.doneOn >= from && c.doneOn <= to);
    if (done.length) moved.push(t.name);
    chunks += done.length;
    minutes += done.reduce((a, c) => a + c.minutes, 0);
  }
  const habits = [];
  let habitSessions = 0;
  for (const h of state.habits) {
    const n = Object.keys(h.log || {}).filter((d) => d >= from && d <= to).length;
    if (n) habits.push(h.name);
    habitSessions += n;
  }
  const things = moved.length + habits.length;
  let line;
  if (things === 0) line = 'A fresh week. One small bit is plenty.';
  else if (things === 1) line = 'You moved one thing forward this week.';
  else line = `You moved ${word(things)} things forward this week.`;
  return { chunks, minutes, moved, habits, habitSessions, line };
}
