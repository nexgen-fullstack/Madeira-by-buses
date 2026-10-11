import {
  cumulativeDistances,
  haversine,
  pointAlong,
  projectOnPolyline,
  type LatLon,
} from '@madeirabus/engine';

/**
 * Turn-by-turn guidance on foot, as a maps app gives it: where a walk turns ("turn left",
 * "keep right"), and, as the phone moves along it, the next turn, how far it is, and a
 * word to say when it comes close and when it is there.
 */

export type TurnKind =
  | 'left'
  | 'right'
  | 'slight-left'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'arrive';

export interface Turn {
  /** How far along the walk it is (m). */
  at: number;
  point: LatLon;
  kind: TurnKind;
}

/** How far before and after a bend (m) the way is looked at for where it heads. */
const ARM = 15;
/** A bend less than this (degrees) is the street wobbling, not a turn. */
const BEND = 35;
/** Bends this close together (m) are one turn: the sharpest of them. */
const ONE_TURN = 20;

/** The heading of a step (degrees clockwise from north). */
function heading(a: LatLon, b: LatLon): number {
  const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return ((Math.atan2(dx, b.lat - a.lat) * 180) / Math.PI + 360) % 360;
}

/** A turn of `angle` degrees (to the right positive) by its kind. */
export function turnKind(angle: number): TurnKind | undefined {
  const a = Math.abs(angle);
  if (a < BEND) return undefined;
  const side = angle > 0 ? 'right' : 'left';
  if (a < 60) return `slight-${side}`;
  if (a < 135) return side;
  if (a < 170) return `sharp-${side}`;
  return 'uturn';
}

/** Where a walk along `path` turns, in order, and where it arrives. */
export function walkTurns(path: readonly LatLon[]): Turn[] {
  if (path.length < 2) return [];
  const cum = cumulativeDistances(path);
  const total = cum.at(-1)!;
  // The bend at each point: the way it heads over the next stretch against the last one.
  const bends: { at: number; angle: number }[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const at = cum[i]!;
    if (at < ARM / 2 || total - at < ARM / 2) continue;
    const before = pointAlong(path, cum, at - ARM);
    const after = pointAlong(path, cum, at + ARM);
    const angle = ((heading(path[i]!, after) - heading(before, path[i]!) + 540) % 360) - 180;
    if (Math.abs(angle) >= BEND) bends.push({ at, angle });
  }
  // Of bends close together, the sharpest.
  const turns: Turn[] = [];
  for (const b of bends) {
    const last = turns.at(-1);
    const kind = turnKind(b.angle)!;
    if (last && b.at - last.at < ONE_TURN) {
      if (Math.abs(b.angle) > Math.abs(angleOf(last.kind))) {
        turns[turns.length - 1] = { at: b.at, point: pointAlong(path, cum, b.at), kind };
      }
      continue;
    }
    turns.push({ at: b.at, point: pointAlong(path, cum, b.at), kind });
  }
  turns.push({ at: total, point: path.at(-1)!, kind: 'arrive' });
  return turns;
}

/** About how sharp a kind of turn is (degrees), to keep the sharper of two. */
function angleOf(kind: TurnKind): number {
  if (kind.startsWith('slight')) return 45;
  if (kind.startsWith('sharp')) return 150;
  if (kind === 'uturn') return 180;
  return 90;
}

/** Where the walker is on the walk, and what comes next. */
export interface WalkState {
  /** How far along the walk (m). */
  along: number;
  /** How far from it (m). */
  offset: number;
  /** The next turn (or the arrival). */
  next: Turn;
  /** How far to it (m). */
  toNext: number;
  /** How far to the end (m). */
  left: number;
  /** Farther from the way than a GPS strays: off it. */
  offRoute: boolean;
  arrived: boolean;
  /** Said once as the next turn comes close ("in 50 m, turn left") and when it is there. */
  cue?: { turn: Turn; stage: 'soon' | 'now' };
}

/** A turn this close (m) is told as coming; this close, as here. */
export const SOON = 60;
export const NOW = 15;
/** Farther than this from the way (m, or the GPS's own error and a half), off it. */
const OFF_ROUTE = 35;
/** This close to the end (m), there. */
const THERE = 20;

/** Follows a walker along a walk, fix by fix. */
export class WalkFollower {
  readonly turns: Turn[];
  private readonly cum: number[];
  private readonly total: number;
  private along = 0;
  private segment = 0;
  private told = new Map<number, 'soon' | 'now'>();
  private off = 0;

  constructor(private readonly path: readonly LatLon[]) {
    this.turns = walkTurns(path);
    this.cum = cumulativeDistances(path);
    this.total = this.cum.at(-1) ?? 0;
  }

  /** Where `p` is on the walk (`accuracy`: the GPS's error, m). */
  update(p: LatLon, accuracy = 0): WalkState {
    if (this.path.length < 2) {
      const end = this.path[0] ?? p;
      const left = haversine(p, end);
      const next: Turn = { at: 0, point: end, kind: 'arrive' };
      return {
        along: 0,
        offset: left,
        next,
        toNext: left,
        left,
        offRoute: false,
        arrived: left < THERE,
      };
    }
    // From a little behind where it was, so a loop of the streets does not jump it ahead.
    const hit = projectOnPolyline(this.path, this.cum, p, Math.max(0, this.segment - 3));
    const off = hit.offset > Math.max(OFF_ROUTE, accuracy * 1.5);
    this.off = off ? this.off + 1 : 0;
    if (!off) {
      this.along = hit.along;
      this.segment = hit.segment;
    }
    const left = Math.max(0, this.total - this.along);
    const k = this.turns.findIndex((t) => t.at > this.along + 2);
    const index = k < 0 ? this.turns.length - 1 : k;
    const next = this.turns[index]!;
    const toNext = Math.max(0, next.at - this.along);
    const arrived = left < THERE && !off;
    let cue: WalkState['cue'];
    const said = this.told.get(index);
    if (!off && toNext <= NOW && said !== 'now') cue = { turn: next, stage: 'now' };
    else if (!off && toNext <= SOON && toNext > NOW && !said) cue = { turn: next, stage: 'soon' };
    if (cue) this.told.set(index, cue.stage);
    return {
      along: this.along,
      offset: hit.offset,
      next,
      toNext,
      left,
      // Twice in a row, not a single stray fix.
      offRoute: this.off >= 2,
      arrived,
      ...(cue ? { cue } : {}),
    };
  }
}
