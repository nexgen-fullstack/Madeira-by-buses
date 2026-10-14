import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unpackRing, unpackSea } from './sea.ts';

const packed = JSON.parse(
  readFileSync(new URL('../../public/coast.json', import.meta.url), 'utf8'),
) as Parameters<typeof unpackSea>[0];

/** Twice a ring's area in degrees², anticlockwise positive. */
const area = (ring: [number, number][]) =>
  ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length]!;
    return sum + x * ny - nx * y;
  }, 0);

describe("the sea's bands", () => {
  it('unpacks a ring from its steps', () => {
    expect(unpackRing([-1700000, 3270000, 100, 0, 0, 100, -100, -100])).toEqual([
      [-17, 32.7],
      [-16.999, 32.7],
      [-16.999, 32.701],
      [-17, 32.7],
    ]);
  });

  it('are pieces without holes, each wound one way', () => {
    // A ring with a hole round the island loses the hole in the map's tiles inside it,
    // which then paint the land over with sea (2026-10-14).
    const sea = unpackSea(packed);
    expect(sea.features.length).toBeGreaterThan(1000);
    for (const f of sea.features) {
      expect(f.geometry.coordinates).toHaveLength(1);
      expect(area(f.geometry.coordinates[0]!)).toBeGreaterThan(0);
    }
  });

  it('run from the shore out to the open sea', () => {
    const distances = [...new Set(unpackSea(packed).features.map((f) => f.properties.d))];
    expect(distances[0]).toBeLessThan(20);
    expect(distances.at(-1)).toBe(9999);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('leave the land bare: no band over Funchal, Pico Ruivo or Porto Santo', () => {
    const inside = (ring: [number, number][], [x, y]: [number, number]) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const sea = unpackSea(packed);
    for (const land of [
      [-16.908, 32.652], // Funchal, Sé
      [-16.943, 32.759], // Pico Ruivo
      [-16.34, 33.07], // Porto Santo, Vila Baleira
    ] as [number, number][]) {
      expect(sea.features.some((f) => inside(f.geometry.coordinates[0]!, land))).toBe(false);
    }
    // And the sea off Funchal is sea.
    expect(sea.features.some((f) => inside(f.geometry.coordinates[0]!, [-16.9, 32.6]))).toBe(true);
  });
});
