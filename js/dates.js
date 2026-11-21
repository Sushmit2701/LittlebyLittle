// Local calendar dates are stored as 'YYYY-MM-DD' strings so they sort and compare simply.

export const pad = (n) => String(n).padStart(2, '0');

export const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromStr = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids daylight-saving edge cases
};

export const todayStr = (now = new Date()) => toStr(now);

export const addDays = (s, n) => {
  const d = fromStr(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
};

/** 0 = Sunday … 6 = Saturday */
export const weekday = (s) => fromStr(s).getDay();

/** Whole days from a to b (b − a). */
export const diffDays = (a, b) => Math.round((fromStr(b) - fromStr(a)) / 864e5);

/** Monday of the week containing s. */
export const weekStart = (s) => addDays(s, -((weekday(s) + 6) % 7));

export const lastDayOfMonth = (s, monthOffset = 0) => {
  const d = fromStr(s);
  return toStr(new Date(d.getFullYear(), d.getMonth() + 1 + monthOffset, 0, 12));
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const DAY_NAMES = DAY_LONG;

/** "Fri 27 Nov", or "Today" / "Tomorrow" when a reference day is given. */
export function fmtDay(s, today) {
  if (!s) return '';
  if (today) {
    const diff = diffDays(today, s);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
  }
  const d = fromStr(s);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** "Saturday 21 November" */
export function fmtLong(s) {
  const d = fromStr(s);
  return `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
}

export function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function addMinutesToTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
