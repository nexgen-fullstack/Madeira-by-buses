import { describe, expect, it, vi } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import {
  buildingLayers,
  DEFAULT_LAYERS,
  fallbackStyle,
  LAND_IMAGES,
  nextTrails,
  overlayVector,
  placeLayerIds,
  poiLabel,
  withHouseNumbers,
  withoutClutter,
  withResortWater,
  RESORT_SEA,
  throughCache,
} from './mapStyles.ts';

/** A tiny stand-in for the OpenFreeMap Liberty style. */
const VECTOR: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://example.com/planet' } },
  glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
    { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'river', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway' },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
    },
    {
      id: 'poi',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      paint: { 'text-color': '#666' },
    },
    { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
  ],
};

const ids = (s: StyleSpecification) => s.layers.map((l) => l.id);

/** The few expressions the layer filters use, evaluated for a feature's properties. */
function evaluate(e: unknown, props: Record<string, unknown>): unknown {
  if (!Array.isArray(e)) return e;
  const [op, ...args] = e as [string, ...unknown[]];
  const value = (x: unknown) => evaluate(x, props);
  switch (op) {
    case 'all':
      return args.every((a) => value(a) === true);
    case 'any':
      return args.some((a) => value(a) === true);
    case '!':
      return value(args[0]) !== true;
    case 'get':
      return props[args[0] as string];
    case '>=':
      return (value(args[0]) as number) >= (value(args[1]) as number);
    case 'match': {
      const input = value(args[0]);
      for (let i = 1; i + 1 < args.length; i += 2) {
        const labels = args[i];
        if (Array.isArray(labels) ? labels.includes(input) : labels === input) return args[i + 1];
      }
      return args[args.length - 1];
    }
    default:
      throw new Error(`no ${op}`);
  }
}

describe('map styles', () => {
  it('puts labels, roads and buildings over satellite imagery', () => {
    const hybrid = overlayVector(VECTOR, 'satellite');
    expect(ids(hybrid)).toEqual([
      'mb-background',
      'mb-land-madeira',
      'mb-land-desertas',
      'mb-land-porto-santo',
      'mb-satellite-far',
      'mb-satellite',
      'mb-satellite-close',
      'mb-resort-sea',
      'road',
      'building-3d',
      'poi',
      'place',
    ]);
    expect(hybrid.sources['mb-satellite']).toMatchObject({ type: 'raster' });
    expect(hybrid.glyphs).toBe(VECTOR.glyphs);
    const poi = hybrid.layers.find((l) => l.id === 'poi')!;
    expect(poi.type === 'symbol' && poi.paint?.['text-color']).toBe('#ffffff');
  });

  it('puts the same details over the relief map and keeps building footprints', () => {
    const relief = overlayVector(VECTOR, 'relief');
    expect(ids(relief).slice(0, 8)).toEqual([
      'mb-background',
      'mb-land-madeira',
      'mb-land-desertas',
      'mb-land-porto-santo',
      'mb-relief',
      'mb-hillshade',
      'mb-sea',
      'building',
    ]);
    expect(relief.sources['mb-dem']).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
  });

  it('adds house numbers under the other labels, also over imagery', () => {
    const style = withHouseNumbers(VECTOR);
    expect(ids(style).slice(-3)).toEqual(['mb-housenumber', 'poi', 'place']);
    expect(style.layers.find((l) => l.id === 'mb-housenumber')).toMatchObject({
      source: 'openmaptiles',
      'source-layer': 'housenumber',
      minzoom: 17,
    });
    expect(withHouseNumbers(style)).toBe(style);
    expect(ids(overlayVector(style, 'satellite'))).toContain('mb-housenumber');
  });

  it('lays a turquoise resort sea over the imagery, along the coastline, and on the plain map', () => {
    const sea = overlayVector(VECTOR, 'satellite').layers.find((l) => l.id === 'mb-resort-sea')!;
    // In bands by distance from the shore, the open sea the deepest.
    expect(sea).toMatchObject({ type: 'fill', source: 'mb-coast' });
    expect(JSON.stringify(sea.type === 'fill' && sea.paint?.['fill-color'])).toContain(RESORT_SEA);
    // Not over the relief map, which has a sea of its own.
    expect(ids(overlayVector(VECTOR, 'relief'))).not.toContain('mb-resort-sea');
    const plain = withResortWater(VECTOR).layers.find((l) => l.id === 'water')!;
    expect(plain.type === 'fill' && plain.paint?.['fill-color']).toMatch(/^#[0-9a-f]{6}$/);
    expect(plain.type === 'fill' && plain.paint?.['fill-color']).not.toBe('rgb(158,189,255)');
  });

  it('falls back to tile-free styles', () => {
    expect(ids(fallbackStyle('map'))).toContain('mb-relief');
    expect(ids(fallbackStyle('satellite'))).toContain('mb-satellite');
    // Its sea in the bands, the app's own, at every zoom.
    const sea = fallbackStyle('satellite').layers.find((l) => l.id === 'mb-resort-sea');
    expect(sea).toMatchObject({ type: 'fill', source: 'mb-coast' });
    expect(sea).not.toHaveProperty('minzoom');
  });

  it('lays the islands drawn from their heights under the imagery, built into the app', () => {
    for (const style of [
      overlayVector(VECTOR, 'satellite'),
      overlayVector(VECTOR, 'relief'),
      fallbackStyle('satellite'),
      fallbackStyle('map'),
    ]) {
      const first = ids(style).findIndex((id) => id.startsWith('mb-land-'));
      // Right over the background, under all else.
      expect(first).toBe(1);
      for (const { id, file, bounds } of LAND_IMAGES) {
        const [w, s, e, n] = bounds;
        expect(style.sources[`mb-land-${id}`]).toEqual({
          type: 'image',
          url: expect.stringMatching(new RegExp(`${file}$`)),
          coordinates: [
            [w, n],
            [e, n],
            [e, s],
            [w, s],
          ],
        });
      }
    }
    // Madeira, the Desertas and Porto Santo, each where it is.
    const at = (lon: number, lat: number) =>
      LAND_IMAGES.find(({ bounds: [w, s, e, n] }) => lon > w! && lon < e! && lat > s! && lat < n!)
        ?.id;
    expect(at(-16.91, 32.65)).toBe('madeira'); // Funchal
    expect(at(-17.25, 32.81)).toBe('madeira'); // Ponta do Pargo
    expect(at(-16.71, 32.74)).toBe('madeira'); // Ponta de São Lourenço
    expect(at(-16.5, 32.52)).toBe('desertas'); // Deserta Grande
    expect(at(-16.34, 33.06)).toBe('porto-santo');
  });

  it("asks for the map's files through the phone's cache where it has one", () => {
    const style = {
      ...VECTOR,
      sprite: 'https://tiles.openfreemap.org/sprites/ofm',
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        other: { type: 'raster', tiles: ['https://example.com/{z}/{x}/{y}.png'] },
      },
    } as StyleSpecification;
    // No Cache Storage (here, as on a website over plain http): the addresses as they are.
    expect(throughCache(style)).toEqual(style);
    vi.stubGlobal('caches', {});
    try {
      const cached = throughCache(style);
      expect(cached.glyphs).toBe('mbc://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
      expect(cached.sprite).toBe('mbc://tiles.openfreemap.org/sprites/ofm');
      expect(cached.sources.openmaptiles).toEqual({
        type: 'vector',
        url: 'mbc://tiles.openfreemap.org/planet',
      });
      // Only the map's own servers.
      expect(cached.sources.other).toEqual(style.sources.other);
      const imagery = fallbackStyle('satellite').sources['mb-satellite'] as { tiles: string[] };
      expect(imagery.tiles[0]).toMatch(/^mbc:\/\/clarity\.maptiles\.arcgis\.com\//);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('finds place and building layers', () => {
    expect(placeLayerIds(VECTOR)).toEqual(['poi']);
    expect(buildingLayers(VECTOR)).toEqual({ source: 'openmaptiles', extrusions: ['building-3d'] });
    expect(buildingLayers(fallbackStyle('map'))).toEqual({ source: undefined, extrusions: [] });
  });

  it('names places in the user language', () => {
    expect(poiLabel('uk', 'shop', 'pharmacy')).toBe('Аптека');
    expect(poiLabel('pt', 'lodging', 'hotel')).toBe('Hotel');
    expect(poiLabel('en', 'amenity', 'bicycle_rental')).toBe('bicycle rental');
    expect(poiLabel('uk', 'art_gallery', 'gallery')).toBe('Галерея');
    expect(poiLabel('en')).toBeUndefined();
  });

  it('leaves out the icons that only clutter, on every base layer', () => {
    const style = withoutClutter({
      ...VECTOR,
      layers: [
        ...VECTOR.layers,
        {
          id: 'poi_r1',
          type: 'symbol',
          source: 'openmaptiles',
          'source-layer': 'poi',
          filter: ['>=', ['get', 'rank'], 1],
        },
      ],
    });
    const shown = (id: string, properties: Record<string, unknown>) => {
      const layer = style.layers.find((l) => l.id === id)!;
      return evaluate('filter' in layer ? layer.filter : true, properties) === true;
    };
    for (const id of ['poi', 'poi_r1']) {
      // Bins, information boards, statues, pitches, car parks: gone.
      expect(shown(id, { class: 'waste_basket', subclass: 'waste_basket', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'information', subclass: 'board', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'art_gallery', subclass: 'artwork', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'pitch', subclass: 'tennis', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'parking', subclass: 'parking', rank: 20 })).toBe(false);
      // Stops, hotels, cafés, pharmacies, museums, viewpoints, the tourist office: kept.
      expect(shown(id, { class: 'bus', subclass: 'bus_stop', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'lodging', subclass: 'hotel', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'cafe', subclass: 'cafe', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'shop', subclass: 'pharmacy', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'museum', subclass: 'museum', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'attraction', subclass: 'viewpoint', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'information', subclass: 'office', rank: 20 })).toBe(true);
    }
    // The layer's own filter still counts.
    expect(shown('poi_r1', { class: 'cafe', subclass: 'cafe', rank: 0 })).toBe(false);
    // Over imagery too.
    expect(overlayVector(style, 'satellite').layers.find((l) => l.id === 'poi_r1')).toHaveProperty(
      'filter',
    );
  });
});

describe('the trails button', () => {
  it('puts the trails on with their photos, then alone, then takes them away', () => {
    const one = nextTrails(DEFAULT_LAYERS);
    expect([one.trails, one.trailPhotos]).toEqual([true, true]);
    const two = nextTrails(one);
    expect([two.trails, two.trailPhotos]).toEqual([true, false]);
    const three = nextTrails(two);
    expect([three.trails, three.trailPhotos]).toEqual([false, true]);
    // The photos of the places with a view are the camera's: the trails leave them be.
    for (const l of [one, two, three]) expect(l.scenic).toBe(DEFAULT_LAYERS.scenic);
  });
});
