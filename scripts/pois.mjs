// The places of everyday life on the map's "Places" button, as Google Maps lists them:
// hospitals, doctors, pharmacies, police, hotels, restaurants, cafés and pastry shops,
// groceries and markets, every shop, sights, museums, theatres, churches, gyms, tours,
// rentals, garages, hairdressers, cash machines, toilets, beaches…
// One Overpass query (`poiQuery`), made small for the app (`compactPois`): a category, a name,
// where it is, and its opening hours, phone and website when OpenStreetMap has them.
//
// fetch-sources.mjs collects them with the rest; on its own:
//
//   node scripts/pois.mjs [out.json]

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The categories, each with the OpenStreetMap tags that belong to it (key → values; '*' any
 * value). The first category a place matches wins.
 */
export const POI_CATEGORIES = [
  ['hospital', { amenity: ['hospital', 'clinic'], healthcare: ['hospital', 'clinic', 'centre'] }],
  [
    'doctor',
    {
      amenity: ['doctors', 'dentist'],
      healthcare: [
        'doctor',
        'dentist',
        'physiotherapist',
        'laboratory',
        'optometrist',
        'podiatrist',
        'psychotherapist',
      ],
    },
  ],
  ['pharmacy', { amenity: ['pharmacy'], healthcare: ['pharmacy'] }],
  ['police', { amenity: ['police'] }],
  ['hotel', { tourism: ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'chalet'] }],
  ['restaurant', { amenity: ['restaurant', 'fast_food', 'food_court'] }],
  ['cafe', { amenity: ['cafe', 'ice_cream'], shop: ['pastry', 'bakery', 'confectionery'] }],
  ['bar', { amenity: ['bar', 'pub', 'biergarten', 'nightclub'] }],
  [
    'grocery',
    {
      amenity: ['marketplace'],
      shop: [
        'supermarket',
        'convenience',
        'greengrocer',
        'butcher',
        'seafood',
        'deli',
        'farm',
        'frozen_food',
        'health_food',
      ],
    },
  ],
  ['mall', { shop: ['mall', 'department_store'] }],
  ['tour', { shop: ['travel_agency'], office: ['travel_agent', 'guide'] }],
  ['park', { leisure: ['park', 'garden'] }],
  ['beach', { natural: ['beach'], leisure: ['beach_resort', 'swimming_area'] }],
  [
    'attraction',
    {
      tourism: ['attraction', 'zoo', 'aquarium', 'theme_park'],
      historic: ['castle', 'fort', 'monument', 'archaeological_site', 'ruins'],
    },
  ],
  ['museum', { tourism: ['museum', 'gallery'] }],
  ['culture', { amenity: ['theatre', 'cinema', 'arts_centre', 'casino', 'concert_hall'] }],
  ['church', { amenity: ['place_of_worship'] }],
  ['gym', { leisure: ['fitness_centre', 'sports_centre', 'golf_course', 'water_park'] }],
  ['library', { amenity: ['library'] }],
  ['government', { amenity: ['townhall', 'courthouse'], office: ['government', 'diplomatic'] }],
  ['info', { tourism: ['information'] }],
  [
    'rental',
    {
      amenity: [
        'car_rental',
        'motorcycle_rental',
        'bicycle_rental',
        'scooter_rental',
        'boat_rental',
      ],
      shop: ['rental'],
    },
  ],
  ['fuel', { amenity: ['fuel'] }],
  ['charging', { amenity: ['charging_station'] }],
  [
    'garage',
    { shop: ['car_repair', 'tyres', 'motorcycle_repair'], amenity: ['vehicle_inspection'] },
  ],
  ['carwash', { amenity: ['car_wash'] }],
  ['parking', { amenity: ['parking'] }],
  ['hair', { shop: ['hairdresser', 'beauty', 'barber', 'massage', 'tattoo'], amenity: ['spa'] }],
  ['laundry', { shop: ['laundry', 'dry_cleaning'] }],
  ['atm', { amenity: ['atm', 'bank', 'bureau_de_change'] }],
  ['post', { amenity: ['post_office'] }],
  ['taxi', { amenity: ['taxi'] }],
  ['toilets', { amenity: ['toilets'] }],
  ['water', { amenity: ['drinking_water'] }],
  // Every other shop: clothes, books, furniture, flowers, bikes… (Google Maps shows them all).
  ['shop', { shop: ['*'] }],
];

/** The Overpass query for every place of the categories in a bounding box. */
export function poiQuery(bbox) {
  const byKey = new Map();
  for (const [, tags] of POI_CATEGORIES)
    for (const [key, values] of Object.entries(tags))
      byKey.set(key, [...(byKey.get(key) ?? []), ...values]);
  const parts = [...byKey].map(([key, values]) =>
    values.includes('*')
      ? `nwr["${key}"](${bbox});`
      : `nwr["${key}"~"^(${[...new Set(values)].join('|')})$"](${bbox});`,
  );
  return `[out:json][timeout:300];\n(${parts.join('\n ')});\nout center tags qt;`;
}

/** Values that say there is no such place any more ("shop=vacant"). */
const GONE = new Set(['no', 'vacant', 'disused', 'closed', 'abandoned']);

/** The category of a place by its tags and the value that made it so ("pastry"), or undefined. */
function categoryOf(tags) {
  for (const [id, wanted] of POI_CATEGORIES)
    for (const [key, values] of Object.entries(wanted)) {
      const value = tags[key];
      if (value && !GONE.has(value) && (values.includes(value) || values.includes('*')))
        return { id, kind: value };
    }
  return undefined;
}

/** Places nobody may use: private car parks and toilets, a hotel's own. */
const closed = (tags) => ['private', 'no', 'customers'].includes(tags.access);

/**
 * A photo's file name on Wikimedia Commons ("Sé do Funchal.jpg") from an `image` or
 * `wikimedia_commons` tag ("File:…", a Commons page or upload address); undefined for a
 * category, a gallery or a picture anywhere else (the app shows Commons' pictures only).
 */
export function commonsFile(value) {
  if (!value) return undefined;
  const v = value.split(';')[0].trim();
  let m = /^(?:File|Image):(.+\.(?:jpe?g|png|webp|tiff?))$/i.exec(v);
  if (m) return m[1].replace(/_/g, ' ');
  m = /^https?:\/\/commons\.(?:m\.)?wikimedia\.org\/wiki\/(?:File|Image):(.+)$/i.exec(v);
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  m =
    /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/i.exec(
      v,
    );
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  return undefined;
}

/** Of the information points, the tourist offices only: not every board and signpost. */
const office = (tags) => ['office', 'visitor_centre'].includes(tags.information);

/**
 * The places, small: `[category, name, lat, lon, extra?]` where `extra` holds the opening
 * hours (`h`), phone (`p`), website (`w`), kind (`k`, the OSM value, e.g. "pastry"), Wikidata
 * item (`wd`) and Commons photo (`i`) when known.
 * Unnamed places stay only where a name does not matter (toilets, water, cash machines, car
 * parks, taxis, charging, beaches).
 */
export function compactPois(elements) {
  const nameless = new Set(['toilets', 'water', 'atm', 'parking', 'taxi', 'charging', 'beach']);
  const out = [];
  const seen = new Set();
  for (const e of elements) {
    const tags = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined || closed(tags)) continue;
    const found = categoryOf(tags);
    const category = found?.id;
    if (!category || (category === 'info' && !office(tags))) continue;
    const name = tags.name ?? tags.brand ?? tags.operator ?? '';
    if (!name && !nameless.has(category)) continue;
    // A place drawn as a building and its point inside: once.
    const key = `${category}|${name}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const extra = {};
    if (found.kind !== 'yes') extra.k = found.kind;
    if (tags.opening_hours) extra.h = tags.opening_hours;
    const phone = tags.phone ?? tags['contact:phone'];
    if (phone) extra.p = phone;
    const web = tags.website ?? tags['contact:website'];
    if (web) extra.w = web;
    // Its Wikidata item and its photo on Wikimedia Commons: the card's photo and history.
    if (/^Q\d+$/.test(tags.wikidata ?? '')) extra.wd = tags.wikidata;
    const photo = commonsFile(tags.wikimedia_commons) ?? commonsFile(tags.image);
    if (photo) extra.i = photo;
    const row = [category, name, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
    out.push(Object.keys(extra).length ? [...row, extra] : row);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2]);
  return out;
}

// On its own: fetch and write.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? 'data/sources/osm/pois.json';
  const bbox = '32.35,-17.35,33.15,-16.25';
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent':
        'MadeiraBus places collector (+https://github.com/nexgen-fullstack/Madeira-by-buses)',
    },
    body: `data=${encodeURIComponent(poiQuery(bbox))}`,
  });
  const json = await res.json();
  const pois = compactPois(json.elements ?? []);
  writeFileSync(
    out,
    JSON.stringify({
      generatedAt: json.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
      pois,
    }),
  );
  console.log(`${pois.length} places written to ${out}`);
}
