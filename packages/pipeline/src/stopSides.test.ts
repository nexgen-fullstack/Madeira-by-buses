import { describe, expect, it } from 'vitest';
import { buildBundle, haversine, parseGtfs, SIGA_FARES_2026, toCsv } from '@madeirabus/engine';
import { placeStopsBySide } from './stopSides.ts';

/** Metres north of the road (along latitude 32.65) in degrees. */
const north = (m: number) => 32.65 + m / 110_540;

/**
 * A road running east along latitude 32.65: line 1 goes east along it, line 2 west along
 * part of it. Madeira drives on the right, so line 1's stops belong on the south pavement.
 */
function bundle() {
  const stops: [string, number, number][] = [
    ['00001', north(0), -16.95], // in the middle of the road
    ['00002', north(5), -16.94], // across the road
    ['00003', north(-4), -16.93], // on its pavement already
    ['00004', north(0), -16.92], // in the middle, its pole mapped beside it
    ['00005', north(0), -16.915], // one pole for both ways
    ['00006', north(0), -16.9], // the end of line 1
    ['00007', north(0), -16.91], // line 2
  ];
  const times = (trip: string, ids: string[]) =>
    ids.map((id, i) => [trip, `08:0${i}:00`, `08:0${i}:00`, id, i + 1]);
  const shape = (id: string, from: number, to: number) =>
    [from, to].map((lon, i) => [id, 32.65, lon, i + 1]);
  return buildBundle(
    [
      {
        feed: parseGtfs({
          'agency.txt': toCsv(
            ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
            [['T', 'Test', 'https://example.com', 'Atlantic/Madeira']],
          ),
          'stops.txt': toCsv(
            ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'],
            stops.map(([id, lat, lon]) => [id, `Stop ${id}`, lat, lon, 'FNC']),
          ),
          'routes.txt': toCsv(
            ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
            [
              ['R1', 'T', '1', 'East', 3],
              ['R2', 'T', '2', 'West', 3],
            ],
          ),
          'trips.txt': toCsv(
            ['route_id', 'service_id', 'trip_id', 'shape_id'],
            [
              ['R1', 'WK', 'east', 'E'],
              ['R2', 'WK', 'west', 'W'],
            ],
          ),
          'stop_times.txt': toCsv(
            ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
            [
              ...times('east', ['00001', '00002', '00003', '00004', '00005', '00006']),
              ...times('west', ['00007', '00005']),
            ],
          ),
          'shapes.txt': toCsv(
            ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
            [...shape('E', -16.95, -16.9), ...shape('W', -16.91, -16.915)],
          ),
          'calendar.txt': toCsv(
            [
              'service_id',
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
              'sunday',
              'start_date',
              'end_date',
            ],
            [['WK', 1, 1, 1, 1, 1, 0, 0, '20260101', '20271231']],
          ),
        }),
        source: { name: 'test' },
      },
    ],
    { demo: false, fares: SIGA_FARES_2026, generatedAt: '2026-10-01T00:00:00Z' },
  ).bundle;
}

describe('stops on their side of the road', () => {
  it('puts each stop on the pavement on the right of its buses, at its pole when mapped', () => {
    const b = bundle();
    const before = b.stops.map((s) => ({ lat: s.lat, lon: s.lon }));
    const pole = { lat: north(-6), lon: -16.9199, tags: { highway: 'bus_stop', gtfs_id: '4' } };
    const stats = placeStopsBySide(b, undefined, [
      pole,
      // A pole of another stop across the road: not this one's.
      { lat: north(6), lon: -16.92, tags: { highway: 'bus_stop', gtfs_id: '4' } },
    ]);
    const at = (id: string) => b.stops.find((s) => s.id === id)!;
    const was = (id: string) => before[b.stops.findIndex((s) => s.id === id)]!;
    // From the middle and from across the road to 3.5 m south of the middle.
    expect(at('00001').lat).toBeCloseTo(north(-3.5), 6);
    expect(at('00002').lat).toBeCloseTo(north(-3.5), 6);
    // Where it was.
    expect(at('00003')).toMatchObject(was('00003'));
    // At its pole.
    expect(haversine(at('00004'), pole)).toBeLessThan(0.5);
    // Both ways at one pole: left alone.
    expect(at('00005')).toMatchObject(was('00005'));
    expect(stats).toMatchObject({ right: 1, osm: 1 });
    expect(stats.kept).toBeGreaterThanOrEqual(1);
  });
});
