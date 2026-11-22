// Optional sign-in and sync across your devices, through the same Supabase project as Bibliophile.
// Signed out (the default), nothing leaves this device.
//
// How it works: each task, habit and your settings is one row in the cloud. The app remembers a
// fingerprint of each row as last synced, so it can tell what changed here (including deletions)
// and send only that. Changes from your other devices come down the same way.

import { CLOUD } from './cloud-config.js';
import { onSave } from './store.js';
import { toRows, hash, mergeRecord, applyRecord } from './sync-merge.js';

const SESSION_KEY = 'chunker:cloud-session';
const STATE_KEY = 'chunker:cloud-state';
const PKCE_KEY = 'chunker:cloud-pkce';
const EMAIL_KEY = 'chunker:cloud-email';
const TABLE = 'chunker_records';
const EPOCH = '1970-01-01T00:00:00.000Z';
const PAGE = 500;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const config = () => (CLOUD.url && CLOUD.anonKey ? { url: new URL(CLOUD.url).origin, anonKey: CLOUD.anonKey } : null);

// ---------- status ----------
const status = { syncing: false, error: '', pendingEmail: read(EMAIL_KEY) || '' };
let host = { getState: () => null, onPulled: () => {}, onStatus: () => {} };
const emit = () => host.onStatus();
let providers = null;

export function getStatus() {
  const s = session();
  return {
    available: !!config(), signedIn: !!s, email: s?.user?.email || '', lastSync: state()?.lastSync || '',
    syncing: status.syncing, error: status.error, pendingEmail: status.pendingEmail, google: providers?.google ?? false,
  };
}

export async function loadProviders() {
  const c = config();
  if (!c || providers) return providers;
  try {
    const j = await (await fetch(c.url + '/auth/v1/settings', { headers: { apikey: c.anonKey } })).json();
    providers = { google: !!j.external?.google };
  } catch { providers = { google: false }; }
  emit();
  return providers;
}

// ---------- auth ----------
const session = () => read(SESSION_KEY);
function storeSession(j) {
  const s = {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: Number(j.expires_at) || Math.floor(Date.now() / 1000) + Number(j.expires_in || 3600),
    user: j.user ? { id: j.user.id, email: j.user.email } : session()?.user,
  };
  write(SESSION_KEY, s);
  return s;
}

async function authFetch(path, body, query = '') {
  const c = config();
  if (!c) throw new Error('Sync isn’t set up in this version of the app.');
  let res;
  try {
    res = await fetch(`${c.url}/auth/v1/${path}${query}`, {
      method: 'POST', headers: { apikey: c.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new Error('Couldn’t reach the sync server. Check your connection.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = j.msg || j.message || j.error_description || j.error || '';
    const e = new Error(
      /rate limit|too many|security purposes/i.test(m) ? 'Too many sign-in emails for now. Wait a minute and try again.'
        : /expired|invalid.*(otp|token)|otp.*(invalid|expired)/i.test(m) ? 'That code didn’t work. It may have expired, so ask for a new one.'
          : /provider is not enabled/i.test(m) ? 'That sign-in method isn’t switched on in Supabase.'
            : m || 'Sign-in didn’t work. Please try again.',
    );
    e.status = res.status;
    throw e;
  }
  return j;
}

const redirectTo = () => location.origin + location.pathname + '?auth=cloud';

export async function sendEmailCode(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please enter a valid email address.');
  await authFetch('otp', { email, create_user: true }, '?redirect_to=' + encodeURIComponent(redirectTo()));
  status.pendingEmail = email;
  write(EMAIL_KEY, email);
  emit();
}
export function cancelEmail() {
  status.pendingEmail = '';
  write(EMAIL_KEY, null);
  emit();
}
export async function verifyEmailCode(code) {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new Error('Enter the code from the email.');
  return signedIn(await authFetch('verify', { type: 'email', email: status.pendingEmail, token }));
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function signInWithGoogle() {
  const c = config();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PKCE_KEY, verifier);
  location.href = `${c.url}/auth/v1/authorize?` + new URLSearchParams({
    provider: 'google', redirect_to: redirectTo(), code_challenge: challenge, code_challenge_method: 's256',
  });
}

// Back from Google (…?auth=cloud&code=…) or from the link in the sign-in email (#access_token=…).
export function isRedirect() {
  return new URLSearchParams(location.search).get('auth') === 'cloud' || /(^|[#&])(access_token|error_description)=/.test(location.hash);
}
export async function handleRedirect() {
  if (!isRedirect()) return null;
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  history.replaceState(null, '', location.pathname + '#today');
  const err = q.get('error_description') || h.get('error_description');
  if (err) return { ok: false, message: /expired|invalid/i.test(err) ? 'That sign-in link has expired. Ask for a new one.' : err.replace(/\+/g, ' ') };
  try {
    if (h.get('access_token')) {
      storeSession(Object.fromEntries(h));
      const u = await rest('/auth/v1/user');
      return signedIn({ ...session(), user: u });
    }
    if (q.get('code')) {
      const verifier = sessionStorage.getItem(PKCE_KEY);
      sessionStorage.removeItem(PKCE_KEY);
      if (!verifier) return { ok: false, message: 'Sign-in expired. Please try again in the same app.' };
      return signedIn(await authFetch('token', { auth_code: q.get('code'), code_verifier: verifier }, '?grant_type=pkce'));
    }
  } catch (e) {
    write(SESSION_KEY, null);
    return { ok: false, message: e.message || 'Sign-in didn’t work. Please try again.' };
  }
  return null;
}

function signedIn(j) {
  const s = storeSession(j);
  const st = state();
  // First sign-in on this device: everything here is combined with the cloud copy.
  if (!st || st.user !== s.user.id) write(STATE_KEY, { user: s.user.id, cursor: EPOCH, snap: {}, dirty: {}, lastSync: '' });
  cancelEmail();
  status.error = '';
  start();
  return { ok: true, email: s.user.email };
}

let refreshing = null;
async function accessToken(force = false) {
  const s = session();
  if (!s) throw new Error('Signed out');
  if (!force && s.expires_at * 1000 - 60000 > Date.now()) return s.access_token;
  refreshing ||= (async () => {
    const run = async () => {
      const cur = session();
      if (!cur) throw new Error('Signed out');
      if (cur.access_token !== s.access_token && cur.expires_at * 1000 - 60000 > Date.now()) return cur.access_token;
      try {
        return storeSession(await authFetch('token', { refresh_token: cur.refresh_token }, '?grant_type=refresh_token')).access_token;
      } catch (e) {
        if (e.status === 400 || e.status === 401) {
          forget();
          status.error = 'You were signed out. Sign in again to keep syncing.';
          emit();
        }
        throw e;
      }
    };
    return navigator.locks ? navigator.locks.request('chunker-cloud-auth', run) : run();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function rest(path, { method = 'GET', body, headers = {} } = {}, retried = false) {
  const c = config();
  const token = await accessToken();
  let res;
  try {
    res = await fetch(c.url + path, {
      method,
      headers: { apikey: c.anonKey, authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const e = new Error('offline');
    e.offline = true;
    throw e;
  }
  if (res.status === 401 && !retried) {
    await accessToken(true);
    return rest(path, { method, body, headers }, true);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(j.message || j.msg || `The server said ${res.status}`);
    e.status = res.status;
    e.code = j.code;
    throw e;
  }
  return res.status === 204 || res.status === 201 ? null : res.json().catch(() => null);
}

function forget() {
  write(SESSION_KEY, null);
  write(STATE_KEY, null);
}

export async function signOut() {
  await syncNow().catch(() => {}); // send any last changes first
  const s = session();
  const c = config();
  if (s && c) fetch(c.url + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: c.anonKey, authorization: 'Bearer ' + s.access_token } }).catch(() => {});
  forget();
  status.error = '';
  emit();
}

// ---------- sync ----------
const state = () => read(STATE_KEY);

// Notice what changed on this device since the last sync. Each change keeps the time it was made.
function markDirty() {
  const st = state();
  const app = host.getState();
  if (!st || !session() || !app) return;
  const now = new Date().toISOString();
  const cur = toRows(app);
  for (const [k, v] of cur) {
    const h = hash(v);
    if (st.snap[k] === h) { delete st.dirty[k]; continue; }
    if (st.dirty[k]?.h === h) continue;
    st.dirty[k] = { at: now, h };
  }
  for (const k of Object.keys(st.snap)) if (!cur.has(k) && st.dirty[k]?.h !== null) st.dirty[k] = { at: now, h: null }; // deleted here
  for (const k of Object.keys(st.dirty)) if (!cur.has(k) && st.snap[k] === undefined) delete st.dirty[k];
  write(STATE_KEY, st);
}

let running = null;
export function syncNow() {
  if (!session() || !config()) return Promise.resolve();
  running ||= doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  status.syncing = true;
  emit();
  try {
    markDirty();
    const changed = await pull();
    await push();
    const st = state();
    if (st) { st.lastSync = new Date().toISOString(); write(STATE_KEY, st); }
    status.error = '';
    if (changed) host.onPulled();
  } catch (e) {
    if (!session()) return;
    status.error = e.offline ? 'Offline. Changes will sync when you’re back online.'
      : e.code === '42P01' || e.code === 'PGRST205' ? 'The sync table is missing. Run supabase/chunker.sql in Supabase’s SQL Editor.'
        : e.message;
  } finally {
    status.syncing = false;
    emit();
  }
}

async function pull() {
  const st = state();
  const app = host.getState();
  const since = new Date(new Date(st.cursor).getTime() - 5000).toISOString(); // small overlap, for safety
  const cur = toRows(app);
  let cursor = st.cursor;
  let changed = false;
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest(`/rest/v1/${TABLE}?select=kind,id,data,deleted,client_at,updated_at&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc,kind.asc,id.asc&limit=${PAGE}&offset=${offset}`);
    for (const r of page) {
      const k = r.kind + ':' + r.id;
      if (new Date(r.updated_at) > new Date(cursor)) cursor = r.updated_at;
      const remote = r.deleted ? undefined : r.data;
      const rh = hash(remote);
      if (st.snap[k] === rh) continue; // nothing new
      const mine = st.dirty[k];
      const value = mergeRecord(r.kind, cur.get(k), remote, mine?.at, r.client_at);
      if (applyRecord(app, r.kind, r.id, value)) changed = true;
      if (rh === undefined) delete st.snap[k]; else st.snap[k] = rh;
      const nowH = hash(toRows(app).get(k));
      if (nowH === rh) delete st.dirty[k];
      else st.dirty[k] = { at: mine && new Date(mine.at) > new Date(r.client_at) ? mine.at : new Date().toISOString(), h: nowH ?? null };
    }
    if (page.length < PAGE) break;
  }
  st.cursor = cursor;
  write(STATE_KEY, st);
  return changed;
}

async function push() {
  const st = state();
  const keys = Object.keys(st.dirty);
  if (!keys.length) return;
  const cur = toRows(host.getState());
  const user = session().user.id;
  for (let i = 0; i < keys.length; i += 200) {
    const batch = keys.slice(i, i + 200).map((k) => {
      const kind = k.slice(0, k.indexOf(':'));
      const v = cur.get(k);
      return { k, h: hash(v), row: { user_id: user, kind, id: k.slice(kind.length + 1), data: v ?? null, deleted: !v, client_at: st.dirty[k].at } };
    });
    await rest(`/rest/v1/${TABLE}?on_conflict=user_id,kind,id`, {
      method: 'POST', body: batch.map((b) => b.row), headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    const now = toRows(host.getState());
    for (const b of batch) {
      if (b.h === undefined) delete st.snap[b.k]; else st.snap[b.k] = b.h;
      if (hash(now.get(b.k)) === b.h) delete st.dirty[b.k]; // unchanged while sending
    }
    write(STATE_KEY, st);
  }
}

// ---------- running in the background ----------
let started = false;
let timer = null;
export function init(h) {
  host = { ...host, ...h };
  if (session() && config()) start();
}
function start() {
  if (started) { syncNow(); return; }
  started = true;
  onSave(() => {
    if (!session()) return;
    markDirty();
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(), 2000);
  });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  const wake = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) syncNow(); };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  syncNow();
}
