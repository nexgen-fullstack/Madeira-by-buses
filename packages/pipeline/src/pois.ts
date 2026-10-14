/**
 * The places of everyday life for the map, from OpenStreetMap and the Overture Maps
 * Foundation together: Overture's (Meta, Microsoft, Foursquare…) know many cafés, shops and
 * restaurants nobody has put on OpenStreetMap yet. A place both know is kept once, as
 * OpenStreetMap has it (with its opening hours), with Overture's phone and website when
 * OpenStreetMap lacks them.
 *
 * `data/sources/osm/pois.json` comes from scripts/pois.mjs, `data/sources/overture/places.json`
 * from scripts/overture-places.py; the app reads the merged `pois.json` (apps/web/src/lib/pois.ts).
 */

import { haversine } from '@madeirabus/engine';

/** What the app knows of a place beyond its name: kind, hours, phone, website, a big store. */
export interface PoiExtra {
  /** The kind of place ("pastry", "supermarket"). */
  k?: string;
  /** Opening hours as OpenStreetMap writes them. */
  h?: string;
  p?: string;
  w?: string;
  /** A big supermarket (Continente, Pingo Doce): shown larger and first. */
  b?: 1;
  /** Known only to Overture. */
  o?: 1;
  /** Its Wikidata item, its photo on Wikimedia Commons (see wikidata.ts). */
  wd?: string;
  i?: string;
  /** Its Wikipedia articles by language, the year it was built, its heritage entry. */
  wp?: Record<string, string>;
  y?: number;
  s?: string;
}

/** `[category, name, lat, lon, extra?]`, as the app reads it. */
export type PoiRow = [string, string, number, number, PoiExtra?];

/** `[category path, name, lat, lon, confidence, {phone, website, brand}?]`, as Overture has it. */
export type OvertureRow = [
  string,
  string,
  number,
  number,
  number,
  { p?: string; w?: string; b?: string }?,
];

export interface OvertureFile {
  release: string;
  places: OvertureRow[];
}

/**
 * Overture's categories (the start of their path, the longest that fits wins) and the app's;
 * null: a kind of place left off the map.
 */
const OVERTURE: [string, string | null][] = [
  ['food_and_drink', 'restaurant'],
  ['food_and_drink>restaurant', 'restaurant'],
  ['food_and_drink>casual_eatery', 'cafe'],
  ['food_and_drink>casual_eatery>fast_food_restaurant', 'restaurant'],
  ['food_and_drink>casual_eatery>food_truck_stand', 'restaurant'],
  ['food_and_drink>casual_eatery>diner', 'restaurant'],
  ['food_and_drink>casual_eatery>gastropub', 'restaurant'],
  ['food_and_drink>casual_eatery>tapas_bar', 'restaurant'],
  ['food_and_drink>casual_eatery>sandwich_shop', 'restaurant'],
  ['food_and_drink>casual_eatery>delicatessen', 'grocery'],
  ['food_and_drink>non_alcoholic_beverage_venue', 'cafe'],
  ['food_and_drink>alcoholic_beverage_venue', 'bar'],
  ['arts_and_entertainment', null],
  ['arts_and_entertainment>nightlife_venue>dance_club', 'bar'],
  ['arts_and_entertainment>museum', 'museum'],
  ['arts_and_entertainment>arts_and_crafts_space>art_gallery', 'museum'],
  ['arts_and_entertainment>amusement_attraction', 'attraction'],
  ['arts_and_entertainment>animal_attraction', 'attraction'],
  ['arts_and_entertainment>movie_theater', 'culture'],
  ['arts_and_entertainment>performing_arts_venue', 'culture'],
  ['arts_and_entertainment>event_venue', 'culture'],
  ['arts_and_entertainment>gaming_venue>casino', 'culture'],
  ['arts_and_entertainment>stadium_arena', 'gym'],
  ['shopping', 'shop'],
  ['shopping>food_and_beverage_store', 'grocery'],
  ['shopping>food_and_beverage_store>liquor_store', 'shop'],
  ['shopping>food_and_beverage_store>tobacco_shop', 'shop'],
  ['shopping>convenience_store', 'grocery'],
  ['shopping>market', 'grocery'],
  ['shopping>superstore', 'grocery'],
  ['shopping>warehouse_club_store', 'grocery'],
  ['shopping>shopping_mall', 'mall'],
  ['shopping>department_store', 'mall'],
  ['shopping>specialty_store>pharmacy_and_drug_store', 'pharmacy'],
  ['shopping>vehicle_dealer', null],
  ['lodging', 'hotel'],
  ['health_care', null],
  ['health_care>hospital', 'hospital'],
  ['health_care>emergency_or_urgent_care_facility', 'hospital'],
  ['health_care>outpatient_care_facility', 'doctor'],
  ['health_care>specialized_medical_facility', 'doctor'],
  ['lifestyle_services', null],
  ['lifestyle_services>personal_or_beauty_service', 'hair'],
  ['lifestyle_services>personal_or_beauty_service>life_coach', null],
  ['lifestyle_services>wellness_service', 'hair'],
  ['services_and_business', null],
  ['services_and_business>financial_service>atm', 'atm'],
  ['services_and_business>financial_service>bank_or_credit_union', 'atm'],
  ['services_and_business>financial_service>money_transfer_service', 'atm'],
  ['services_and_business>laundry_service', 'laundry'],
  ['services_and_business>shipping_or_delivery_service>post_office', 'post'],
  ['services_and_business>rental_service>vehicle_rental_service', 'rental'],
  ['sports_and_recreation', null],
  ['sports_and_recreation>recreational_equipment_rental', 'rental'],
  ['sports_and_recreation>park', 'park'],
  ['sports_and_recreation>sport_or_fitness_facility', 'gym'],
  ['sports_and_recreation>sport_or_fitness_facility>diving_center', 'tour'],
  ['sports_and_recreation>sport_or_fitness_facility>water_sport', 'tour'],
  ['sports_and_recreation>sport_or_fitness_facility>adventure_sport', 'tour'],
  ['sports_and_recreation>sport_or_fitness_facility>horseback_riding_service', 'tour'],
  ['travel_and_transportation', null],
  ['travel_and_transportation>vehicle_service', 'garage'],
  ['travel_and_transportation>fueling_station>gas_station', 'fuel'],
  ['travel_and_transportation>fueling_station>ev_charging_station', 'charging'],
  ['travel_and_transportation>parking', 'parking'],
  [
    'travel_and_transportation>ground_transport_facility_or_service>taxi_or_ride_share_service',
    'taxi',
  ],
  ['travel_and_transportation>travel_service', 'tour'],
  ['travel_and_transportation>travel_service>visitor_center', 'info'],
  ['travel_and_transportation>travel_service>passport_and_visa_service', null],
  ['cultural_and_historic', null],
  ['cultural_and_historic>cultural_center', 'culture'],
  ['cultural_and_historic>historic_site', 'attraction'],
  ['cultural_and_historic>memorial_site', 'attraction'],
  ['cultural_and_historic>place_of_worship', 'church'],
  ['community_and_government', null],
  ['community_and_government>government_office', 'government'],
  ['community_and_government>public_safety_service>police_station', 'police'],
  ['education', null],
  ['education>library', 'library'],
  ['geographic_entities', null],
  ['geographic_entities>built_feature>garden', 'park'],
  ['geographic_entities>land_feature>beach', 'beach'],
  ['geographic_entities>land_feature>cave', 'attraction'],
  ['geographic_entities>water_feature>waterfall', 'attraction'],
];

/** The app's category for an Overture category path, or undefined to leave it off the map. */
export function overtureCategory(path: string): string | undefined {
  let best: [string, string | null] | undefined;
  for (const entry of OVERTURE) {
    const [prefix] = entry;
    if (
      (path === prefix || path.startsWith(`${prefix}>`)) &&
      prefix.length > (best?.[0].length ?? -1)
    )
      best = entry;
  }
  return best?.[1] ?? undefined;
}

/** The big supermarkets people look for: every Continente and Pingo Doce. */
export function isBigStore(name: string): boolean {
  return /\b(continente|pingo doce)\b/i.test(name);
}

/** Words that say what a place is rather than which one: left out when names are compared. */
const GENERIC = new Set(
  (
    'restaurante restaurant snack bar cafe caffe pastelaria padaria hotel hostel apartamentos ' +
    'apartments supermercado minimercado mercearia loja shop store the o a os as de da do das dos ' +
    'e and di la le el madeira funchal lda sa unipessoal'
  ).split(' '),
);

/** A name's words, plain: lower case, without accents, signs or words that every café has. */
export function nameWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC.has(w));
}

/** Two names of the same place: one's words all in the other's, or most of them shared. */
export function sameName(a: string, b: string): boolean {
  const wa = new Set(nameWords(a));
  const wb = new Set(nameWords(b));
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared === Math.min(wa.size, wb.size) || shared / Math.max(wa.size, wb.size) >= 0.5;
}

/** How near (m) a place both know may be put by the two. */
const SAME_PLACE = 80;
/** Overture places it is less sure of than this are left out (closed, moved, never were). */
export const MIN_CONFIDENCE = 0.5;

const CELL = 0.002;

/**
 * OpenStreetMap's places and those only Overture knows, each once; the big supermarkets
 * marked. Returns the rows sorted as the app expects and how many came from each.
 */
export function mergePois(
  osm: readonly PoiRow[],
  overture: readonly OvertureRow[],
  minConfidence = MIN_CONFIDENCE,
): { pois: PoiRow[]; osm: number; overture: number; matched: number } {
  const out: PoiRow[] = osm.map(([c, n, lat, lon, x]) => {
    const extra: PoiExtra = { ...x };
    if (c === 'grocery' && isBigStore(n)) extra.b = 1;
    return Object.keys(extra).length > 0 ? [c, n, lat, lon, extra] : [c, n, lat, lon];
  });
  const grid = new Map<string, number[]>();
  const key = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
  out.forEach((r, i) => {
    const k = key(r[2], r[3]);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  const near = (lat: number, lon: number): number[] => {
    const cy = Math.floor(lat / CELL);
    const cx = Math.floor(lon / CELL);
    const hits: number[] = [];
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) hits.push(...(grid.get(`${y}:${x}`) ?? []));
    return hits;
  };
  let added = 0;
  let matched = 0;
  for (const [path, name, lat, lon, confidence, info] of overture) {
    const category = overtureCategory(path);
    if (!category || confidence < minConfidence || !name) continue;
    const here = { lat, lon };
    const twin = near(lat, lon).find((i) => {
      const r = out[i]!;
      return haversine(here, { lat: r[2], lon: r[3] }) <= SAME_PLACE && sameName(r[1], name);
    });
    if (twin !== undefined) {
      matched++;
      const r = out[twin]!;
      if (r[4]?.o) continue;
      const extra: PoiExtra = { ...r[4] };
      if (!extra.p && info?.p) extra.p = info.p;
      if (!extra.w && info?.w) extra.w = info.w;
      out[twin] = [r[0], r[1], r[2], r[3], extra];
      continue;
    }
    const extra: PoiExtra = { o: 1 };
    if (info?.p) extra.p = info.p;
    if (info?.w) extra.w = info.w;
    if (category === 'grocery' && isBigStore(`${name} ${info?.b ?? ''}`)) extra.b = 1;
    const row: PoiRow = [category, name, lat, lon, extra];
    const k = key(lat, lon);
    grid.set(k, [...(grid.get(k) ?? []), out.length]);
    out.push(row);
    added++;
  }
  out.sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2]);
  return { pois: out, osm: osm.length, overture: added, matched };
}
