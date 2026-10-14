/**
 * Which way the phone points (degrees clockwise from north), as Google Maps' beam shows it:
 * from the phone's compass (Android's `deviceorientationabsolute`, iOS' `webkitCompassHeading`),
 * smoothed so the beam turns steadily, at most some fifteen times a second. Listened to only
 * while something on screen shows it.
 */

type Listener = (heading: number) => void;

const listeners = new Set<Listener>();
let smooth: number | undefined;
let sent = 0;

/** The way between two headings, -180..180. */
export const turnBetween = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/** A heading from an orientation event, undefined when it has no compass in it. */
export function compassHeading(
  e: Pick<DeviceOrientationEvent, 'alpha' | 'absolute'> & { webkitCompassHeading?: number },
  screenAngle = 0,
): number | undefined {
  let h: number | undefined;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
  if (h === undefined || Number.isNaN(h)) return undefined;
  // The phone on its side: its top points elsewhere than the screen's.
  return (((h + screenAngle) % 360) + 360) % 360;
}

function onOrientation(e: DeviceOrientationEvent) {
  const h = compassHeading(e, globalThis.screen?.orientation?.angle ?? 0);
  if (h === undefined) return;
  smooth = smooth === undefined ? h : (smooth + turnBetween(smooth, h) * 0.25 + 360) % 360;
  const now = performance.now();
  if (now - sent < 66) return;
  sent = now;
  for (const l of listeners) l(smooth);
}

/** Calls `listener` with the phone's heading as it turns; returns how to stop. */
export function onCompass(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (listeners.size === 0) {
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener);
    window.addEventListener('deviceorientation', onOrientation);
  }
  listeners.add(listener);
  if (smooth !== undefined) listener(smooth);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener);
      window.removeEventListener('deviceorientation', onOrientation);
      smooth = undefined;
    }
  };
}
