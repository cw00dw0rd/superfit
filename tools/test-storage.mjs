// Guards on-device data across app updates. Runs in CI before every deploy.
// node tools/test-storage.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { STORAGE_KEY, SCHEMA_VERSION, migrate, load, normalize } from '../www/js/store.js';

const dir = new URL('./fixtures/', import.meta.url);
const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

// Every value in `before` must still be present (deeply) in `after`; `after` may only add.
function assertKept(before, after, path = '$') {
  if (Array.isArray(before)) {
    assert.ok(Array.isArray(after), `${path} is no longer an array`);
    assert.ok(after.length >= before.length, `${path} lost items (${before.length} -> ${after.length})`);
    before.forEach((v, i) => assertKept(v, after[i], `${path}[${i}]`));
  } else if (before && typeof before === 'object') {
    assert.ok(after && typeof after === 'object', `${path} is no longer an object`);
    for (const k of Object.keys(before)) {
      if (k === 'schemaVersion') continue;
      assert.ok(k in after, `${path}.${k} was dropped`);
      assertKept(before[k], after[k], `${path}.${k}`);
    }
  } else assert.deepEqual(after, before, `${path} changed`);
}

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`ok  ${name}`); };

// 1. A fixture exists for every released schema version.
for (let v = 0; v <= SCHEMA_VERSION; v++)
  check(`fixture v${v} exists`, () => assert.ok(fs.existsSync(new URL(`v${v}.json`, dir)), `add tools/fixtures/v${v}.json`));

for (let v = 0; v <= SCHEMA_VERSION; v++) {
  const raw = fs.readFileSync(new URL(`v${v}.json`, dir), 'utf8');
  const data = JSON.parse(raw);

  // 2. Upgrading keeps every piece of user data, including fields this version doesn't know.
  check(`v${v} -> v${SCHEMA_VERSION} keeps all data`, () => {
    const { state, from } = migrate(data);
    assert.equal(from, v);
    assert.equal(state.schemaVersion, SCHEMA_VERSION);
    assertKept(data, state);
  });

  // 3. Upgrading is idempotent: running it again changes nothing.
  check(`v${v} upgrade is idempotent`, () => {
    const once = migrate(data).state;
    assert.deepEqual(migrate(once).state, once);
  });

  // 4. Loading from storage backs up the original before upgrading older data.
  check(`v${v} load backs up before upgrading`, () => {
    const st = memory({ [STORAGE_KEY]: raw });
    const r = load(st);
    assertKept(data, r.state);
    if (v < SCHEMA_VERSION) assert.equal(st.map.get(`${STORAGE_KEY}.backup.v${v}`), raw);
  });
}

// 5. Unreadable data is quarantined, never overwritten.
check('corrupt data is quarantined', () => {
  const st = memory({ [STORAGE_KEY]: '{"agenda": [ broken' });
  const r = load(st);
  assert.ok(r.corrupt);
  assert.equal(st.map.get(STORAGE_KEY), '{"agenda": [ broken');
  assert.ok([...st.map.keys()].some(k => k.startsWith(`${STORAGE_KEY}.corrupt.`)));
});

// 6. Data written by a newer app version is not downgraded or stripped by an older app.
check('newer data is left intact', () => {
  const newer = { ...JSON.parse(fs.readFileSync(new URL(`v${SCHEMA_VERSION}.json`, dir))), schemaVersion: SCHEMA_VERSION + 1, futureFeature: { x: 1 } };
  const r = migrate(newer);
  assert.ok(r.newer);
  assert.equal(r.state.schemaVersion, SCHEMA_VERSION + 1);
  assertKept(newer, r.state);
});

// 7. Empty or partial data gets every default (no crashes on first run or old partial saves).
check('partial data is completed', () => {
  const s = normalize({ prefs: { weeklyGoal: 4 }, agenda: [{ id: 'a' }] });
  assert.equal(s.prefs.weeklyGoal, 4);
  assert.deepEqual(s.prefs.studios, []);
  assert.deepEqual(s.agenda[0].friends, []);
  assert.equal(s.agenda[0].status, 'planned');
  assert.deepEqual(s.log, []);
});

console.log(`${checks} storage checks passed (schema v${SCHEMA_VERSION})`);
