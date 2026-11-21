// Turns dictated text like "Finish the shoulder dislocation audit by Friday, about three hours"
// into { name, deadline, minutes }. Works offline with simple rules; dates are read the UK way (day/month).
import { addDays, weekday, weekStart, lastDayOfMonth, fromStr, toStr } from './dates.js';

const NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, 'forty five': 45,
  forty: 40, fifty: 50, sixty: 60, ninety: 90,
};
const NUM_RE = Object.keys(NUM).sort((a, b) => b.length - a.length).join('|');
const UNIT = '(?:hours?|hrs?|h|minutes?|mins?|days?|weeks?)';

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const DAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const DAY_RE = Object.keys(DAYS).sort((a, b) => b.length - a.length).join('|');

const LEAD = '(?:\\b(?:by|on|before|until|till|due(?:\\s+(?:by|on))?|for|deadline(?:\\s+is)?)\\s+)?';

export function normalise(text) {
  let s = ` ${text} `;
  s = s
    .replace(/\b(?:an?|one)\s+hour\s+and\s+a\s+half\b/gi, '1.5 hours')
    .replace(/\bhour\s+and\s+a\s+half\b/gi, '1.5 hours')
    .replace(/\bhalf\s+an?\s+hour\b/gi, '30 minutes')
    .replace(/\bhalf\s+hour\b/gi, '30 minutes')
    .replace(/\b(?:a\s+)?quarter\s+of\s+an\s+hour\b/gi, '15 minutes')
    .replace(/\ba\s+couple\s+(?:of\s+)?hours\b/gi, '2 hours')
    .replace(/\ba\s+few\s+hours\b/gi, '3 hours')
    .replace(/\b(?:an?|one)\s+hour\b/gi, '1 hour')
    .replace(/\bin\s+a\s+fortnight\b/gi, 'in 2 weeks')
    .replace(/\bin\s+a\s+(day|week)\b/gi, 'in 1 $1');
  s = s.replace(
    new RegExp(`\\b(${NUM_RE})(\\s+and\\s+a\\s+half)?(?=\\s+${UNIT}\\b)`, 'gi'),
    (m, w, half) => String(NUM[w.toLowerCase()] + (half ? 0.5 : 0)),
  );
  s = s.replace(/\b(\d+)\s+and\s+a\s+half(?=\s+hours?\b)/gi, (m, n) => String(+n + 0.5));
  return s;
}

const DUR_LEAD = "(?:(?:it(?:'ll|\\s+will|\\s+should)?\\s+)?(?:take|takes)\\s+)?(?:about|around|roughly|approximately|approx\\.?|maybe|probably|~)?\\s*";
const RE_HOURS = new RegExp(`${DUR_LEAD}(\\d+(?:\\.\\d+)?)\\s*(?:hours?|hrs?|h)\\b(?:\\s*(?:and\\s*)?(\\d+)\\s*(?:minutes?|mins?|m)\\b)?`, 'i');
const RE_MINS = new RegExp(`${DUR_LEAD}(\\d+)\\s*(?:minutes?|mins?|m)\\b`, 'i');

export function parseDuration(s) {
  let m = s.match(RE_HOURS);
  if (m) return { minutes: Math.round(parseFloat(m[1]) * 60 + (m[2] ? +m[2] : 0)), match: m[0] };
  m = s.match(RE_MINS);
  if (m) return { minutes: +m[1], match: m[0] };
  return null;
}

function future(dateStr, today) {
  // a day/month without a year means the next time that date comes round
  if (dateStr >= today) return dateStr;
  const d = fromStr(dateStr);
  d.setFullYear(d.getFullYear() + 1);
  return toStr(d);
}

function validDate(y, m, d) {
  const dt = new Date(y, m, d, 12);
  return dt.getMonth() === m && dt.getDate() === d ? toStr(dt) : null;
}

export function parseDeadline(s, today) {
  const year = fromStr(today).getFullYear();
  const rules = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => validDate(+m[1], +m[2] - 1, +m[3])],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
      const d = validDate(y, +m[2] - 1, +m[1]);
      return d && (m[3] ? d : future(d, today));
    }],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'i'), (m) => {
      const d = validDate(m[3] ? +m[3] : year, MONTHS[m[2].toLowerCase()], +m[1]);
      return d && (m[3] ? d : future(d, today));
    }],
    [new RegExp(`\\b(${MONTH_RE})\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'), (m) => {
      const d = validDate(m[3] ? +m[3] : year, MONTHS[m[1].toLowerCase()], +m[2]);
      return d && (m[3] ? d : future(d, today));
    }],
    [/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
      const t = fromStr(today);
      let d = validDate(t.getFullYear(), t.getMonth(), +m[1]);
      if (!d || d < today) d = validDate(t.getFullYear(), t.getMonth() + 1, +m[1]);
      return d;
    }],
    [/\b(?:the\s+)?day\s+after\s+tomorrow\b/i, () => addDays(today, 2)],
    [/\btomorrow\b/i, () => addDays(today, 1)],
    [/\b(?:today|tonight|end\s+of\s+(?:the\s+)?day)\b/i, () => today],
    [/\bin\s+(\d+)\s+days?\b/i, (m) => addDays(today, +m[1])],
    [/\bin\s+(\d+)\s+weeks?\b/i, (m) => addDays(today, 7 * +m[1])],
    [/\b(?:the\s+)?end\s+of\s+next\s+week\b/i, () => addDays(weekStart(today), 13)],
    [/\b(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?week\b|\bthis\s+week\b/i, () => {
      const fri = addDays(weekStart(today), 4);
      return fri >= today ? fri : addDays(weekStart(today), 6);
    }],
    [/\bnext\s+week\b/i, () => addDays(weekStart(today), 11)],
    [/\b(?:the\s+)?end\s+of\s+next\s+month\b/i, () => lastDayOfMonth(today, 1)],
    [/\b(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?month\b/i, () => lastDayOfMonth(today)],
    [new RegExp(`\\bnext\\s+(${DAY_RE})\\b`, 'i'), (m) => addDays(weekStart(today), 7 + ((DAYS[m[1].toLowerCase()] + 6) % 7))],
    [new RegExp(`\\b(?:this\\s+)?(${DAY_RE})\\b`, 'i'), (m) => addDays(today, (DAYS[m[1].toLowerCase()] - weekday(today) + 7) % 7)],
  ];
  for (const [re, fn] of rules) {
    const full = new RegExp(LEAD + re.source, re.flags);
    const m = s.match(full) || null;
    if (!m) continue;
    // run the rule's own regex on the matched text to get clean groups
    const inner = m[0].match(re);
    const date = inner && fn(inner);
    if (date) return { date, match: m[0] };
  }
  return null;
}

const PRIORITY_RE = /\b(?:high\s+priority|urgent|important|asap|priority)\b[,.]?/i;

function cleanName(s) {
  let n = s.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  n = n.replace(/^(?:(?:i\s+(?:need|have|want|ought)\s+to|i've\s+got\s+to|i\s+must|i\s+should|need\s+to|have\s+to|got\s+to|remember\s+to|please|to\s*do:?|and|then)\s+)+/i, '');
  const tail = /(?:[\s,;:.\-–—]+|\s+(?:and|it's|its|it\s+is|which\s+is|that's|due|by|takes?|will\s+take|should\s+take|it'll\s+take|about|around|roughly|for|on|before|until))+$/i;
  let prev;
  do { prev = n; n = n.replace(tail, '').trim(); } while (n !== prev);
  n = n.replace(/^[\s,;:.\-–—]+/, '');
  return n ? n[0].toUpperCase() + n.slice(1) : '';
}

export function parseOne(text, today) {
  let s = normalise(text);
  const dur = parseDuration(s);
  if (dur) s = s.replace(dur.match, ' ');
  const dl = parseDeadline(s, today);
  if (dl) s = s.replace(dl.match, ' ');
  let priority = 'normal';
  if (PRIORITY_RE.test(s)) {
    priority = 'high';
    s = s.replace(PRIORITY_RE, ' ');
  }
  return {
    name: cleanName(s),
    deadline: dl ? dl.date : null,
    minutes: dur ? dur.minutes : null,
    priority,
  };
}

/** Several tasks can be dictated at once: one per sentence or line. */
export function parseDictation(text, today) {
  const parts = text.split(/\n+|[.!?;](?=\s|$)/).map((p) => p.trim()).filter(Boolean);
  const drafts = [];
  for (const p of parts) {
    const d = parseOne(p, today);
    const prev = drafts[drafts.length - 1];
    const words = d.name ? d.name.split(' ').length : 0;
    if (prev && words < 2 && (d.deadline || d.minutes)) {
      // e.g. "About three hours." on its own belongs to the task before it
      prev.deadline = prev.deadline || d.deadline;
      prev.minutes = prev.minutes || d.minutes;
      if (d.priority === 'high') prev.priority = 'high';
      continue;
    }
    if (d.name || d.deadline || d.minutes) drafts.push(d);
  }
  return drafts;
}
