import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../js/store.js';
import { buildChunks, plan } from '../js/scheduler.js';
import { toRows, hash, mergeRecord, applyRecord, cleanTask } from '../js/sync-merge.js';

const TODAY = '2026-11-23';
const task = (over = {}) => {
  const t = { id: 'a', name: 'Audit', deadline: '2026-11-30', totalMinutes: 120, chunkSize: 30, priority: 'normal', ...over };
  t.chunks = buildChunks(t.totalMinutes, t.chunkSize);
  return t;
};

test('re-planning does not look like an edit', () => {
  const s = defaultState();
  s.tasks = [task()];
  const before = hash(toRows(s).get('task:a'));
  plan(s, TODAY);
  assert.equal(hash(toRows(s).get('task:a')), before);
});

test('AI key and theme stay on the device', () => {
  const s = defaultState();
  s.settings.aiKey = 'sk-ant-secret';
  const synced = toRows(s).get('settings:main');
  assert.equal(synced.aiKey, undefined);
  assert.equal(synced.theme, undefined);
  const other = defaultState();
  other.settings.aiKey = 'mine';
  applyRecord(other, 'settings', 'main', { ...synced, dailyLimit: 120 });
  assert.equal(other.settings.aiKey, 'mine');
  assert.equal(other.settings.dailyLimit, 120);
});

test('only changed on the other device: the cloud copy wins', () => {
  const remote = { ...cleanTask(task()), name: 'Audit v2' };
  assert.equal(mergeRecord('task', cleanTask(task()), remote, undefined, TODAY).name, 'Audit v2');
});

test('changed on both: later wins, but ticks from either side survive', () => {
  const base = task();
  const phone = cleanTask(base);
  phone.chunks[0] = { ...phone.chunks[0], done: true, doneOn: TODAY, date: TODAY };
  const ipad = { ...cleanTask(base), name: 'Shoulder audit' };
  const merged = mergeRecord('task', phone, ipad, '2026-11-23T08:00:00Z', '2026-11-23T09:00:00Z');
  assert.equal(merged.name, 'Shoulder audit');
  assert.equal(merged.chunks[0].done, true);
});

test('habit ticks from two devices are added together', () => {
  const h = { id: 'h', name: 'Gym', minutes: 45, days: [1, 3, 5] };
  const merged = mergeRecord('habit', { ...h, log: { '2026-11-23': true } }, { ...h, log: { '2026-11-25': true } }, '2026-11-25T07:00:00Z', '2026-11-25T08:00:00Z');
  assert.deepEqual(Object.keys(merged.log).sort(), ['2026-11-23', '2026-11-25']);
});

test('deleted on another device, untouched here: it goes', () => {
  assert.equal(mergeRecord('task', cleanTask(task()), undefined, undefined, TODAY), undefined);
});

test('arriving tasks keep this device’s plan for today', () => {
  const s = defaultState();
  s.tasks = [task()];
  plan(s, TODAY);
  const dates = s.tasks[0].chunks.map((c) => c.date);
  const incoming = { ...cleanTask(s.tasks[0]), priority: 'high' };
  assert.equal(applyRecord(s, 'task', 'a', incoming), true);
  assert.deepEqual(s.tasks[0].chunks.map((c) => c.date), dates);
  assert.equal(s.tasks[0].priority, 'high');
});

test('a new task from another device is added and can be planned', () => {
  const s = defaultState();
  const t = cleanTask(task({ id: 'b' }));
  assert.equal(applyRecord(s, 'task', 'b', t), true);
  plan(s, TODAY);
  assert.ok(s.tasks[0].chunks.every((c) => c.date));
  assert.equal(applyRecord(s, 'task', 'b', t), false, 'applying the same thing twice changes nothing');
});
