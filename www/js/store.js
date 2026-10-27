// On-device data: one JSON object under one localStorage key, kept compatible forever.
// Rules (see CLAUDE.md, "Data compatibility"):
//   - STORAGE_KEY never changes.
//   - Changing the shape of stored data = bump SCHEMA_VERSION + add a migration below.
//   - Migrations and normalize() only ADD or convert; they never delete user data or unknown fields.
//   - Every released schema version has a fixture in tools/fixtures/ that tools/test-storage.mjs upgrades.
// Environment-neutral (browser + Node tests): pass in a Storage-like object.

export const STORAGE_KEY = 'sfp.v1';
export const SCHEMA_VERSION = 4;

export const DEFAULTS = {
  prefs: { studios: [], plan: 'all', day: 'all', tod: 'all', q: '', weeklyGoal: 2, days: [], tods: [], plans: [], allStudios: false },
  agenda: [], friends: [], log: [], nameFixes: {}, schedule: null, lastSync: null,
  rewards: [{ at: 2, text: '', receivedAt: null }, { at: 5, text: '', receivedAt: null }, { at: 10, text: '', receivedAt: null }],
  badgesSeen: null,
  me: { name: '', phone: '', asked: false },
};

// MIGRATIONS[n] upgrades data from version n-1 to n. Append only; never edit a released one.
const MIGRATIONS = {
  // v0 = the unversioned format shipped 2026-10-21/22. v1 adds schemaVersion; normalize() fills gaps.
  1: s => s,
  // v2 (2026-10-23): dashboard filters are multi-select arrays. The old single values are converted and kept.
  2: s => {
    const p = isObj(s.prefs) ? { ...s.prefs } : {};
    const one = v => (v === undefined || v === null || v === 'all' || v === '' ? [] : [v]);
    if (!Array.isArray(p.days)) p.days = one(p.day).map(Number).filter(d => d >= 1 && d <= 7);
    if (!Array.isArray(p.tods)) p.tods = one(p.tod);
    if (!Array.isArray(p.plans)) p.plans = one(p.plan);
    if (typeof p.allStudios !== 'boolean') p.allStudios = false;
    return { ...s, prefs: p };
  },
  // v3 (2026-10-23): log entries may carry type / typeNote / minutes (optional, never back-filled);
  // self-set rewards at 2, 5 and 10 badges; badgesSeen = badge ids already celebrated
  // (null until the app first records the badges earned before this version, so they don't pop).
  3: s => ({
    ...s,
    rewards: Array.isArray(s.rewards) ? s.rewards : DEFAULTS.rewards.map(r => ({ ...r })),
    badgesSeen: Array.isArray(s.badgesSeen) ? s.badgesSeen : null,
  }),
  // v4 (2026-10-27): me = your own name/phone, sent in invite links; asked = the name prompt was shown.
  4: s => ({ ...s, me: isObj(s.me) ? s.me : { ...DEFAULTS.me } }),
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);

// Additive repair applied on every load: fills missing fields with defaults, keeps everything else.
export function normalize(s) {
  const out = { ...s };
  out.prefs = { ...DEFAULTS.prefs, ...(isObj(s.prefs) ? s.prefs : {}) };
  for (const k of ['studios', 'days', 'tods', 'plans']) out.prefs[k] = arr(out.prefs[k]);
  for (const k of ['agenda', 'friends', 'log']) out[k] = arr(s[k]);
  out.nameFixes = isObj(s.nameFixes) ? s.nameFixes : {};
  if (!('schedule' in out)) out.schedule = null;
  if (!('lastSync' in out)) out.lastSync = null;
  // Rewards: keep every stored row (and its fields); add any milestone that is missing.
  out.rewards = arr(s.rewards).filter(isObj).map(r => ({ text: '', receivedAt: null, ...r }));
  for (const d of DEFAULTS.rewards) if (!out.rewards.some(r => r.at === d.at)) out.rewards.push({ ...d });
  out.rewards.sort((a, b) => a.at - b.at);
  if (!('badgesSeen' in out) || (out.badgesSeen !== null && !Array.isArray(out.badgesSeen))) out.badgesSeen = null;
  out.me = { ...DEFAULTS.me, ...(isObj(s.me) ? s.me : {}) };
  out.agenda = out.agenda.map(e => ({ status: 'planned', ...e, friends: arr(e?.friends) }));
  out.log = out.log.map(l => ({ ...l, friends: arr(l?.friends) }));
  return out;
}

// Upgrades any stored object to the current version. Data from a NEWER app version is left as is
// (only normalized), so an older cached app never strips fields it doesn't understand.
export function migrate(data) {
  let s = isObj(data) ? { ...data } : {};
  const from = Number.isInteger(s.schemaVersion) ? s.schemaVersion : 0;
  if (from > SCHEMA_VERSION) return { state: normalize(s), from, newer: true };
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) s = MIGRATIONS[v](s);
  s.schemaVersion = SCHEMA_VERSION;
  return { state: normalize(s), from, newer: false };
}

// Reads state. Before any upgrade, the raw data is copied to `${STORAGE_KEY}.backup.v<from>`.
// Unreadable data is quarantined to `${STORAGE_KEY}.corrupt.<time>` instead of being overwritten.
export function load(storage) {
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  if (!raw) return { state: migrate({}).state, from: SCHEMA_VERSION, fresh: true };
  let data;
  try { data = JSON.parse(raw); } catch {
    try { storage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw); } catch { /* full */ }
    return { state: migrate({}).state, from: SCHEMA_VERSION, corrupt: true };
  }
  const r = migrate(data);
  if (r.from < SCHEMA_VERSION) {
    const bk = `${STORAGE_KEY}.backup.v${r.from}`;
    try { if (!storage.getItem(bk)) storage.setItem(bk, raw); } catch { /* full: upgrade anyway, data is kept */ }
  }
  return r;
}

export function save(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
