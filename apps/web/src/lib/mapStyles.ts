import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import type { Lang } from '../i18n.ts';

/**
 * Map styles and layers.
 *
 * - "map": OpenFreeMap Liberty (OpenStreetMap data): streets, buildings,
 *   shops and institutions with their names.
 * - "satellite": aerial imagery with the same labels, roads and places on top
 *   (a "hybrid" view like in Google Maps).
 * - "relief": a physical map of the island coloured by elevation with hill
 *   shading — useful on mountainous Madeira — plus the same labels.
 *
 * Overlays (3D buildings, places, 3D terrain) are toggled on whatever base is
 * shown. Every style degrades gracefully: without the vector tiles (offline,
 * blocked network) the relief layers still draw the island.
 */

export type BaseLayer = 'map' | 'satellite' | 'relief';

export interface MapLayers {
  base: BaseLayer;
  buildings3d: boolean;
  places: boolean;
  terrain3d: boolean;
  /** Every bus stop and line on the map (off: a plain island, as a maps app opens). */
  transit: boolean;
  /** The hiking trails, dashed in the red of their waymarks, with where each starts. */
  trails: boolean;
  /** With the trails, their photos where each was taken (off: the trails' lines alone). */
  trailPhotos: boolean;
  /** The places with a view by their photos (not those of the trails: see `trailPhotos`). */
  scenic: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  base: 'map',
  buildings3d: false,
  places: true,
  terrain3d: false,
  transit: false,
  trails: false,
  trailPhotos: true,
  scenic: true,
};

/**
 * The trails button's three steps in turn: the trails with their photos, the trails alone
 * (their lines and starts), then none, the bare island.
 */
export function nextTrails(layers: MapLayers): MapLayers {
  if (!layers.trails) return { ...layers, trails: true, trailPhotos: true };
  if (layers.trailPhotos) return { ...layers, trailPhotos: false };
  return { ...layers, trails: false, trailPhotos: true };
}

const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Imagery tiles, as sharp as a maps app's: Esri's "Clarity" imagery (cloud-free over the
 * island, crisp, in true colours) as far as it goes, to tile zoom 17; closer in, Esri's
 * World Imagery, which goes on to 19 (cars in the streets of Funchal). Override with
 * VITE_SATELLITE_TILES (and VITE_SATELLITE_CLOSE_TILES), e.g. a MapTiler key for production.
 */
export const SATELLITE_TILES: string =
  import.meta.env.VITE_SATELLITE_TILES ||
  'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_CLOSE_TILES: string =
  import.meta.env.VITE_SATELLITE_CLOSE_TILES ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
/** The closest tile zoom of the first imagery, and of the second. */
const SATELLITE_MAX = 17;
const SATELLITE_CLOSE_MAX = 19;

/**
 * Imagery tiles drawn at half their size on a sharp screen (a phone's two or three pixels
 * to a point): tiles of the next zoom, as crisp as the screen, as a maps app sends them.
 */
export const satelliteTileSize = (
  pixelRatio = globalThis.devicePixelRatio ?? 1,
  slow = slowConnection(),
) => (pixelRatio >= 1.5 && !slow ? 128 : 256);

/**
 * A slow mobile connection (EDGE, 3G) or data saving asked for: the imagery in tiles twice
 * as large, a quarter of the requests, a touch less crisp, so the map comes at once.
 */
export function slowConnection(): boolean {
  const c = (
    globalThis.navigator as
      (Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }) | undefined
  )?.connection;
  return Boolean(c && (c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType ?? '')));
}

/** The map zoom from which the first imagery has no closer tiles and the second takes over. */
export const satelliteSwitch = (tileSize: number) =>
  SATELLITE_MAX - Math.log2(512 / tileSize) + 0.5;
const SATELLITE_ATTRIBUTION =
  import.meta.env.VITE_SATELLITE_ATTRIBUTION ||
  'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

/** Open elevation tiles (Terrain Tiles on AWS Open Data, Terrarium encoding). */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRAIN_ATTRIBUTION =
  'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (SRTM, EU-DEM and others)';

const SEA = '#9fdde4';

export function demSource(): SourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [TERRAIN_TILES],
    tileSize: 256,
    maxzoom: 14,
    encoding: 'terrarium',
    attribution: TERRAIN_ATTRIBUTION,
  };
}

/** Elevation-tinted land, sea and hill shading. */
function reliefLayers(): LayerSpecification[] {
  return [
    { id: 'mb-background', type: 'background', paint: { 'background-color': SEA } },
    {
      id: 'mb-relief',
      type: 'color-relief',
      source: 'mb-dem',
      paint: {
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          -50,
          SEA,
          0,
          SEA,
          1,
          '#cfe5c0',
          250,
          '#d7e4b0',
          700,
          '#e3d9a6',
          1200,
          '#d6c19c',
          1600,
          '#c9b9a8',
          1862,
          '#f3efe8',
        ],
      },
    },
    {
      id: 'mb-hillshade',
      type: 'hillshade',
      source: 'mb-dem-shade',
      paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#3d4a3a' },
    },
    {
      // Flat sea on top: hill shading of the sea floor only adds noise.
      id: 'mb-sea',
      type: 'color-relief',
      source: 'mb-dem',
      paint: {
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          -100,
          SEA,
          0,
          SEA,
          0.5,
          'rgba(159, 221, 228, 0)',
        ],
      },
    },
  ];
}

/**
 * The imagery a touch lighter and livelier than it comes, as a maps app shows it: the deep
 * ocean and the laurel forest are nearly black in it, which on a phone in the sun reads as
 * a dark blot; lifted only a little, so it does not turn hazy.
 */
export const SATELLITE_PAINT = {
  'raster-brightness-min': 0.06,
  'raster-brightness-max': 1,
  'raster-contrast': 0.08,
  'raster-saturation': 0.12,
  'raster-resampling': 'linear',
} as const;

export const SATELLITE_CLOSE_PAINT = {
  'raster-brightness-min': 0,
  'raster-brightness-max': 1,
  'raster-contrast': 0.16,
  'raster-saturation': 0.22,
  'raster-resampling': 'linear',
  'raster-fade-duration': 120,
} as const;

/**
 * The sea round the island: the deep teal of the open ocean rather than the near-black of
 * the imagery, lightening by the shore to a muted turquoise (Madeira's shores are rock and
 * pebbles, not white sand). Painted in bands by distance from the coast (public/coast.json,
 * scripts/coast-line.py), opaque enough out at sea that the seams between the imagery's
 * pictures do not show, clearer near the shore, where the surf and the rocks show through.
 */
export const RESORT_SEA = '#126e89';
/** The sea before its bands come, and wherever there are none. */
const RESORT_SEA_DEEP = '#126e89';
/** The sea of the plain map, a lighter turquoise. */
const RESORT_SEA_MAP = '#8fdbe3';

/** The sea by the rocks and out at sea: colour and opacity, with the distance between faded. */
const SHORE_SEA = { color: '#2a98a1', opacity: 0.46 };
const OPEN_SEA = { color: RESORT_SEA, opacity: 0.93 };
/** From the shore out to here (m) the sea fades from the one to the other. */
const FADE_OUT = 300;

/**
 * From this zoom the sea is painted in its bands; further out the bands are thinner than a
 * pixel, and the map, simplifying them to draw, breaks them into shapes over the land.
 */
const BANDS_FROM = 10.5;

/** Far out, the sea as the vector tiles have it, in the open sea's colour. */
function openSeaFar(source: string): LayerSpecification {
  return {
    id: 'mb-resort-sea-far',
    type: 'fill',
    source,
    'source-layer': 'water',
    maxzoom: BANDS_FROM,
    filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['!=', ['get', 'class'], 'river']],
    paint: {
      'fill-color': OPEN_SEA.color,
      'fill-opacity': OPEN_SEA.opacity,
      'fill-antialias': false,
    },
  } as LayerSpecification;
}

function resortSea(): LayerSpecification {
  // Smoothly by the band's distance from the shore: no step to see between the bands.
  const fade = (near: string | number, far: string | number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['get', 'd'],
    0,
    near,
    FADE_OUT,
    far,
  ];
  const opacity = fade(SHORE_SEA.opacity, OPEN_SEA.opacity);
  return {
    id: 'mb-resort-sea',
    type: 'fill',
    source: 'mb-coast',
    minzoom: BANDS_FROM,
    paint: {
      'fill-color': fade(SHORE_SEA.color, OPEN_SEA.color),
      'fill-antialias': true,
      'fill-outline-color': 'rgba(0, 0, 0, 0)',
      // Close in a little clearer still: the surf, the boats, the harbour walls.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, opacity, 18, ['*', 0.8, opacity]],
    },
  } as LayerSpecification;
}

/** The plain map's water in the resort's turquoise rather than the style's lavender blue. */
export function withResortWater(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((l) =>
      l.type === 'fill' && sourceLayer(l) === 'water'
        ? ({ ...l, paint: { ...l.paint, 'fill-color': RESORT_SEA_MAP } } as LayerSpecification)
        : l.type === 'line' && sourceLayer(l) === 'waterway'
          ? ({ ...l, paint: { ...l.paint, 'line-color': RESORT_SEA_MAP } } as LayerSpecification)
          : l,
    ),
  };
}

function satelliteLayers(): LayerSpecification[] {
  const handOver = satelliteSwitch(satelliteTileSize());
  return [
    { id: 'mb-background', type: 'background', paint: { 'background-color': RESORT_SEA_DEEP } },
    // Under the sharp imagery, the same in tiles four times as large (a sixteenth of the
    // requests): there at once on a slow phone, so a place newly in view is never a dark
    // hole while its sharp tiles come.
    {
      id: 'mb-satellite-quick',
      type: 'raster',
      source: 'mb-satellite-quick',
      paint: { ...SATELLITE_PAINT, 'raster-fade-duration': 0 },
    },
    {
      id: 'mb-satellite',
      type: 'raster',
      source: 'mb-satellite',
      maxzoom: handOver + 0.5,
      paint: { ...SATELLITE_PAINT },
    },
    // Closer in, over it (half a zoom early, so nothing shows through while it loads).
    {
      id: 'mb-satellite-close',
      type: 'raster',
      source: 'mb-satellite-close',
      minzoom: handOver - 0.5,
      // Close in, the streets and roofs as they are: no lift of the shadows (which washes
      // them out), a little more contrast and colour.
      paint: { ...SATELLITE_CLOSE_PAINT },
    },
  ];
}

function baseSources(base: BaseLayer): Record<string, SourceSpecification> {
  if (base === 'satellite') {
    const tileSize = satelliteTileSize();
    return {
      // The sea's bands come once the app has them (lib/sea.ts).
      'mb-coast': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'mb-satellite-quick': {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 512,
        maxzoom: SATELLITE_MAX,
        attribution: SATELLITE_ATTRIBUTION,
      },
      'mb-satellite': {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize,
        maxzoom: SATELLITE_MAX,
        attribution: SATELLITE_ATTRIBUTION,
      },
      'mb-satellite-close': {
        type: 'raster',
        tiles: [SATELLITE_CLOSE_TILES],
        tileSize,
        maxzoom: SATELLITE_CLOSE_MAX,
        attribution: SATELLITE_ATTRIBUTION,
      },
    };
  }
  return { 'mb-dem': demSource(), 'mb-dem-shade': demSource() };
}

/** Style used when the vector tiles can't be loaded: still a readable island. */
export function fallbackStyle(base: BaseLayer): StyleSpecification {
  return {
    version: 8,
    sources: baseSources(base === 'map' ? 'relief' : base),
    layers: base === 'satellite' ? satelliteLayers() : reliefLayers(),
  };
}

const sourceLayer = (l: LayerSpecification): string | undefined =>
  'source-layer' in l ? (l['source-layer'] as string | undefined) : undefined;

/**
 * Puts the labels, roads, places and buildings of a vector style on top of
 * imagery or relief. Fills (land use, water, parks) are dropped so the base
 * shows through; on imagery, text switches to white with a dark halo.
 */
export function overlayVector(
  vector: StyleSpecification,
  base: Exclude<BaseLayer, 'map'>,
): StyleSpecification {
  const keepLines = new Set(['transportation', 'boundary', 'aeroway']);
  const water = vector.layers.find((l) => l.type === 'fill' && sourceLayer(l) === 'water');
  const kept: LayerSpecification[] =
    base === 'satellite' && water && 'source' in water
      ? [openSeaFar(water.source), resortSea()]
      : [];
  for (const layer of vector.layers) {
    if (layer.type === 'symbol' || layer.type === 'fill-extrusion') {
      kept.push(base === 'satellite' && layer.type === 'symbol' ? brightText(layer) : layer);
    } else if (layer.type === 'line' && keepLines.has(sourceLayer(layer) ?? '')) {
      kept.push({
        ...layer,
        paint: { ...layer.paint, 'line-opacity': base === 'satellite' ? 0.45 : 0.7 },
      } as LayerSpecification);
    } else if (layer.type === 'fill' && sourceLayer(layer) === 'building' && base === 'relief') {
      kept.push(layer);
    }
  }
  return {
    ...vector,
    sources: { ...vector.sources, ...baseSources(base) },
    layers: [...(base === 'satellite' ? satelliteLayers() : reliefLayers()), ...kept],
  };
}

function brightText(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol') return layer;
  return {
    ...layer,
    paint: {
      ...layer.paint,
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0, 0, 0, 0.8)',
      'text-halo-width': 1.4,
    },
  };
}

/**
 * House numbers on the buildings when zoomed in close, small and grey as in Google Maps.
 * The style leaves them out though its tiles carry them; under the other labels, which
 * win where they meet.
 */
export function withHouseNumbers(style: StyleSpecification): StyleSpecification {
  const source = Object.keys(style.sources).find((id) =>
    style.layers.some((l) => 'source' in l && l.source === id && sourceLayer(l) === 'building'),
  );
  if (!source || style.layers.some((l) => sourceLayer(l) === 'housenumber')) return style;
  const layer: LayerSpecification = {
    id: 'mb-housenumber',
    type: 'symbol',
    source,
    'source-layer': 'housenumber',
    minzoom: 17,
    layout: {
      'text-field': ['get', 'housenumber'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10, 20, 13],
      'text-padding': 2,
    },
    paint: {
      'text-color': '#7a7a7a',
      'text-halo-color': 'rgba(255, 255, 255, 0.9)',
      'text-halo-width': 1.2,
    },
  };
  const first = style.layers.findIndex((l) => l.type === 'symbol');
  const layers = [...style.layers];
  layers.splice(first < 0 ? layers.length : first, 0, layer);
  return { ...style, layers };
}

/**
 * Icons that only clutter a map for getting about by bus (OpenMapTiles POI classes and
 * subclasses): litter bins and recycling, information boards and signposts, benches,
 * drinking fountains, toilets in the parks, stiles and gates, sports pitches and
 * playgrounds, swimming pools, statues, post boxes and car parks. Bus stops, hotels,
 * restaurants and cafés, shops, pharmacies, hospitals, museums, viewpoints, landmarks,
 * banks and tourist offices stay.
 */
export const CLUTTER_CLASSES = [
  'waste_basket',
  'recycling',
  'waste_disposal',
  'bench',
  'drinking_water',
  'toilets',
  'stile',
  'gate',
  'lift_gate',
  'entrance',
  'pitch',
  'playground',
  'swimming_pool',
  'fitness_station',
  'dog_park',
  'picnic_site',
  'bbq',
  'shelter',
  'fountain',
  'vending',
  'telephone',
  'clock',
  'charging_station',
  'hunting_stand',
  'parking',
  'bicycle_parking',
];
export const CLUTTER_SUBCLASSES = [
  ...CLUTTER_CLASSES,
  // Information points, but not the tourist office.
  'information',
  'board',
  'guidepost',
  'map',
  'route_marker',
  'terminal',
  'tactile_map',
  'artwork',
  'post_box',
  'vending_machine',
  'picnic_table',
  'kissing_gate',
  'parking_entrance',
  'motorcycle_parking',
];

/** The style without the icons that only clutter (see CLUTTER_CLASSES), on every base layer. */
export function withoutClutter(style: StyleSpecification): StyleSpecification {
  const clutter = [
    'any',
    ['match', ['get', 'class'], CLUTTER_CLASSES, true, false],
    ['match', ['get', 'subclass'], CLUTTER_SUBCLASSES, true, false],
  ];
  return {
    ...style,
    layers: style.layers.map((l) => {
      if (sourceLayer(l) !== 'poi') return l;
      const own = 'filter' in l ? l.filter : undefined;
      const filter = own ? ['all', own, ['!', clutter]] : ['!', clutter];
      return { ...l, filter } as LayerSpecification;
    }),
  };
}

let vectorStyle: Promise<StyleSpecification> | undefined;

async function fetchVectorStyle(): Promise<StyleSpecification> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(VECTOR_STYLE, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return withResortWater(
      withoutClutter(withHouseNumbers((await res.json()) as StyleSpecification)),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves the full style for a base layer, falling back to tile-free layers. */
export async function loadStyle(
  base: BaseLayer,
): Promise<{ style: StyleSpecification; vector: boolean }> {
  try {
    vectorStyle ??= fetchVectorStyle();
    const vector = await vectorStyle;
    return { style: base === 'map' ? vector : overlayVector(vector, base), vector: true };
  } catch {
    vectorStyle = undefined; // retry next time (e.g. when back online)
    return { style: fallbackStyle(base), vector: false };
  }
}

/** Ids of style layers showing shops, services and institutions. */
export function placeLayerIds(style: StyleSpecification): string[] {
  return style.layers.filter((l) => sourceLayer(l) === 'poi').map((l) => l.id);
}

/** The vector source and existing 3D layers for buildings, if the style has them. */
export function buildingLayers(style: StyleSpecification): {
  source?: string;
  extrusions: string[];
} {
  let source: string | undefined;
  const extrusions: string[] = [];
  for (const l of style.layers) {
    if (sourceLayer(l) !== 'building') continue;
    source ??= 'source' in l ? (l.source as string) : undefined;
    if (l.type === 'fill-extrusion') extrusions.push(l.id);
  }
  return { source, extrusions };
}

/** A 3D buildings layer for styles that only draw flat footprints. */
export function extrusionLayer(source: string, satellite: boolean): LayerSpecification {
  return {
    id: 'mb-buildings-3d',
    type: 'fill-extrusion',
    source,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': satellite ? '#e9e4da' : '#d9d3c8',
      'fill-extrusion-opacity': satellite ? 0.75 : 0.85,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
    },
  };
}

/** Human label for an OpenMapTiles POI class/subclass, in every app language. */
// prettier-ignore
const POI_LABELS: Record<string, Record<Lang, string>> = {
  town: { uk: 'Місто', en: 'Town', pt: 'Cidade', es: 'Ciudad', fr: 'Ville', it: 'Città', de: 'Stadt', nl: 'Stad', cs: 'Město', pl: 'Miasto', ru: 'Город' },
  village: { uk: 'Селище', en: 'Village', pt: 'Localidade', es: 'Pueblo', fr: 'Village', it: 'Paese', de: 'Ort', nl: 'Dorp', cs: 'Obec', pl: 'Miejscowość', ru: 'Посёлок' },
  locality: { uk: 'Місцевість', en: 'Locality', pt: 'Sítio', es: 'Paraje', fr: 'Lieu-dit', it: 'Località', de: 'Ortsteil', nl: 'Buurtschap', cs: 'Místo', pl: 'Okolica', ru: 'Местность' },
  cable_car: { uk: 'Канатна дорога', en: 'Cable car', pt: 'Teleférico', es: 'Teleférico', fr: 'Téléphérique', it: 'Funivia', de: 'Seilbahn', nl: 'Kabelbaan', cs: 'Lanovka', pl: 'Kolejka linowa', ru: 'Канатная дорога' },
  marketplace: { uk: 'Ринок', en: 'Market', pt: 'Mercado', es: 'Mercado', fr: 'Marché', it: 'Mercato', de: 'Markt', nl: 'Markt', cs: 'Tržnice', pl: 'Targ', ru: 'Рынок' },
  mall: { uk: 'Торговий центр', en: 'Shopping centre', pt: 'Centro comercial', es: 'Centro comercial', fr: 'Centre commercial', it: 'Centro commerciale', de: 'Einkaufszentrum', nl: 'Winkelcentrum', cs: 'Obchodní centrum', pl: 'Centrum handlowe', ru: 'Торговый центр' },
  peak: { uk: 'Вершина', en: 'Peak', pt: 'Pico', es: 'Pico', fr: 'Sommet', it: 'Vetta', de: 'Gipfel', nl: 'Top', cs: 'Vrchol', pl: 'Szczyt', ru: 'Вершина' },
  nature: { uk: 'Природа', en: 'Nature', pt: 'Natureza', es: 'Naturaleza', fr: 'Nature', it: 'Natura', de: 'Natur', nl: 'Natuur', cs: 'Příroda', pl: 'Przyroda', ru: 'Природа' },
  trailhead: { uk: 'Початок стежки', en: 'Trailhead', pt: 'Início de trilho', es: 'Inicio de sendero', fr: 'Départ de sentier', it: 'Inizio sentiero', de: 'Wanderweg-Start', nl: 'Begin van wandelpad', cs: 'Začátek stezky', pl: 'Początek szlaku', ru: 'Начало тропы' },
  historic: { uk: 'Пам’ятка', en: 'Landmark', pt: 'Monumento', es: 'Monumento', fr: 'Monument', it: 'Monumento', de: 'Sehenswürdigkeit', nl: 'Bezienswaardigheid', cs: 'Památka', pl: 'Zabytek', ru: 'Достопримечательность' },
  hospital: { uk: 'Лікарня', en: 'Hospital', pt: 'Hospital', es: 'Hospital', fr: 'Hôpital', it: 'Ospedale', de: 'Krankenhaus', nl: 'Ziekenhuis', cs: 'Nemocnice', pl: 'Szpital', ru: 'Больница' },
  pharmacy: { uk: 'Аптека', en: 'Pharmacy', pt: 'Farmácia', es: 'Farmacia', fr: 'Pharmacie', it: 'Farmacia', de: 'Apotheke', nl: 'Apotheek', cs: 'Lékárna', pl: 'Apteka', ru: 'Аптека' },
  school: { uk: 'Школа', en: 'School', pt: 'Escola', es: 'Escuela', fr: 'École', it: 'Scuola', de: 'Schule', nl: 'School', cs: 'Škola', pl: 'Szkoła', ru: 'Школа' },
  college: { uk: 'Навчальний заклад', en: 'College', pt: 'Ensino', es: 'Centro educativo', fr: 'Établissement d’enseignement', it: 'Istituto', de: 'Hochschule', nl: 'Onderwijsinstelling', cs: 'Vysoká škola', pl: 'Uczelnia', ru: 'Учебное заведение' },
  bank: { uk: 'Банк', en: 'Bank', pt: 'Banco', es: 'Banco', fr: 'Banque', it: 'Banca', de: 'Bank', nl: 'Bank', cs: 'Banka', pl: 'Bank', ru: 'Банк' },
  atm: { uk: 'Банкомат', en: 'ATM', pt: 'Multibanco', es: 'Cajero', fr: 'Distributeur', it: 'Bancomat', de: 'Geldautomat', nl: 'Geldautomaat', cs: 'Bankomat', pl: 'Bankomat', ru: 'Банкомат' },
  lodging: { uk: 'Житло', en: 'Accommodation', pt: 'Alojamento', es: 'Alojamiento', fr: 'Hébergement', it: 'Alloggio', de: 'Unterkunft', nl: 'Accommodatie', cs: 'Ubytování', pl: 'Nocleg', ru: 'Жильё' },
  hotel: { uk: 'Готель', en: 'Hotel', pt: 'Hotel', es: 'Hotel', fr: 'Hôtel', it: 'Hotel', de: 'Hotel', nl: 'Hotel', cs: 'Hotel', pl: 'Hotel', ru: 'Отель' },
  restaurant: { uk: 'Ресторан', en: 'Restaurant', pt: 'Restaurante', es: 'Restaurante', fr: 'Restaurant', it: 'Ristorante', de: 'Restaurant', nl: 'Restaurant', cs: 'Restaurace', pl: 'Restauracja', ru: 'Ресторан' },
  cafe: { uk: 'Кафе', en: 'Café', pt: 'Café', es: 'Cafetería', fr: 'Café', it: 'Caffè', de: 'Café', nl: 'Café', cs: 'Kavárna', pl: 'Kawiarnia', ru: 'Кафе' },
  bar: { uk: 'Бар', en: 'Bar', pt: 'Bar', es: 'Bar', fr: 'Bar', it: 'Bar', de: 'Bar', nl: 'Bar', cs: 'Bar', pl: 'Bar', ru: 'Бар' },
  fast_food: { uk: 'Фастфуд', en: 'Fast food', pt: 'Comida rápida', es: 'Comida rápida', fr: 'Restauration rapide', it: 'Fast food', de: 'Schnellimbiss', nl: 'Snackbar', cs: 'Rychlé občerstvení', pl: 'Fast food', ru: 'Фастфуд' },
  shop: { uk: 'Магазин', en: 'Shop', pt: 'Loja', es: 'Tienda', fr: 'Magasin', it: 'Negozio', de: 'Geschäft', nl: 'Winkel', cs: 'Obchod', pl: 'Sklep', ru: 'Магазин' },
  grocery: { uk: 'Продукти', en: 'Grocery', pt: 'Mercearia', es: 'Alimentación', fr: 'Épicerie', it: 'Alimentari', de: 'Lebensmittel', nl: 'Levensmiddelen', cs: 'Potraviny', pl: 'Sklep spożywczy', ru: 'Продукты' },
  supermarket: { uk: 'Супермаркет', en: 'Supermarket', pt: 'Supermercado', es: 'Supermercado', fr: 'Supermarché', it: 'Supermercato', de: 'Supermarkt', nl: 'Supermarkt', cs: 'Supermarket', pl: 'Supermarket', ru: 'Супермаркет' },
  town_hall: { uk: 'Ратуша', en: 'Town hall', pt: 'Câmara Municipal', es: 'Ayuntamiento', fr: 'Mairie', it: 'Municipio', de: 'Rathaus', nl: 'Gemeentehuis', cs: 'Radnice', pl: 'Ratusz', ru: 'Мэрия' },
  police: { uk: 'Поліція', en: 'Police', pt: 'Polícia', es: 'Policía', fr: 'Police', it: 'Polizia', de: 'Polizei', nl: 'Politie', cs: 'Policie', pl: 'Policja', ru: 'Полиция' },
  post: { uk: 'Пошта', en: 'Post office', pt: 'Correios', es: 'Correos', fr: 'Poste', it: 'Posta', de: 'Post', nl: 'Postkantoor', cs: 'Pošta', pl: 'Poczta', ru: 'Почта' },
  museum: { uk: 'Музей', en: 'Museum', pt: 'Museu', es: 'Museo', fr: 'Musée', it: 'Museo', de: 'Museum', nl: 'Museum', cs: 'Muzeum', pl: 'Muzeum', ru: 'Музей' },
  attraction: { uk: 'Пам’ятка', en: 'Attraction', pt: 'Atração', es: 'Atracción', fr: 'Attraction', it: 'Attrazione', de: 'Sehenswürdigkeit', nl: 'Attractie', cs: 'Atrakce', pl: 'Atrakcja', ru: 'Достопримечательность' },
  place_of_worship: { uk: 'Храм', en: 'Place of worship', pt: 'Igreja', es: 'Lugar de culto', fr: 'Lieu de culte', it: 'Luogo di culto', de: 'Gotteshaus', nl: 'Gebedshuis', cs: 'Kostel', pl: 'Świątynia', ru: 'Храм' },
  bus: { uk: 'Зупинка', en: 'Bus stop', pt: 'Paragem', es: 'Parada de autobús', fr: 'Arrêt de bus', it: 'Fermata', de: 'Bushaltestelle', nl: 'Bushalte', cs: 'Zastávka', pl: 'Przystanek', ru: 'Остановка' },
  fuel: { uk: 'АЗС', en: 'Fuel', pt: 'Combustível', es: 'Gasolinera', fr: 'Station-service', it: 'Distributore', de: 'Tankstelle', nl: 'Tankstation', cs: 'Čerpací stanice', pl: 'Stacja paliw', ru: 'АЗС' },
  park: { uk: 'Парк', en: 'Park', pt: 'Parque', es: 'Parque', fr: 'Parc', it: 'Parco', de: 'Park', nl: 'Park', cs: 'Park', pl: 'Park', ru: 'Парк' },
  beach: { uk: 'Пляж', en: 'Beach', pt: 'Praia', es: 'Playa', fr: 'Plage', it: 'Spiaggia', de: 'Strand', nl: 'Strand', cs: 'Pláž', pl: 'Plaża', ru: 'Пляж' },
  aerodrome: { uk: 'Аеропорт', en: 'Airport', pt: 'Aeroporto', es: 'Aeropuerto', fr: 'Aéroport', it: 'Aeroporto', de: 'Flughafen', nl: 'Luchthaven', cs: 'Letiště', pl: 'Lotnisko', ru: 'Аэропорт' },
  harbor: { uk: 'Порт', en: 'Harbour', pt: 'Porto', es: 'Puerto', fr: 'Port', it: 'Porto', de: 'Hafen', nl: 'Haven', cs: 'Přístav', pl: 'Port', ru: 'Порт' },
  ferry_terminal: { uk: 'Пором', en: 'Ferry', pt: 'Ferry', es: 'Ferry', fr: 'Ferry', it: 'Traghetto', de: 'Fähre', nl: 'Veerboot', cs: 'Trajekt', pl: 'Prom', ru: 'Паром' },
  doctors: { uk: 'Лікар', en: 'Doctor', pt: 'Médico', es: 'Médico', fr: 'Médecin', it: 'Medico', de: 'Arztpraxis', nl: 'Huisarts', cs: 'Lékař', pl: 'Lekarz', ru: 'Врач' },
  dentist: { uk: 'Стоматолог', en: 'Dentist', pt: 'Dentista', es: 'Dentista', fr: 'Dentiste', it: 'Dentista', de: 'Zahnarzt', nl: 'Tandarts', cs: 'Zubař', pl: 'Dentysta', ru: 'Стоматолог' },
  library: { uk: 'Бібліотека', en: 'Library', pt: 'Biblioteca', es: 'Biblioteca', fr: 'Bibliothèque', it: 'Biblioteca', de: 'Bibliothek', nl: 'Bibliotheek', cs: 'Knihovna', pl: 'Biblioteka', ru: 'Библиотека' },
  cinema: { uk: 'Кінотеатр', en: 'Cinema', pt: 'Cinema', es: 'Cine', fr: 'Cinéma', it: 'Cinema', de: 'Kino', nl: 'Bioscoop', cs: 'Kino', pl: 'Kino', ru: 'Кинотеатр' },
  theatre: { uk: 'Театр', en: 'Theatre', pt: 'Teatro', es: 'Teatro', fr: 'Théâtre', it: 'Teatro', de: 'Theater', nl: 'Theater', cs: 'Divadlo', pl: 'Teatr', ru: 'Театр' },
  stadium: { uk: 'Стадіон', en: 'Stadium', pt: 'Estádio', es: 'Estadio', fr: 'Stade', it: 'Stadio', de: 'Stadion', nl: 'Stadion', cs: 'Stadion', pl: 'Stadion', ru: 'Стадион' },
  gallery: { uk: 'Галерея', en: 'Gallery', pt: 'Galeria', es: 'Galería', fr: 'Galerie', it: 'Galleria', de: 'Galerie', nl: 'Galerie', cs: 'Galerie', pl: 'Galeria', ru: 'Галерея' },
  monument: { uk: 'Пам’ятник', en: 'Monument', pt: 'Monumento', es: 'Monumento', fr: 'Monument', it: 'Monumento', de: 'Denkmal', nl: 'Monument', cs: 'Pomník', pl: 'Pomnik', ru: 'Памятник' },
  castle: { uk: 'Фортеця', en: 'Fort', pt: 'Forte', es: 'Fuerte', fr: 'Fort', it: 'Forte', de: 'Festung', nl: 'Fort', cs: 'Pevnost', pl: 'Twierdza', ru: 'Крепость' },
  bakery: { uk: 'Пекарня', en: 'Bakery', pt: 'Padaria', es: 'Panadería', fr: 'Boulangerie', it: 'Panetteria', de: 'Bäckerei', nl: 'Bakkerij', cs: 'Pekárna', pl: 'Piekarnia', ru: 'Пекарня' },
  ice_cream: { uk: 'Морозиво', en: 'Ice cream', pt: 'Gelataria', es: 'Heladería', fr: 'Glacier', it: 'Gelateria', de: 'Eisdiele', nl: 'IJssalon', cs: 'Zmrzlinárna', pl: 'Lodziarnia', ru: 'Мороженое' },
  viewpoint: { uk: 'Оглядовий майданчик', en: 'Viewpoint', pt: 'Miradouro', es: 'Mirador', fr: 'Point de vue', it: 'Belvedere', de: 'Aussichtspunkt', nl: 'Uitkijkpunt', cs: 'Vyhlídka', pl: 'Punkt widokowy', ru: 'Смотровая площадка' },
};

/** A place's name in the reader's language when OpenStreetMap has one. */
export function placeName(place: { name: string; names?: Record<string, string> }, lang: Lang) {
  return place.names?.[lang] ?? place.name;
}

export function poiLabel(lang: Lang, klass?: string, subclass?: string): string | undefined {
  const hit = (subclass && POI_LABELS[subclass]) || (klass && POI_LABELS[klass]);
  if (hit) return hit[lang];
  const raw = subclass || klass;
  return raw ? raw.replaceAll('_', ' ') : undefined;
}
