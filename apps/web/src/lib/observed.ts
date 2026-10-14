import { haversine, type LatLon } from '@madeirabus/engine';
import type { Forecast } from './weather.ts';

/**
 * The temperature now as IPMA's weather stations on the islands measure it, every hour,
 * rather than as a forecast model reckons it: a model's grid is kilometres wide and on
 * Madeira misses by a few degrees (a sea breeze, a valley in the shade). The station nearest
 * a place (at its height, a degree cooler for every 150 m up) sets "now"; the next hours
 * lean on it less and less, then the forecast is its own.
 */

const OBSERVATIONS =
  'https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json';

/** IPMA's stations on Madeira and Porto Santo: id, where, height of the ground (m). */
export const STATIONS: readonly (LatLon & { id: string; alt: number })[] = [
  ['1210956', 32.8675, -17.1714, 36], // Porto Moniz
  ['1210960', 32.8345, -16.9062, 222], // São Jorge
  ['1210965', 32.8082, -16.8864, 405], // Santana
  ['1210967', 32.8002, -17.0447, 86], // São Vicente
  ['1210970', 32.7565, -17.0577, 1565], // Bica da Cana
  ['1210972', 32.6935, -16.904, 1106], // Pico Alto
  ['1210973', 32.7167, -16.9167, 1469], // Areeiro
  ['1210974', 32.7351, -16.9283, 1801], // Pico do Areeiro
  ['1210975', 32.7259, -16.8168, 687], // Santo da Serra
  ['1210976', 32.6758, -16.9069, 599], // Monte
  ['1210977', 32.645, -16.8657, 275], // Cancela
  ['1210978', 32.747, -16.706, 124], // São Lourenço
  ['1210980', 32.831, -17.202, 929], // Lombo da Terça
  ['1210984', 32.663, -17.015, 592], // Quinta Grande
  ['1210986', 32.6815, -17.1042, 74], // Ponta do Sol
  ['1210987', 32.7572, -17.2016, 632], // Prazeres
  ['1210990', 32.8138, -17.2632, 276], // Calheta
  ['1200521', 32.6969, -16.7761, 71], // Santa Catarina (airport)
  ['1200522', 32.6479, -16.888, 87], // Funchal
  ['1240971', 32.6365, -16.9356, 12], // Funchal, Lido
  ['1200524', 33.074, -16.3487, 85], // Porto Santo
].map(([id, lat, lon, alt]) => ({
  id: id as string,
  lat: lat as number,
  lon: lon as number,
  alt: alt as number,
}));

/** °C cooler per metre up. */
const LAPSE = 0.0065;
/** A station this far (km) or this much higher or lower (m) says nothing of a place. */
const REACH = 15;
const CLIMB = 450;
/** A measurement older than this (ms) is not "now". */
const STALE = 2.5 * 3600_000;
/** Over this many hours ahead the forecast is its own again. */
const FADE_HOURS = 6;
/** A station further off than the model (°C) is out of order, not the weather. */
const MAX_SHIFT = 7;

/** The last temperature each station measured, and when (ms). */
export type Measured = Map<string, { temp: number; at: number }>;

type Answer = Record<string, Record<string, { temperatura?: number } | null>>;

/** The latest measurement of each station in IPMA's answer (times are UTC; -99: none). */
export function readObservations(answer: Answer): Measured {
  const out: Measured = new Map();
  for (const time of Object.keys(answer).sort()) {
    const at = Date.parse(`${time}:00Z`);
    for (const [id, v] of Object.entries(answer[time] ?? {})) {
      const t = v?.temperatura;
      if (typeof t === 'number' && t > -50 && t < 50) out.set(id, { temp: t, at });
    }
  }
  return out;
}

/**
 * The temperature at a place now from the stations near it at a like height (each brought
 * to the place's height), the nearer weighing more; undefined with none near or fresh.
 */
export function measuredAt(
  p: LatLon,
  elevation: number,
  measured: Measured,
  now = Date.now(),
): number | undefined {
  let sum = 0;
  let weights = 0;
  for (const s of STATIONS) {
    const m = measured.get(s.id);
    if (!m || now - m.at > STALE) continue;
    const km = haversine(p, s) / 1000;
    if (km > REACH || Math.abs(s.alt - elevation) > CLIMB) continue;
    const w = 1 / Math.max(km, 1) ** 2;
    sum += w * (m.temp + LAPSE * (s.alt - elevation));
    weights += w;
  }
  return weights > 0 ? sum / weights : undefined;
}

/**
 * A forecast with "now" as measured (and the "feels like" by as much), the next hours
 * nudged the same way less and less; as it was where no station is near.
 */
export function withMeasured(f: Forecast, measured: Measured, now = Date.now()): Forecast {
  const real = measuredAt(f.place, f.elevation, measured, now);
  if (real === undefined) return f;
  const shift = real - f.now.temp;
  if (Math.abs(shift) > MAX_SHIFT || Math.abs(shift) < 0.05) return f;
  // Both in the island's time: only their difference counts.
  const from = Date.parse(`${f.now.time.slice(0, 13)}:00Z`);
  const hours = f.hours.map((h) => {
    const ahead = (Date.parse(`${h.time.slice(0, 13)}:00Z`) - from) / 3600_000;
    if (!(ahead >= 0)) return h;
    const k = Math.max(0, 1 - ahead / FADE_HOURS);
    return k > 0 ? { ...h, temp: h.temp + shift * k, feels: h.feels + shift * k } : h;
  });
  return {
    ...f,
    now: { ...f.now, temp: real, feels: f.now.feels + shift, measured: true },
    hours,
  };
}

let kept: { at: number; measured: Promise<Measured> } | undefined;

/** IPMA's latest measurements, asked at most every 20 minutes; none when they cannot be had. */
export function loadMeasured(): Promise<Measured> {
  if (kept && Date.now() - kept.at < 20 * 60_000) return kept.measured;
  const measured = fetch(OBSERVATIONS)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Answer>;
    })
    .then(readObservations)
    .catch((): Measured => {
      kept = undefined;
      return new Map();
    });
  kept = { at: Date.now(), measured };
  return measured;
}
