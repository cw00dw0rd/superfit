// Crawls superfit.club for studio pages and their plan PDFs, re-parsing only PDFs
// whose URL changed since the last sync (Webflow gives re-uploads a new URL).
// Environment-neutral: the caller supplies fetchText / fetchBytes / parsePdf.

export const SITE = 'https://superfit.club';
export const OVERVIEW_URL = `${SITE}/studios-ubersicht`;

const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = s => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const decode = s => s.replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&quot;/g, '"');

export function findStudioLinks(html) {
  const slugs = new Set();
  for (const m of html.matchAll(/href="(?:https?:\/\/(?:www\.)?superfit\.club)?\/studios\/([a-z0-9-]+)\/?"/gi)) slugs.add(m[1].toLowerCase());
  return [...slugs].map(slug => ({ id: slug, url: `${SITE}/studios/${slug}`, name: titleCase(slug.replace(/-/g, ' ')) }));
}

export function readStudioPage(html) {
  const pdfs = new Set();
  for (const m of html.matchAll(/(?:href|src)="([^"]+?\.pdf)(?:\?[^"]*)?"/gi)) pdfs.add(decode(m[1]));
  const maps = (html.match(/href="(https:\/\/(?:www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)[^"]*)"/i) || [])[1];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const addr = text.match(/([A-ZÄÖÜ][\p{L}.\-]*(?:straße|strasse|str\.|allee|platz|damm|weg|ufer|ring|chaussee|markt|tor|brücke|gasse|zeile|promenade)\s\d+[a-z]?(?:\s?-\s?\d+[a-z]?)?),?\s+(\d{5})\s+Berlin/u);
  // Studio pages are titled "SUPERFIT | Mitte | Grunerstr. 20, 10179 Berlin".
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1]?.split('|').map(t => decode(t).trim()) || [];
  const titleAddr = title.find(t => /\d{5}/.test(t));
  return {
    name: title.length >= 3 ? title[1] : '',
    pdfs: [...pdfs].map(u => (u.startsWith('http') ? u : SITE + u)),
    address: titleAddr || (addr ? `${addr[1].trim()}, ${addr[2]} Berlin` : ''),
    mapsUrl: maps ? decode(maps) : '',
  };
}

const classId = (studio, c, plan) => `${studio}-${plan}-${c.day}-${c.start.replace(':', '')}-${slugify(c.name || 'x')}`;

// Normalises parser output into schedule classes. nameFixes maps decoded names ("FULLBODY ?ORKOUT") to corrections.
export function toClasses(studioId, parsed, nameFixes = {}) {
  return parsed.classes.map(c => {
    const name = nameFixes[c.name] || c.name || '(unknown)';
    return {
      id: classId(studioId, { ...c, name }, parsed.plan),
      studio: studioId, plan: parsed.plan, day: c.day, start: c.start, end: c.end,
      name, brand: c.brand, tags: c.tags,
    };
  });
}

/**
 * previous: current schedule ({studios, classes}); returns { schedule, changes[] }.
 * force: re-parse every PDF even if its URL is unchanged.
 */
export async function syncSchedule({ fetchText, fetchBytes, parsePdf, previous, nameFixes = {}, force = false, onProgress = () => {} }) {
  const prevStudios = Object.fromEntries((previous?.studios || []).map(s => [s.id, s]));
  const prevClasses = previous?.classes || [];
  onProgress('Reading studio overview…');
  const links = findStudioLinks(await fetchText(OVERVIEW_URL));
  if (!links.length) throw new Error('No studio links found on the overview page: the site layout may have changed.');

  const studios = [], classes = [], changes = [];
  for (const [i, link] of links.entries()) {
    onProgress(`Studio ${i + 1}/${links.length}: ${link.name}`);
    const old = prevStudios[link.id];
    let page;
    try { page = readStudioPage(await fetchText(link.url)); }
    catch (e) { changes.push({ studio: link.name, kind: 'error', msg: `page failed: ${e.message}` }); if (old) { studios.push(old); classes.push(...prevClasses.filter(c => c.studio === link.id)); } continue; }

    const studio = { ...old, ...link, name: page.name || old?.name || link.name, address: page.address || old?.address || '', mapsUrl: page.mapsUrl || old?.mapsUrl || '', plans: {}, ignoredPdfs: [] };
    for (const url of page.pdfs) {
      const known = Object.entries(old?.plans || {}).find(([, p]) => p.pdf === url);
      if (known && !force) {
        studio.plans[known[0]] = known[1];
        classes.push(...prevClasses.filter(c => c.studio === link.id && c.plan === known[0]));
        continue;
      }
      if (!force && old?.ignoredPdfs?.includes(url)) { studio.ignoredPdfs.push(url); continue; }
      let parsed;
      try { parsed = await parsePdf(await fetchBytes(url)); }
      catch (e) { studio.ignoredPdfs.push(url); continue; } // not a timetable PDF (price list etc.)
      if (parsed.studioName && studio.name === titleCase(link.id.replace(/-/g, ' '))) studio.name = titleCase(parsed.studioName);
      const fresh = toClasses(link.id, parsed, nameFixes);
      const before = prevClasses.filter(c => c.studio === link.id && c.plan === parsed.plan);
      const key = c => `${c.day} ${c.start} ${c.name}`;
      const added = fresh.filter(c => !before.some(b => key(b) === key(c)));
      const removed = before.filter(b => !fresh.some(c => key(b) === key(c)));
      studio.plans[parsed.plan] = { pdf: url, validFrom: parsed.validFrom, unknownGlyphs: parsed.unknownGlyphs };
      classes.push(...fresh);
      if (!old?.plans?.[parsed.plan] || added.length || removed.length || force)
        changes.push({ studio: studio.name, plan: parsed.plan, kind: old?.plans?.[parsed.plan] ? 'updated' : 'new', validFrom: parsed.validFrom, added, removed, unknown: parsed.unknownGlyphs });
    }
    for (const plan of Object.keys(old?.plans || {})) if (!studio.plans[plan]) changes.push({ studio: studio.name, plan, kind: 'removed', added: [], removed: [] });
    studios.push(studio);
  }
  return { schedule: { generated: new Date().toISOString(), source: OVERVIEW_URL, studios, classes }, changes };
}

// Compares two schedules (e.g. the device copy vs. the published feed), same change format as syncSchedule.
export function diffSchedules(prev, next) {
  const key = c => `${c.day} ${c.start} ${c.name}`;
  const changes = [];
  const prevStudios = Object.fromEntries((prev?.studios || []).map(s => [s.id, s]));
  for (const st of next.studios) {
    const old = prevStudios[st.id];
    for (const [plan, p] of Object.entries(st.plans || {})) {
      const before = (prev?.classes || []).filter(c => c.studio === st.id && c.plan === plan);
      const after = next.classes.filter(c => c.studio === st.id && c.plan === plan);
      const added = after.filter(c => !before.some(b => key(b) === key(c)));
      const removed = before.filter(b => !after.some(c => key(b) === key(c)));
      if (!old?.plans?.[plan] || added.length || removed.length)
        changes.push({ studio: st.name, plan, kind: old?.plans?.[plan] ? 'updated' : 'new', validFrom: p.validFrom, added, removed, unknown: p.unknownGlyphs });
    }
    for (const plan of Object.keys(old?.plans || {})) if (!st.plans?.[plan]) changes.push({ studio: st.name, plan, kind: 'removed', added: [], removed: [] });
  }
  return changes;
}
