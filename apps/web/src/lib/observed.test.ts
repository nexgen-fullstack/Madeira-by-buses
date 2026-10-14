import { describe, expect, it } from 'vitest';
import { measuredAt, readObservations, withMeasured } from './observed.ts';
import type { Forecast } from './weather.ts';

const NOW = Date.parse('2026-10-14T06:30:00Z');
const answer = {
  '2026-10-14T05:00': { '1200522': { temperatura: 20.5 }, '1240971': { temperatura: 20.8 } },
  '2026-10-14T06:00': { '1200522': { temperatura: 20.4 }, '1240971': { temperatura: -99 } },
};

const forecast = (lat: number, lon: number, elevation: number, temp: number): Forecast =>
  ({
    place: { id: 'x', name: 'X', lat, lon, area: 'MCS' },
    elevation,
    now: { time: '2026-10-14T07:30', temp, feels: temp - 1 },
    hours: [0, 1, 2, 3, 6, 7].map((h) => ({
      time: `2026-10-14T${String(7 + h).padStart(2, '0')}:00`,
      temp,
      feels: temp - 1,
    })),
    days: [],
  }) as unknown as Forecast;

describe('the temperature now from IPMA’s stations', () => {
  it('keeps each station’s latest real measurement', () => {
    const m = readObservations(answer);
    expect(m.get('1200522')?.temp).toBe(20.4);
    // -99 is "none": the hour before stays.
    expect(m.get('1240971')?.temp).toBe(20.8);
  });

  it('brings the stations to the place’s height and leaves far ones out', () => {
    const m = readObservations(answer);
    const funchal = measuredAt({ lat: 32.6497, lon: -16.9086 }, 30, m, NOW)!;
    expect(funchal).toBeGreaterThan(20.4);
    expect(funchal).toBeLessThan(21.3);
    // 400 m up the hill: some 2.5° cooler.
    expect(measuredAt({ lat: 32.66, lon: -16.9 }, 480, m, NOW)!).toBeLessThan(18.5);
    // Porto Moniz: no station of these near.
    expect(measuredAt({ lat: 32.8666, lon: -17.1696 }, 30, m, NOW)).toBeUndefined();
    // Measured hours ago: not now.
    expect(measuredAt({ lat: 32.6497, lon: -16.9086 }, 30, m, NOW + 5 * 3600_000)).toBeUndefined();
  });

  it('sets now as measured and the next hours less and less', () => {
    const m = readObservations(answer);
    const f = withMeasured(forecast(32.6479, -16.888, 87, 23), m, NOW);
    expect(f.now.temp).toBeCloseTo(20.4, 1);
    expect(f.now.measured).toBe(true);
    expect(f.now.feels).toBeCloseTo(19.4, 1);
    expect(f.hours[0]!.temp).toBeCloseTo(20.4, 1);
    expect(f.hours[3]!.temp).toBeGreaterThan(20.4);
    expect(f.hours[5]!.temp).toBe(23);
  });
});
