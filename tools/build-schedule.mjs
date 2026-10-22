// Builds www/data/schedule.json, the schedule bundled with the app.
//   node tools/build-schedule.mjs                       crawl superfit.club (only changed PDFs re-parsed)
//   node tools/build-schedule.mjs --force               crawl and re-parse everything
//   node tools/build-schedule.mjs --pdf mitte a.pdf b.pdf   add/replace one studio from local PDFs
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { parseSchedulePdf } from '../www/js/pdfparse.js';
import { syncSchedule, toClasses, SITE } from '../www/js/sync.js';

const out = new URL('../www/data/schedule.json', import.meta.url);
const previous = JSON.parse(fs.readFileSync(out, 'utf8'));
const protos = JSON.parse(fs.readFileSync(new URL('../www/data/glyphs.json', import.meta.url), 'utf8')).glyphs;
const parsePdf = data => parseSchedulePdf(pdfjs, data, protos);
const args = process.argv.slice(2);

const report = changes => {
  for (const c of changes) {
    console.log(`${c.studio} ${c.plan || ''}: ${c.kind}${c.validFrom ? ` (valid from ${c.validFrom})` : ''}${c.msg ? ` ${c.msg}` : ''}`);
    for (const a of c.added || []) console.log(`  + ${a.day} ${a.start} ${a.name}`);
    for (const r of c.removed || []) console.log(`  - ${r.day} ${r.start} ${r.name}`);
    if (c.unknown) console.log(`  ! ${c.unknown} unknown glyphs: check names with "?" and retrain (tools/train-glyphs.mjs)`);
  }
};

let schedule;
if (args[0] === '--pdf') {
  const [, id, ...files] = args;
  const studio = previous.studios.find(s => s.id === id) || { id, url: `${SITE}/studios/${id}`, name: id, address: '', mapsUrl: '', plans: {} };
  let classes = previous.classes;
  for (const f of files) {
    const parsed = await parsePdf(new Uint8Array(fs.readFileSync(f)));
    studio.name = parsed.studioName ? parsed.studioName[0] + parsed.studioName.slice(1).toLowerCase() : studio.name;
    studio.plans[parsed.plan] = { pdf: studio.plans[parsed.plan]?.pdf || '', validFrom: parsed.validFrom, unknownGlyphs: parsed.unknownGlyphs };
    classes = classes.filter(c => !(c.studio === id && c.plan === parsed.plan)).concat(toClasses(id, parsed));
    console.log(`${f}: ${parsed.plan}, ${parsed.classes.length} classes, unknown glyphs ${parsed.unknownGlyphs}`);
  }
  schedule = { ...previous, generated: new Date().toISOString(), studios: [...previous.studios.filter(s => s.id !== id), studio], classes };
} else {
  const r = await syncSchedule({
    fetchText: async u => { const res = await fetch(u); if (!res.ok) throw new Error(`${res.status} ${u}`); return res.text(); },
    fetchBytes: async u => { const res = await fetch(u); if (!res.ok) throw new Error(`${res.status} ${u}`); return new Uint8Array(await res.arrayBuffer()); },
    parsePdf, previous, force: args.includes('--force'), onProgress: m => console.log(m),
  });
  report(r.changes);
  schedule = r.schedule;
}
// Keep the old timestamp (and file) when nothing but the timestamp would change.
const same = JSON.stringify({ ...schedule, generated: 0 }) === JSON.stringify({ ...previous, generated: 0 });
if (same) console.log('No changes.');
else {
  fs.writeFileSync(out, JSON.stringify(schedule, null, 1));
  console.log(`${schedule.studios.length} studios, ${schedule.classes.length} classes -> www/data/schedule.json`);
}
