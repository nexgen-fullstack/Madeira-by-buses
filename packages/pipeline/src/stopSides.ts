/**
 * Bus stops where they stand: on the pavement on the right of the way their buses go
 * (Madeira drives on the right), not in the middle of the road nor across it.
 *
 * The timetables put a good many stops on the road's middle line (a quarter of CAM's and
 * Rodoeste's) and some on the far side, so the map showed a stop across the road from its
 * bus and a walk led to the wrong pavement. Each stop whose buses all go one way is set:
 *
 * - where OpenStreetMap has its pole (a platform with the stop's code or name, mapped on
 *   the spot), when that pole is on the right side of the road;
 * - else on the right pavement: half the road's width and the kerb from its middle (as
 *   walk.bin knows them), or on a footway mapped along it.
 *
 * A stop already on its right side, one served both ways (one pole for both directions,
 * the end of a line) and one far off the road (a bay, a bus station) stay as they are.
 */

import {
  cumulativeDistances,
  haversine,
  Network,
  pointAlong,
  type LatLon,
  type NetworkBundle,
  type WalkGraph,
} from '@madeirabus/engine';
import { nameWords } from './pois.ts';

export interface OsmStopNode {
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface StopSideStats {
  /** Already on the right of their buses. */
  right: number;
  /** Moved to OpenStreetMap's pole. */
  osm: number;
  /** Moved to the right pavement. */
  pavement: number;
  /** Served both ways, or too far off the road to tell. */
  kept: number;
}

/** Metres either way of a stop that tell which way its bus goes there. */
const ARM = 12;
/** A stop at least this far right of the road's middle (m) is on its side already. */
const ON_SIDE = 2.5;
/** Farther left than this (m), a stop is in a bay or on another road: left alone. */
const FAR_LEFT = 15;
/** How far (m) an OpenStreetMap pole may be from the stop it is taken for: by its number… */
const POLE_REACH = 40;
/** …and by its name alone. */
const NAMED_REACH = 20;
/** Where a pavement is not known, a stop stands this far right of the road's middle (m). */
const DEFAULT_KERB = 3.5;

const KY = 110_540;
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

interface Pass {
  /** Where the stop meets its bus's way, and the way's heading there (unit, east/north m). */
  at: LatLon;
  dir: [number, number];
}

/** How far right (m, left negative) of the way through `pass` a point is. */
function rightOf(pass: Pass, p: LatLon): number {
  const x = (p.lon - pass.at.lon) * kx(pass.at.lat);
  const y = (p.lat - pass.at.lat) * KY;
  return x * pass.dir[1] - y * pass.dir[0];
}

/** How far along the way through `pass` a point is (m, ahead positive). */
function aheadOf(pass: Pass, p: LatLon): number {
  const x = (p.lon - pass.at.lon) * kx(pass.at.lat);
  const y = (p.lat - pass.at.lat) * KY;
  return x * pass.dir[0] + y * pass.dir[1];
}

/** The point `m` metres to the right of the way at `pass`. */
function rightBy(pass: Pass, m: number): LatLon {
  return {
    lat: pass.at.lat - (pass.dir[0] * m) / KY,
    lon: pass.at.lon + (pass.dir[1] * m) / kx(pass.at.lat),
  };
}

/** The numbers a stop is known by in OpenStreetMap's `gtfs_id` ("00402" and "siga:00402": 402). */
const stopNumber = (id: string) => Number(id.replace(/^.*:/, ''));

/** Moves the bundle's stops to their side of the road (in place); how many went where. */
export function placeStopsBySide(
  bundle: NetworkBundle,
  walk: WalkGraph | undefined,
  poles: readonly OsmStopNode[],
): StopSideStats {
  const net = new Network(bundle);
  const stats: StopSideStats = { right: 0, osm: 0, pavement: 0, kept: 0 };
  // The poles, by where they are, and by the stop numbers they carry.
  const platforms = poles.filter(
    (p) => p.tags?.public_transport === 'platform' || p.tags?.highway === 'bus_stop',
  );
  const cell = (lat: number, lon: number) =>
    `${Math.floor(lat / 0.001)}:${Math.floor(lon / 0.001)}`;
  const grid = new Map<string, OsmStopNode[]>();
  for (const p of platforms) {
    if (p.tags?.public_transport === 'stop_position') continue;
    const k = cell(p.lat, p.lon);
    grid.set(k, [...(grid.get(k) ?? []), p]);
  }
  const polesNear = (s: LatLon) => {
    const out: OsmStopNode[] = [];
    const cy = Math.floor(s.lat / 0.001);
    const cx = Math.floor(s.lon / 0.001);
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) out.push(...(grid.get(`${y}:${x}`) ?? []));
    return out.filter((p) => haversine(p, s) <= POLE_REACH);
  };
  const shapes = new Map<number, { shape: LatLon[]; cum: number[] }>();
  const way = (pattern: number) => {
    let w = shapes.get(pattern);
    if (!w) {
      const shape = net.shape(pattern);
      w = { shape, cum: cumulativeDistances(shape) };
      shapes.set(pattern, w);
    }
    return w;
  };

  // Where every stop meets its lines, before any of them moves.
  net.patterns.forEach((_, p) => net.stopPositions(p));
  bundle.stops.forEach((stop, i) => {
    const passes: Pass[] = [];
    for (const { pattern, pos } of net.stopPatterns[i] ?? []) {
      const { shape, cum } = way(pattern);
      if (shape.length < 2) continue;
      const along = net.stopPositions(pattern).stops[pos]!;
      const a = pointAlong(shape, cum, along - ARM);
      const b = pointAlong(shape, cum, along + ARM);
      const dx = (b.lon - a.lon) * kx(a.lat);
      const dy = (b.lat - a.lat) * KY;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      passes.push({ at: pointAlong(shape, cum, along), dir: [dx / len, dy / len] });
    }
    if (passes.length === 0) return;
    const pass = passes[0]!;
    // One pole for both ways (or a line turning round at it): which side is not ours to say.
    const bothWays = passes.some((p) => p.dir[0] * pass.dir[0] + p.dir[1] * pass.dir[1] < -0.3);
    const side = rightOf(pass, stop);
    if (bothWays || side <= -FAR_LEFT || haversine(pass.at, stop) > 30) {
      stats.kept++;
      return;
    }
    if (side >= ON_SIDE) {
      stats.right++;
      return;
    }
    // Its pole, mapped where it stands: by its number, else by its name; on the right side.
    const number = stopNumber(stop.id);
    const words = new Set(nameWords(stop.name));
    const pole = polesNear(stop)
      .filter((p) => {
        const right = rightOf(pass, p);
        return right >= 1 && right <= 12 && Math.abs(aheadOf(pass, p)) <= 30;
      })
      .map((p) => {
        const ids = (p.tags?.gtfs_id ?? '').split(';').map(Number);
        const named = nameWords(p.tags?.name ?? '').filter((w) => words.has(w)).length;
        const score = ids.includes(number) ? 2 : named > 0 && named >= words.size / 2 ? 1 : 0;
        return { p, score, d: haversine(p, stop) };
      })
      // By its number anywhere near; by its name only close by (two poles may share one).
      .filter((c) => c.score === 2 || (c.score === 1 && c.d <= NAMED_REACH))
      .sort((a, b) => b.score - a.score || a.d - b.d)[0];
    if (pole) {
      stop.lat = round(pole.p.lat);
      stop.lon = round(pole.p.lon);
      stats.osm++;
      return;
    }
    // Else on the pavement on the right: the road's own kerb, or a footway along it.
    const probe = rightBy(pass, 2);
    const kerb = walk?.onPavement(probe, 8)?.point;
    const right = kerb ? rightOf(pass, kerb) : NaN;
    const at = kerb && right >= 1.5 && right <= 10 ? kerb : rightBy(pass, DEFAULT_KERB);
    stop.lat = round(at.lat);
    stop.lon = round(at.lon);
    stats.pavement++;
  });
  return stats;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
