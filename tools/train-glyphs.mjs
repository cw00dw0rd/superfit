// Builds www/data/glyphs.json (glyph outline prototypes -> letter) from PDFs with known contents.
// Usage: node tools/train-glyphs.mjs <labels.json> [pdf ...]
// labels.json: { "<pdf filename substring>": { "brand": "...", "classes": ["<day> <HH:MM> <NAME>[ / <BRAND>]", ...] } }
// Existing glyphs.json entries are kept, so you can train on new PDFs incrementally.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';
import { parseSchedulePdf, matchGlyph } from '../www/js/pdfparse.js';

const [labelsFile, ...pdfs] = process.argv.slice(2);
const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
const outFile = new URL('../www/data/glyphs.json', import.meta.url);
const protos = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).glyphs : [];
let conflicts = 0;

function learn(sigs, text, where) {
  const letters = [...text.replace(/\s+/g, '')];
  if (letters.length !== sigs.length) {
    console.warn(`  skip ${where}: ${sigs.length} glyphs vs "${text}" (${letters.length})`);
    return;
  }
  sigs.forEach((shape, i) => {
    const m = matchGlyph(shape, protos);
    if (m && m.ch === letters[i]) return;
    if (m) { conflicts++; console.warn(`  conflict ${where}: glyph ${i} looks like ${m.ch}, labelled ${letters[i]}`); }
    protos.push({ ch: letters[i], ...shape });
  });
}

for (const file of pdfs) {
  const key = Object.keys(labels).find(k => path.basename(file).includes(k));
  if (!key) { console.warn(`no labels for ${file}`); continue; }
  const L = labels[key];
  const parsed = await parseSchedulePdf(pdfjs, new Uint8Array(fs.readFileSync(file)), []);
  console.log(`${key}: ${parsed.classes.length} tiles, ${L.classes.length} labels`);
  for (const line of L.classes) {
    const [, day, start, rest] = line.match(/^(\d) (\d\d:\d\d) (.+)$/);
    const [name, brand = L.brand] = rest.split(' / ');
    const c = parsed.classes.find(c => c.day === +day && c.start === start);
    if (!c) { console.warn(`  no tile at ${day} ${start}`); continue; }
    learn(c._sigs, name, `${key} ${day} ${start}`);
    learn(c._brandSigs, brand, `${key} ${day} ${start} brand`);
  }
}

fs.writeFileSync(outFile, JSON.stringify({ version: new Date().toISOString().slice(0, 10), glyphs: protos }));
console.log(`${protos.length} glyph prototypes, ${conflicts} conflicts -> www/data/glyphs.json`);
