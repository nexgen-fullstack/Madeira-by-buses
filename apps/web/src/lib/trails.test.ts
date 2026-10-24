import { describe, expect, it } from 'vitest';
import { encodePolyline, haversine, type LatLon, type Trail } from '@madeirabus/engine';
import {
  branchKeys,
  endOf,
  mergeWalk,
  nearbyTrails,
  reversedTrail,
  startsAtEnd,
  trailBranches,
  trailLines,
  trailRegion,
  walkEnds,
} from './trails.ts';

const at = (lat: number, lon: number) => ({ start: [lat, lon] }) as unknown as Trail;

describe('where a trail starts', () => {
  it('lists it by the region of the island it starts in', () => {
    // PR 6 at Rabaçal, PR 8 at Baía d'Abra, PR 9 at Queimadas, PR 1 at Pico do Areeiro.
    expect(trailRegion(at(32.7546, -17.1325))).toBe('west');
    expect(trailRegion(at(32.7433, -16.701))).toBe('east');
    expect(trailRegion(at(32.7848, -16.9016))).toBe('north');
    expect(trailRegion(at(32.7356, -16.9286))).toBe('mountains');
    // Levada dos Tornos above Funchal.
    expect(trailRegion(at(32.6702, -16.8899))).toBe('funchal');
  });
});

/** A trail along points (lat, lon), from the first to the last. */
const trail = (id: string, ...points: [number, number][]) => {
  const line: LatLon[] = points.map(([lat, lon]) => ({ lat, lon }));
  return {
    id,
    name: id,
    kind: 'levada',
    osm: 1,
    length: 1000,
    up: 100,
    down: 20,
    low: 500,
    high: 600,
    roundtrip: false,
    start: points[0]!,
    end: points.at(-1)!,
    lines: [encodePolyline(line)],
  } as Trail;
};

describe('a trail walked from its end', () => {
  it('starts at its end, goes down what it climbed, its line the other way', () => {
    const t = trail('a', [32.7, -16.9], [32.7, -16.89], [32.71, -16.89]);
    const r = reversedTrail(t);
    expect([r.start, r.end, r.up, r.down]).toEqual([t.end, t.start, 20, 100]);
    expect(trailLines(r)[0]).toEqual([...trailLines(t)[0]!].reverse());
  });
});

describe('the other trails met on the way', () => {
  // A levada 2 km east along 32.70.
  const main = trail('main', [32.7, -16.9], [32.7, -16.88]);
  it('turn off where they cross or join it, each to where it ends', () => {
    // One crossing it in the middle, north to south: both ways from the crossing.
    const across = trail('across', [32.71, -16.89], [32.69, -16.89]);
    // One coming down from the north and ending on it: walked from it, it is walked backwards.
    const joins = trail('joins', [32.71, -16.885], [32.7, -16.885]);
    // One along the same path, and one far away: none.
    const along = trail('along', [32.7, -16.899], [32.7, -16.881]);
    const far = trail('far', [32.8, -16.9], [32.8, -16.88]);
    const found = trailBranches(main, [main, across, joins, along, far]);
    expect(found.map((b) => [b.trail.id, b.reversed, b.rejoins])).toEqual([
      ['across', true, false],
      ['across', false, false],
      ['joins', true, false],
    ]);
    // Each from the crossing on the levada to the other trail's end.
    for (const b of found) {
      expect(Math.abs(b.coords[0]!.lat - 32.7)).toBeLessThan(0.0003);
      expect(Math.abs(b.coords.at(-1)!.lat - 32.7)).toBeGreaterThan(0.009);
    }
    expect(haversine(found[2]!.coords.at(-1)!, { lat: 32.71, lon: -16.885 })).toBeLessThan(1);
  });

  it('come back onto it when they are another way between two of its places', () => {
    const detour = trail('detour', [32.7, -16.895], [32.705, -16.89], [32.7, -16.885]);
    const [b] = trailBranches(main, [detour]);
    expect(b).toMatchObject({ rejoins: true, reversed: false });
    // Mapped the other way, it is still walked the way the levada goes: from the earlier place.
    const back = trail('back', [32.7, -16.885], [32.705, -16.89], [32.7, -16.895]);
    const [c] = trailBranches(main, [back]);
    expect(c).toMatchObject({ rejoins: true, reversed: true });
    expect(c!.coords[0]!.lon).toBeCloseTo(-16.895, 3);
  });

  it('run on with the walk: one behind its start comes into it, and turns round with it', () => {
    // The promenade from the Lido runs on along the levada past its start, as the Passeio
    // Público Marítimo along the one from Praia Formosa to Câmara de Lobos.
    const promenade = trail('promenade', [32.7, -16.92], [32.7, -16.9], [32.7, -16.88]);
    const [b] = trailBranches(main, [promenade]);
    // Walked east from the start: the promenade is walked east into it, its chequered flag
    // where the levada starts.
    expect(b!.reversed).toBe(false);
    expect(b!.coords[0]!.lon).toBeCloseTo(-16.92, 3);
    expect(haversine(b!.coords.at(-1)!, { lat: 32.7, lon: -16.9 })).toBeLessThan(30);
    // Walked west from the end, the promenade goes on west from where the levada ends.
    const [w] = trailBranches(reversedTrail(main), [promenade]);
    expect(w!.reversed).toBe(true);
    expect(haversine(w!.coords[0]!, { lat: 32.7, lon: -16.9 })).toBeLessThan(30);
    expect(w!.coords.at(-1)!.lon).toBeCloseTo(-16.92, 3);
  });
});

describe('which end a trail starts at', () => {
  const main = trail('main', [32.7, -16.9], [32.7, -16.88]);
  it('is the end nearer to the phone, where it is known', () => {
    expect(startsAtEnd(main, undefined)).toBe(false);
    expect(startsAtEnd(main, { lat: 32.69, lon: -16.905 })).toBe(false);
    expect(startsAtEnd(main, { lat: 32.69, lon: -16.87 })).toBe(true);
    // A loop starts where it is mapped to.
    expect(startsAtEnd({ ...main, roundtrip: true }, { lat: 32.69, lon: -16.87 })).toBe(false);
  });
});

describe('a trail in pieces', () => {
  // The Passeio Público Marítimo: Câmara de Lobos to Baía Azul, then on to the Lido in two
  // more pieces, each starting a few tens of metres from where the one before ends.
  const t = {
    ...trail('ppm', [32.7, -16.9], [32.7, -16.89]),
    lines: [
      encodePolyline([
        { lat: 32.7, lon: -16.9 },
        { lat: 32.7, lon: -16.89 },
      ]),
      encodePolyline([
        { lat: 32.7, lon: -16.8897 },
        { lat: 32.7, lon: -16.885 },
      ]),
      encodePolyline([
        { lat: 32.7003, lon: -16.885 },
        { lat: 32.7, lon: -16.88 },
      ]),
    ],
  } as Trail;
  it('ends where its last piece ends', () => {
    expect(endOf(t).lon).toBeCloseTo(-16.88, 5);
  });
  it('walked from its end, starts there, its pieces the other way and in the other order', () => {
    const back = reversedTrail(t);
    expect(back.start[1]).toBeCloseTo(-16.88, 5);
    const lines = trailLines(back);
    expect(lines[0]![0]!.lon).toBeCloseTo(-16.88, 5);
    expect(lines.at(-1)!.at(-1)!.lon).toBeCloseTo(-16.9, 5);
    expect(endOf(back).lon).toBeCloseTo(-16.9, 5);
  });
});

describe('a walk with other trails added', () => {
  const main = trail('main', [32.7, -16.9], [32.7, -16.88]);
  // One leading into its start from the west, one going on past its end to the east.
  const into = trail('into', [32.7, -16.92], [32.7, -16.9]);
  const on = trail('on', [32.7, -16.88], [32.7, -16.86]);
  const branches = trailBranches(main, [main, into, on]);
  it('keys each way off once, by its trail', () => {
    expect(branchKeys(branches)).toEqual(['into.0', 'on.0']);
  });
  it('starts where the trail leading in starts, and ends where the one going on ends', () => {
    const ends = walkEnds(main, branches);
    expect(ends.starts.map((s) => s.trail.id)).toEqual(['main', 'into', 'on']);
    expect(ends.starts[ends.start]!.trail.id).toBe('into');
    expect(ends.end.trail.id).toBe('on');
    expect(ends.end.at.lon).toBeCloseTo(-16.86, 3);
    // Alone, the trail's own start and end.
    const alone = walkEnds(main, []);
    expect([alone.start, alone.end.trail.id]).toEqual([0, 'main']);
  });
  it('starts at the start nearest to the phone', () => {
    const ends = walkEnds(main, branches, { lat: 32.69, lon: -16.861 });
    expect(ends.starts[ends.start]!.trail.id).toBe('on');
    const west = walkEnds(main, branches, { lat: 32.69, lon: -16.899 });
    expect(west.starts[west.start]!.trail.id).toBe('main');
  });
});

describe('the trails near one chosen', () => {
  const main = trail('main', [32.7, -16.9], [32.7, -16.89]);
  // About 780 m from the levada's end: a quarter of an hour on foot.
  const walk = trail('walk', [32.707, -16.89], [32.72, -16.87]);
  // About 1.5 km from its end: too far to walk to in a quarter of an hour.
  const half = trail('half', [32.714, -16.89], [32.72, -16.86]);
  // Near a bus stop, but not on foot: a bus does not bring it near any more.
  const bus = trail('bus', [32.701, -16.741], [32.71, -16.73]);
  const far = trail('far', [32.8, -17.2], [32.81, -17.21]);
  const met = trail('met', [32.9, -17.3], [32.91, -17.31]);
  it('are those met or a quarter of an hour on foot; none of the rest', () => {
    const near = nearbyTrails(main, [main, walk, half, bus, far, met], ['met']);
    expect([...near].sort()).toEqual(['main', 'met', 'walk']);
  });
});

describe('trails merged into one walk', () => {
  // A levada 2 km east along 32.70, climbing 100 m and going down 20.
  const main = trail('main', [32.7, -16.9], [32.7, -16.88]);
  const km = (m: number) => Math.round(m / 100) / 10;

  it('walks a trail met near the start first, from its far end, and the trail on', () => {
    // A path of ~1.1 km coming down from the north to the levada's start.
    const lead = trail('lead', [32.71, -16.9], [32.7, -16.9]);
    const branches = trailBranches(main, [main, lead]);
    const walk = mergeWalk(main, branches);
    expect(walk.pieces.map((p) => p.trail.id)).toEqual(['lead', 'main']);
    expect(haversine(walk.start.at, { lat: 32.71, lon: -16.9 })).toBeLessThan(5);
    expect(haversine(walk.end.at, endOf(main))).toBeLessThan(5);
    expect(km(walk.length)).toBeCloseTo(km(1112 + 1873), 0);
    // The path walked as mapped (north to south): its own climb, and all of the levada's.
    expect(walk.up).toBe(200);
    expect(walk.down).toBe(40);
  });

  it('walks a trail met near the end last, the levada up to there', () => {
    const off = trail('off', [32.7, -16.88], [32.69, -16.88]);
    const walk = mergeWalk(main, trailBranches(main, [main, off]));
    expect(walk.pieces.map((p) => p.trail.id)).toEqual(['main', 'off']);
    expect(haversine(walk.end.at, { lat: 32.69, lon: -16.88 })).toBeLessThan(5);
  });

  it('starts at the other end when the whole walk is turned round', () => {
    const lead = trail('lead', [32.71, -16.9], [32.7, -16.9]);
    const back = reversedTrail(main);
    const walk = mergeWalk(back, trailBranches(back, [back, lead]));
    expect(walk.pieces.map((p) => p.trail.id)).toEqual(['main', 'lead']);
    expect(haversine(walk.start.at, { lat: 32.7, lon: -16.88 })).toBeLessThan(5);
    expect(haversine(walk.end.at, { lat: 32.71, lon: -16.9 })).toBeLessThan(5);
  });
});
