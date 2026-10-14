import { useEffect, useMemo, useRef, useState } from 'react';
import { haversine, type LatLon } from '@madeirabus/engine';
import type { PlannerClient } from '../worker/client.ts';

/** A fix of the phone's GPS. */
export interface Fix extends LatLon {
  accuracy?: number;
  timestamp?: number;
  /** m/s, when the phone tells it. */
  speed?: number | null;
}

/**
 * Puts the phone's GPS fixes where the person is (`PlannerClient.snap`): walking, just where
 * the phone says — on a pedestrian street, in a square, inside a church — never moved onto
 * the nearest pavement; going faster than a walker can (a bus, a car), on the road. Its speed
 * from the phone, or from the last two fixes.
 */
export class Snapper {
  private last?: { p: LatLon; time: number };

  constructor(private readonly planner: PlannerClient) {}

  /** The fix on the road at speed; else, or with no road near or loaded, as it came. */
  async place(fix: Fix): Promise<LatLon> {
    const time = fix.timestamp ?? Date.now();
    let speed = fix.speed ?? undefined;
    if (speed === undefined && this.last && time > this.last.time) {
      speed = haversine(this.last.p, fix) / ((time - this.last.time) / 1000);
    }
    this.last = { p: { lat: fix.lat, lon: fix.lon }, time };
    try {
      const on = await this.planner.snap(fix, fix.accuracy ?? 20, speed ?? 0);
      return on ?? { lat: fix.lat, lon: fix.lon };
    } catch {
      return { lat: fix.lat, lon: fix.lon };
    }
  }
}

/** `fix` where the person is (see `Snapper`); as it is until the first answer. */
export function useSnapped<T extends Fix>(
  fix: T | undefined,
  planner: PlannerClient | undefined,
): T | undefined {
  const snapper = useRef<Snapper | undefined>(undefined);
  if (planner && !snapper.current) snapper.current = new Snapper(planner);
  const [placed, setPlaced] = useState<{ of: T; at: LatLon } | undefined>();
  useEffect(() => {
    if (!fix || !snapper.current) return;
    let cancelled = false;
    void snapper.current.place(fix).then((at) => !cancelled && setPlaced({ of: fix, at }));
    return () => {
      cancelled = true;
    };
  }, [fix]);
  // The last fix placed (a few milliseconds behind the newest), not a jump off the road and
  // back while the next answer comes.
  return useMemo(
    () =>
      !fix ? undefined : placed ? { ...placed.of, lat: placed.at.lat, lon: placed.at.lon } : fix,
    [fix, placed],
  );
}
