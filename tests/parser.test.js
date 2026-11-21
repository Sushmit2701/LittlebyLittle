import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDictation, parseOne } from '../js/parser.js';
import { buildICS } from '../js/ics.js';

const TODAY = '2026-11-21'; // a Saturday

test('the example from the brief', () => {
  assert.deepEqual(parseOne('Finish the shoulder dislocation audit by Friday, about three hours.', TODAY), {
    name: 'Finish the shoulder dislocation audit', deadline: '2026-11-27', minutes: 180, priority: 'normal',
  });
});

const cases = [
  ['Read the trauma chapter by the 15th, 2h 30m, urgent', { deadline: '2026-12-15', minutes: 150, priority: 'high' }],
  ['Prepare the MDT list tomorrow 20 mins', { deadline: '2026-11-22', minutes: 20 }],
  ['Submit logbook by 12/1 a couple of hours', { deadline: '2027-01-12', minutes: 120 }],
  ['Portfolio reflections in two weeks, two and a half hours', { deadline: '2026-12-05', minutes: 150 }],
  ['Teaching slides by 3rd December, an hour and a half', { deadline: '2026-12-03', minutes: 90 }],
  ['Rota swap by end of the month, half an hour', { deadline: '2026-11-30', minutes: 30 }],
  ['Case report due December 10 about 4 hours', { deadline: '2026-12-10', minutes: 240 }],
  ['ALS renewal next Monday 45 minutes', { deadline: '2026-11-23', minutes: 45 }],
];
for (const [text, want] of cases) {
  test(`reads: ${text}`, () => {
    const got = parseOne(text, TODAY);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, k);
  });
}

test('missing pieces come back empty so the app can ask', () => {
  const d = parseOne('Audits at work, nearest deadline first, about two hours', TODAY);
  assert.equal(d.name, 'Audits at work, nearest deadline first');
  assert.equal(d.deadline, null);
  assert.equal(d.minutes, 120);
});

test('several tasks in one go, with a stray effort sentence joined to its task', () => {
  const ds = parseDictation('Write the teaching slides by Thursday. About an hour. Book the course by Friday, 20 minutes', TODAY);
  assert.equal(ds.length, 2);
  assert.equal(ds[0].minutes, 60);
  assert.equal(ds[1].name, 'Book the course');
});

test('ics file has one event per chunk at the right time', () => {
  const ics = buildICS([{ uid: 'x1', title: 'Audit · Part 1 of 4', date: '2026-11-23', time: '07:00', minutes: 30 }], new Date('2026-11-21T10:00:00Z'));
  assert.match(ics, /DTSTART:20261123T070000\r\n/);
  assert.match(ics, /DTEND:20261123T073000\r\n/);
  assert.match(ics, /SUMMARY:Audit · Part 1 of 4/);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
});
