import { useEffect, useState } from 'react';
import { useApp } from '../state/app.tsx';
import { canNotify, notify } from './device.ts';
import { load, save } from './storage.ts';
import {
  loadSea,
  loadWarnings,
  loadWeather,
  weatherWord,
  type Forecast,
  type Sea,
  type Warning,
} from './weather.ts';

/** How often the warnings are looked at again while the app is open (ms). */
const WARNINGS_EVERY = 30 * 60_000;

let warningsAt = 0;
let warningsKept: Warning[] | undefined;
const listeners = new Set<(w: Warning[] | undefined) => void>();

/** IPMA's warnings for Madeira, shared by every screen, looked at again every half hour. */
async function refreshWarnings(force = false): Promise<Warning[] | undefined> {
  if (!force && warningsKept && Date.now() - warningsAt < WARNINGS_EVERY) return warningsKept;
  const fresh = await loadWarnings();
  if (fresh) {
    warningsKept = fresh;
    warningsAt = Date.now();
    for (const l of listeners) l(fresh);
  }
  return warningsKept;
}

/** The official warnings for Madeira (undefined until known), kept fresh while the app is open. */
export function useWarnings(): Warning[] | undefined {
  const [warnings, setWarnings] = useState(warningsKept);
  useEffect(() => {
    listeners.add(setWarnings);
    void refreshWarnings();
    const id = window.setInterval(() => void refreshWarnings(), WARNINGS_EVERY);
    const back = () => document.visibilityState === 'visible' && void refreshWarnings();
    document.addEventListener('visibilitychange', back);
    return () => {
      listeners.delete(setWarnings);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return warnings;
}

export interface WeatherState {
  forecasts?: Forecast[];
  /** When the forecast was fetched (ms). */
  at?: number;
  sea?: Sea[];
  /** The forecast could not be had, fresh or kept. */
  failed?: boolean;
}

/** The forecast for every part of the island and the sea, fetched when a screen asks. */
export function useWeather(withSea = false): WeatherState {
  const [state, setState] = useState<WeatherState>({});
  useEffect(() => {
    let live = true;
    const get = () =>
      void loadWeather().then(
        (w) =>
          live &&
          setState((s) =>
            w ? { ...s, forecasts: w.forecasts, at: w.at } : { ...s, failed: true },
          ),
      );
    get();
    const id = window.setInterval(get, 15 * 60_000);
    if (withSea) void loadSea().then((sea) => live && setState((s) => ({ ...s, sea })));
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [withSea]);
  return state;
}

const TOLD = 'madeirabus.weatherTold.v1';

/**
 * A notification for each new official warning (yellow, orange, red) for Madeira, once, where
 * the phone lets the app notify; the warnings themselves for a banner.
 */
export function useWeatherAlerts(): Warning[] | undefined {
  const warnings = useWarnings();
  const { settings } = useApp();
  useEffect(() => {
    if (!warnings || warnings.length === 0) return;
    const told = new Set(load<{ keys: string[] }>(TOLD, { keys: [] }).keys);
    const fresh = warnings.filter((w) => !told.has(`${w.area}|${w.type}|${w.level}|${w.start}`));
    if (fresh.length === 0) return;
    void canNotify().then((ok) => {
      if (!ok) return;
      const lang = settings.lang;
      for (const w of fresh) {
        const title = `⚠️ ${weatherWord(w.level, lang)}: ${weatherWord(w.type, lang)}`;
        const body = `${weatherWord(w.area, lang)} · ${w.start.slice(11, 16)}–${w.end.slice(11, 16)}`;
        void notify(title, w.text ? `${body}. ${w.text}` : body, 'madeirabus-weather');
      }
      // Only the warnings still in force are remembered.
      const keep = warnings.map((w) => `${w.area}|${w.type}|${w.level}|${w.start}`);
      save(TOLD, { keys: keep });
    });
  }, [warnings, settings.lang]);
  return warnings;
}
