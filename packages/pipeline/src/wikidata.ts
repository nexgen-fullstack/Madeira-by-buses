/**
 * What Wikidata knows of Madeira's places, given to the places of pois.json that are the
 * same, for their cards on the map: a photo on Wikimedia Commons, the Wikipedia articles
 * (a church's history) in the app's languages, the year it was built and its entry in
 * Portugal's heritage register (SIPA).
 *
 * A place OpenStreetMap ties to an item (`wikidata=Q…`) gets that item; another, an item
 * near it of the same name (not a parish, a street or a village of that name). A place only
 * Overture knows that turns out to be the item an OpenStreetMap place already is (the
 * cathedral under its English name) is the same place: left out.
 *
 * `data/sources/wikidata/madeira.json` comes from scripts/wikidata.mjs.
 */

import { haversine } from '@madeirabus/engine';
import type { PoiExtra, PoiRow } from './pois.ts';

export interface WikidataItem {
  q: string;
  lat: number;
  lon: number;
  /** Its labels and other names in the app's languages, Portuguese and English first. */
  names: string[];
  /** Its photo's file name on Wikimedia Commons. */
  image?: string;
  /** Its Wikipedia articles' titles by language. */
  articles?: Record<string, string>;
  year?: number;
  sipa?: string;
  /** What it is (Wikidata's ids: church building, chapel, museum…). */
  is?: string[];
}

export interface WikidataFile {
  generatedAt?: string;
  items: WikidataItem[];
}

/**
 * Items that are not a place one goes into, though they may share its name: a parish, a
 * municipality, a village or a locality, a street or a square, an island, a mountain, a
 * protected area, a geosite, a radio station.
 */
const NOT_A_PLACE = new Set([
  'Q1131296',
  'Q13217644',
  'Q486972',
  'Q3257686',
  'Q532',
  'Q515',
  'Q15284',
  'Q5084',
  'Q79007',
  'Q174782',
  'Q23442',
  'Q8502',
  'Q473972',
  'Q107529920',
  'Q14350',
]);

/** Words a church, a chapel or a museum shares with many others: not its own name. */
const COMMON = new Set(
  (
    'igreja capela ermida church chapel cathedral catedral se nossa senhora sao santa santo ' +
    'our lady of saint st sra sr parish paroquial matriz convento convent mosteiro museu museum ' +
    'casa house jardim garden parque park forte fort fortaleza fortress miradouro viewpoint ' +
    'praia beach quinta hotel teatro theatre the o a os as de da do das dos e and di la le el ' +
    'madeira funchal'
  ).split(' '),
);

/** A name's own words: lower case, without accents, signs or the words every church has. */
export function ownWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !COMMON.has(w));
}

/**
 * Two names of one place: all the own words of the shorter in the longer, and at least half
 * of the longer's ("São Pedro" and "Igreja Paroquial de São Pedro Apóstolo"; not "Municipal"
 * and "Teatro Municipal Baltazar Dias").
 */
export function sameOwnName(a: string, b: string): boolean {
  const wa = new Set(ownWords(a));
  const wb = new Set(ownWords(b));
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared === Math.min(wa.size, wb.size) && shared / Math.max(wa.size, wb.size) >= 0.5;
}

/** Items that are a church, a chapel, a cathedral, a monastery or a convent. */
const CHURCHLIKE = new Set([
  'Q16970',
  'Q108325',
  'Q317557',
  'Q1088552',
  'Q2977',
  'Q56242215',
  'Q120560',
  'Q1129743',
  'Q24398318',
  'Q1370598',
  'Q44613',
  'Q1128397',
  'Q2031836',
]);
const CHURCH_NAME =
  /^(igreja|capela|ermida|se|santuario|convento|mosteiro|church|chapel|cathedral)( |$)/;

/** Whether an item is a church: by what it is, or by its name ("Igreja de…", "Capela do…"). */
function churchlike(item: WikidataItem): boolean {
  if (item.is?.some((k) => CHURCHLIKE.has(k))) return true;
  return item.names.some((n) =>
    CHURCH_NAME.test(
      n
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase(),
    ),
  );
}

/**
 * The kinds of places given an item by their name when OpenStreetMap ties none to them: the
 * landmarks one would look up. A café, a shop or a pharmacy named after the church or the
 * village it is in ("Farmácia Santo António", "Bar São João") gets one by its tag only.
 */
const LANDMARKS = new Set([
  'church',
  'attraction',
  'museum',
  'culture',
  'park',
  'beach',
  'library',
  'government',
  'hospital',
  'mall',
  'hotel',
  'info',
]);

/** Whether `item` is the place `name` of a `category`: a church a church, the rest by all its name. */
function isTheItem(category: string, name: string, item: WikidataItem): boolean {
  if (category === 'church')
    return churchlike(item) && item.names.some((n) => sameOwnName(n, name));
  if (churchlike(item)) return false;
  const own = ownWords(name).sort().join(' ');
  return own !== '' && item.names.some((n) => ownWords(n).sort().join(' ') === own);
}

/** How far (m) a place may be from its item of the same name. */
const SAME_PLACE = 150;

/** Overture's church this near an OpenStreetMap church known to Wikidata is that one (m). */
const CHURCH_TWIN = 60;

const CELL = 0.003;

const wikiOf = (item: WikidataItem): PoiExtra => {
  const w: PoiExtra = { wd: item.q };
  if (item.image) w.i = item.image;
  if (item.articles && Object.keys(item.articles).length > 0) w.wp = item.articles;
  if (item.year) w.y = item.year;
  if (item.sipa) w.s = item.sipa;
  return w;
};

/**
 * The places with what Wikidata knows of them (`wd`, `i`, `wp`, `y`, `s` in their extra; a
 * photo OpenStreetMap names itself kept), Overture's twins of an OpenStreetMap place left
 * out. Returns the rows and how many places got an item, by its tag or by its name.
 */
export function attachWikidata(
  pois: readonly PoiRow[],
  items: readonly WikidataItem[],
): { pois: PoiRow[]; tagged: number; named: number; twins: number } {
  const byQ = new Map(items.map((i) => [i.q, i]));
  const grid = new Map<string, WikidataItem[]>();
  const key = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
  for (const item of items) {
    if (item.is?.some((k) => NOT_A_PLACE.has(k))) continue;
    const k = key(item.lat, item.lon);
    grid.set(k, [...(grid.get(k) ?? []), item]);
  }
  const near = (lat: number, lon: number): WikidataItem[] => {
    const cy = Math.floor(lat / CELL);
    const cx = Math.floor(lon / CELL);
    const hits: WikidataItem[] = [];
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) hits.push(...(grid.get(`${y}:${x}`) ?? []));
    return hits;
  };
  /** The items OpenStreetMap's places are, and where. */
  const osmHas = new Map<string, { lat: number; lon: number }[]>();
  const rows = pois.map((row): { row: PoiRow; q?: string; by?: 'tag' | 'name' } => {
    const [category, name, lat, lon, extra] = row;
    const x = extra;
    // By its tag, else by its name near it.
    let item = x?.wd ? byQ.get(x.wd) : undefined;
    const by = item ? 'tag' : 'name';
    if (!item && !x?.wd && name && LANDMARKS.has(category)) {
      const here = { lat, lon };
      item = near(lat, lon)
        .filter((i) => haversine(here, i) <= SAME_PLACE && isTheItem(category, name, i))
        .sort((a, b) => haversine(here, a) - haversine(here, b))[0];
    }
    const q = item?.q ?? x?.wd;
    if (q && !x?.o) osmHas.set(q, [...(osmHas.get(q) ?? []), { lat, lon }]);
    if (!item) return { row, q };
    // OpenStreetMap's own photo of the place before the item's.
    return { row: [category, name, lat, lon, { ...wikiOf(item), ...x }], q, by };
  });
  // The churches OpenStreetMap has with their item: Overture's church beside one, under
  // another name ("Cathedral of Our Lady of the Assumption" by the Sé), is that church.
  const osmChurches = rows
    .filter(({ row, q }) => q && row[0] === 'church' && !row[4]?.o)
    .map(({ row }) => ({ lat: row[2], lon: row[3] }));
  let twins = 0;
  const kept = rows.filter(({ row, q }) => {
    if (!row[4]?.o) return true;
    const here = { lat: row[2], lon: row[3] };
    const twin = q
      ? osmHas.get(q)?.some((p) => haversine(p, here) <= SAME_PLACE)
      : row[0] === 'church' && osmChurches.some((p) => haversine(p, here) <= CHURCH_TWIN);
    if (twin) twins++;
    return !twin;
  });
  return {
    pois: kept.map(({ row }) => row),
    tagged: kept.filter((r) => r.by === 'tag').length,
    named: kept.filter((r) => r.by === 'name').length,
    twins,
  };
}
