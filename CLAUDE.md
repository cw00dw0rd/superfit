# SF Planner — rules for changes

Static PWA in `www/` (no build step), deployed to GitHub Pages by `.github/workflows/pages.yml`. See README.md for layout and tools.

## Data compatibility (mandatory)

Users' agenda, friends, workout log and settings live only on their phones, in `localStorage["sfp.v1"]`. An update must never lose, corrupt or strand that data.

1. **Never change `STORAGE_KEY` (`sfp.v1`)**, and never change the app's origin (`cw00dw0rd.github.io`) without first shipping a migration path. Storage is per origin, so a new domain starts empty.
2. **All reads and writes of stored state go through `www/js/store.js`.** Do not call `localStorage` for user data anywhere else.
3. **Changing the stored shape** (new field with meaning, renamed field, new structure) requires all of:
   - bump `SCHEMA_VERSION`;
   - append a migration `MIGRATIONS[N]` (never edit a released migration);
   - add `tools/fixtures/vN.json` with realistic data in the new shape (never edit or delete existing fixtures).
4. **Migrations and `normalize()` only add or convert.** Never delete user entries or fields, and keep unknown fields: a newer app version may have written them.
5. **Code must tolerate old entries**: treat optional fields as possibly missing (`e.friends ?? []`, `l.start` may be absent).
6. **History is self-contained**: agenda and log entries store a snapshot (name, studio, times). Never make their display depend on the current schedule still containing that class.
7. **Backups**: export writes the stored object; `importBackup` must pass it through `store.migrate`.
8. **Service worker**: bump `CACHE` in `www/sw.js` when shell files change; never clear localStorage or IndexedDB from it.
9. **Run `npm test` before pushing.** CI runs it on every push, and a failure blocks the Pages deploy.

App data (`www/data/schedule.json`, `classinfo.json`, `glyphs.json`) is not user data and may change freely; class IDs should stay stable (`studio-plan-day-HHMM-name`).

## Commits

Do not put model identifiers in commits, PRs or code comments.
