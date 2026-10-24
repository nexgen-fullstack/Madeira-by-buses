import { GridIndex, hasView, haversine, offsetPolyline, pavementSides } from '@madeirabus/engine';
import type { Itinerary, LatLon, Network, StopGroup, Travel } from '@madeirabus/engine';
import type { Direction } from './lines.ts';
import { routeColor as colorOf } from './color.ts';

export interface MapLine {
  coords: LatLon[];
  /** Hex colour with '#'. */
  color: string;
  dashed?: boolean;
  width?: number;
  /** Written along the line: the number of the bus. */
  label?: string;
  /** Arrows along the line, the way the bus goes. */
  arrows?: boolean;
  /**
   * Along the line running the other way on the same road: each drawn to its own side of
   * the road at any zoom, as two lanes with a dark line between them.
   */
  side?: boolean;
  /** Shown when the line is tapped: what it is and when it runs. */
  note?: LineNote;
  /** The bus it is (route and pattern indices), for its card when tapped. */
  route?: number;
  pattern?: number;
  /** The stop it is boarded at on a route: its card shows the next buses from there. */
  board?: number;
  /** Where a tap on it goes (another trail met on the way: its page). */
  href?: string;
  /** A walk with a view (along the sea): on a wider band. */
  view?: boolean;
  /** Pale: shown, but not part of the way (another trail met, not added to the walk). */
  faint?: boolean;
  /** Told to `MapContent.onLine` when tapped or held (a trail added to a walk, or not yet). */
  key?: string;
}

export interface LineNote {
  title: string;
  lines: string[];
}

export type PointKind =
  'stop' | 'board' | 'alight' | 'transfer' | 'origin' | 'destination' | 'user' | 'bus';

export interface MapPoint extends LatLon {
  kind: PointKind;
  /** The ring round a stop; the dot of a bus. */
  color?: string;
  /** Inside the ring of a stop (white when not given). */
  fill?: string;
  label?: string;
  /** Stop indices this point represents (clicking opens its departures). */
  stops?: number[];
  /**
   * A bus left and the next boarded at one place (within a few metres): the two flags
   * stand a little apart, so both show and that it is one place.
   */
  pair?: boolean;
  /** Its name written to the side of its flag, away from the other's name at the same place. */
  apart?: boolean;
  /**
   * A stop on a road both ways of its line share: the way its bus goes there (degrees from
   * north), so it is drawn on its own way's side, as that way's line is.
   */
  heading?: number;
  /** How a start or finish flag looks: what goes that way, in its colour (plain when not given). */
  flag?: FlagLook;
  /** The place's name, told while a finger is held on its flag (not written on the map). */
  name?: string;
}

/** What a way is gone by: on foot, by bus, by car, by bike, or along a hiking trail. */
export type FlagMode = 'walk' | 'bus' | 'car' | 'bike' | 'trail';

/**
 * A flag of a way, in the colour its line is drawn in: the start flag of that colour, the
 * chequered one of that colour and black (or white, by a dark colour); a bus's with its
 * number, the others with a walker, a car, a bike or a hiker on a white disc.
 */
export interface FlagLook {
  mode: FlagMode;
  /** Hex colour with '#'. */
  color: string;
  /** The number of the bus. */
  text?: string;
}

export interface MapContent {
  lines: MapLine[];
  points: MapPoint[];
  /** Change this to re-fit the camera. */
  fitKey?: string;
  fit?: LatLon[];
  /**
   * A place the map is centred on, not fitted: a stop tapped stays in the middle of the screen
   * at its zoom (or a closer one), and does not go back to the island when the sheet moves.
   */
  centre?: LatLon;
  /**
   * Where the person is on a trip they follow, on foot or by bus: kept in the middle of the
   * screen as they go, the map moving with them (as in Google Maps), their dot with a beam the
   * way the phone points; `me: false` aboard, where the bus is the one shown.
   */
  follow?: LatLon & { me?: boolean };
  /**
   * A route chosen to take, which the map shows alone: every other stop and line steps
   * aside. Different for each route.
   */
  focus?: string;
  /**
   * Places with a view shown on the map by their photos, where they are: the island as
   * the app opens. The first ones stay when they crowd each other far out.
   */
  scenic?: ScenicSpot[];
  /**
   * A line with a `key` tapped (`held`: a finger held on it): what the screen does with it,
   * and a word to show, if any.
   */
  onLine?: (key: string, held: boolean) => LineNote | undefined;
  /**
   * Of the hiking trails layer, only these (a trail's page: those near it; the trails tab:
   * those its filters keep); all when not given.
   */
  trailIds?: readonly string[];
  /** Where the buses shown run on the Via Rápida: a violet band under them, named. */
  expressways?: LatLon[][];
  /** Little signs with a word or two: the weather in each part of the island, the webcams. */
  badges?: MapBadge[];
  /**
   * A tap anywhere on the map (but a stop): the screen's own (the weather of that spot),
   * with the name of the place under the finger, when the map has one there.
   */
  onMapTap?: (at: LatLon & { name?: string }) => void;
}

/** A little sign on the map: the sky and warmth of a part of the island, a live webcam. */
export interface MapBadge extends LatLon {
  id: string;
  kind: 'weather' | 'webcam';
  /** What it says, large ("☀️ 23°"). */
  text: string;
  /** A picture before it (SVG markup of our own: the sky, sun or moon). */
  icon?: string;
  /** Under it, small ("Funchal"). */
  sub?: string;
  /** Chosen: drawn stronger. */
  active?: boolean;
  /** Live now (a webcam broadcasting). */
  live?: boolean;
  /** What a tap on it does. */
  onTap?: () => void;
}

/** A place with a view on the map: its photo (or its region's colours) and its name. */
export interface ScenicSpot extends LatLon {
  id: string;
  name: string;
  /** The small photo's address; none yet: the colours of `region`. */
  photo?: string;
  region: string;
  /** Where a tap goes (a place with a view's page when not given). */
  href?: string;
  /** Its name shown only while a finger is held on it (among the trails, which it would hide). */
  quiet?: boolean;
  /** A photo along a hiking trail: shown or not with the trails' photos, not the camera's. */
  trail?: boolean;
}

export const EMPTY_CONTENT: MapContent = { lines: [], points: [] };

/** Madeira from Ponta do Pargo to Ponta de São Lourenço, Funchal to Porto Moniz: the whole island in view. */
export const ISLAND: LatLon[] = [
  { lat: 32.63, lon: -17.27 },
  { lat: 32.88, lon: -16.65 },
];

/** The way chosen, in the neon yellow of the logo's pin: it stands out on any map. */
export const WAY_YELLOW = '#FFE600';
/** The way back, in neon turquoise. */
export const WAY_TURQUOISE = '#00E8D5';
/** The ring round the stops on those ways. */
const INK = '#14181F';
/**
 * Each bus of a route in a neon of its own, the first in the yellow of a chosen way:
 * where one bus ends and the next begins shows on the map.
 */
/** The Via Rápida, under a bus that takes it (as in styles.css). */
export const VR_VIOLET = '#7E57C2';

/** Where a pattern runs on the Via Rápida (within `from`…`to` m along it), in its lane. */
export function expresswayLanes(net: Network, pattern: number, from?: number, to?: number) {
  return net.expressways(pattern, from, to).map((x) => net.laneBetween(pattern, x.from, x.to));
}

export const RIDE_COLORS = [WAY_YELLOW, '#FF3DF0', WAY_TURQUOISE, '#FF8A00', '#7CFF3A'];
export const rideColor = (ride: number) => RIDE_COLORS[ride % RIDE_COLORS.length]!;
/** The foot of the flags where a bus is boarded and left. */
export const FLAG_FOOT = INK;
/** How wide a bus of a route is drawn (px), the line it rides on the map. */
export const RIDE_WIDTH = 8;
/** How wide a line's main way is drawn on its page (px), and its other runs. */
export const WAY_WIDTH = 6.5;
export const RUN_WIDTH = 4.5;

/** A walk on the map, in navy; one with a view (along the sea), in the deep cyan of the logo's wave. */
export const WALK_INK = '#002F85';
export const VIEW_WALK = '#00838F';
/**
 * Each walk of a route in a colour of its own, as each bus is: blue, violet, green, red,
 * brown — none of them a bus's neon, so a walk and a ride never look alike.
 */
export const WALK_COLORS = ['#1E6FFF', '#8E24AA', '#00A152', '#E53935', '#795548'];
export const walkColor = (walk: number) => WALK_COLORS[walk % WALK_COLORS.length]!;

/**
 * A start flag (or a chequered one, `finish`) at `p` of a way gone as `look` says, with the
 * place's `name` told while a finger is held on it.
 */
export function flagPoint(
  p: LatLon,
  finish: boolean,
  look: FlagLook,
  name?: string,
  extra?: Partial<MapPoint>,
): MapPoint {
  return {
    lat: p.lat,
    lon: p.lon,
    kind: finish ? 'alight' : 'board',
    color: '#ffffff',
    fill: FLAG_FOOT,
    flag: look,
    ...(name ? { name } : {}),
    ...extra,
  };
}

/** A walk along the streets on their pavements, or as the crow flies without the streets. */
export function walkPath(leg: {
  from: LatLon;
  to: LatLon;
  path?: LatLon[];
  kerb?: number[];
}): LatLon[] {
  if (!leg.path) return [leg.from, leg.to];
  if (!leg.kerb || leg.kerb.length !== leg.path.length - 1) return leg.path;
  return offsetPolyline(leg.path, pavementSides(leg.path, leg.kerb));
}

/**
 * A walk as the map draws it: only its stretches along the streets and paths. Without a way
 * found (no `path`), or on a step off the ways (`kerb` < 0: from a place 200 m into the woods
 * to the nearest path, say), it would be a straight dotted line looking like a trail where
 * none is: not drawn, the walk's flags tell it is walked there.
 */
export function walkRuns(leg: { path?: LatLon[]; kerb?: number[] }, pavements = true): LatLon[][] {
  const path = leg.path;
  if (!path || path.length < 2) return [];
  const kerb = leg.kerb;
  if (!kerb || kerb.length !== path.length - 1) return [path];
  // Each step on the pavement its side of the street, as the whole walk keeps them.
  const sides = pavementSides(path, kerb);
  const runs: LatLon[][] = [];
  let run: { points: LatLon[]; sides: number[] } = { points: [], sides: [] };
  const done = () => {
    if (run.points.length > 1) {
      runs.push(pavements ? offsetPolyline(run.points, run.sides) : run.points);
    }
    run = { points: [], sides: [] };
  };
  kerb.forEach((k, i) => {
    if (k < 0) return done();
    if (run.points.length === 0) run.points.push(path[i]!);
    run.points.push(path[i + 1]!);
    run.sides.push(sides[i]!);
  });
  done();
  return runs;
}

const routeColor = (net: Network, route: number) => colorOf(net.routes[route]!);

/**
 * A route on the map, each of its buses in a neon of its own with arrows the way it goes,
 * a start flag where it is boarded and a chequered one where it is left, both on the bus's
 * side of the road, where the walks lead; each walk from a start flag to a chequered one
 * too, so the journey starts at a start flag and ends at a chequered one. `focus` brings
 * one of its legs close up. A route `chosen` to take is shown alone.
 */
export function itineraryContent(
  net: Network,
  it: Itinerary,
  focus?: number,
  chosen = false,
): MapContent {
  const lines: MapLine[] = [];
  const points: MapPoint[] = [];
  // Each bus in the centre of its lane, from where its stop meets the lane: where it is
  // boarded and left, not the pavement where the stop is mapped.
  const rides = it.legs.map((leg) =>
    leg.kind === 'ride' ? net.rideLane(leg.pattern, leg.boardPos, leg.alightPos) : undefined,
  );
  const expressways = it.legs.flatMap((leg) => {
    if (leg.kind !== 'ride') return [];
    const { stops } = net.stopPositions(leg.pattern);
    return expresswayLanes(net, leg.pattern, stops[leg.boardPos], stops[leg.alightPos]);
  });
  let ride = 0;
  let walk = 0;
  it.legs.forEach((leg, i) => {
    if (leg.kind === 'walk') {
      // Along the pavements when the walking network is loaded, to the very spot of the bus.
      const from = rides[i - 1]?.at(-1);
      const to = rides[i + 1]?.[0];
      const path = walkPath(leg);
      const coords = [...(from ? [from] : []), ...path, ...(to ? [to] : [])];
      const color = walkColor(walk++);
      // Drawn along the ways only; joined to the bus where it starts or ends on them.
      const runs = walkRuns(leg);
      const kerb = leg.kerb;
      if (from && runs[0] && (!kerb || kerb[0]! >= 0)) runs[0].unshift(from);
      if (to && runs.length > 0 && (!kerb || kerb.at(-1)! >= 0)) runs.at(-1)!.push(to);
      for (const run of runs) {
        lines.push({ coords: run, color, dashed: true, ...(hasView(leg) ? { view: true } : {}) });
      }
      // A walk, as a bus, from a start flag to a chequered one in its colour, each with a
      // walker, the next walk in another colour: where the
      // journey starts on foot, where it is walked on from the bus, and where it ends; the
      // names of the places walked from and to (a stop's name stands at its bus's flag).
      const ends = i === 0 || i === it.legs.length - 1;
      if (pathLength(coords) >= (ends ? END_WALK : TRANSFER_WALK)) {
        const fromName = i === 0 ? leg.from.name : '';
        const toName = i === it.legs.length - 1 ? leg.to.name : '';
        const look: FlagLook = { mode: 'walk', color };
        points.push(
          flagPoint(coords[0]!, false, look, leg.from.name, fromName ? { label: fromName } : {}),
        );
        points.push(
          flagPoint(coords.at(-1)!, true, look, leg.to.name, toName ? { label: toName } : {}),
        );
      }
      return;
    }
    const coords = rides[i]!;
    const start = coords[0] ?? leg.from;
    const end = coords.at(-1) ?? leg.to;
    const color = rideColor(ride++);
    const short = net.routes[leg.route]!.short;
    lines.push({
      coords,
      color,
      width: RIDE_WIDTH,
      label: short,
      arrows: true,
      route: leg.route,
      pattern: leg.pattern,
      board: leg.from.stop,
    });
    // The bus's flags in the colour it is drawn in, with its number.
    const look: FlagLook = { mode: 'bus', color, text: short };
    points.push(
      flagPoint(start, false, look, leg.from.name, {
        label: leg.from.name,
        stops: [leg.from.stop!],
      }),
    );
    points.push(
      flagPoint(end, true, look, leg.to.name, { label: leg.to.name, stops: [leg.to.stop!] }),
    );
    for (const s of leg.stops.slice(1, -1)) {
      const st = net.stops[s.stop]!;
      points.push({ lat: st.lat, lon: st.lon, kind: 'stop', color: INK, stops: [s.stop] });
    }
  });
  pairFlags(points);
  const leg = focus !== undefined ? lines[focus] : undefined;
  const key = `it:${it.key}:${it.depart}`;
  return {
    lines,
    points,
    fitKey: `${key}${leg ? `:${focus}` : ''}`,
    fit: leg ? leg.coords : lines.flatMap((l) => l.coords),
    ...(chosen ? { focus: key } : {}),
    ...(expressways.length > 0 ? { expressways } : {}),
  };
}

/** A walk at either end of a journey this long (m) or longer has its flags; one between buses, this long. */
const END_WALK = 15;
const TRANSFER_WALK = 120;

/** A line's length (m). */
const pathLength = (coords: readonly LatLon[]) =>
  coords.slice(1).reduce((m, p, i) => m + haversine(coords[i]!, p), 0);

/** A bus left this close to where the next is boarded is left and boarded at one place (m). */
const ONE_PLACE = 6;

/**
 * Where a way ends and the next starts at one place (within `near` m), the chequered flag
 * and the start flag stand side by side, a little apart (the start where the other ends),
 * and the place's name is written once when it is the same place.
 */
export function pairFlags(points: MapPoint[], near = ONE_PLACE): void {
  for (const board of points) {
    if (board.kind !== 'board' || board.pair) continue;
    const alight = points.find((p) => p.kind === 'alight' && !p.pair && haversine(p, board) < near);
    if (!alight) continue;
    alight.pair = true;
    board.pair = true;
    board.lat = alight.lat;
    board.lon = alight.lon;
    if (alight.label === board.label) {
      board.label = undefined;
    } else if (alight.label && board.label) {
      alight.apart = true;
      board.apart = true;
    }
  }
}

/** A hiking trail in the volcanic red of the island's PR waymarks (as in styles.css). */
export const TRAIL_RED = '#B8471B';

/** A car's way in the blue of a maps app, a bike's in laurel green (as in styles.css). */
export const CAR_BLUE = '#1A73E8';
export const BIKE_GREEN = '#1E8A4C';

/**
 * The way by car, on foot or by bike: a car's and a bike's as a line along the roads
 * (each with a white edge on any map), a walk as the dots of a walk; a start flag where it
 * starts and a chequered one where it goes.
 */
export function travelContent(travel: Travel, names?: { from?: string; to?: string }): MapContent {
  const first = travel.path[0]!;
  const last = travel.path[travel.path.length - 1]!;
  const color =
    travel.mode === 'walk' ? walkColor(0) : travel.mode === 'car' ? CAR_BLUE : BIKE_GREEN;
  const lines: MapLine[] =
    travel.mode === 'walk'
      ? walkRuns(travel, false).map((coords) => ({ coords, color, dashed: true }))
      : [{ coords: travel.path, color, width: travel.mode === 'car' ? 7 : 5.5, arrows: true }];
  const key = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const look: FlagLook = { mode: travel.mode, color };
  return {
    lines,
    // As every way: a start flag where it starts, a chequered one where it ends, with a
    // walker, a car or a bike on them in the way's colour.
    points: [flagPoint(first, false, look, names?.from), flagPoint(last, true, look, names?.to)],
    fitKey: `travel:${travel.mode}:${key(first)}>${key(last)}`,
    fit: travel.path,
    focus: `travel:${travel.mode}`,
  };
}

/** Where the trip starts and where it goes, before there is a route between them. */
export function placesContent(from?: MapPoint, to?: MapPoint): MapContent {
  const points: MapPoint[] = [];
  if (from) points.push({ ...from, kind: 'origin', color: '#14181F' });
  if (to) points.push({ ...to, kind: 'destination', color: '#14181F' });
  return {
    lines: [],
    points,
    fitKey: points.map((p) => `${p.kind}:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|'),
    fit: points,
  };
}

/** Closer than this (m) to a line already drawn, a variant runs along it. */
const ALONG = 25;
/** Shorter detours (m) are only the road wobbling. */
const DETOUR = 60;

/** A polyline with a point at least every `step` metres. */
function densify(coords: readonly LatLon[], step = 10): LatLon[] {
  const out: LatLon[] = [];
  coords.forEach((b, i) => {
    const a = coords[i - 1];
    if (a) {
      const n = Math.floor(haversine(a, b) / step);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push({ lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) });
      }
    }
    out.push(b);
  });
  return out;
}

/**
 * The stretches of `coords` away from every line of `drawn`: where a variant of a way
 * leaves its main road, e.g. a detour to Cabo Girão or a run by the Via Rápida.
 */
export function detours(coords: readonly LatLon[], drawn: readonly LatLon[][]): LatLon[][] {
  const index = new GridIndex(
    drawn.flatMap((d) => densify(d)),
    60,
  );
  const runs: LatLon[][] = [];
  let run: LatLon[] | undefined;
  let last: LatLon | undefined;
  for (const p of densify(coords)) {
    const near = index.within(p, ALONG).length > 0;
    if (!near) {
      // From where it leaves the line, so the detour hangs on it.
      run ??= last ? [last] : [];
      run.push(p);
    } else if (run) {
      run.push(p);
      runs.push(run);
      run = undefined;
    }
    last = p;
  }
  if (run) runs.push(run);
  return runs.filter((r) => r.slice(1).reduce((m, p, i) => m + haversine(r[i]!, p), 0) >= DETOUR);
}

/** A line drawn this close (m) to its bus's lane on the Via Rápida is on it there. */
const ON_VR = 6;
/** Shorter bits (m) of a line on the Via Rápida are where it only touches it. */
const VR_BIT = 80;

/** The parts of a line drawn that lie on its bus's stretches on the Via Rápida (`lanes`). */
export function onExpressway(coords: readonly LatLon[], lanes: readonly LatLon[][]): LatLon[][] {
  if (lanes.length === 0) return [];
  const index = new GridIndex(
    lanes.flatMap((l) => densify(l, 4)),
    40,
  );
  const runs: LatLon[][] = [];
  let run: LatLon[] | undefined;
  for (const p of densify(coords, 4)) {
    if (index.within(p, ON_VR).length > 0) (run ??= []).push(p);
    else if (run) {
      runs.push(run);
      run = undefined;
    }
  }
  if (run) runs.push(run);
  return runs.filter((r) => r.slice(1).reduce((m, p, i) => m + haversine(r[i]!, p), 0) >= VR_BIT);
}

/** Whether a variant has a bus on `date` (every variant when no date is given). */
const runsOn = (net: Network, pattern: number, date?: string) =>
  date === undefined ||
  net.patterns[pattern]!.trips.some(([service]) => net.isServiceActive(service, date));

/** Closer than this (m) to the other way's road, along it, the two ways share the road. */
const SHARED = 18;
/** Shorter runs (m) on or off the other way's road are crossings and wobbles, not a change. */
const SHORT_RUN = 60;
/** A stop farther than this (m) from its way's line stays where it is mapped. */
const SNAP = 60;

/** The heading of a step (degrees clockwise from north). */
function heading(a: LatLon, b: LatLon): number {
  const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const dy = b.lat - a.lat;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** The heading of a line at its `i`th point. */
const headingAt = (line: readonly LatLon[], i: number) =>
  heading(line[Math.max(0, i - 1)]!, line[Math.min(line.length - 1, i + 1)]!);

/**
 * A way's line in runs along the other ways' roads (`shared`: drawn to its side, as the
 * two lanes of one road) and on roads of its own (one-way streets, loops: drawn in the
 * middle of its road). Close to the other way's line and running along it, either way
 * (not across it at a crossing), is on its road.
 */
export function sharedRuns(
  coords: readonly LatLon[],
  others: readonly (readonly LatLon[])[],
): { coords: LatLon[]; shared: boolean }[] {
  const dense = densify(coords);
  const other = others.map((o) => densify(o));
  const points = other.flat();
  const headings = other.flatMap((o) => o.map((_, i) => headingAt(o, i)));
  const index = new GridIndex(points, 60);
  const flags = dense.map((p, i) => {
    const h = headingAt(dense, i);
    return index.within(p, SHARED).some(({ index: k }) => {
      const turn = Math.abs(((headings[k]! - h + 540) % 360) - 180);
      // Running along it (back the other way, or the same way) within 35°.
      return turn > 145 || turn < 35;
    });
  });
  // Runs of one kind, as [first point, last point, shared].
  const runs = () => {
    const out: [number, number, boolean][] = [];
    flags.forEach((f, i) => {
      const last = out.at(-1);
      if (last && last[2] === f) last[1] = i;
      else out.push([i, i, f]);
    });
    return out;
  };
  const length = (a: number, b: number) => {
    let m = 0;
    for (let i = Math.max(1, a); i <= b; i++) m += haversine(dense[i - 1]!, dense[i]!);
    return m;
  };
  // A short run between two of the other kind takes theirs: first the short shared ones
  // (a crossing), then the short ones apart (a wobble of the map, a lay-by).
  for (const kind of [true, false]) {
    const all = runs();
    all.forEach(([a, b, f], i) => {
      if (f !== kind || i === 0 || i === all.length - 1 || length(a, b) >= SHORT_RUN) return;
      for (let k = a; k <= b; k++) flags[k] = !kind;
    });
  }
  // A short run at either end goes with the one next to it.
  const ends = runs();
  for (const r of [ends[0], ends.at(-1)]) {
    if (!r || ends.length < 2 || length(r[0], r[1]) >= SHORT_RUN) continue;
    for (let k = r[0]; k <= r[1]; k++) flags[k] = !r[2];
  }
  const all = runs();
  if (all.length === 1) return [{ coords: coords.slice(), shared: all[0]![2] }];
  // Each run from where the one before it ends, so the line goes on unbroken.
  return all.map(([a, b, shared]) => ({
    coords: dense.slice(Math.max(0, a - 1), b + 1),
    shared,
  }));
}

/**
 * A line on the map, each way it runs with arrows the way the bus goes: the `chosen` way
 * in neon yellow, the way back (and any other) in neon turquoise, and each stop in the
 * colour of its way, on its line. Where both ways take one road, each is drawn to its own
 * side of it (traffic keeps right), its stops with it; where they part (one-way streets,
 * a loop), each in the middle of its road. Of the other variants of a way, those with a
 * bus on `date`, only where they leave its road are drawn, thinner and with arrows too;
 * tapped, they tell their `note`.
 */
export function routeContent(
  net: Network,
  directions: readonly Direction[],
  chosen: number,
  date?: string,
  note?: (direction: Direction, pattern: number) => LineNote,
): MapContent {
  const way = directions[chosen];
  // The chosen way last, over the way back where the two share a stop.
  const ways = [...directions.filter((d) => d !== way), ...(way ? [way] : [])];
  // Each way's lines: its main variant always, the line's road; the others on the day they run.
  const drawnBy = ways.map((d) => {
    const drawn: { coords: LatLon[]; pattern: number; main: boolean }[] = [];
    d.patterns.forEach((p, i) => {
      if (i > 0 && !runsOn(net, p, date)) return;
      const shape = net.lane(p);
      const parts =
        i === 0
          ? [shape]
          : detours(
              shape,
              drawn.map((x) => x.coords),
            );
      for (const coords of parts) drawn.push({ coords, pattern: p, main: i === 0 });
    });
    return drawn;
  });
  const lines: MapLine[] = [];
  const points = new Map<number, MapPoint>();
  // Where its buses run on the Via Rápida: under each line drawn, where its bus takes it
  // (not where a variant runs beside the line drawn for it, a carriageway away).
  const vr = new Map<number, LatLon[][]>();
  const expressways = drawnBy.flat().flatMap(({ coords, pattern: p }) => {
    if (!vr.has(p)) vr.set(p, expresswayLanes(net, p));
    return onExpressway(coords, vr.get(p)!);
  });
  ways.forEach((d, w) => {
    const color = d === way ? WAY_YELLOW : WAY_TURQUOISE;
    const mine = drawnBy[w]!;
    const others = drawnBy.flatMap((x, k) => (k === w ? [] : x.map((y) => y.coords)));
    // Where this way's lines run, to put its stops on them.
    const along: { point: LatLon; heading: number; shared: boolean }[] = [];
    for (const { coords, pattern: p, main } of mine) {
      const about = main ? undefined : note?.(d, p);
      for (const run of sharedRuns(coords, others)) {
        lines.push({
          coords: run.coords,
          color,
          width: main ? WAY_WIDTH : RUN_WIDTH,
          arrows: true,
          side: run.shared,
          route: net.patterns[p]!.route,
          pattern: p,
          ...(about ? { note: about } : {}),
        });
        const dense = densify(run.coords);
        dense.forEach((point, i) =>
          along.push({ point, heading: headingAt(dense, i), shared: run.shared }),
        );
      }
    }
    const index = new GridIndex(
      along.map((a) => a.point),
      60,
    );
    for (const p of d.patterns) {
      if (!mine.some((x) => x.pattern === p)) continue;
      for (const s of net.patterns[p]!.stops) {
        const st = net.stops[s]!;
        // On its way's line, in the lane its bus stops in; to its side where the way back
        // shares the road.
        const near = index.within(st, SNAP)[0];
        const on = near ? along[near.index] : undefined;
        points.delete(s);
        points.set(s, {
          lat: on?.point.lat ?? st.lat,
          lon: on?.point.lon ?? st.lon,
          kind: 'stop',
          color: INK,
          fill: color,
          label: st.name,
          stops: [s],
          ...(on?.shared ? { heading: Math.round(on.heading) } : {}),
        });
      }
    }
  });
  // The same while the reader switches between the ways or days: the line is shown alone.
  const main = directions[0]?.patterns[0];
  const key = `route:${main === undefined ? '' : net.patterns[main]!.route}`;
  return {
    lines,
    points: [...points.values()],
    fitKey: key,
    fit: lines.flatMap((l) => l.coords),
    focus: key,
    ...(expressways.length > 0 ? { expressways } : {}),
  };
}

/** Every line of the network along its roads (the stops are a map layer of their own). */
export function networkContent(net: Network): MapContent {
  const seen = new Set<number>();
  const lines: MapLine[] = [];
  net.patterns.forEach((p, i) => {
    if (seen.has(p.shape)) return;
    seen.add(p.shape);
    lines.push({
      coords: net.lane(i),
      color: routeColor(net, p.route),
      width: 2.5,
      route: p.route,
      pattern: i,
    });
  });
  return {
    lines,
    points: [],
    fitKey: 'network',
    fit: net.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
  };
}

export function stopsContent(groups: StopGroup[], user?: LatLon, fitKey = 'stops'): MapContent {
  const points: MapPoint[] = groups.map((g) => ({
    lat: g.lat,
    lon: g.lon,
    kind: 'stop',
    color: '#002F85',
    label: g.name,
    stops: g.stops,
  }));
  if (user) points.push({ ...user, kind: 'user' });
  return { lines: [], points, fitKey, fit: [...groups, ...(user ? [user] : [])] };
}

/** How close stops with the same name are to count as one place (both sides of a road, m). */
const SAME_STOP = 120;

/**
 * Every stop and line of the network as GeoJSON, for the "bus stops and
 * lines" layer. Each stop carries the stops of the same name around it, so a
 * tap shows the buses both ways.
 */
export function transitGeoJson(net: Network) {
  const seen = new Set<number>();
  const lines = net.patterns.flatMap((p, i) => {
    if (seen.has(p.shape)) return [];
    seen.add(p.shape);
    return [
      {
        type: 'Feature' as const,
        properties: { color: routeColor(net, p.route), route: p.route, pattern: i },
        geometry: {
          type: 'LineString' as const,
          coordinates: net.lane(i).map((c) => [c.lon, c.lat]),
        },
      },
    ];
  });
  const served = new Set(net.patterns.flatMap((p) => p.stops));
  const stops = net.stops.flatMap((s, i) => {
    if (!served.has(i)) return [];
    const same = net
      .nearbyStops(s, SAME_STOP)
      .filter((h) => net.stops[h.stop]!.name === s.name)
      .map((h) => h.stop)
      .sort((a, b) => a - b);
    return [
      {
        type: 'Feature' as const,
        properties: { label: s.name, stops: (same.length > 0 ? same : [i]).join(',') },
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      },
    ];
  });
  return {
    lines: { type: 'FeatureCollection' as const, features: lines },
    stops: { type: 'FeatureCollection' as const, features: stops },
  };
}
