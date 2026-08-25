/**
 * Owns the coffee list and everything about getting it in and out of GitHub.
 *
 * Source-of-truth rules:
 *   - repo + token set  -> "sync" mode. GitHub is authoritative; every edit is a commit.
 *   - no token          -> "local" mode. Edits live in this browser's localStorage only,
 *                          and the UI badges that plainly so the divergence is never silent.
 *
 * Reads deliberately avoid the API when unauthenticated: the static file on Pages is
 * unlimited, while anonymous API calls are capped at 60/hour per IP.
 */

import * as gh from './github.js';

export const DATA_PATH = 'data/coffees.json';
const DEFAULT_REPO = 'rgsheld/coffee-map';
const K_CONFIG = 'coffeemap.config';
const K_CACHE  = 'coffeemap.cache';

/* ------------------------------------------------------------------ state */

const state = {
  coffees: [],
  sha: null,
  config: { repo: DEFAULT_REPO, token: '' },
  status: 'local',      // 'local' | 'synced' | 'pending' | 'error'
  statusText: '',
  dirty: false,         // local edits not yet committed
  loaded: false,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(state); }

export function get() { return state; }
export function isSyncing() { return Boolean(state.config.token && gh.parseRepo(state.config.repo)); }

function setStatus(status, text = '') {
  state.status = status;
  state.statusText = text;
  emit();
}

/* ------------------------------------------------------------------ storage */

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* private mode / quota — the in-memory copy still works for this session */ }
}

function cache() {
  writeLocal(K_CACHE, { coffees: state.coffees, sha: state.sha, dirty: state.dirty, at: Date.now() });
}

export function loadConfig() {
  const saved = readLocal(K_CONFIG, {});
  state.config = { repo: saved.repo || DEFAULT_REPO, token: saved.token || '' };
  return state.config;
}

export function saveConfig({ repo, token }) {
  state.config = { repo: repo ?? state.config.repo, token: token ?? state.config.token };
  writeLocal(K_CONFIG, state.config);
  emit();
}

export function forgetToken() {
  state.config.token = '';
  writeLocal(K_CONFIG, state.config);
  setStatus('local', 'Token removed. Edits stay on this device.');
}

/* ------------------------------------------------------------------ shape */

function normalise(doc) {
  const list = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.coffees) ? doc.coffees : []);
  return list.filter(Boolean).map((c) => ({
    id: c.id || newId(),
    name: str(c.name),
    country: str(c.country).toUpperCase().slice(0, 3),
    region: str(c.region),
    variety: arr(c.variety),
    process: str(c.process),
    roaster: str(c.roaster),
    flavorNotes: arr(c.flavorNotes ?? c.flavourNotes ?? c.notes_flavor),
    rating: c.rating === '' || c.rating == null ? null : Number(c.rating),
    dateTried: str(c.dateTried),
    altitude: c.altitude === '' || c.altitude == null ? null : Number(c.altitude),
    notes: str(c.notes),
    // Kept so the seeded examples stay one click away from being cleared.
    ...(c.sample === true ? { sample: true } : {}),
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
  }));
}

const str = (v) => (v == null ? '' : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

export function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `c_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${rand}`;
}

function serialise(coffees) {
  const sorted = [...coffees].sort((a, b) =>
    a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  return JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), coffees: sorted }, null, 2) + '\n';
}

/* ------------------------------------------------------------------ load */

export async function load() {
  loadConfig();
  const cached = readLocal(K_CACHE, null);
  const repo = gh.parseRepo(state.config.repo);

  // Show cached data immediately so the map is never blank while the network settles.
  if (cached && Array.isArray(cached.coffees)) {
    state.coffees = normalise(cached.coffees);
    state.sha = cached.sha || null;
    state.dirty = Boolean(cached.dirty);
  }

  if (state.config.token && repo) {
    try {
      const { text, sha } = await gh.getFile({ ...repo, path: DATA_PATH, token: state.config.token });
      if (text !== null) {
        const remote = normalise(JSON.parse(text));
        if (state.dirty) {
          // Local edits never got committed. Keep them, and push on the next save.
          state.coffees = mergeById(remote, state.coffees);
          state.sha = sha;
          state.loaded = true;
          cache();
          setStatus('pending', 'Local edits not yet pushed.');
          return state;
        }
        state.coffees = remote;
        state.sha = sha;
      } else {
        state.sha = null;   // file not created yet; first save will create it
      }
      state.dirty = false;
      state.loaded = true;
      cache();
      setStatus('synced', 'Synced with GitHub.');
      return state;
    } catch (err) {
      state.loaded = true;
      setStatus('error', err.message);
      return state;
    }
  }

  // No token: read the static file that ships with the site.
  try {
    const res = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const remote = normalise(await res.json());
      // Local unsaved edits win over the bundled file, otherwise they'd vanish on reload.
      state.coffees = state.dirty ? mergeById(remote, state.coffees) : remote;
      if (!state.dirty) state.sha = null;
      cache();
    }
  } catch { /* offline, or opened via file:// — the cache above already covers us */ }

  state.loaded = true;
  setStatus('local', state.config.token ? 'Check the repository name in Settings.'
                                        : 'Saved on this device only.');
  return state;
}

/** Union two lists by id; `mine` wins on collision. Used only to protect uncommitted edits. */
function mergeById(theirs, mine) {
  const byId = new Map(theirs.map((c) => [c.id, c]));
  for (const c of mine) byId.set(c.id, c);
  return [...byId.values()];
}

/* ------------------------------------------------------------------ save */

/**
 * Apply a change and persist it.
 *
 * `mutate` is an operation, not a snapshot: (coffees) => coffees. That matters for
 * conflict handling — on a 409 we re-read the current remote list and replay the
 * same operation against it, so a concurrent edit from another device survives
 * instead of being overwritten by a stale whole-file snapshot.
 */
export async function applyChange(mutate, message) {
  const before = state.coffees;
  state.coffees = mutate(before.map((c) => ({ ...c })));
  state.dirty = true;
  cache();
  emit();

  const repo = gh.parseRepo(state.config.repo);
  if (!state.config.token || !repo) {
    setStatus('local', 'Saved on this device only.');
    return { ok: true, mode: 'local' };
  }

  setStatus('pending', 'Saving to GitHub…');
  try {
    await commit(mutate, message, repo);
    state.dirty = false;
    cache();
    setStatus('synced', 'Synced with GitHub.');
    return { ok: true, mode: 'sync' };
  } catch (err) {
    // The edit is safe in memory and in localStorage; only the push failed.
    setStatus('error', err.message);
    return { ok: false, mode: 'sync', error: err };
  }
}

async function commit(mutate, message, repo, attempt = 0) {
  try {
    const { sha } = await gh.putFile({
      ...repo, path: DATA_PATH, token: state.config.token,
      text: serialise(state.coffees), sha: state.sha, message,
    });
    state.sha = sha;
  } catch (err) {
    if (err.kind === 'conflict' && attempt < 2) {
      // Someone else committed. Re-read, replay this operation on top, try again.
      const fresh = await gh.getFile({ ...repo, path: DATA_PATH, token: state.config.token });
      state.sha = fresh.sha;
      state.coffees = mutate(fresh.text ? normalise(JSON.parse(fresh.text)) : []);
      cache();
      emit();
      return commit(mutate, message, repo, attempt + 1);
    }
    throw err;
  }
}

/** Retry a push that previously failed, sending the current list as-is. */
export async function retryPush() {
  const repo = gh.parseRepo(state.config.repo);
  if (!state.config.token || !repo) return { ok: false };
  setStatus('pending', 'Retrying…');
  try {
    // Re-read first so we start from the true head rather than a stale sha.
    const fresh = await gh.getFile({ ...repo, path: DATA_PATH, token: state.config.token });
    state.sha = fresh.sha;
    await gh.putFile({
      ...repo, path: DATA_PATH, token: state.config.token,
      text: serialise(state.coffees), sha: state.sha, message: 'Sync coffee log',
    });
    const after = await gh.getFile({ ...repo, path: DATA_PATH, token: state.config.token });
    state.sha = after.sha;
    state.dirty = false;
    cache();
    setStatus('synced', 'Synced with GitHub.');
    return { ok: true };
  } catch (err) {
    setStatus('error', err.message);
    return { ok: false, error: err };
  }
}

/* ------------------------------------------------------------------ ops */

export const upsert = (coffee) => (list) => {
  const i = list.findIndex((c) => c.id === coffee.id);
  if (i === -1) list.push(coffee); else list[i] = coffee;
  return list;
};

export const remove = (id) => (list) => list.filter((c) => c.id !== id);

export const replaceAll = (coffees) => () => coffees;

/* ------------------------------------------------------------------ transfer */

export function exportText() { return serialise(state.coffees); }

export function parseImport(text) {
  const parsed = normalise(JSON.parse(text));
  if (!parsed.length) throw new Error('No coffees found in that file.');
  return parsed;
}

export async function testConnection({ repo, token }) {
  const parsed = gh.parseRepo(repo);
  if (!parsed) throw new gh.GitHubError('Repository should look like "owner/repo".', { kind: 'notfound' });
  if (!token) throw new gh.GitHubError('Paste a token first.', { kind: 'auth' });
  return gh.testAccess({ ...parsed, path: DATA_PATH, token });
}
