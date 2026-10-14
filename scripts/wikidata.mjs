// Madeira's places as Wikidata knows them, for the place cards on the map: a photo on
// Wikimedia Commons, the Wikipedia articles (a church's history) in the app's languages,
// the year it was built and its entry in Portugal's heritage register (SIPA).
// Everything is free to use (Wikidata CC0; the photos' own free licences, credited in the app).
//
// One query for the items with a place in Madeira (Wikidata's SPARQL service), then their
// names, photos and articles 50 at a time. The pipeline gives them to the places of
// pois.json that are the same (packages/pipeline/src/wikidata.ts).
//
//   node scripts/wikidata.mjs [out.json]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const AGENT =
  'MadeiraBus place cards (+https://github.com/nexgen-fullstack/Madeira-by-busses) node-fetch';
/** The app's languages: the articles kept are in these. */
const LANGS = ['uk', 'en', 'pt', 'es', 'fr', 'it', 'de', 'nl', 'cs', 'pl', 'ru'];

const QUERY = `SELECT ?item ?coord WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(-17.35 32.35)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(-16.25 33.15)"^^geo:wktLiteral .
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'user-agent': AGENT, ...init?.headers } });
    if (res.ok) return res.json();
    if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(res.status))
      throw new Error(`${res.status} ${url.slice(0, 120)}`);
    await sleep(3000 * (attempt + 1));
  }
}

/** The first value of a claim (a string, an item's id, a time's year). */
function claim(entity, p) {
  const v = entity.claims?.[p]?.find((c) => c.rank !== 'deprecated')?.mainsnak?.datavalue?.value;
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (v.id) return v.id;
  if (v.time) return Number(/^[+-]?(\d+)/.exec(v.time)?.[1]);
  return undefined;
}

const out = process.argv[2] ?? 'data/sources/wikidata/madeira.json';
const found = await json(
  `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(QUERY)}`,
  { headers: { accept: 'application/sparql-results+json' } },
);
/** Each item once, where Wikidata puts it. */
const where = new Map();
for (const b of found.results.bindings) {
  const q = b.item.value.split('/').pop();
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
  if (!m || where.has(q)) continue;
  where.set(q, { lat: Number(m[2]), lon: Number(m[1]) });
}
console.log(`${where.size} items in Madeira`);

const items = [];
const ids = [...where.keys()];
for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50);
  const res = await json(
    'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|aliases|sitelinks|claims&ids=' +
      batch.join('|'),
  );
  for (const q of batch) {
    const e = res.entities?.[q];
    if (!e) continue;
    const articles = {};
    for (const lang of LANGS) {
      const title = e.sitelinks?.[`${lang}wiki`]?.title;
      if (title) articles[lang] = title;
    }
    const image = claim(e, 'P18');
    // Only what a card can show: a photo or an article.
    if (!image && Object.keys(articles).length === 0) continue;
    const names = new Set();
    for (const lang of ['pt', 'en', ...LANGS]) {
      if (e.labels?.[lang]) names.add(e.labels[lang].value);
      for (const a of e.aliases?.[lang] ?? []) names.add(a.value);
    }
    const { lat, lon } = where.get(q);
    const row = { q, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
    row.names = [...names];
    if (image) row.image = image;
    if (Object.keys(articles).length) row.articles = articles;
    // Built (P571 inception) and its heritage register entry (P1700 SIPA).
    const year = claim(e, 'P571');
    if (Number.isFinite(year) && year > 1000 && year <= new Date().getFullYear()) row.year = year;
    const sipa = claim(e, 'P1700');
    if (sipa) row.sipa = sipa;
    // What it is (church building, chapel, museum…), to match it with a place of that kind.
    const kinds = (e.claims?.P31 ?? [])
      .map((c) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    if (kinds.length) row.is = kinds;
    items.push(row);
  }
  process.stdout.write(`\r${Math.min(i + 50, ids.length)}/${ids.length}`);
  await sleep(150);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), items }));
console.log(`\n${items.length} items with a photo or an article written to ${out}`);
