import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../js/store.js';
import { plan, buildChunks, suggestFixes, weekSummary, suggestHabitDays, slotTimes } from '../js/scheduler.js';
import { addDays, weekday } from '../js/dates.js';

const TODAY = '2026-11-23'; // a Monday

function task(over = {}) {
  const t = { id: over.id || 'a', name: 'Audit', deadline: '2026-11-27', totalMinutes: 120, chunkSize: 30, priority: 'normal', ...over };
  t.chunks = buildChunks(t.totalMinutes, t.chunkSize);
  return t;
}
const perDay = (s) => {
  const m = {};
  for (const t of s.tasks) for (const c of t.chunks) if (c.date) m[c.date] = (m[c.date] || 0) + c.minutes;
  return m;
};

test('splits effort into chunks, last one takes the remainder', () => {
  assert.deepEqual(buildChunks(100, 30).map((c) => c.minutes), [30, 30, 30, 10]);
  assert.deepEqual(buildChunks(62, 30).map((c) => c.minutes), [30, 32]); // tiny leftovers fold in
});

test('splits 120 minutes into four 30-minute parts', () => {
  const c = buildChunks(120, 30);
  assert.equal(c.length, 4);
  assert.deepEqual(c.map((x) => x.index), [1, 2, 3, 4]);
});

test('finishes a day before the deadline and spreads the work', () => {
  const s = defaultState();
  s.tasks = [task()];
  plan(s, TODAY);
  const dates = s.tasks[0].chunks.map((c) => c.date);
  assert.ok(dates.every((d) => d && d >= TODAY && d < '2026-11-27'), dates.join());
  assert.ok(new Set(dates).size >= 3, 'spread over several days');
  assert.deepEqual([...dates].sort(), dates, 'parts stay in order');
});

test('never goes over the daily limit', () => {
  const s = defaultState();
  s.settings.dailyLimit = 60;
  s.tasks = [task({ id: 'a', totalMinutes: 180 }), task({ id: 'b', totalMinutes: 60, deadline: '2026-11-26' })];
  plan(s, TODAY);
  for (const m of Object.values(perDay(s))) assert.ok(m <= 60);
});

test('skips days off and unavailable dates', () => {
  const s = defaultState();
  s.settings.offWeekdays = [2]; // Tuesday
  s.settings.unavailableDates = ['2026-11-25'];
  s.tasks = [task({ deadline: '2026-12-01', totalMinutes: 150 })];
  plan(s, TODAY);
  for (const c of s.tasks[0].chunks) {
    assert.notEqual(weekday(c.date), 2);
    assert.notEqual(c.date, '2026-11-25');
  }
});

test('reports a task that does not fit and suggests a kind fix', () => {
  const s = defaultState();
  s.tasks = [task({ totalMinutes: 600, deadline: '2026-11-25' })];
  plan(s, TODAY);
  assert.ok(s.tasks[0].unplaced > 0);
  const fx = suggestFixes(s, 'a', TODAY);
  assert.ok(fx.deadline > '2026-11-25');
  assert.ok(fx.limit > 90);
  // the suggestion really works
  s.tasks[0].deadline = fx.deadline;
  plan(s, TODAY);
  assert.equal(s.tasks[0].unplaced, 0);
});

test('high priority is planned earlier in the window', () => {
  const s = defaultState();
  s.tasks = [task({ id: 'n', deadline: '2026-12-04' }), task({ id: 'h', deadline: '2026-12-04', priority: 'high' })];
  plan(s, TODAY);
  const last = (id) => s.tasks.find((t) => t.id === id).chunks.map((c) => c.date).sort().pop();
  assert.ok(last('h') < last('n'));
});

test("today's plan stays put; missed chunks get redistributed from today on", () => {
  const s = defaultState();
  s.tasks = [task({ deadline: '2026-11-30' })];
  plan(s, TODAY);
  // pretend nothing was done for two days
  const later = addDays(TODAY, 2);
  const before = s.tasks[0].chunks.filter((c) => c.date === later).map((c) => c.id);
  plan(s, later);
  for (const c of s.tasks[0].chunks) assert.ok(c.date >= later);
  for (const id of before) assert.equal(s.tasks[0].chunks.find((c) => c.id === id).date, later);
});

test('"Too much today" moves the chunk off today and adds nothing new to today', () => {
  const s = defaultState();
  s.tasks = [task({ deadline: '2026-11-25', totalMinutes: 60 }), task({ id: 'b', deadline: '2026-11-28', totalMinutes: 60 })];
  plan(s, TODAY);
  const todays = s.tasks.flatMap((t) => t.chunks).filter((c) => c.date === TODAY);
  assert.ok(todays.length > 0);
  const c = todays[0];
  c.notBefore = addDays(TODAY, 1);
  s.lockedDay = TODAY;
  plan(s, TODAY);
  assert.ok(c.date > TODAY);
  const after = s.tasks.flatMap((t) => t.chunks).filter((x) => x.date === TODAY);
  assert.equal(after.length, todays.length - 1);
});

test('done chunks keep their day and count towards the weekly summary', () => {
  const s = defaultState();
  s.tasks = [task()];
  plan(s, TODAY);
  const c = s.tasks[0].chunks[0];
  Object.assign(c, { done: true, doneOn: TODAY, date: TODAY });
  s.habits = [{ id: 'h', name: 'Gym', minutes: 45, days: [1, 3, 5], log: { [TODAY]: true } }];
  const w = weekSummary(s, TODAY);
  assert.equal(w.chunks, 1);
  assert.equal(w.line, 'You moved two things forward this week.');
});

test('a quiet week gets a kind line, not a missed count', () => {
  assert.equal(weekSummary(defaultState(), TODAY).line, 'A fresh week. One small bit is plenty.');
});

test('habit days are spread across the week', () => {
  assert.deepEqual(suggestHabitDays(3), [1, 3, 5]);
  assert.equal(suggestHabitDays(7).length, 7);
});

test('chunks are placed at the preferred time, one after another', () => {
  const s = defaultState();
  s.settings.preferredTime = 'evening';
  s.tasks = [task({ deadline: '2026-11-24', totalMinutes: 60 })];
  plan(s, TODAY);
  const times = Object.values(slotTimes(s, TODAY));
  assert.deepEqual(times, ['19:30', '20:05']);
});
