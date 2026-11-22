// How Daily Chunker's data becomes sync rows, and how two devices' versions are combined.
// Pure functions, so they can be tested without a network.

// Settings that stay on each device (your AI key never leaves the browser it was typed into).
export const LOCAL_SETTINGS = ['aiKey', 'theme'];

// Dates of chunks not yet done are worked out again on each device, so they aren't synced.
// Syncing them would make every re-plan look like an edit.
export function cleanTask(t) {
  const { unplaced, overdue, ...rest } = t;
  return {
    ...rest,
    chunks: t.chunks.map((c) => {
      if (c.done) return { ...c };
      const { date, ...open } = c;
      return open;
    }),
  };
}

export const syncedSettings = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !LOCAL_SETTINGS.includes(k)));

/** The whole app state as a map of 'kind:id' → value. */
export function toRows(state) {
  const m = new Map();
  for (const t of state.tasks) m.set('task:' + t.id, cleanTask(t));
  for (const h of state.habits) m.set('habit:' + h.id, h);
  m.set('settings:main', syncedSettings(state.settings));
  return m;
}

// Fingerprints use sorted keys, because the database stores JSON with its keys in its own order.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
export function hash(v) {
  if (v === undefined || v === null) return undefined;
  const str = canon(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

/**
 * Combine this device's version of a record with the cloud's.
 * - Only one side changed: that side wins.
 * - Both changed: the later change wins, but a chunk ticked on either device stays ticked,
 *   and a habit's ticked days are added together.
 * `local` / `remote` are undefined when deleted. `localAt` is undefined when this device made no change.
 */
export function mergeRecord(kind, local, remote, localAt, remoteAt) {
  if (!localAt) return remote;
  const localNewer = new Date(localAt) > new Date(remoteAt);
  if (!local || !remote) return localNewer ? local : remote;
  const base = localNewer ? local : remote;
  const other = localNewer ? remote : local;
  if (kind === 'task') {
    const otherDone = new Map(other.chunks.filter((c) => c.done).map((c) => [c.id, c]));
    return {
      ...base,
      chunks: base.chunks.map((c) => {
        const d = otherDone.get(c.id);
        return !c.done && d ? { ...c, done: true, doneOn: d.doneOn, date: d.date || d.doneOn } : c;
      }),
    };
  }
  if (kind === 'habit') return { ...base, log: { ...(other.log || {}), ...(base.log || {}) } };
  return base;
}

/**
 * Put a record into the app state. Keeps this device's planned dates for chunks it already has,
 * so today's plan doesn't shift when something arrives from another device.
 * Returns true if anything changed.
 */
export function applyRecord(state, kind, id, value) {
  if (kind === 'settings') {
    if (!value) return false;
    const before = hash(syncedSettings(state.settings));
    const keep = Object.fromEntries(LOCAL_SETTINGS.map((k) => [k, state.settings[k]]));
    state.settings = { ...state.settings, ...value, ...keep };
    return hash(syncedSettings(state.settings)) !== before;
  }
  const list = kind === 'task' ? state.tasks : kind === 'habit' ? state.habits : null;
  if (!list) return false;
  const i = list.findIndex((x) => x.id === id);
  if (value === undefined) {
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  }
  let next = JSON.parse(JSON.stringify(value));
  if (kind === 'task' && i >= 0) {
    const dates = new Map(list[i].chunks.filter((c) => !c.done && c.date).map((c) => [c.id, c.date]));
    next.chunks.forEach((c) => { if (!c.done && dates.has(c.id)) c.date = dates.get(c.id); });
  }
  if (kind === 'task') next.chunks.forEach((c) => { if (!c.done && !('date' in c)) c.date = null; });
  if (i >= 0 && hash(kind === 'task' ? cleanTask(list[i]) : list[i]) === hash(kind === 'task' ? cleanTask(next) : next)) return false;
  if (i < 0) list.push(next); else list[i] = next;
  return true;
}
