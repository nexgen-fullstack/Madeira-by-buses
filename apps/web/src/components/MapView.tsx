import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bus,
  Camera,
  Check,
  Clock,
  CloudSun,
  ExternalLink,
  Flag,
  LayoutGrid,
  MapPin,
  Phone,
  Signpost,
  Video,
  X,
} from 'lucide-react';
import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { haversine, type LatLon, type Network } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { luminance, readableOn } from '../lib/color.ts';
import { decodePlace, encodePlace } from '../lib/itinerary.ts';
import { rememberPosition } from '../lib/geolocation.ts';
import { Snapper } from '../lib/snap.ts';
import { placePhoto, type PlacePhoto } from '../lib/placePhoto.ts';
import { hideLaunch } from '../lib/launch.ts';
import {
  RUN_WIDTH,
  TRAIL_RED,
  transitGeoJson,
  VIEW_WALK,
  VR_VIOLET,
  WAY_TURQUOISE,
  WAY_WIDTH,
  type FlagLook,
  type FlagMode,
  type LineNote,
  type MapBadge,
  type MapContent,
  type ScenicSpot,
} from '../lib/mapContent.ts';
import {
  buildingLayers,
  demSource,
  extrusionLayer,
  fallbackStyle,
  loadStyle,
  nextTrails,
  placeLayerIds,
  poiLabel,
  type BaseLayer,
  type MapLayers,
} from '../lib/mapStyles.ts';
import { pointName } from '../lib/pointName.ts';
import { useBack } from '../lib/back.ts';
import { navigate } from '../lib/router.ts';
import { trailPhotoSpots } from '../lib/photos.ts';
import { loadTrails, trailLines, useTrails } from '../lib/trails.ts';
import { useApp } from '../state/app.tsx';
import { LayerSwitcher } from './LayerSwitcher.tsx';
import { LineCard, LineChooser, type LinePick } from './LineCard.tsx';
import { MapContentContext, type PickField, type Spotlight } from './mapContext.tsx';
import { busImage, busImageId } from './busImage.ts';
import {
  bigStoreImage,
  bigStoreImageId,
  PlacesChip,
  PlacesPicker,
  poiImage,
  poiImageId,
} from './PlacesPicker.tsx';
import {
  loadPois,
  ofCategory,
  POI_LOOK,
  poiName,
  poiRank,
  type Poi,
  type PoiCategory,
} from '../lib/pois.ts';
import type { LiveBus } from '../lib/liveBus.ts';
import { useWarnings, useWeather } from '../lib/useWeather.ts';
import { worstLevel } from '../lib/weather.ts';
import { SkyIcon } from './SkyIcon.tsx';

// MapLibre computes its worker URL at runtime, which bundlers cannot see; point it at the bundled worker.
setWorkerUrl(maplibreWorkerUrl);

const MADEIRA_CENTER: [number, number] = [-16.96, 32.75];

interface PickedPlace {
  name: string;
  /** OpenMapTiles POI class / subclass, labelled at render time in the current language. */
  klass?: string;
  subclass?: string;
  lat: number;
  lon: number;
  /** One of the places of the "Places" button: its kind, hours, phone, website. */
  poi?: Poi;
}

/** A stop tapped while choosing a place on the map: chosen as the stop while the pin stays on it. */
interface PickedStop extends LatLon {
  stops: number[];
  name: string;
}

/**
 * The pin of a maps app in the yellow of the logo's pin: where the journey goes, a dropped
 * pin, the spot being chosen. Pressed, it turns turquoise (colours in styles.css).
 */
const PIN_PATH =
  'M14 1C6.8 1 1 6.8 1 14c0 9.6 11.2 22.6 12.2 23.8a1 1 0 0 0 1.6 0C15.8 36.6 27 23.6 27 14 27 6.8 21.2 1 14 1z';
const PIN_SVG = `<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true">
<path class="map-pin__body" d="${PIN_PATH}"/>
<path class="map-pin__shade" d="M14 1C21.2 1 27 6.8 27 14c0 9.6-11.2 22.6-12.2 23.8l-.8.4z"/>
<path class="map-pin__edge" d="${PIN_PATH}"/>
<ellipse class="map-pin__shine" cx="9.2" cy="8.2" rx="3.4" ry="1.9" transform="rotate(-38 9.2 8.2)"/>
<circle class="map-pin__dot" cx="14" cy="14" r="5"/></svg>`;
/**
 * A pin for a marker. Turquoise while pressed; a tap chooses it (it stays turquoise) or lets it
 * go again, and a tap anywhere else on the map lets it go too.
 */
function pinElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-pin';
  el.innerHTML = PIN_SVG;
  const release = () => el.classList.remove('map-pin--pressed');
  el.addEventListener('pointerdown', () => el.classList.add('map-pin--pressed'));
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('click', (e) => {
    // The map under the pin would take the tap for one elsewhere (or for the stop beneath).
    e.stopPropagation();
    el.classList.toggle('map-pin--chosen');
  });
  return el;
}

/**
 * The map's credits as their round "i" alone, as in a maps app: MapLibre opens them as
 * they first fill in (and again when the phone is turned); here they open only when the "i"
 * is tapped, and fold away at a second tap or a tap on the map. Returns `fold`.
 */
function foldAttribution(map: MapLibreMap): () => void {
  const el = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
  if (!el) return () => {};
  let wanted = false;
  const fold = () => {
    wanted = false;
    el.classList.remove('maplibregl-compact-show');
  };
  // Before MapLibre's own handler turns it: what the tap asks for.
  el.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element).closest('.maplibregl-ctrl-attrib-button')) {
        wanted = !el.classList.contains('maplibregl-compact-show');
      }
    },
    true,
  );
  new MutationObserver(() => {
    if (!wanted && el.classList.contains('maplibregl-compact-show')) {
      el.classList.remove('maplibregl-compact-show');
    }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
  fold();
  return fold;
}

/**
 * The map's buttons where the sheet over it on a phone has come up to them (or the map's
 * credits below them): they step aside rather than lie on the screen's content, and come
 * back when the sheet goes down.
 */
function hideCovered(map: MapLibreMap): void {
  const panel = document.querySelector<HTMLElement>('.panel--sheet');
  const box = map.getContainer().parentElement;
  if (!box) return;
  const credits = box.querySelector('.maplibregl-ctrl-bottom-right');
  const limit = Math.min(
    panel ? panel.getBoundingClientRect().top : Infinity,
    credits && credits.childElementCount > 0 ? credits.getBoundingClientRect().top : Infinity,
  );
  const buttons = box.querySelectorAll<HTMLElement>(
    '.maplibregl-ctrl-top-right > .maplibregl-ctrl, .map-tools',
  );
  for (const el of buttons) {
    el.classList.remove('map-ctrl--covered');
    el.classList.toggle('map-ctrl--covered', el.getBoundingClientRect().bottom > limit - 4);
  }
}

/** A tap on the map away from the pins: none of them is chosen any more. */
function releasePins(map: MapLibreMap) {
  for (const pin of map.getCanvasContainer().querySelectorAll('.map-pin--chosen')) {
    pin.classList.remove('map-pin--chosen');
  }
}

function toGeoJson(content: MapContent) {
  return {
    lines: {
      type: 'FeatureCollection' as const,
      features: content.lines.map((l) => ({
        type: 'Feature' as const,
        properties: {
          color: l.color,
          // A dark edge round a light line (the neon of a chosen way), a white one round the rest.
          casing: luminance(l.color) > 0.25 ? '#14181F' : '#ffffff',
          // The number of the bus written on the line, on a plate of its colour.
          ink: readableOn(l.color),
          plate: plateId(l.color),
          dashed: Boolean(l.dashed),
          width: l.width ?? 4,
          label: l.label ?? '',
          arrows: Boolean(l.arrows),
          side: Boolean(l.side),
          note: l.note ? JSON.stringify(l.note) : '',
          route: l.route ?? -1,
          pattern: l.pattern ?? -1,
          board: l.board ?? -1,
          href: l.href ?? '',
          view: l.view ?? l.color === VIEW_WALK,
          walkDot: walkDotId(l.color),
          key: l.key ?? '',
          faint: Boolean(l.faint),
        },
        geometry: { type: 'LineString' as const, coordinates: l.coords.map((c) => [c.lon, c.lat]) },
      })),
    },
    points: {
      type: 'FeatureCollection' as const,
      features: content.points.map((p) => ({
        type: 'Feature' as const,
        properties: {
          kind: p.kind,
          color: p.color ?? '#002F85',
          fill: p.fill ?? '#ffffff',
          label: p.label ?? '',
          stops: (p.stops ?? []).join(','),
          pair: Boolean(p.pair),
          apart: Boolean(p.apart),
          heading: p.heading ?? -1,
          dot: stopDotId(p.fill ?? '#ffffff'),
          flag: flagId(p.kind === 'alight', p.flag),
          name: p.name ?? p.label ?? '',
        },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    },
    expressways: {
      type: 'FeatureCollection' as const,
      features: (content.expressways ?? []).map((coords) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: coords.map((c) => [c.lon, c.lat]) },
      })),
    },
  };
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * Lines are drawn in their lanes, moved over by real metres (see `offsetPolyline`), which
 * far out are less than a pixel. Where the two ways of a line share a road, each is drawn
 * to its own side of it by this much of its width at any zoom: their dark edges meet in
 * the middle, a solid line between two lanes, and neither covers the other.
 */
const LANE_APART = 0.75;

/** How far a way on a shared road is drawn to its side (px), by its width. */
const sideOffset = [
  'case',
  ['get', 'side'],
  ['*', ['get', 'width'], LANE_APART],
  0,
] as unknown as number;

/** The arrows of a way on a shared road with it, on their side (px across the line). */
const sideArrows = [
  'case',
  ['==', ['get', 'width'], WAY_WIDTH],
  ['literal', [0, WAY_WIDTH * LANE_APART]],
  ['literal', [0, RUN_WIDTH * LANE_APART]],
] as unknown as [number, number];

/** The image of a stop on a shared road, a dot in its way's colour in a dark ring. */
const stopDotId = (fill: string) => `mb-stop-${fill.replace('#', '').toLowerCase()}`;
/** Its dot and ring at full size (px), as the stops drawn as circles are close up. */
const DOT_FILL = 4.5;
const DOT_RING = 2;

/**
 * How big a stop is drawn at a zoom, of its full size: as the circles of the other stops
 * grow (their radius and ring in the `mb-point` layer), so the two kinds look alike.
 */
function stopScale(zoom: number): number {
  const at = (stops: [number, number][]) => {
    const i = stops.findIndex(([z]) => z >= zoom);
    if (i <= 0) return i === 0 ? stops[0]![1] : stops.at(-1)![1];
    const [z0, v0] = stops[i - 1]!;
    const [z1, v1] = stops[i]!;
    return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
  };
  const radius = at([
    [10, 0],
    [11.5, 1.8],
    [13, 3],
    [15, 4.5],
  ]);
  const ring = at([
    [10, 0],
    [11.5, 1],
    [14, 2],
  ]);
  return (radius + ring) / (DOT_FILL + DOT_RING);
}
const DOT_ZOOMS = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15];

/** Puts on the map the dots of the colours its stops on shared roads are in. */
function addStopDots(map: MapLibreMap, content: MapContent) {
  for (const p of content.points) {
    if (p.heading === undefined) continue;
    const id = stopDotId(p.fill ?? '#ffffff');
    if (map.hasImage(id)) continue;
    const r = (DOT_FILL + DOT_RING) * 2;
    const image = canvasImage(r * 2, r * 2, (ctx) => {
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color ?? '#14181F';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r, r, DOT_FILL * 2, 0, Math.PI * 2);
      ctx.fillStyle = p.fill ?? '#ffffff';
      ctx.fill();
    });
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
}

/** A chevron pointing along a line, for the arrows the way the bus goes. */
function arrowImage(): ImageData | undefined {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 9);
  ctx.lineTo(26, 20);
  ctx.lineTo(14, 31);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.strokeStyle = '#14181F';
  ctx.lineWidth = 8;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** A canvas of `size` px drawn by `draw`, as an image for the map. */
function canvasImage(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): ImageData | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  draw(ctx);
  return ctx.getImageData(0, 0, width, height);
}

const FLAG_W = 72;
const FLAG_H = 80;
const FLAG_INK = '#14181F';
const FLAG_GREEN = '#00C853';

/** The image of a flag: plain, or as `look` says (each look drawn once). */
const flagId = (finish: boolean, look?: FlagLook) =>
  look
    ? `mb-flag-${finish ? 'finish' : 'start'}-${look.mode}-${look.color.replace('#', '').toLowerCase()}-${look.text ?? ''}`
    : finish
      ? 'mb-flag-finish'
      : 'mb-flag-start';

/**
 * What goes the way, drawn in `color` round (`cx`, `cy`) in a box of `size` px: a walker,
 * a hiker with a stick, a car or a bike, in thick round strokes that read when small.
 */
function drawMode(
  ctx: CanvasRenderingContext2D,
  mode: Exclude<FlagMode, 'bus'>,
  color: string,
  cx: number,
  cy: number,
  size: number,
) {
  // Drawn on a grid of 24 round the middle.
  const k = size / 24;
  const x = (u: number) => cx + u * k;
  const y = (v: number) => cy + v * k;
  const path = (...pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(x(u), y(v)) : ctx.lineTo(x(u), y(v))));
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.8 * k;
  if (mode === 'walk' || mode === 'trail') {
    ctx.beginPath();
    ctx.arc(x(1.5), y(-8), 2.8 * k, 0, Math.PI * 2);
    ctx.fill();
    // The body leaning forward, an arm and a leg each way.
    path([1, -4], [-0.5, 3]);
    path([-0.5, 3], [-4.5, 10]);
    path([-0.5, 3], [3, 6], [3.5, 10.5]);
    path([0.5, -3], [-3.5, 1]);
    path([0.5, -3], [4, 0]);
    // A hiker's stick.
    if (mode === 'trail') path([6.5, -1], [7.5, 10.5]);
  } else if (mode === 'car') {
    ctx.beginPath();
    ctx.moveTo(x(-10), y(5));
    ctx.lineTo(x(-10), y(0));
    ctx.lineTo(x(-6.5), y(-1));
    ctx.lineTo(x(-4), y(-6.5));
    ctx.lineTo(x(4), y(-6.5));
    ctx.lineTo(x(6.5), y(-1));
    ctx.lineTo(x(10), y(0));
    ctx.lineTo(x(10), y(5));
    ctx.closePath();
    ctx.fill();
    // Its windows white, its wheels dark.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x(-4.5), y(-1.2));
    ctx.lineTo(x(-3), y(-4.8));
    ctx.lineTo(x(3), y(-4.8));
    ctx.lineTo(x(4.5), y(-1.2));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = FLAG_INK;
    for (const u of [-5.5, 5.5]) {
      ctx.beginPath();
      ctx.arc(x(u), y(5.5), 2.8 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.lineWidth = 2.2 * k;
    for (const u of [-6.5, 6.5]) {
      ctx.beginPath();
      ctx.arc(x(u), y(4), 4.6 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    path([-6.5, 4], [-2, -3], [4, -3], [6.5, 4]);
    path([-2, -3], [0.5, 4], [4, -3]);
    path([-6.5, 4], [0.5, 4]);
    path([-3.5, -6], [-0.5, -6]);
    path([4, -3], [3, -7], [5.5, -7]);
  }
  ctx.restore();
}

/** Text as big as fits `width` (px), up to `max`, in bold. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
  let px = max;
  for (; px > 10; px--) {
    ctx.font = `800 ${px}px system-ui, 'Segoe UI', Roboto, sans-serif`;
    if (ctx.measureText(text).width <= width) break;
  }
}

/**
 * A flag as in Formula 1, its pole at the bottom corner standing on the stop: the start
 * flag (cloth to the right), the chequered one where the way ends (cloth to the left), so
 * that where one way ends and the next starts the two stand side by side. Each in the
 * colour its way is drawn in: the start flag of that colour, the chequered one of that
 * colour and black (a dark colour and white); a bus's with its number (large in the middle
 * of the chequered one), the others with a walker, a hiker, a car or a bike in the way's
 * colour on a white disc. Without a `look`, plain: green, and black and white.
 */
function flagImage(finish: boolean, look?: FlagLook): ImageData | undefined {
  return canvasImage(FLAG_W, FLAG_H, (ctx) => {
    const pole = finish ? FLAG_W - 6 : 6;
    const cloth = { x: finish ? 8 : 9, y: 5, w: FLAG_W - 17, h: 38 };
    const mid = { x: cloth.x + cloth.w / 2, y: cloth.y + cloth.h / 2 };
    const bus = look?.mode === 'bus';
    // The pole, white-edged to read on the aerial photos.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(pole, 4);
    ctx.lineTo(pole, FLAG_H - 4);
    ctx.stroke();
    ctx.strokeStyle = '#14181F';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cloth.x - 2, cloth.y - 2, cloth.w + 4, cloth.h + 4);
    if (finish) {
      const cols = 5;
      const rows = 4;
      const cw = cloth.w / cols;
      const ch = cloth.h / rows;
      // In its colour and black, or white by a dark colour; plain, black and white.
      const own = look?.color ?? '#ffffff';
      const other = !look || bus || luminance(own) > 0.25 ? FLAG_INK : '#ffffff';
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 ? own : other;
          ctx.fillRect(cloth.x + c * cw, cloth.y + r * ch, cw, ch);
        }
    } else {
      ctx.fillStyle = look?.color ?? FLAG_GREEN;
      ctx.fillRect(cloth.x, cloth.y, cloth.w, cloth.h);
    }
    ctx.strokeStyle = FLAG_INK;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(cloth.x, cloth.y, cloth.w, cloth.h);
    if (!look) return;
    if (look.mode === 'bus') {
      const text = look.text ?? '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (finish) {
        // Large in the middle, black on a white edge: it reads on the chequers.
        fitFont(ctx, text, cloth.w - 4, 28);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(text, mid.x, mid.y + 1);
        ctx.fillStyle = FLAG_INK;
        ctx.fillText(text, mid.x, mid.y + 1);
      } else {
        fitFont(ctx, text, cloth.w - 8, 24);
        ctx.fillStyle = readableOn(look.color);
        ctx.fillText(text, mid.x, mid.y + 1);
      }
      return;
    }
    // A white disc in a dark ring in the middle, with what goes the way.
    const r = cloth.h / 2 - 3;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = FLAG_INK;
    ctx.stroke();
    drawMode(ctx, look.mode, look.color, mid.x, mid.y, r * 1.55);
  });
}

/** Puts on the map the flags its ways start and end at, each look once. */
function addFlags(map: MapLibreMap, content: MapContent) {
  for (const p of content.points) {
    if (p.kind !== 'board' && p.kind !== 'alight') continue;
    const finish = p.kind === 'alight';
    const id = flagId(finish, p.flag);
    if (map.hasImage(id)) continue;
    const image = flagImage(finish, p.flag);
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
}

/** The plate a line's number is written on, one for each colour of line. */
const plateId = (color: string) => `mb-plate-${color.replace('#', '').toLowerCase()}`;

/** Plate size and corner in image pixels (drawn at twice the size of the screen). */
const PLATE = 24;
const PLATE_EDGE = 2;
const PLATE_CORNER = 6;

/**
 * A rounded plate in a line's colour with an edge that reads on any map (dark round a
 * light colour, white round a dark one), as the number of a bus is printed in the list:
 * stretched round the number (a nine-patch), its corners kept round.
 */
function plateImage(color: string): ImageData | undefined {
  return canvasImage(PLATE, PLATE, (ctx) => {
    const rounded = (inset: number, radius: number) => {
      const a = inset;
      const b = PLATE - inset;
      ctx.beginPath();
      ctx.moveTo(a + radius, a);
      ctx.arcTo(b, a, b, b, radius);
      ctx.arcTo(b, b, a, b, radius);
      ctx.arcTo(a, b, a, a, radius);
      ctx.arcTo(a, a, b, a, radius);
      ctx.closePath();
    };
    rounded(0, PLATE_CORNER);
    ctx.fillStyle = luminance(color) > 0.25 ? '#14181F' : '#ffffff';
    ctx.fill();
    rounded(PLATE_EDGE, PLATE_CORNER - PLATE_EDGE);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

/** Puts on the map the plates of the colours its lines are in. */
function addPlates(map: MapLibreMap, content: MapContent) {
  const colors = content.lines.filter((l) => l.label).map((l) => l.color);
  if (content.expressways?.length) colors.push(VR_VIOLET);
  for (const color of colors) {
    const id = plateId(color);
    if (map.hasImage(id)) continue;
    const image = plateImage(color);
    if (!image) continue;
    const mid = PLATE / 2;
    map.addImage(id, image, {
      pixelRatio: 2,
      // Only the straight middle of each side stretches; the text goes inside the edge.
      stretchX: [[PLATE_CORNER, PLATE - PLATE_CORNER]],
      stretchY: [[PLATE_CORNER, PLATE - PLATE_CORNER]],
      content: [mid - 4, mid - 4, mid + 4, mid + 4],
    });
  }
}

/** A step of a walk: a white dot in a bright blue ring, on any map. */
function walkDotImage(color = '#1E6FFF'): ImageData | undefined {
  return canvasImage(24, 24, (ctx) => {
    ctx.beginPath();
    ctx.arc(12, 12, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
  });
}

/** The steps of a walk in its colour, one image for each colour of walk. */
const walkDotId = (color: string) => `mb-walk-dot-${color.replace('#', '').toLowerCase()}`;

/** Puts on the map the steps of the colours its walks are in. */
function addWalkDots(map: MapLibreMap, content: MapContent) {
  for (const l of content.lines) {
    if (!l.dashed || map.hasImage(walkDotId(l.color))) continue;
    const image = walkDotImage(l.color);
    if (image) map.addImage(walkDotId(l.color), image, { pixelRatio: 2 });
  }
}

/** Puts on the map the dots of the places' kinds and the big supermarkets' signs, each once. */
async function addPoiImages(map: MapLibreMap, pois: readonly Poi[]) {
  for (const category of new Set(pois.map((p) => p.category))) {
    if (map.hasImage(poiImageId(category))) continue;
    const image = await poiImage(category);
    if (image && !map.hasImage(poiImageId(category)))
      map.addImage(poiImageId(category), image, { pixelRatio: 2 });
  }
  for (const pingo of [false, true]) {
    const id = bigStoreImageId({ name: pingo ? 'Pingo Doce' : 'Continente' });
    if (map.hasImage(id) || !pois.some((p) => p.big)) continue;
    const image = bigStoreImage(pingo);
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
}

/** A place's dot (a big supermarket's sign) and the colour its name is written in. */
const poiLook = (p: Poi) =>
  p.big
    ? { image: bigStoreImageId(p), color: '#202124' }
    : { image: poiImageId(p.category), color: POI_LOOK[p.category].color };

/** Puts the places of the kind chosen on the map, its dot drawn once. */
async function applyPois(map: MapLibreMap, pois: readonly Poi[]) {
  await addPoiImages(map, pois);
  (map.getSource('mb-pois') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: pois.map((p, i) => ({
      type: 'Feature',
      properties: { i, image: poiLook(p).image, name: p.name, color: '#3c4043', big: !!p.big },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  });
}

/**
 * Every place of everyday life close in, as a maps app shows them along the streets: the big
 * supermarkets and the sights from afar, then where to eat, drink and sleep, then the shops
 * and services, the car parks and toilets last; their names closer in. Each rank a layer of
 * its own, the more important over (and so placed before) the rest.
 */
const ALL_POI_ZOOMS: readonly [rank: number, minzoom: number][] = [
  [4, 17.5],
  [3, 16],
  [2, 15.2],
  [1, 14.5],
  [0, 13],
];
/** From this zoom the names of the everyday places are written beside them. */
const POI_NAMES_FROM = 16.5;
const allPoiLayerId = (rank: number) => `mb-allpoi-${rank}`;
export const ALL_POI_LAYERS = ALL_POI_ZOOMS.map(([rank]) => allPoiLayerId(rank));

function addAllPoiLayers(map: MapLibreMap) {
  map.addSource('mb-allpois', { type: 'geojson', data: EMPTY });
  for (const [rank, minzoom] of ALL_POI_ZOOMS) {
    const big = rank === 0;
    map.addLayer({
      id: allPoiLayerId(rank),
      type: 'symbol',
      source: 'mb-allpois',
      minzoom,
      filter: ['==', ['get', 'rank'], rank],
      layout: {
        'icon-image': ['get', 'image'],
        'icon-size': big
          ? ['interpolate', ['linear'], ['zoom'], 13, 0.55, 16, 0.8]
          : ['interpolate', ['linear'], ['zoom'], minzoom, 0.5, 18, 0.72],
        'icon-padding': 1,
        'text-field':
          rank <= 1 ? ['get', 'name'] : ['step', ['zoom'], '', POI_NAMES_FROM, ['get', 'name']],
        'text-font': [big ? 'Noto Sans Bold' : 'Noto Sans Regular'],
        'text-size': big ? 12 : 11,
        'text-anchor': 'left',
        'text-offset': [big ? 1.2 : 0.9, 0],
        'text-max-width': 8,
        'text-optional': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    });
  }
}

/**
 * Puts every place of everyday life on the map (none while a kind of place is chosen on the
 * "Places" button: those alone then, as a maps app shows what was asked for).
 */
async function applyAllPois(map: MapLibreMap, pois: readonly Poi[] | undefined, on: boolean) {
  const source = map.getSource('mb-allpois') as GeoJSONSource | undefined;
  if (!source) return;
  if (pois && on) await addPoiImages(map, pois);
  source.setData({
    type: 'FeatureCollection',
    features:
      pois && on
        ? pois.map((p, i) => ({
            type: 'Feature',
            properties: { i, name: p.name, rank: poiRank(p), ...poiLook(p) },
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          }))
        : [],
  });
  hideCoveredBasePois(map, Boolean(pois && on));
}

/**
 * The map style's own shops, cafés, hotels… (OpenMapTiles classes and subclasses) that the
 * app's places draw too: hidden while those are on, so none shows twice. Viewpoints, schools,
 * stadiums and the like stay.
 */
export const COVERED_POI_CLASSES = [
  'shop',
  'grocery',
  'restaurant',
  'fast_food',
  'cafe',
  'ice_cream',
  'bar',
  'beer',
  'alcohol_shop',
  'bakery',
  'clothing_store',
  'lodging',
  'hospital',
  'pharmacy',
  'dentist',
  'doctors',
  'bank',
  'atm',
  'fuel',
  'car',
  'laundry',
  'post',
  'library',
  'museum',
  'theatre',
  'cinema',
  'art_gallery',
  'music',
  'place_of_worship',
  'town_hall',
  'police',
  'hairdresser',
  'beauty',
  'castle',
  'zoo',
  'aquarium',
];

function hideCoveredBasePois(map: MapLibreMap, hide: boolean) {
  const style = map.getStyle();
  if (!style) return;
  const covered = [
    'any',
    ['match', ['get', 'class'], COVERED_POI_CLASSES, true, false],
    ['match', ['get', 'subclass'], [...COVERED_POI_CLASSES, 'attraction'], true, false],
  ];
  for (const id of placeLayerIds(style)) {
    // The style's own filter, kept aside the first time.
    const own = (baseFilters.get(map) ?? baseFilters.set(map, new Map()).get(map)!) as Map<
      string,
      unknown
    >;
    if (!own.has(id)) own.set(id, map.getFilter(id) ?? null);
    const base = own.get(id) as FilterSpecification | null;
    const filter = hide ? (base ? ['all', base, ['!', covered]] : ['!', covered]) : base;
    map.setFilter(id, filter as FilterSpecification | null);
  }
}

/** Each map's style filters of its places, before the app's places hid some (per style). */
const baseFilters = new WeakMap<MapLibreMap, Map<string, unknown>>();

/** Puts the buses where they are now on the map, each look drawn once. */
function applyBuses(map: MapLibreMap, buses: readonly LiveBus[] | undefined) {
  const source = map.getSource('mb-buses') as GeoJSONSource | undefined;
  if (!source) return;
  for (const b of buses ?? []) {
    const id = busImageId(b);
    if (map.hasImage(id)) continue;
    const image = busImage(b);
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
  source.setData({
    type: 'FeatureCollection',
    features: (buses ?? []).map((b) => ({
      type: 'Feature',
      properties: { image: busImageId(b), aboard: Boolean(b.aboard) },
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
    })),
  });
}

function addOverlay(map: MapLibreMap, base: BaseLayer) {
  if (map.getSource('mb-lines')) return;
  const images: [string, () => ImageData | undefined][] = [
    ['mb-arrow', arrowImage],
    ['mb-flag-start', () => flagImage(false)],
    ['mb-flag-finish', () => flagImage(true)],
    ['mb-walk-dot', walkDotImage],
  ];
  for (const [id, make] of images) {
    if (map.hasImage(id)) continue;
    const image = make();
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
  // The shops, cafés and sights along the streets, under all the app draws.
  addAllPoiLayers(map);
  // Every stop and line, under whatever the screen draws.
  map.addSource('mb-net-lines', { type: 'geojson', data: EMPTY });
  map.addSource('mb-net-stops', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'mb-net-line',
    type: 'line',
    source: 'mb-net-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 2.2, 16, 4],
      'line-opacity': 0.7,
    },
  });
  // A wide band along each line, invisible, for a finger to find it by.
  map.addLayer({
    id: 'mb-net-line-hit',
    type: 'line',
    source: 'mb-net-lines',
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH, 'line-opacity': 0 },
  });
  map.addLayer({
    id: 'mb-net-stop',
    type: 'circle',
    source: 'mb-net-stops',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 12, 2.6, 14, 4, 17, 7],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#002F85',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
    },
  });
  // The hiking trails: dashed in the red of their waymarks on a white edge, a tap opens one;
  // where each starts, a dot in its red with its number from closer in.
  map.addSource('mb-trails', { type: 'geojson', data: EMPTY });
  map.addSource('mb-trail-heads', { type: 'geojson', data: EMPTY });
  const trailWidth = (k: number) =>
    [
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      1.4 * k,
      12,
      2.4 * k,
      15,
      3.6 * k,
    ] as unknown as number;
  map.addLayer({
    id: 'mb-trail-casing',
    type: 'line',
    source: 'mb-trails',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#ffffff',
      // Zoom only at the top of an expression: the edge's own stops.
      'line-width': trailWidth(2.2),
      'line-opacity': 0.75,
    },
  });
  map.addLayer({
    id: 'mb-trail',
    type: 'line',
    source: 'mb-trails',
    layout: { 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': TRAIL_RED,
      'line-width': trailWidth(1),
      'line-dasharray': [2, 1.2],
    },
  });
  map.addLayer({
    id: 'mb-trail-hit',
    type: 'line',
    source: 'mb-trails',
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH, 'line-opacity': 0 },
  });
  map.addLayer({
    id: 'mb-trail-head',
    type: 'circle',
    source: 'mb-trail-heads',
    layout: { visibility: 'none' },
    // Far out only the official PR trails' starts.
    filter: HEADS_FILTER,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 13, 6],
      'circle-color': TRAIL_RED,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  // The places of the kind chosen on the "Places" button, under the ways shown.
  map.addSource('mb-pois', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'mb-poi',
    type: 'symbol',
    source: 'mb-pois',
    layout: {
      'icon-image': ['get', 'image'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 14, 0.8, 17, 1],
      'icon-padding': 1,
      // Where they crowd (far out), some step aside, the big supermarkets last; closer in,
      // all of them.
      'icon-allow-overlap': false,
      'symbol-sort-key': ['case', ['get', 'big'], 0, 1],
    },
  });
  map.addSource('mb-lines', { type: 'geojson', data: EMPTY });
  map.addSource('mb-points', { type: 'geojson', data: EMPTY });
  // Where a bus shown runs on the Via Rápida: a violet band along the road, under its line.
  map.addSource('mb-expressways', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'mb-expressway',
    type: 'line',
    source: 'mb-expressways',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': VR_VIOLET,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 16, 15, 26],
      'line-opacity': 0.8,
    },
  });
  map.addLayer({
    id: 'mb-line-casing',
    type: 'line',
    source: 'mb-lines',
    filter: ['!', ['get', 'dashed']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'casing'],
      // The edge in proportion to the line: half its width again.
      'line-width': ['*', ['get', 'width'], 1.5],
      'line-opacity': ['case', ['get', 'faint'], 0.35, 0.9],
      'line-offset': sideOffset,
    },
  });
  map.addLayer({
    id: 'mb-line',
    type: 'line',
    source: 'mb-lines',
    filter: ['!', ['get', 'dashed']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'width'],
      'line-opacity': ['case', ['get', 'faint'], 0.5, 1],
      'line-offset': sideOffset,
    },
  });
  map.addLayer({
    id: 'mb-line-hit',
    type: 'line',
    source: 'mb-lines',
    // A bus's line, or one the screen takes taps on (another trail met on a trail's way).
    filter: ['any', ['>=', ['get', 'route'], 0], ['!=', ['get', 'key'], '']],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH, 'line-opacity': 0 },
  });
  // A walk: a faint band of its colour along the pavements with small bright dots close
  // together on it, ringed in its colour; a walk with a view, along the sea, on a wider band.
  const view: ExpressionSpecification = ['get', 'view'];
  map.addLayer({
    id: 'mb-walk',
    type: 'line',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['case', view, 3.5, 2.5], 17, 5],
      'line-opacity': base === 'satellite' ? 0.75 : ['case', view, 0.7, 0.5],
    },
  });
  map.addLayer({
    id: 'mb-walk-dots',
    type: 'symbol',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 5, 17, 8],
      'icon-image': ['get', 'walkDot'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.35, 17, 0.58],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
  });
  // Arrows the way the bus goes, on the line (and as far apart as the two ways of a line).
  for (const side of [false, true]) {
    map.addLayer({
      id: side ? 'mb-line-arrow-side' : 'mb-line-arrow',
      type: 'symbol',
      source: 'mb-lines',
      minzoom: 10,
      filter: ['all', ['get', 'arrows'], side ? ['get', 'side'] : ['!', ['get', 'side']]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'icon-image': 'mb-arrow',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        ...(side && { 'icon-offset': sideArrows }),
      },
    });
  }
  // Where the trip starts and where the person is: neon turquoise, glowing.
  map.addLayer({
    id: 'mb-point-glow',
    type: 'circle',
    source: 'mb-points',
    filter: ['match', ['get', 'kind'], ['origin', 'user'], true, false],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 16, 20],
      'circle-color': WAY_TURQUOISE,
      'circle-opacity': 0.45,
      'circle-blur': 0.9,
    },
  });
  map.addLayer({
    id: 'mb-point',
    type: 'circle',
    source: 'mb-points',
    // The destination is the yellow pin (a marker), not a circle; a stop on a road both ways
    // of its line share is a dot on its way's side (below).
    filter: ['all', ['!=', ['get', 'kind'], 'destination'], ['<', ['get', 'heading'], 0]],
    // Where one bus is left and the next boarded at the same stop: a red dot in a blue ring.
    layout: { 'circle-sort-key': ['match', ['get', 'kind'], 'board', 2, 'alight', 1, 0] },
    paint: {
      // The stops along a line are dots that grow as the map comes closer: zoomed out,
      // a line with eighty stops would be a string of beads hiding the line itself.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          0,
          6.5,
        ],
        11.5,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          1.8,
          6.5,
        ],
        13,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          3,
          6.5,
        ],
        15,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          4.5,
          6.5,
        ],
      ],
      'circle-color': [
        'match',
        ['get', 'kind'],
        ['user', 'origin'],
        WAY_TURQUOISE,
        'bus',
        ['get', 'color'],
        ['get', 'fill'],
      ],
      'circle-stroke-color': [
        'match',
        ['get', 'kind'],
        ['user', 'origin', 'bus'],
        '#ffffff',
        ['get', 'color'],
      ],
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['match', ['get', 'kind'], 'stop', 0, 3],
        11.5,
        ['match', ['get', 'kind'], 'stop', 1, 3],
        14,
        ['match', ['get', 'kind'], 'stop', 2, 3],
      ],
    },
  });
  // A stop on a road both ways of its line share: on its way's side of it, as its line is,
  // turned the way its bus goes so that its right is that side.
  map.addLayer({
    id: 'mb-stop-side',
    type: 'symbol',
    source: 'mb-points',
    filter: ['>=', ['get', 'heading'], 0],
    layout: {
      'icon-image': ['get', 'dot'],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        ...DOT_ZOOMS.flatMap((z) => [z, stopScale(z)]),
      ] as unknown as number,
      // The offset is scaled with the dot: so much more where the dot is small.
      'icon-offset': [
        'interpolate',
        ['linear'],
        ['zoom'],
        ...DOT_ZOOMS.flatMap((z) => {
          const scale = stopScale(z);
          return [z, ['literal', [scale > 0 ? (WAY_WIDTH * LANE_APART) / scale : 0, 0]]];
        }),
      ] as unknown as [number, number],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  // The flags where each bus is boarded and left, standing on their stops.
  map.addLayer({
    id: 'mb-flag',
    type: 'symbol',
    source: 'mb-points',
    filter: ['match', ['get', 'kind'], ['board', 'alight'], true, false],
    layout: {
      'icon-image': ['get', 'flag'],
      'icon-anchor': ['match', ['get', 'kind'], 'board', 'bottom-left', 'bottom-right'],
      // The pole's foot on the stop, the cloth up and to the side; where a bus is left and
      // the next boarded at one place, the two poles a few pixels apart.
      'icon-offset': [
        'match',
        ['get', 'kind'],
        'board',
        ['case', ['get', 'pair'], ['literal', [1, 2]], ['literal', [-3, 2]]],
        ['case', ['get', 'pair'], ['literal', [-1, 2]], ['literal', [3, 2]]],
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 14, 1.1, 17, 1.35],
      'icon-allow-overlap': true,
      // Shown whatever is there, and the numbers along the lines keep clear of them.
      'icon-ignore-placement': false,
      'symbol-sort-key': ['match', ['get', 'kind'], 'board', 2, 1],
    },
  });
  // The buses of the way where they are now, over everything else.
  map.addSource('mb-buses', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'mb-bus',
    type: 'symbol',
    source: 'mb-buses',
    layout: {
      'icon-image': ['get', 'image'],
      // The bus you are in a size larger: it stands out on its own line.
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case', ['get', 'aboard'], 1.05, 0.8],
        15,
        ['case', ['get', 'aboard'], 1.45, 1.1],
      ],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['case', ['get', 'aboard'], 2, 1],
    },
  });
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'mb-trail-label',
      type: 'symbol',
      source: 'mb-trail-heads',
      minzoom: 11,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
        'text-offset': [0, 1],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 9,
      },
      paint: { 'text-color': TRAIL_RED, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    });
    map.addLayer({
      id: 'mb-poi-label',
      type: 'symbol',
      source: 'mb-pois',
      minzoom: 12,
      layout: {
        // A Continente's or a Pingo Doce's name from afar, the others' close in.
        'text-field': [
          'step',
          ['zoom'],
          ['case', ['get', 'big'], ['get', 'name'], ''],
          15.5,
          ['get', 'name'],
        ],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
        // The names never push the places' dots off the map (they are drawn above them).
        'text-ignore-placement': true,
        'text-font': ['Noto Sans Regular'],
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });
    map.addLayer({
      id: 'mb-net-label',
      type: 'symbol',
      source: 'mb-net-stops',
      minzoom: 15.5,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#002F85', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    // The number of the bus along its line on a plate of its colour, as in the list:
    // "this line is the 045, that one the 207". Under the flags, which it keeps clear of;
    // level whichever way the line runs, standing up when the map is tilted, and smaller
    // with the whole island in view.
    map.addLayer(
      {
        id: 'mb-line-label',
        type: 'symbol',
        source: 'mb-lines',
        filter: ['!=', ['get', 'label'], ''],
        layout: {
          'symbol-placement': 'line',
          // Closer together from afar, so each bus of the way has its plate on the island.
          'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 9, 70, 12, 140, 14, 200],
          // Level plates may sit on a winding mountain road (the default asks for a straight one).
          'text-max-angle': 180,
          // Stop names and flags do not push the number off; they keep clear of it instead.
          'text-allow-overlap': true,
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 11, 15, 12],
          'text-font': ['Noto Sans Bold'],
          'text-rotation-alignment': 'viewport',
          'text-pitch-alignment': 'viewport',
          'text-padding': 4,
          'icon-image': ['get', 'plate'],
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1, 4, 0, 4],
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
        },
        paint: { 'text-color': ['get', 'ink'] },
      },
      'mb-flag',
    );
    // Its name along the band, on a violet plate: "here the bus takes the Via Rápida".
    map.addLayer(
      {
        id: 'mb-expressway-label',
        type: 'symbol',
        source: 'mb-expressways',
        minzoom: 9.5,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 10, 160, 13, 260, 15, 360],
          'text-field': 'Via Rápida',
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 11.5],
          'text-font': ['Noto Sans Bold'],
          'text-max-angle': 180,
          'text-rotation-alignment': 'viewport',
          'text-pitch-alignment': 'viewport',
          'text-padding': 6,
          'icon-image': plateId(VR_VIOLET),
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1, 5, 0, 5],
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
        },
        paint: { 'text-color': '#ffffff' },
      },
      'mb-line-label',
    );
    map.addLayer({
      id: 'mb-label',
      type: 'symbol',
      source: 'mb-points',
      filter: ['all', ['!=', ['get', 'label'], ''], ['!=', ['get', 'kind'], 'stop']],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        // Two names at one place: one to each side, under its own flag.
        'text-offset': [
          'case',
          ['!', ['get', 'apart']],
          ['literal', [0, 1.1]],
          ['==', ['get', 'kind'], 'board'],
          ['literal', [0.3, 1.1]],
          ['literal', [-0.3, 1.1]],
        ],
        'text-anchor': [
          'case',
          ['!', ['get', 'apart']],
          'top',
          ['==', ['get', 'kind'], 'board'],
          'top-left',
          'top-right',
        ],
        'text-max-width': 10,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#14181F', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }
}

const TRANSIT_LAYERS = ['mb-net-line', 'mb-net-line-hit', 'mb-net-stop', 'mb-net-label'];
const TRAIL_LAYERS = [
  'mb-trail-casing',
  'mb-trail',
  'mb-trail-hit',
  'mb-trail-head',
  'mb-trail-label',
];

/** What a GeoJSON source is given. */
type GeoJsonData = Parameters<GeoJSONSource['setData']>[0];
type TrailData = { lines: GeoJsonData; heads: GeoJsonData };

/** The trails as GeoJSON: their lines, and where each starts with its number. */
async function trailGeoJson(): Promise<TrailData> {
  const trails = await loadTrails();
  return {
    lines: {
      type: 'FeatureCollection',
      features: trails.flatMap((t) =>
        trailLines(t).map((line) => ({
          type: 'Feature' as const,
          properties: { id: t.id },
          geometry: { type: 'LineString' as const, coordinates: line.map((p) => [p.lon, p.lat]) },
        })),
      ),
    },
    heads: {
      type: 'FeatureCollection',
      features: trails.map((t) => ({
        type: 'Feature' as const,
        properties: { id: t.id, label: t.ref ?? t.name, pr: t.kind === 'pr' },
        geometry: { type: 'Point' as const, coordinates: [t.start[1], t.start[0]] },
      })),
    },
  };
}

/** Where the trails start, far out only the official PR trails'. */
const HEADS_FILTER: ExpressionSpecification = ['any', ['get', 'pr'], ['>=', ['zoom'], 11.5]];

/** Puts the hiking trails on the map, or hides them; `only`: just these. */
function applyTrails(
  map: MapLibreMap,
  data: TrailData | undefined,
  on: boolean,
  only?: readonly string[],
) {
  if (!map.getSource('mb-trails')) return;
  if (data) {
    (map.getSource('mb-trails') as GeoJSONSource).setData(data.lines);
    (map.getSource('mb-trail-heads') as GeoJSONSource).setData(data.heads);
  }
  const mine: ExpressionSpecification | undefined = only
    ? ['in', ['get', 'id'], ['literal', [...only]]]
    : undefined;
  for (const id of TRAIL_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    const base = id === 'mb-trail-head' ? HEADS_FILTER : undefined;
    map.setFilter(id, mine && base ? ['all', mine, base] : (mine ?? base ?? null));
  }
}
/** How wide a line is to a finger (px): easy to tap on a phone. */
const HIT_WIDTH = 22;

/**
 * The different lines among tapped line features, each number once (its ways and
 * variants are the same bus to the person tapping; the card tells which way), in the
 * order of their numbers.
 */
function tappedLines(
  features: { layer: { id: string }; properties: Record<string, unknown> | null }[],
  net: Network | undefined,
): { route: number; pattern?: number; board?: number }[] {
  const out = new Map<string, { route: number; pattern?: number; board?: number }>();
  for (const f of features) {
    if (f.layer.id !== 'mb-line-hit' && f.layer.id !== 'mb-net-line-hit') continue;
    const route = Number(f.properties?.route ?? -1);
    if (!(route >= 0)) continue;
    const pattern = Number(f.properties?.pattern ?? -1);
    const board = Number(f.properties?.board ?? -1);
    const key = net?.routes[route]?.short ?? String(route);
    if (out.has(key)) continue;
    out.set(key, {
      route,
      ...(pattern >= 0 ? { pattern } : {}),
      ...(board >= 0 ? { board } : {}),
    });
  }
  const number = (r: number) => net?.routes[r]?.short ?? '';
  return [...out.values()].sort((a, b) =>
    number(a.route).localeCompare(number(b.route), undefined, { numeric: true }),
  );
}

type TransitData = ReturnType<typeof transitGeoJson>;

/** Puts every stop and line on the map, or hides them. */
function applyTransit(map: MapLibreMap, data: TransitData | undefined, on: boolean) {
  if (!map.getSource('mb-net-lines')) return;
  if (data) {
    (map.getSource('mb-net-lines') as GeoJSONSource).setData(data.lines);
    (map.getSource('mb-net-stops') as GeoJSONSource).setData(data.stops);
  }
  for (const id of TRANSIT_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

/** The origin and destination of the planner as they are in the address. */
function plannedPlaces(net: Network | undefined, myLocation: string) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (!net || !path.startsWith('plan')) return {};
  const q = new URLSearchParams(query);
  return {
    from: decodePlace(net, q.get('from'), myLocation),
    to: decodePlace(net, q.get('to'), myLocation),
  };
}

export default function MapView({ className }: { className?: string }) {
  const { content, pick, pickArea, pickStart, setPick, spotlight, buses } =
    useContext(MapContentContext);
  const busesRef = useRef(buses);
  busesRef.current = buses;
  const { settings, setSettings, data } = useApp();
  const t = useI18n();
  const net = data.status === 'ready' ? data.net : undefined;
  const plannerRef = useRef(data.status === 'ready' ? data.planner : undefined);
  plannerRef.current = data.status === 'ready' ? data.planner : undefined;
  // The map's handlers are set up once; they read these.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const netRef = useRef(net);
  netRef.current = net;
  const tRef = useRef(t);
  tRef.current = t;
  const layers = settings.map;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const fitted = useRef<Fit>({});
  const [ready, setReady] = useState(false);
  const styleLoaded = useRef(false);
  const shownStyle = useRef(`${layers.base}:fallback`);
  const [picked, setPicked] = useState<PickedPlace | undefined>();
  // A place's photo opened large.
  const [bigPhoto, setBigPhoto] = useState<PlacePhoto | undefined>();
  // The "Places" button: its list of kinds open, the kind shown on the map, the places.
  const [placesOpen, setPlacesOpen] = useState(false);
  const [poiCategory, setPoiCategory] = useState<PoiCategory | undefined>();
  const [pois, setPois] = useState<Poi[] | undefined>();
  const shownPois = useMemo(
    () => (poiCategory && pois ? ofCategory(pois, poiCategory) : []),
    [poiCategory, pois],
  );
  const poisRef = useRef<Poi[]>([]);
  poisRef.current = shownPois;
  // Every place along the streets once the map comes close to them (with the map's places
  // on, and not while a kind of place is chosen or a point is being picked).
  const [nearStreets, setNearStreets] = useState(false);
  const allPoisOn = layers.places && !poiCategory && !pick;
  const allPoisRef = useRef<{ pois?: Poi[]; on: boolean }>({ on: false });
  allPoisRef.current = { pois, on: allPoisOn };
  const [note, setNote] = useState<LineNote | undefined>();
  // A line tapped: its card, or a short list when several lie under the finger.
  const [linePick, setLinePick] = useState<LinePick | undefined>();
  const [lineChoice, setLineChoice] = useState<
    { routes: { route: number; pattern?: number; board?: number }[]; at: LatLon } | undefined
  >();
  // The phone's back button closes a line's card (or the choice of lines) first.
  useBack(
    useCallback(() => {
      if (!linePick && !lineChoice) return false;
      setLinePick(undefined);
      setLineChoice(undefined);
      return true;
    }, [linePick, lineChoice]),
  );
  const transitRef = useRef<{ data?: TransitData; on: boolean }>({ on: false });
  // The hiking trails: on by the button or layers (and while the trails tab is open).
  const trailsRef = useRef<{ data?: TrailData; on: boolean; only?: readonly string[] }>({
    on: false,
  });
  // A way shown (a bus journey, a walk, a drive, a trip under way), the trails step aside:
  // one met on the way would lead the walker off it, up the hill. The trails button brings
  // them back for that way; a trail's own page shows them as ever.
  const [trailsWith, setTrailsWith] = useState<string | undefined>();
  const wayShown = content.focus !== undefined && !content.focus.startsWith('hike:');
  // Each way its own: trails asked for over one walk are not over the next.
  const wayKey = wayShown ? `${content.focus}|${content.fitKey ?? ''}` : undefined;
  const trailsOn = layers.trails && (!wayShown || trailsWith === wayKey);
  // Back to the island, the next way shown starts without them again.
  useEffect(() => {
    if (!wayShown) setTrailsWith(undefined);
  }, [wayShown]);
  const trailIds = content.trailIds;
  const [trailData, setTrailData] = useState<TrailData | undefined>();
  useEffect(() => {
    if (!trailsOn || trailData) return;
    let cancelled = false;
    void trailGeoJson().then((d) => !cancelled && setTrailData(d));
    return () => {
      cancelled = true;
    };
  }, [trailsOn, trailData]);
  useEffect(() => {
    trailsRef.current = { data: trailData, on: trailsOn, only: trailIds };
    const map = mapRef.current;
    if (map && ready) applyTrails(map, trailData, trailsOn, trailIds);
  }, [trailData, trailsOn, trailIds, ready]);
  // A chosen route is shown alone: every stop and line step aside until asked for again.
  const [transitWith, setTransitWith] = useState<string | undefined>();
  const transitOn = layers.transit && (!content.focus || transitWith === content.focus);
  const setTransit = (on: boolean) => {
    if (on && content.focus) setTransitWith(content.focus);
    setSettings({ map: { ...layers, transit: on } });
  };
  // Choosing a place: the point under the pin, its name, and whether the map is moving.
  const [center, setCenter] = useState<LatLon | undefined>();
  const [moving, setMoving] = useState(false);
  const pickedStop = useRef<PickedStop | undefined>(undefined);

  // Create the map once; start with the tile-free style so the island shows at once.
  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: fallbackStyle(layersRef.current.base),
      center: MADEIRA_CENTER,
      zoom: 9.2,
      maxPitch: 70,
      maxBounds: [
        [-18.2, 32.0],
        [-15.6, 33.5],
      ],
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // While developing, the map for the browser console (to put the camera where a screenshot was).
    if (import.meta.env.DEV) (window as unknown as { mbMap?: MapLibreMap }).mbMap = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    const locate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      // Its own dot stands where the GPS says, often in a house beside the street: ours
      // stands on the pavement (on the road, going by bus), see `Snapper`.
      showUserLocation: false,
      showAccuracyCircle: false,
    });
    const me = document.createElement('div');
    me.className = 'maplibregl-user-location-dot';
    const meMarker = new Marker({ element: me });
    let snapper: Snapper | undefined;
    let shownFix = 0;
    // Where the phone was found: a trail then starts at its nearer end.
    locate.on('geolocate', (p) => {
      const fix = {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        timestamp: p.timestamp,
      };
      rememberPosition(fix);
      const planner = plannerRef.current;
      if (planner) snapper ??= new Snapper(planner);
      const id = ++shownFix;
      void (snapper ? snapper.place({ ...fix, speed: p.coords.speed }) : Promise.resolve(fix)).then(
        (at) => {
          if (id !== shownFix) return;
          meMarker.setLngLat([at.lon, at.lat]);
          if (!me.isConnected) meMarker.addTo(map);
        },
      );
    });
    // Located no more (the button pressed off, or no location): no dot.
    const watching = () => (locate as unknown as { _watchState?: string })._watchState;
    locate.on('trackuserlocationend', () =>
      window.setTimeout(() => watching() === 'OFF' && meMarker.remove(), 0),
    );
    locate.on('error', () => meMarker.remove());
    // Its button pressed: the sheet over the map goes down, the place in full view.
    locate.on('trackuserlocationstart', () => window.dispatchEvent(new Event('mb-sheet-down')));
    map.addControl(locate, 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 90 }), 'bottom-right');
    const foldCredits = foldAttribution(map);
    map.on('dragstart', foldCredits);
    map.once('load', hideLaunch);
    map.on('style.load', () => {
      styleLoaded.current = true;
      baseFilters.delete(map);
      addOverlay(map, layersRef.current.base);
      applyDetails(map, layersRef.current);
      applyTransit(map, transitRef.current.data, transitRef.current.on);
      applyTrails(map, trailsRef.current.data, trailsRef.current.on, trailsRef.current.only);
      fitted.current = {};
      setReady(true);
      apply(map, contentRef.current, fitted);
      applyBuses(map, busesRef.current);
      void applyPois(map, poisRef.current);
      void applyAllPois(map, allPoisRef.current.pois, allPoisRef.current.on);
    });
    // Close to the streets the first time: their shops and cafés are loaded.
    const nearTheStreets = () => map.getZoom() >= 12.5 && setNearStreets(true);
    map.on('zoomend', nearTheStreets);
    map.once('load', nearTheStreets);
    map.on('click', (e: MapMouseEvent) => {
      releasePins(map);
      foldCredits();
      const box: [[number, number], [number, number]] = [
        [e.point.x - 8, e.point.y - 8],
        [e.point.x + 8, e.point.y + 8],
      ];
      const features = map.queryRenderedFeatures(box);
      const stop = features.find(
        (f) =>
          (f.layer.id === 'mb-point' ||
            f.layer.id === 'mb-stop-side' ||
            f.layer.id === 'mb-net-stop') &&
          f.properties?.stops,
      );
      if (pickRef.current) {
        // Choosing a place: the pin goes where the map was tapped (onto a stop, if one was).
        if (stop && stop.geometry.type === 'Point') {
          const [lon, lat] = stop.geometry.coordinates as [number, number];
          const stops = String(stop.properties.stops).split(',').map(Number);
          pickedStop.current = { lat, lon, stops, name: String(stop.properties.label ?? '') };
          map.easeTo({ center: [lon, lat], duration: 400 });
        } else {
          pickedStop.current = undefined;
          map.easeTo({ center: e.lngLat, duration: 400 });
        }
        return;
      }
      if (stop) {
        navigate('stop', { ids: String(stop.properties.stops) });
        return;
      }
      // The screen takes any tap (the weather: that spot's).
      const onMapTap = contentRef.current.onMapTap;
      if (onMapTap) {
        const named = features.find(
          (f) => (f.sourceLayer === 'poi' || f.sourceLayer === 'place') && f.properties?.name,
        );
        onMapTap({
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
          ...(named ? { name: String(named.properties.name) } : {}),
        });
        return;
      }
      // A line the screen takes taps on: another trail met on a trail's way, added to it.
      const keyed = features.find((f) => f.layer.id.startsWith('mb-line') && f.properties?.key);
      const onLine = contentRef.current.onLine;
      if (keyed && onLine) {
        setPicked(undefined);
        setNote(onLine(String(keyed.properties.key), false));
        return;
      }
      // Another trail met on a trail's way: its page.
      const branch = features.find((f) => f.layer.id.startsWith('mb-line') && f.properties?.href);
      if (branch) {
        navigate(String(branch.properties.href));
        return;
      }
      // A hiking trail or where it starts: its page.
      const trail = features.find(
        (f) =>
          (f.layer.id === 'mb-trail-hit' || f.layer.id === 'mb-trail-head') && f.properties?.id,
      );
      if (trail) {
        navigate(`hikes/${String(trail.properties.id)}`);
        return;
      }
      // A run of a line that goes its own way: when it runs.
      const run = features.find((f) => f.layer.id.startsWith('mb-line') && f.properties?.note);
      if (run) {
        setPicked(undefined);
        setLinePick(undefined);
        setLineChoice(undefined);
        setNote(JSON.parse(String(run.properties.note)) as LineNote);
        return;
      }
      setNote(undefined);
      // A bus's line: its card (which one, when several are under the finger).
      const lines = tappedLines(features, netRef.current);
      if (lines.length > 0) {
        const at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        setPicked(undefined);
        if (lines.length === 1) {
          const [only] = lines;
          setLineChoice(undefined);
          setLinePick({ route: only!.route, pattern: only!.pattern, stop: only!.board, at });
        } else {
          setLinePick(undefined);
          setLineChoice({ routes: lines, at });
        }
        return;
      }
      setLinePick(undefined);
      setLineChoice(undefined);
      // One of the places of the kind chosen: its card with its hours, phone and website.
      const mine = features.find((f) => f.layer.id === 'mb-poi');
      if (mine) {
        const p = poisRef.current[Number(mine.properties?.i)];
        if (p) {
          setPicked({ name: p.name, lat: p.lat, lon: p.lon, poi: p });
          return;
        }
      }
      // A shop or café along the street: the same card.
      const along = features.find((f) => ALL_POI_LAYERS.includes(f.layer.id));
      const every = allPoisRef.current.pois;
      if (along && every) {
        const p = every[Number(along.properties?.i)];
        if (p) {
          setPicked({ name: p.name, lat: p.lat, lon: p.lon, poi: p });
          return;
        }
      }
      const poi = features.find((f) => f.sourceLayer === 'poi' && f.properties?.name);
      if (poi && poi.geometry.type === 'Point') {
        const [lon, lat] = poi.geometry.coordinates as [number, number];
        setPicked({
          name: String(poi.properties.name),
          klass: poi.properties.class as string | undefined,
          subclass: poi.properties.subclass as string | undefined,
          lat,
          lon,
        });
        return;
      }
      setPicked(undefined);
    });
    // Long press / right click drops a pin anywhere.
    map.on('contextmenu', (e: MapMouseEvent) => {
      if (pickRef.current) return;
      // A finger held on a flag: the name of its place, which the map does not write.
      const flag = map
        .queryRenderedFeatures(
          [
            [e.point.x - 10, e.point.y - 10],
            [e.point.x + 10, e.point.y + 10],
          ],
          { layers: ['mb-flag'] },
        )
        .find((f) => f.properties?.name);
      if (flag) {
        setPicked(undefined);
        setNote({ title: String(flag.properties.name), lines: [] });
        return;
      }
      // A finger held on a line the screen takes: a trail added to a walk taken off again.
      const keyed = map
        .queryRenderedFeatures(
          [
            [e.point.x - 8, e.point.y - 8],
            [e.point.x + 8, e.point.y + 8],
          ],
          { layers: ['mb-line-hit'] },
        )
        .find((f) => f.properties?.key);
      const onLine = contentRef.current.onLine;
      if (keyed && onLine) {
        setPicked(undefined);
        setNote(onLine(String(keyed.properties.key), true));
        return;
      }
      const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      setNote(undefined);
      // The screen takes any spot (the weather: that spot's), held as tapped.
      const onMapTap = contentRef.current.onMapTap;
      if (onMapTap) {
        setPicked(undefined);
        onMapTap(p);
        return;
      }
      setPicked({ name: pointName(netRef.current, p, tRef.current), ...p });
    });
    map.on('movestart', (e) => {
      // A drag, a pinch or a wheel: the reader looks elsewhere now.
      if ((e as { originalEvent?: Event }).originalEvent) fitted.current.moved = true;
      if (pickRef.current) setMoving(true);
    });
    map.on('moveend', () => {
      setMoving(false);
      if (!pickRef.current) return;
      const c = map.getCenter();
      setCenter({ lat: c.lat, lon: c.lng });
    });
    for (const id of [
      'mb-point',
      'mb-stop-side',
      'mb-net-stop',
      'mb-line-hit',
      'mb-net-line-hit',
      'mb-trail-hit',
      'mb-trail-head',
    ]) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
    // The sheet over the map on a phone, pulled up and down: the buttons it reaches step aside.
    const covered = () => hideCovered(map);
    const sheet = new ResizeObserver(covered);
    const panel = document.querySelector('.panel');
    if (panel) sheet.observe(panel);
    const ro = new ResizeObserver(() => {
      covered();
      map.resize();
      // A route fitted while the map was another size (still loading, a sheet opening) stays in view.
      const { bounds, moved } = fitted.current;
      if (bounds && !moved && !pickRef.current) fitTo(map, bounds, 0);
    });
    ro.observe(container.current);
    // The sheet over the map on a phone came to rest at another height.
    const onInset = () => {
      const { bounds, moved } = fitted.current;
      if (bounds && !moved && !pickRef.current) fitTo(map, bounds, 300);
    };
    window.addEventListener('mb-map-inset', onInset);
    window.addEventListener('mb-map-inset', covered);
    return () => {
      window.removeEventListener('mb-map-inset', onInset);
      window.removeEventListener('mb-map-inset', covered);
      sheet.disconnect();
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Base layer: fetch the vector style (if reachable) and swap it in.
  useEffect(() => {
    let cancelled = false;
    loadStyle(layers.base).then(({ style, vector }) => {
      const map = mapRef.current;
      if (cancelled || !map) return;
      // The tile-free fallback for this base may already be on screen.
      const key = `${layers.base}:${vector ? 'vector' : 'fallback'}`;
      if (key === shownStyle.current) return;
      shownStyle.current = key;
      styleLoaded.current = false;
      map.setStyle(style as StyleSpecification, { diff: false });
    });
    return () => {
      cancelled = true;
    };
  }, [layers.base]);

  // Overlays toggle in place.
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && styleLoaded.current) applyDetails(map, layers);
  }, [layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && map.getSource('mb-lines')) apply(map, content, fitted);
  }, [content, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) applyBuses(map, buses);
  }, [buses, ready]);

  // The places of the kind chosen: loaded the first time, put on the map; when none is in
  // view, the map goes to the nearest.
  useEffect(() => {
    if ((!poiCategory && !nearStreets) || pois) return;
    let cancelled = false;
    void loadPois().then((p) => !cancelled && setPois(p));
    return () => {
      cancelled = true;
    };
  }, [poiCategory, nearStreets, pois]);
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) void applyAllPois(map, pois, allPoisOn);
  }, [pois, allPoisOn, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void applyPois(map, shownPois);
    if (shownPois.length === 0) return;
    const bounds = map.getBounds();
    if (shownPois.some((p) => bounds.contains([p.lon, p.lat]))) return;
    const c = map.getCenter();
    const centre = { lat: c.lat, lon: c.lng };
    const nearest = shownPois.reduce((a, b) =>
      haversine(centre, b) < haversine(centre, a) ? b : a,
    );
    map.easeTo({ center: [nearest.lon, nearest.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [shownPois, ready]);

  // Every stop and line: built the first time they are shown, put back after a style change.
  const transit = useMemo(
    () => (layers.transit && net ? transitGeoJson(net) : undefined),
    [layers.transit, net],
  );
  const shownTransit = useRef<TransitData | undefined>(undefined);
  useEffect(() => {
    transitRef.current = { data: transit ?? transitRef.current.data, on: transitOn };
    const map = mapRef.current;
    if (!map || !ready) return;
    // Hidden and shown again for a chosen route, the same stops need not be loaded again.
    applyTransit(map, transit !== shownTransit.current ? transit : undefined, transitOn);
    if (transit) shownTransit.current = transit;
  }, [transit, transitOn, ready]);

  // The yellow pin where the journey goes.
  const destination = content.points.find((p) => p.kind === 'destination');
  useMarker(mapRef, ready, destination);
  useSpotlightMarker(mapRef, ready, spotlight);
  // And on a place tapped or a pin dropped.
  useMarker(mapRef, ready, pick ? undefined : picked);
  // The photos of the places with a view where they are (not while a place is picked): the
  // camera button hides them. With the trails, the photos along them where each was taken:
  // the trails button's second step hides those, and only those.
  // With the trails on, the photos without their names (a finger held on one shows it),
  // but for the trail chosen's own.
  const trailPhotosOn = layers.trailPhotos;
  const allTrails = useTrails(trailsOn && trailPhotosOn);
  const hikeChosen = content.focus?.startsWith('hike:') ?? false;
  const photoSpots = useMemo(() => {
    const quiet = (s: ScenicSpot): ScenicSpot => ({ ...s, quiet: true });
    const spots = [
      ...(content.scenic ?? [])
        .filter((s) => (s.trail ? trailPhotosOn : layers.scenic))
        .map((s) => (trailsOn && !hikeChosen ? quiet(s) : s)),
      ...(trailsOn && trailPhotosOn && allTrails
        ? allTrails
            .filter((tr) => !trailIds || trailIds.includes(tr.id))
            .flatMap(trailPhotoSpots)
            .map(quiet)
        : []),
    ];
    if (spots.length === 0) return undefined;
    // Each once, as it came first.
    const byId = new Map<string, ScenicSpot>();
    for (const s of spots) if (!byId.has(s.id)) byId.set(s.id, s);
    return [...byId.values()];
  }, [layers.scenic, content.scenic, trailsOn, trailPhotosOn, hikeChosen, allTrails, trailIds]);
  // A kind of place shown from the "Places" button: its dots alone, not hidden under photos.
  useScenicMarkers(mapRef, ready, pick || poiCategory ? undefined : photoSpots);
  // The screen's little signs: the weather of each part of the island, the webcams.
  useBadgeMarkers(mapRef, ready, pick ? undefined : content.badges);
  // On the weather button, the sky and warmth in Funchal now and the worst warning's colour.
  const { forecasts } = useWeather();
  const warnings = useWarnings();
  const warning = warnings ? worstLevel(warnings) : undefined;
  const funchal = forecasts?.[0]?.now;
  // A run or a line tapped belongs to the map shown; another one, forget it.
  useEffect(() => {
    setNote(undefined);
    setLinePick(undefined);
    setLineChoice(undefined);
  }, [content]);

  // Choosing a place: start where the field's place is, or near the other end of the trip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pick) return;
    pickedStop.current = undefined;
    setPicked(undefined);
    const places = plannedPlaces(netRef.current, tRef.current.t('place.myLocation'));
    const own = pickStart ?? places[pick];
    const other = places[pick === 'from' ? 'to' : 'from'];
    if (pickArea) {
      // A village with nowhere in it to go to: all of it in view, the pin in its middle.
      const bounds = new LngLatBounds();
      for (const ring of pickArea.rings) for (const p of ring) bounds.extend([p.lon, p.lat]);
      map.fitBounds(bounds, { padding: 40, duration: 0 });
    } else if (own) map.jumpTo({ center: [own.lon, own.lat], zoom: Math.max(map.getZoom(), 16) });
    else if (other)
      map.jumpTo({ center: [other.lon, other.lat], zoom: Math.max(map.getZoom(), 14) });
    const c = map.getCenter();
    setCenter({ lat: c.lat, lon: c.lng });
    // The map grows to fill the screen while choosing.
    window.setTimeout(() => map.resize(), 50);
  }, [pick, pickArea, pickStart]);

  // Its bounds drawn while the pin is put down in it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: (pick ? (pickArea?.rings ?? []) : []).map((ring) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: ring.map((p) => [p.lon, p.lat]),
        },
      })),
    };
    const source = map.getSource('mb-pick-area') as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else if (data.features.length > 0) {
      map.addSource('mb-pick-area', { type: 'geojson', data });
      map.addLayer({
        id: 'mb-pick-area',
        type: 'line',
        source: 'mb-pick-area',
        paint: { 'line-color': '#0066dd', 'line-width': 3, 'line-dasharray': [2, 1.5] },
      });
    }
  }, [pick, pickArea, ready]);

  // Escape leaves "choose on the map".
  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPick(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick, setPick]);

  const onStop = pickedStop.current && center && haversine(pickedStop.current, center) < 8;
  const centerName = !center ? '' : onStop ? pickedStop.current!.name : pointName(net, center, t);
  const choose = () => {
    if (!pick || !center) return;
    const value =
      onStop && pickedStop.current
        ? encodePlace(pickedStop.current, net)
        : encodePlace({ ...center, name: centerName });
    setPick(undefined);
    pickInto(pick, value);
  };

  const pickedLabel = picked?.name || t.t('place.pin');
  // A viewpoint, a beach, a peak tapped: the view from there, when there is a photo of it.
  const pickedPhoto = useMemo(
    () => (picked && (picked.klass || picked.subclass) ? placePhoto(picked) : undefined),
    [picked],
  );
  return (
    <div className={`${className ?? ''} map-wrap${pick ? ' map-wrap--picking' : ''}`}>
      <div ref={container} className="map-canvas" role="region" aria-label={t.t('map.label')} />
      {pick && (
        <>
          <div className="map-pick" role="status">
            <MapPin size={18} aria-hidden />
            <span>
              {pickArea
                ? t.t('place.pickIn', { name: pickArea.name })
                : t.t(pick === 'from' ? 'place.pickFrom' : 'place.pickTo')}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => setPick(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <div className={`map-center-pin${moving ? ' map-center-pin--lifted' : ''}`} aria-hidden>
            <div className="map-pin" dangerouslySetInnerHTML={{ __html: PIN_SVG }} />
            <span className="map-center-pin__shadow" />
          </div>
          <div className="pick-card" role="dialog" aria-label={t.t('place.pickOnMap')}>
            <div className="pick-card__text">
              <div className="strong">{moving ? '…' : centerName}</div>
              {center && (
                <div className="muted small">
                  {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
                </div>
              )}
            </div>
            <button
              type="button"
              className="button button--primary"
              disabled={!center || moving}
              onClick={choose}
            >
              <Check size={16} /> {t.t('place.pickDone')}
            </button>
          </div>
        </>
      )}
      {/* Top left under the bar, as in a maps app: the layers, and every stop and line. */}
      <div className="map-tools">
        <LayerSwitcher
          value={{ ...layers, transit: transitOn }}
          onChange={(map) =>
            map.transit !== transitOn
              ? setTransit(map.transit)
              : setSettings({ map: { ...map, transit: layers.transit } })
          }
        />
        <button
          type="button"
          className="map-tool"
          aria-pressed={transitOn}
          aria-label={t.t('layers.transit')}
          title={t.t('layers.transit')}
          onClick={() => setTransit(!transitOn)}
        >
          <Bus size={18} />
        </button>
        {/* The trails with their photos, the trails alone, none: a tap each. */}
        <button
          type="button"
          className={`map-tool map-tool--trails${trailsOn && !trailPhotosOn ? ' map-tool--lines' : ''}`}
          aria-pressed={trailsOn}
          aria-label={t.t('layers.trails')}
          title={t.t(
            !trailsOn
              ? 'layers.trailsOff'
              : trailPhotosOn
                ? 'layers.trailsPhotos'
                : 'layers.trailsLines',
          )}
          data-step={!trailsOn ? 'off' : trailPhotosOn ? 'photos' : 'lines'}
          onClick={() => {
            // Over a way shown, the first tap brings the trails back for it.
            if (wayShown && trailsWith !== wayKey) {
              setTrailsWith(wayKey);
              if (layers.trails) return;
            }
            setSettings({ map: nextTrails(layers) });
          }}
        >
          <Signpost size={18} />
          {trailsOn && trailPhotosOn && (
            <Camera size={10} className="map-tool__badge" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className="map-tool"
          aria-pressed={layers.scenic}
          aria-label={t.t('layers.scenic')}
          title={t.t('layers.scenic')}
          onClick={() => setSettings({ map: { ...layers, scenic: !layers.scenic } })}
        >
          <Camera size={18} />
        </button>
        {/* The weather on the island, with the colour of any official warning. */}
        <button
          type="button"
          className={`map-tool map-tool--weather${warning ? ` map-tool--warn-${warning}` : ''}`}
          aria-label={t.t('layers.weather')}
          title={t.t('layers.weather')}
          onClick={() => navigate('weather')}
        >
          {funchal ? (
            <span className="map-tool__weather" aria-hidden>
              <SkyIcon code={funchal.code} day={funchal.day} size={20} />
              <span>{Math.round(funchal.temp)}°</span>
            </span>
          ) : (
            <CloudSun size={18} />
          )}
        </button>
        {/* The island's live webcams. */}
        <button
          type="button"
          className="map-tool"
          aria-label={t.t('layers.webcams')}
          title={t.t('layers.webcams')}
          onClick={() => navigate('webcams')}
        >
          <Video size={18} />
        </button>
        {/* The places of everyday life, as a maps app groups them: hospitals, hotels, cafés… */}
        <button
          type="button"
          className="map-tool"
          aria-pressed={poiCategory !== undefined}
          aria-expanded={placesOpen}
          aria-label={t.t('places.title')}
          title={t.t('places.title')}
          onClick={() => setPlacesOpen((o) => !o)}
        >
          <LayoutGrid size={18} />
        </button>
      </div>
      {poiCategory && !placesOpen && !pick && (
        <PlacesChip
          category={poiCategory}
          onOpen={() => setPlacesOpen(true)}
          onClear={() => setPoiCategory(undefined)}
        />
      )}
      {placesOpen && !pick && (
        <PlacesPicker
          chosen={poiCategory}
          onChoose={(c) => {
            setPoiCategory(c);
            setPlacesOpen(false);
            setPicked(undefined);
          }}
          onClose={() => setPlacesOpen(false)}
        />
      )}
      {note && !pick && (
        <div className="place-card" role="dialog" aria-label={note.title}>
          <div className="place-card__text">
            <div className="strong line-note__title">{note.title}</div>
            {note.lines.map((l) => (
              <div key={l} className="small">
                {l}
              </div>
            ))}
          </div>
          <div className="place-card__actions">
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => setNote(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {linePick && !pick && <LineCard pick={linePick} onClose={() => setLinePick(undefined)} />}
      {lineChoice && !pick && (
        <LineChooser
          routes={lineChoice.routes}
          onClose={() => setLineChoice(undefined)}
          onPick={(r) => {
            const board = lineChoice.routes.find(
              (x) => x.route === r.route && x.pattern === r.pattern,
            )?.board;
            setLinePick({ route: r.route, pattern: r.pattern, stop: board, at: lineChoice.at });
            setLineChoice(undefined);
          }}
        />
      )}
      {picked && !pick && (
        <div className="place-card" role="dialog" aria-label={pickedLabel}>
          {pickedPhoto && (
            <button
              type="button"
              className="place-card__photo"
              aria-label={t.t('place.photo', { name: pickedPhoto.title })}
              onClick={() => setBigPhoto(pickedPhoto)}
            >
              <img src={pickedPhoto.sm} alt="" width={480} height={320} />
            </button>
          )}
          <div className="place-card__text">
            <div className="strong">{pickedLabel}</div>
            <div className="muted small">
              {picked.poi
                ? poiName(picked.poi.category, settings.lang)
                : (poiLabel(settings.lang, picked.klass, picked.subclass) ??
                  `${picked.lat.toFixed(5)}, ${picked.lon.toFixed(5)}`)}
            </div>
            {picked.poi?.hours && (
              <div className="small place-card__line">
                <Clock size={13} aria-hidden /> {picked.poi.hours}
              </div>
            )}
            {(picked.poi?.phone || picked.poi?.web) && (
              <div className="small place-card__line">
                {picked.poi.phone && (
                  <a href={`tel:${picked.poi.phone.split(/[;,]/)[0]!.replace(/\s/g, '')}`}>
                    <Phone size={13} aria-hidden /> {picked.poi.phone.split(/[;,]/)[0]}
                  </a>
                )}
                {picked.poi.web && (
                  <a href={picked.poi.web} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} aria-hidden /> {t.t('places.website')}
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="place-card__actions">
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => {
                planWith({ to: encodePlace({ ...picked, name: pickedLabel }) });
                setPicked(undefined);
              }}
            >
              <Flag size={14} /> {t.t('place.routeTo')}
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                planWith({ from: encodePlace({ ...picked, name: pickedLabel }) });
                setPicked(undefined);
              }}
            >
              <MapPin size={14} /> {t.t('place.routeFrom')}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => setPicked(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {bigPhoto && (
        <div
          className="photo-view"
          role="dialog"
          aria-label={bigPhoto.title}
          onClick={() => setBigPhoto(undefined)}
        >
          <img
            src={bigPhoto.lg}
            alt={bigPhoto.title}
            style={{ backgroundImage: `url("${bigPhoto.sm}")` }}
          />
          <div className="photo-view__text">
            <div className="strong">{bigPhoto.title}</div>
            {bigPhoto.credit && (
              <a
                className="small"
                href={bigPhoto.credit.source}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {t.t('scenic.photo', {
                  author: bigPhoto.credit.author,
                  license: bigPhoto.credit.license,
                })}
              </a>
            )}
          </div>
          <button
            type="button"
            className="icon-button photo-view__close"
            aria-label={t.t('close')}
            onClick={() => setBigPhoto(undefined)}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Keeps a yellow pin on the map at `at`, or none. */
function useMarker(
  mapRef: { current: MapLibreMap | null },
  ready: boolean,
  at: LatLon | undefined,
): void {
  const marker = useRef<Marker | null>(null);
  const lat = at?.lat;
  const lon = at?.lon;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || lat === undefined || lon === undefined) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    marker.current ??= new Marker({ element: pinElement(), anchor: 'bottom' });
    marker.current.setLngLat([lon, lat]).addTo(map);
  }, [mapRef, ready, lat, lon]);
  useEffect(
    () => () => {
      marker.current?.remove();
      marker.current = null;
    },
    [],
  );
}

/**
 * A stop tapped in a list: the map goes to it, above the sheet, close enough to see the
 * streets round it, and it pulses there with its name.
 */
function useSpotlightMarker(
  mapRef: { current: MapLibreMap | null },
  ready: boolean,
  spot: Spotlight | undefined,
): void {
  const marker = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    marker.current?.remove();
    marker.current = null;
    if (!map || !ready || !spot) return;
    const el = document.createElement('div');
    el.className = 'map-spot';
    el.setAttribute('role', 'status');
    for (const part of ['ring', 'dot']) {
      const span = document.createElement('span');
      span.className = `map-spot__${part}`;
      el.append(span);
    }
    const name = document.createElement('span');
    name.className = 'map-spot__name';
    name.textContent = spot.name;
    el.append(name);
    marker.current = new Marker({ element: el, anchor: 'center' })
      .setLngLat([spot.lon, spot.lat])
      .addTo(map);
    const sheet = parseFloat(
      getComputedStyle(map.getContainer()).getPropertyValue('--map-bottom-inset'),
    );
    const room = map.getContainer().clientHeight;
    const bottom = Math.min((Number.isFinite(sheet) ? sheet : 0) + 40, Math.max(40, room - 160));
    map.easeTo({
      center: [spot.lon, spot.lat],
      zoom: Math.max(map.getZoom(), 15),
      padding: { top: 92, bottom, left: 40, right: 64 },
      duration: 600,
    });
  }, [mapRef, ready, spot]);
  useEffect(
    () => () => {
      marker.current?.remove();
      marker.current = null;
    },
    [],
  );
}

/** A finger held this long (ms) on a photo shows its name, for this long (ms) after it lets go. */
const HOLD_MS = 350;
const PEEK_MS = 1800;

/** How big a place's photo is drawn at a zoom (px): small far out, larger close in. */
const scenicSize = (zoom: number) => (zoom < 9.5 ? 34 : zoom < 11 ? 46 : zoom < 12.5 ? 60 : 76);

/**
 * Keeps the places with a view on the map as round photos with their names under them,
 * where they are. Those that would crowd one another give way to the ones before them in
 * the list (with a photo first), so zooming in brings out more; a tap opens the place.
 */
function useScenicMarkers(
  mapRef: { current: MapLibreMap | null },
  ready: boolean,
  spots: readonly ScenicSpot[] | undefined,
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !spots || spots.length === 0) return;
    const markers = spots.map((spot) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'scenic-pin';
      el.setAttribute('aria-label', spot.name);
      // The pin's head, turned so its corner points down, and the photo in it upright.
      const face = document.createElement('span');
      face.className = 'scenic-pin__face';
      const pic = document.createElement('span');
      pic.className = `scenic-pin__photo scenic-art--${spot.region}`;
      if (spot.photo) pic.style.backgroundImage = `url("${spot.photo}")`;
      else
        pic.textContent =
          spot.name.replace(/^(Miradouro|Farol|Teleférico) (d[aoe]s? )?/, '')[0] ?? '';
      face.append(pic);
      const name = document.createElement('span');
      name.className = 'scenic-pin__name';
      name.textContent = spot.name;
      const dot = document.createElement('span');
      dot.className = `scenic-pin__dot scenic-art--${spot.region}`;
      el.append(face, name, dot);
      // Its name kept back: shown while a finger is held on it (and a little after), or
      // the mouse is over it; the held finger then opens nothing.
      let held = false;
      if (spot.quiet) {
        el.classList.add('scenic-pin--quiet');
        let timer: number | undefined;
        let hide: number | undefined;
        const peek = (on: boolean) => el.classList.toggle('scenic-pin--peek', on);
        el.addEventListener('pointerdown', (e) => {
          held = false;
          window.clearTimeout(hide);
          if (e.pointerType === 'mouse') return;
          timer = window.setTimeout(() => {
            held = true;
            peek(true);
          }, HOLD_MS);
        });
        const release = () => {
          window.clearTimeout(timer);
          if (held) hide = window.setTimeout(() => peek(false), PEEK_MS);
        };
        for (const type of ['pointerup', 'pointercancel']) el.addEventListener(type, release);
        el.addEventListener('mouseenter', () => peek(true));
        el.addEventListener('mouseleave', () => !held && peek(false));
        // Not the phone's menu, nor a pin dropped on the map under it.
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (held) {
          held = false;
          return;
        }
        navigate(spot.href ?? `explore/${spot.id}`);
      });
      return new Marker({ element: el, anchor: 'bottom' })
        .setLngLat([spot.lon, spot.lat])
        .addTo(map);
    });
    // Far out only those that do not crowd the ones before them, the rest as little dots
    // until one zooms in.
    const layout = () => {
      const zoom = map.getZoom();
      const size = scenicSize(zoom);
      const shown: { x: number; y: number }[] = [];
      markers.forEach((m) => {
        const el = m.getElement();
        el.style.setProperty('--pin-size', `${size}px`);
        el.classList.toggle('scenic-pin--named', zoom >= 10.5);
        const p = map.project(m.getLngLat());
        const free = shown.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > size * 1.15);
        el.classList.toggle('scenic-pin--dot', !free);
        if (free) shown.push(p);
      });
    };
    layout();
    map.on('zoomend', layout);
    map.on('moveend', layout);
    return () => {
      map.off('zoomend', layout);
      map.off('moveend', layout);
      for (const m of markers) m.remove();
    };
  }, [mapRef, ready, spots]);
}

/**
 * The screen's little signs on the map where they are (the weather of each part of the
 * island, the webcams), each a tap away from what it shows.
 */
function useBadgeMarkers(
  mapRef: { current: MapLibreMap | null },
  ready: boolean,
  badges: readonly MapBadge[] | undefined,
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !badges || badges.length === 0) return;
    const markers = badges.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = [
        'map-badge',
        `map-badge--${b.kind}`,
        b.active ? 'map-badge--active' : '',
        b.live ? 'map-badge--live' : '',
      ]
        .filter(Boolean)
        .join(' ');
      el.setAttribute('aria-label', [b.text, b.sub].filter(Boolean).join(', '));
      const text = document.createElement('span');
      text.className = 'map-badge__text';
      // Our own SVG (numbers only), then the words.
      if (b.icon) text.innerHTML = b.icon;
      text.append(b.text);
      el.append(text);
      if (b.sub) {
        const sub = document.createElement('span');
        sub.className = 'map-badge__sub';
        sub.textContent = b.sub;
        el.append(sub);
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        b.onTap?.();
      });
      return new Marker({ element: el, anchor: 'bottom' }).setLngLat([b.lon, b.lat]).addTo(map);
    });
    // Close in, their names; far out, the signs alone.
    const named = () =>
      markers.forEach((m) =>
        m.getElement().classList.toggle('map-badge--named', map.getZoom() >= 10.2),
      );
    named();
    map.on('zoomend', named);
    return () => {
      map.off('zoomend', named);
      for (const m of markers) m.remove();
    };
  }, [mapRef, ready, badges]);
}

/** Opens the planner keeping whatever origin/destination is already set. */
function planWith(patch: Record<string, string>) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const current = path.startsWith('plan') ? Object.fromEntries(new URLSearchParams(query)) : {};
  navigate('plan', { ...current, ...patch, i: undefined });
}

/**
 * A point chosen on the map goes to the screen that asked: a place's page, a bus's trip, or
 * the planner.
 */
function pickInto(field: PickField, value: string) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (!path.startsWith('explore/') && !path.startsWith('ride/')) {
    return planWith({ [field]: value });
  }
  navigate(path, {
    ...Object.fromEntries(new URLSearchParams(query)),
    [field]: value,
    i: undefined,
  });
}

/** Shows or hides places, 3D buildings and 3D terrain on the current style. */
function applyDetails(map: MapLibreMap, layers: MapLayers) {
  const style = map.getStyle();
  if (!style) return;
  for (const id of placeLayerIds(style)) {
    map.setLayoutProperty(id, 'visibility', layers.places ? 'visible' : 'none');
  }
  const buildings = buildingLayers(style);
  if (layers.buildings3d && buildings.source && buildings.extrusions.length === 0) {
    map.addLayer(extrusionLayer(buildings.source, layers.base === 'satellite'), 'mb-net-line');
    buildings.extrusions.push('mb-buildings-3d');
  }
  for (const id of buildings.extrusions) {
    map.setLayoutProperty(id, 'visibility', layers.buildings3d ? 'visible' : 'none');
  }
  if (layers.terrain3d) {
    if (!map.getSource('mb-dem-3d')) map.addSource('mb-dem-3d', demSource());
    map.setTerrain({ source: 'mb-dem-3d', exaggeration: 1.3 });
  } else if (map.getTerrain()) {
    map.setTerrain(null);
  }
  const want3d = layers.buildings3d || layers.terrain3d;
  if (want3d && map.getPitch() < 20) map.easeTo({ pitch: 55, duration: 900 });
  if (!want3d && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
}

/** The last place the camera was fitted to, kept in view while the map changes size. */
interface Fit {
  key?: string;
  bounds?: LngLatBounds;
  /** The map was moved by hand since: a change of size keeps it where it is. */
  moved?: boolean;
}

function fitTo(map: MapLibreMap, bounds: LngLatBounds, duration: number) {
  // Clear of the buttons down the right side, of the pin's height at the top and, on a
  // phone, of the sheet over the map's bottom.
  const sheet = parseFloat(
    getComputedStyle(map.getContainer()).getPropertyValue('--map-bottom-inset'),
  );
  const room = map.getContainer().clientHeight;
  // A phone on its side has little height: smaller margins, for a larger island. At the
  // top, clear of the buttons there and of the pin and flags standing up from the stops.
  const low = room < 420;
  // Below the turn-by-turn banner over the map's top, while walking.
  const guide = parseFloat(getComputedStyle(map.getContainer()).getPropertyValue('--guide-h'));
  const top = (low ? 56 : 92) + (Number.isFinite(guide) ? guide : 0);
  const bottom = (low ? 16 : 40) + (Number.isFinite(sheet) ? sheet : 0);
  map.fitBounds(bounds, {
    padding: {
      top,
      bottom: Math.min(bottom, Math.max(40, room - top - 80)),
      left: 40,
      right: 64,
    },
    maxZoom: 15.5,
    duration,
  });
}

function apply(map: MapLibreMap, content: MapContent, fit: { current: Fit }) {
  addPlates(map, content);
  addStopDots(map, content);
  addFlags(map, content);
  addWalkDots(map, content);
  const data = toGeoJson(content);
  (map.getSource('mb-lines') as GeoJSONSource | undefined)?.setData(data.lines);
  (map.getSource('mb-points') as GeoJSONSource | undefined)?.setData(data.points);
  (map.getSource('mb-expressways') as GeoJSONSource | undefined)?.setData(data.expressways);
  if (
    content.fitKey &&
    content.fitKey !== fit.current.key &&
    content.fit &&
    content.fit.length > 0
  ) {
    const bounds = new LngLatBounds();
    for (const c of content.fit) bounds.extend([c.lon, c.lat]);
    fit.current = { key: content.fitKey, bounds };
    fitTo(map, bounds, 600);
  }
}
