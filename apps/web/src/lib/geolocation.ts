import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLon } from '@madeirabus/engine';
import { watchPosition, type Position } from './device.ts';

/** The last place the phone was known to be, from any screen. */
let last: Position | undefined;

/** Keeps where the phone was found (by the planner, a trip, the map's locate button). */
export function rememberPosition(p: Position): void {
  last = p;
}

/** Older than this (ms), where the phone was is no guide to where it is. */
const STALE = 30 * 60_000;

/**
 * Where the phone is, without asking the person: the last place known, or a quick fix when
 * the app may already use the location. Undefined when neither.
 */
export function useQuietPosition(): LatLon | undefined {
  const fresh = () => (last && Date.now() - last.timestamp < STALE ? last : undefined);
  const [here, setHere] = useState<LatLon | undefined>(fresh);
  useEffect(() => {
    if (here || !('geolocation' in navigator) || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled || status.state !== 'granted') return;
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const pos = {
              lat: p.coords.latitude,
              lon: p.coords.longitude,
              accuracy: p.coords.accuracy,
              timestamp: p.timestamp,
            };
            rememberPosition(pos);
            if (!cancelled) setHere(pos);
          },
          () => undefined,
          { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return here;
}

export interface GeoState {
  position?: Position;
  error?: 'denied' | 'unavailable';
  pending: boolean;
}

/**
 * One-shot or continuous geolocation. With `background`, the app keeps
 * receiving positions with the screen off (see `watchPosition`).
 */
export function useGeolocation(
  watch = false,
  background?: { title: string; text: string },
): GeoState & { request: () => void } {
  const [state, setState] = useState<GeoState>({ pending: false });
  const stop = useRef<(() => void) | undefined>(undefined);
  const backgroundRef = useRef(background);
  backgroundRef.current = background;

  const onPos = useCallback((position: Position) => {
    rememberPosition(position);
    setState({ pending: false, position });
  }, []);
  const onErr = useCallback((error: 'denied' | 'unavailable') => {
    setState((s) => ({ ...s, pending: false, error }));
  }, []);

  const request = useCallback(() => {
    setState((s) => ({ ...s, pending: true }));
    if (watch) {
      stop.current ??= watchPosition(onPos, onErr, backgroundRef.current);
      return;
    }
    if (!('geolocation' in navigator)) {
      onErr('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        onPos({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        }),
      (e) => onErr(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }, [watch, onPos, onErr]);

  useEffect(
    () => () => {
      stop.current?.();
      stop.current = undefined;
    },
    [],
  );

  return { ...state, request };
}
