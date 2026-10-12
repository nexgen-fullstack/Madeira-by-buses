import { cumulativeDistances, haversine, projectOnPolyline, type LatLon } from '@madeirabus/engine';

/**
 * When a walker has left the way they were shown for good (a street taken that the walk does
 * not take), as a maps app sees it before it finds a new way: not one stray fix of the GPS,
 * but several in a row, for some seconds, each farther from the way than the GPS errs.
 */

/** Farther than this from the way (m, or the GPS's own error and a half), off it. */
export const OFF_WAY = 30;
/** Off for at least this many fixes in a row… */
const FIXES = 3;
/** …over at least this long (ms). */
const FOR_MS = 6_000;
/** A fix less sure than this (m) says nothing either way. */
const UNSURE = 50;
/** So close to the end (m) the walker is there whatever way they take. */
const NEAR_END = 40;
/** After a new way is found, the next no sooner than this (ms). */
export const COOLDOWN_MS = 15_000;

export class OffWay {
  private readonly cum: number[];
  private off = 0;
  private since?: number;
  private last = -Infinity;

  constructor(private readonly path: readonly LatLon[]) {
    this.cum = cumulativeDistances(path);
  }

  /** A fix of the phone at `now` (ms): true when it is time to look for a new way. */
  update(p: LatLon, accuracy: number | undefined, now: number): boolean {
    if (this.path.length < 2 || (accuracy ?? 0) > UNSURE) return false;
    if (haversine(p, this.path.at(-1)!) < NEAR_END) {
      this.off = 0;
      return false;
    }
    const hit = projectOnPolyline(this.path, this.cum, p);
    if (hit.offset <= Math.max(OFF_WAY, (accuracy ?? 0) * 1.5)) {
      this.off = 0;
      this.since = undefined;
      return false;
    }
    this.off++;
    this.since ??= now;
    if (this.off < FIXES || now - this.since < FOR_MS || now - this.last < COOLDOWN_MS)
      return false;
    this.last = now;
    this.off = 0;
    this.since = undefined;
    return true;
  }
}
