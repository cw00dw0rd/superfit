// Offline test of the site crawler + change detection, using stand-in HTML and local PDFs.
// node tools/test-sync.mjs <kursplan.pdf> <teamtraining.pdf>
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import assert from 'assert/strict';
import { parseSchedulePdf } from '../www/js/pdfparse.js';
import { syncSchedule, findStudioLinks, readStudioPage } from '../www/js/sync.js';

const [kp, tt] = process.argv.slice(2);
const protos = JSON.parse(fs.readFileSync(new URL('../www/data/glyphs.json', import.meta.url))).glyphs;
const CDN = 'https://cdn.prod.website-files.com/6814daccdbfcd1feda6231bc/';
const overview = `<nav><a href="/studios-ubersicht">Studios</a></nav>
  <a href="/studios/mitte" class="studio-card">Mitte</a><a href="https://superfit.club/studios/friedrichshain">F'hain</a><a href="/studios/mitte">again</a>`;
const studioPage = (kpName, ttName) => `<h1>Mitte</h1><p>Beispielstraße 12, 10115 Berlin</p>
  <a href="${CDN}${kpName}" target="_blank">Kursplan</a> <a href="${CDN}${ttName}">Teamtrainingsplan</a>
  <a href="https://maps.app.goo.gl/abc123">Route</a>`;
const fhainPage = `<p>Kein Plan</p><a href="${CDN}preisliste.pdf">Preise</a>`;
let pages = { mitte: studioPage('aaa_KP_MI_01.10.26.pdf', 'bbb_TT_MI_01.10.26.pdf') };
const files = { 'aaa_KP_MI_01.10.26.pdf': kp, 'bbb_TT_MI_01.10.26.pdf': tt, 'ccc_KP_MI_01.11.26.pdf': kp, 'preisliste.pdf': null };
let downloads = 0;
const env = {
  fetchText: async u => u.endsWith('studios-ubersicht') ? overview : u.endsWith('/mitte') ? pages.mitte : fhainPage,
  fetchBytes: async u => { downloads++; const f = files[u.slice(CDN.length)]; if (!f) return new Uint8Array([37, 80, 68, 70]); return new Uint8Array(fs.readFileSync(f)); },
  parsePdf: d => parseSchedulePdf(pdfjs, d, protos),
};

assert.deepEqual(findStudioLinks(overview).map(s => s.id), ['mitte', 'friedrichshain']);
const pg = readStudioPage(pages.mitte);
assert.equal(pg.pdfs.length, 2); assert.equal(pg.address, 'Beispielstraße 12, 10115 Berlin'); assert.equal(pg.mapsUrl, 'https://maps.app.goo.gl/abc123');

const r1 = await syncSchedule({ ...env, previous: { studios: [], classes: [] } });
assert.equal(r1.schedule.classes.length, 99);
assert.equal(r1.changes.filter(c => c.kind === 'new').length, 2);
console.log('first sync:', r1.changes.map(c => `${c.studio} ${c.plan} ${c.kind} +${c.added.length}`).join(', '), `| downloads ${downloads}`);

downloads = 0;
const r2 = await syncSchedule({ ...env, previous: r1.schedule });
assert.equal(r2.changes.length, 0); assert.equal(downloads, 0, 'nothing re-downloaded'); assert.equal(r2.schedule.classes.length, 99);
console.log('second sync: no changes, downloads', downloads);

// Kursplan re-uploaded under a new URL; pretend a class was removed before so the diff shows something.
pages.mitte = studioPage('ccc_KP_MI_01.11.26.pdf', 'bbb_TT_MI_01.10.26.pdf');
const prev = { ...r2.schedule, classes: r2.schedule.classes.filter(c => c.id !== 'mitte-kurs-1-0800-bodypump') };
const r3 = await syncSchedule({ ...env, previous: prev });
assert.equal(r3.changes.length, 1); assert.equal(r3.changes[0].added.length, 1);
console.log('third sync:', r3.changes.map(c => `${c.studio} ${c.plan} ${c.kind} +${c.added.map(a => a.name)} -${c.removed.length}`).join(', '));
console.log('all sync tests passed');
