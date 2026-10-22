// Checks parser output against a labels file: node tools/verify.mjs <labels.json> <pdf ...>
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';
import { parseSchedulePdf } from '../www/js/pdfparse.js';

const [labelsFile, ...pdfs] = process.argv.slice(2);
const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
const protos = JSON.parse(fs.readFileSync(new URL('../www/data/glyphs.json', import.meta.url))).glyphs;
let bad = 0, total = 0;
for (const file of pdfs) {
  const key = Object.keys(labels).find(k => path.basename(file).includes(k));
  const r = await parseSchedulePdf(pdfjs, new Uint8Array(fs.readFileSync(file)), protos);
  const want = labels[key].classes.map(l => { const [, d, s, rest] = l.match(/^(\d) (\S+) (.+)$/); const [n, b = labels[key].brand] = rest.split(' / '); return `${d} ${s} ${n} / ${b}`; });
  const got = r.classes.map(c => `${c.day} ${c.start} ${c.name} / ${c.brand}`);
  total += want.length;
  for (const w of want) if (!got.includes(w)) { bad++; console.log('MISSING', key, w); }
  for (const g of got) if (!want.includes(g)) console.log('EXTRA  ', key, g);
  console.log(`${key}: ${r.studioName} ${r.plan} valid ${r.validFrom}, ${r.classes.length} classes, unknown glyphs ${r.unknownGlyphs}`);
}
console.log(`${total - bad}/${total} match`);
process.exit(bad ? 1 : 0);
