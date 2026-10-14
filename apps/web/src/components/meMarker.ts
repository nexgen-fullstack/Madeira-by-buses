import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { haversine, type LatLon } from '@madeirabus/engine';
import { onCompass } from '../lib/compass.ts';

/** The heading from one point to the next (degrees clockwise from north). */
export function bearing(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) -
    Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (((Math.atan2(y, x) / r) % 360) + 360) % 360;
}

/** Faster than this (m/s) the person rides: the beam then shows the way they go. */
const RIDING = 2.5;
/** A step shorter than this (m) says nothing of the way (the GPS wanders). */
const STEP = 6;

/**
 * The person on the map as Google Maps draws them: a blue dot, and a beam from it the way
 * the phone points (turned with the phone), or, riding, the way they go.
 */
export class MeMarker {
  private readonly el = document.createElement('div');
  private readonly marker: Marker;
  private stopCompass?: () => void;
  private compass?: number;
  private course?: number;
  private riding = false;
  private last?: LatLon & { t: number };

  constructor() {
    this.el.className = 'me-marker';
    this.el.innerHTML =
      '<span class="me-marker__beam"></span><span class="maplibregl-user-location-dot"></span>';
    this.marker = new Marker({ element: this.el, rotationAlignment: 'map', pitchAlignment: 'map' });
  }

  get shown(): boolean {
    return this.el.isConnected;
  }

  /** Puts the dot where the person is (with the GPS's own heading and speed when it has them). */
  place(map: MapLibreMap, p: LatLon, gps?: { heading?: number | null; speed?: number | null }) {
    const now = Date.now();
    if (typeof gps?.speed === 'number' && gps.speed >= 0) this.riding = gps.speed > RIDING;
    if (typeof gps?.heading === 'number' && !Number.isNaN(gps.heading) && (gps.speed ?? 0) > 0.7) {
      this.course = gps.heading;
    } else if (this.last && haversine(this.last, p) > STEP) {
      this.course = bearing(this.last, p);
      if (gps?.speed == null) {
        this.riding = haversine(this.last, p) / Math.max(1, (now - this.last.t) / 1000) > RIDING;
      }
    }
    if (!this.last || haversine(this.last, p) > STEP)
      this.last = { lat: p.lat, lon: p.lon, t: now };
    this.marker.setLngLat([p.lon, p.lat]);
    if (!this.el.isConnected) {
      this.marker.addTo(map);
      this.stopCompass ??= onCompass((h) => {
        this.compass = h;
        this.turn();
      });
    }
    this.turn();
  }

  remove(): void {
    this.marker.remove();
    this.stopCompass?.();
    this.stopCompass = undefined;
    this.compass = undefined;
    this.course = undefined;
    this.last = undefined;
  }

  private turn() {
    const h =
      this.riding && this.course !== undefined ? this.course : (this.compass ?? this.course);
    this.el.classList.toggle('me-marker--beam', h !== undefined);
    if (h !== undefined) this.marker.setRotation(h);
  }
}
