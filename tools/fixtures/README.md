# Storage fixtures

One file per released on-device schema version (`www/js/store.js` → `SCHEMA_VERSION`), in the exact
shape that version wrote to `localStorage["sfp.v1"]`. `tools/test-storage.mjs` upgrades each one to the
current version and fails if any user data is lost.

When you bump `SCHEMA_VERSION` to N: add `vN.json` (the new shape, realistic data). Never edit or
delete an existing fixture: it is a record of data that real phones may still hold.
