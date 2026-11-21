// All data lives in this one localStorage entry. No server, no account.

const KEY = 'dailyChunker.v1';

export function defaultState() {
  return {
    version: 1,
    settings: {
      dailyLimit: 90, // most minutes of task chunks on any one day
      defaultChunk: 30,
      preferredTime: 'morning', // morning | lunch | evening
      slotTimes: { morning: '07:00', lunch: '12:30', evening: '19:30' },
      offWeekdays: [], // 0 = Sunday … 6 = Saturday
      unavailableDates: [], // 'YYYY-MM-DD' (on-call, leave …)
      aiKey: '',
      theme: 'auto',
    },
    tasks: [],
    habits: [],
    lockedDay: null, // a day where "Too much today" was pressed: nothing new is added to it
    lastPlanned: null,
    notice: null,
  };
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function load() {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return {
      ...base,
      ...saved,
      settings: { ...base.settings, ...saved.settings, slotTimes: { ...base.settings.slotTimes, ...(saved.settings?.slotTimes || {}) } },
    };
  } catch {
    return base;
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
