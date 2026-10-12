import type { Itinerary, LatLon, Network, RideLeg } from '@madeirabus/engine';
import { rideColor } from './mapContent.ts';

/** A bus on the map where it is now: in its ride's colour with its number, or gold with you in it. */
export interface LiveBus extends LatLon {
  /** Stays the same while it moves. */
  key: string;
  color: string;
  /** The line's number. */
  text: string;
  /** You are in it: gold, with your dot on it. */
  aboard?: boolean;
}

/** The gold of the bus you are in. */
export const ABOARD_GOLD = '#FFC400';

/** How long before its first departure a bus is shown waiting at its first stop (s). */
const AT_TERMINUS = 20 * 60;

/** Where one ride's bus is by the timetable: the point, and the index of the stop it is at or going to. */
export interface BusNow {
  leg: RideLeg;
  /** Which ride of the way (0 = the first bus). */
  index: number;
  point: LatLon;
  pos: number;
  /** It has not left its first stop yet. */
  waiting: boolean;
}

/**
 * Where the buses of a way are now by their timetable, each until it reaches the stop it is
 * left at; one about to set off waits at its first stop. None on another day than today.
 */
export function busesNow(
  net: Network,
  it: Itinerary,
  date: string,
  today: string,
  time: number,
): BusNow[] {
  if (date !== today) return [];
  const out: BusNow[] = [];
  let index = 0;
  for (const leg of it.legs) {
    if (leg.kind !== 'ride') continue;
    const i = index++;
    if (time > leg.end) continue;
    const at = net.busAt(leg.pattern, date, leg.dayTrip, time);
    if (at) {
      out.push({ leg, index: i, point: at.point, pos: at.pos, waiting: false });
      continue;
    }
    // Not out yet: at its first stop when it leaves soon.
    const first = net.tripStops(leg.pattern, date, leg.dayTrip)[0];
    if (first && time < first.dep && first.dep - time <= AT_TERMINUS) {
      const start = net.busAt(leg.pattern, date, leg.dayTrip, first.dep);
      if (start) out.push({ leg, index: i, point: start.point, pos: 0, waiting: true });
    }
  }
  return out;
}

/** The buses for the map. */
export function liveBuses(net: Network, buses: readonly BusNow[]): LiveBus[] {
  return buses.map((b) => ({
    key: `${b.leg.pattern}:${b.leg.dayTrip}`,
    lat: b.point.lat,
    lon: b.point.lon,
    color: rideColor(b.index),
    text: net.routes[b.leg.route]!.short,
  }));
}
