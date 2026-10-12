import { describe, expect, it } from 'vitest';
import { OffWay } from './reroute.ts';

/** A point `east` and `north` metres from a corner in Funchal. */
const at = (east: number, north: number) => ({
  lat: 32.65 + north / 110_540,
  lon: -16.91 + east / (111_320 * Math.cos((32.65 * Math.PI) / 180)),
});

describe('leaving the way walked', () => {
  // 400 m east along a street.
  const way = [at(0, 0), at(400, 0)];

  it('asks for a new way once the walker has turned up another street for good', () => {
    const off = new OffWay(way);
    let t = 0;
    // Along the street, a GPS that strays 20 m now and then: on the way.
    for (const [e, n] of [
      [10, 0],
      [40, 20],
      [80, -15],
      [120, 5],
    ] as const)
      expect(off.update(at(e, n), 10, (t += 2000))).toBe(false);
    // Up a side street to the north: not at the first fix, nor the second…
    expect(off.update(at(120, 45), 10, (t += 2000))).toBe(false);
    expect(off.update(at(120, 60), 10, (t += 2000))).toBe(false);
    expect(off.update(at(120, 75), 10, (t += 2000))).toBe(false);
    // …but when it has lasted.
    expect(off.update(at(120, 90), 10, (t += 2000))).toBe(true);
    // And not again straight away.
    expect(off.update(at(120, 110), 10, t + 2000)).toBe(false);
  });

  it('pays no heed to a fix it cannot trust, nor to the last steps', () => {
    const off = new OffWay(way);
    let t = 0;
    for (let i = 0; i < 8; i++) expect(off.update(at(100, 80), 120, (t += 2000))).toBe(false);
    for (let i = 0; i < 8; i++) expect(off.update(at(395, 30), 10, (t += 2000))).toBe(false);
  });
});
