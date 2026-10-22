// Parses a Superfit Kursplan / Teamtraining PDF into structured classes.
// Times, day headers and a few labels are real text; class names are vector
// glyph outlines, decoded by matching against glyph prototypes (data/glyphs.json).
// Works in the browser and in Node: pass in the pdf.js module.

const DAYS = ['MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG', 'SONNTAG'];
const TIME_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

// Glyph area above the time text in each tile (points, relative to its baseline).
const TILE_ABOVE = [12, 46];
const TILE_WIDTH = 150;

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

function collectFilledPaths(pdfjs, ol) {
  const O = pdfjs.OPS;
  const argc = { [O.moveTo]: 2, [O.lineTo]: 2, [O.curveTo]: 6, [O.curveTo2]: 4, [O.curveTo3]: 4, [O.closePath]: 0, [O.rectangle]: 4 };
  const letter = { [O.moveTo]: 'm', [O.lineTo]: 'l', [O.curveTo]: 'c', [O.curveTo2]: 'v', [O.curveTo3]: 'y', [O.closePath]: 'h', [O.rectangle]: 'r' };
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const paths = [];
  let cur = null;
  for (let k = 0; k < ol.fnArray.length; k++) {
    const f = ol.fnArray[k], a = ol.argsArray[k];
    if (f === O.save) stack.push(ctm);
    else if (f === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (f === O.transform) ctm = mul(a, ctm);
    else if (f === O.constructPath) {
      const pts = [];
      let j = 0, ops = '';
      for (const op of a[0]) {
        const c = a[1].slice(j, j + argc[op]);
        j += argc[op];
        ops += letter[op] || '?';
        if (op === O.rectangle) pts.push([c[0], c[1]], [c[0] + c[2], c[1] + c[3]]);
        else for (let q = 0; q < c.length; q += 2) pts.push([c[q], c[q + 1]]);
      }
      const dev = pts.map(([x, y]) => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]);
      cur = cur ? { ops: cur.ops + ops, dev: cur.dev.concat(dev) } : { ops, dev };
    } else if (f === O.fill || f === O.eoFill || f === O.fillStroke || f === O.eoFillStroke) {
      if (cur && cur.dev.length) {
        const xs = cur.dev.map(p => p[0]), ys = cur.dev.map(p => p[1]);
        paths.push({ ops: cur.ops, pts: cur.dev, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
      }
      cur = null;
    } else if (f === O.endPath || f === O.stroke || f === O.closeStroke) cur = null;
  }
  return paths;
}

// Glyph shape: op sequence, size and outline points relative to the glyph's corner.
const r1 = v => Math.round(v * 10) / 10;
export const glyphShape = p => ({
  ops: p.ops, w: r1(p.x1 - p.x0), h: r1(p.y1 - p.y0),
  pts: p.pts.flatMap(([x, y]) => [r1(x - p.x0), r1(y - p.y0)]),
});

// Nearest prototype with the same op sequence; null when nothing is close enough.
export function matchGlyph(shape, protos) {
  let best = null, bestD = 0.6;
  for (const g of protos) {
    if (g.ops !== shape.ops || Math.abs(g.w - shape.w) > 0.8 || Math.abs(g.h - shape.h) > 0.8) continue;
    let d = 0;
    for (let i = 0; i < g.pts.length; i++) d += Math.abs(g.pts[i] - shape.pts[i]);
    d /= g.pts.length || 1;
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}

// Turn the glyph paths in a band into a word string (with spaces from gaps).
function readBand(glyphs, protos, unknown) {
  const seen = new Set();
  const g = glyphs
    .filter(p => { const key = `${p.x0.toFixed(1)},${p.y0.toFixed(1)},${p.ops.length}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => a.x0 - b.x0);
  // Drop superscripts like the ™ after GRIT.
  const maxH = Math.max(0, ...g.map(p => p.y1 - p.y0));
  const gg = g.filter(p => p.y1 - p.y0 >= maxH * 0.6);
  let out = '', prev = null;
  const sigs = [];
  for (const p of gg) {
    const shape = glyphShape(p);
    sigs.push(shape);
    const h = p.y1 - p.y0;
    if (prev && p.x0 - prev.x1 > h * 0.26) out += ' ';
    const m = matchGlyph(shape, protos);
    if (!m) { out += '?'; unknown.push(shape); } else out += m.ch;
    prev = p;
  }
  return { text: out.trim(), sigs };
}

export async function parseSchedulePdf(pdfjs, data, protos = []) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const items = tc.items.filter(i => i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height }));

  const headers = items.filter(i => DAYS.includes(i.s.toUpperCase())).sort((a, b) => a.x - b.x);
  if (headers.length < 5) throw new Error('No weekday header found: not a Superfit plan PDF?');
  const topY = Math.max(...headers.map(h => h.y));
  const title = items.filter(i => i.y > topY + 10).sort((a, b) => a.x - b.x).map(i => i.s);
  const titleStr = title.join(' ').toUpperCase();
  const plan = titleStr.includes('TEAM') ? 'team' : 'kurs';
  const validFrom = (titleStr.match(/(\d{2})\.(\d{2})\.(\d{4})/) || []).slice(1);
  const studioName = title[0] || '';
  const colOf = x => {
    let best = 0;
    headers.forEach((h, i) => { if (x >= h.x - 15) best = i; });
    return DAYS.indexOf(headers[best].s.toUpperCase()) + 1;
  };

  const ol = await page.getOperatorList();
  const paths = collectFilledPaths(pdfjs, ol).filter(p => p.x1 - p.x0 < 16 && p.y1 - p.y0 < 11);
  const unknown = [];
  const classes = [];
  for (const t of items) {
    const m = t.s.match(TIME_RE);
    if (!m) continue;
    const inTile = (x0, x1) => x0 >= t.x - 3 && x1 <= t.x + TILE_WIDTH;
    const labels = items.filter(i => i !== t && !TIME_RE.test(i.s) && inTile(i.x, i.x) && i.y > t.y + 8 && i.y < t.y + 30);
    // Glyphs hidden under a real text label (e.g. "EXPRESS") are skipped; the label becomes a tag.
    const underLabel = p => labels.some(i => p.x1 > i.x && p.x0 < i.x + i.w && p.y1 > i.y && p.y0 < i.y + i.h);
    let glyphs = paths.filter(p => inTile(p.x0, p.x1) && p.y0 >= t.y + TILE_ABOVE[0] && p.y1 <= t.y + TILE_ABOVE[1] && !underLabel(p));
    const tallest = Math.max(0, ...glyphs.map(p => p.y1 - p.y0));
    glyphs = glyphs.filter(p => p.y1 - p.y0 >= tallest * 0.5); // drops ™ and similar
    // Group into rows by baseline: lowest row is the class name, the next is the brand line.
    const rows = [];
    for (const p of glyphs.sort((a, b) => a.y0 - b.y0)) {
      const row = rows.find(r => Math.abs(r.y - p.y0) < 2.5);
      if (row) row.g.push(p); else rows.push({ y: p.y0, g: [p] });
    }
    // Some tiles have the class name as real text ("FUNCTIONAL") below the glyph rows.
    const textNames = labels.filter(i => !rows.length || i.y < rows[0].y - 3);
    if (textNames.length) rows.unshift(null);
    const name = textNames.length ? { text: textNames.map(i => i.s.toUpperCase()).join(' '), sigs: [] } : readBand(rows[0]?.g || [], protos, unknown);
    const brand = readBand(rows[1]?.g || [], protos, unknown);
    const tags = labels.filter(i => !textNames.includes(i)).map(i => i.s.toUpperCase());
    const pad = s => s.padStart(2, '0');
    classes.push({
      day: colOf(t.x),
      start: `${pad(m[1])}:${m[2]}`,
      end: `${pad(m[3])}:${m[4]}`,
      name: name.text,
      brand: brand.text,
      tags,
      _sigs: name.sigs,
      _brandSigs: brand.sigs,
      _pos: [Math.round(t.x), Math.round(t.y)],
    });
  }
  classes.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  await doc.destroy();
  return {
    studioName,
    plan,
    validFrom: validFrom.length ? `${validFrom[2]}-${validFrom[1]}-${validFrom[0]}` : null,
    classes,
    unknownGlyphs: unknown.length,
  };
}
