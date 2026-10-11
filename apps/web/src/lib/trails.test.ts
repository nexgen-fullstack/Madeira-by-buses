import { describe, expect, it } from 'vitest';
import { encodePolyline, haversine, type LatLon, type Trail } from '@madeirabus/engine';
import { reversedTrail, startsAtEnd, trailBranches, trailLines, trailRegion } from './trails.ts';

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
