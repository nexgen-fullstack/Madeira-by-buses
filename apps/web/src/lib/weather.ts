import type { Lang } from '../i18n.ts';
import { load, save } from './storage.ts';

/**
 * The weather on Madeira, as precise as a phone can have it for free: the forecast hour by
 * hour for each part of the island from Open-Meteo (the best weather models for the place,
 * brought down to its height — Pico do Arieiro is 1 818 m above Funchal's sea front), the
 * sea's waves and warmth from its marine forecast, and the official warnings of IPMA, the
 * Portuguese weather service, for the south coast, the north coast, the mountains and
 * Porto Santo (yellow, orange, red: rain, wind, rough sea, thunder, heat…).
 *
 * Both answer any phone straight away (no key; Open-Meteo is free for non-commercial use);
 * the last answer is kept for when the phone is offline.
 */

/** IPMA's warning areas on the islands of Madeira. */
export type WarningArea = 'MCS' | 'MCN' | 'MRM' | 'MPS';

export interface WeatherPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The warning area it is in. */
  area: WarningArea;
}

/**
 * The parts of the island the weather is told for, south to north and west to east, with
 * its heights: the weather of Madeira changes within a few kilometres.
 */
export const WEATHER_PLACES: readonly WeatherPlace[] = [
  { id: 'funchal', name: 'Funchal', lat: 32.6497, lon: -16.9086, area: 'MCS' },
  { id: 'camara-de-lobos', name: 'Câmara de Lobos', lat: 32.6489, lon: -16.9774, area: 'MCS' },
  { id: 'ribeira-brava', name: 'Ribeira Brava', lat: 32.6731, lon: -17.0636, area: 'MCS' },
  { id: 'calheta', name: 'Calheta', lat: 32.7214, lon: -17.1771, area: 'MCS' },
  { id: 'canico', name: 'Caniço', lat: 32.6448, lon: -16.8379, area: 'MCS' },
  { id: 'machico', name: 'Machico', lat: 32.7178, lon: -16.7667, area: 'MCS' },
  { id: 'porto-moniz', name: 'Porto Moniz', lat: 32.8666, lon: -17.1696, area: 'MCN' },
  { id: 'sao-vicente', name: 'São Vicente', lat: 32.7987, lon: -17.0432, area: 'MCN' },
  { id: 'santana', name: 'Santana', lat: 32.8073, lon: -16.8814, area: 'MCN' },
  { id: 'porto-da-cruz', name: 'Porto da Cruz', lat: 32.7726, lon: -16.8277, area: 'MCN' },
  { id: 'curral', name: 'Curral das Freiras', lat: 32.7203, lon: -16.9689, area: 'MRM' },
  { id: 'arieiro', name: 'Pico do Arieiro', lat: 32.7356, lon: -16.9286, area: 'MRM' },
  { id: 'paul-da-serra', name: 'Paul da Serra', lat: 32.7353, lon: -17.0559, area: 'MRM' },
  { id: 'porto-santo', name: 'Porto Santo', lat: 33.0612, lon: -16.3388, area: 'MPS' },
];

/** Where the sea is told: the south coast, the north coast, Porto Santo. */
export const SEA_PLACES = [
  { id: 'funchal', lat: 32.635, lon: -16.91 },
  { id: 'porto-moniz', lat: 32.875, lon: -17.18 },
  { id: 'porto-santo', lat: 33.04, lon: -16.33 },
] as const;

export interface WeatherNow {
  time: string;
  temp: number;
  feels: number;
  /** WMO weather code. */
  code: number;
  day: boolean;
  /** km/h */
  wind: number;
  gusts: number;
  /** Degrees the wind comes from. */
  dir: number;
  humidity: number;
  /** mm in the last quarter of an hour. */
  rain: number;
  cloud: number;
}

export interface WeatherHour {
  time: string;
  temp: number;
  /** % chance of rain. */
  chance: number;
  rain: number;
  code: number;
  day: boolean;
  wind: number;
  gusts: number;
  uv: number;
  /** m */
  visibility: number;
}

export interface WeatherDay {
  date: string;
  code: number;
  max: number;
  min: number;
  rain: number;
  chance: number;
  gusts: number;
  sunrise: string;
  sunset: string;
  uv: number;
}

export interface Forecast {
  place: WeatherPlace;
  /** The height the forecast is for (m). */
  elevation: number;
  now: WeatherNow;
  hours: WeatherHour[];
  days: WeatherDay[];
}

export interface Sea {
  id: string;
  /** m */
  waves: number;
  temp: number;
  /** The highest waves of each day ahead (m). */
  daysMax: number[];
}

export interface Warning {
  area: WarningArea;
  /** IPMA's name of the kind ("Precipitação"). */
  type: string;
  level: 'yellow' | 'orange' | 'red';
  start: string;
  end: string;
  text: string;
}

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const WARNINGS = 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json';
/** A forecast this fresh (ms) is not asked for again. */
const FRESH = 15 * 60_000;

const HOURLY = [
  'temperature_2m',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'is_day',
  'wind_speed_10m',
  'wind_gusts_10m',
  'uv_index',
  'visibility',
];
const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_gusts_10m_max',
  'sunrise',
  'sunset',
  'uv_index_max',
];
const CURRENT = [
  'temperature_2m',
  'apparent_temperature',
  'weather_code',
  'is_day',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'relative_humidity_2m',
  'precipitation',
  'cloud_cover',
];

/** The address of the forecast for every part of the island at once. */
export function forecastUrl(places: readonly WeatherPlace[] = WEATHER_PLACES): string {
  const q = new URLSearchParams({
    latitude: places.map((p) => p.lat).join(','),
    longitude: places.map((p) => p.lon).join(','),
    current: CURRENT.join(','),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    timezone: 'Atlantic/Madeira',
    forecast_days: '7',
    forecast_hours: '48',
    wind_speed_unit: 'kmh',
  });
  return `${FORECAST}?${q}`;
}

interface OpenMeteoAnswer {
  elevation: number;
  current: Record<string, number | string>;
  hourly: Record<string, (number | string | null)[]>;
  daily: Record<string, (number | string | null)[]>;
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/** Open-Meteo's answer for one place as the app reads it. */
export function readForecast(place: WeatherPlace, a: OpenMeteoAnswer): Forecast {
  const c = a.current;
  const h = a.hourly;
  const d = a.daily;
  return {
    place,
    elevation: Math.round(a.elevation),
    now: {
      time: String(c.time),
      temp: num(c.temperature_2m),
      feels: num(c.apparent_temperature),
      code: num(c.weather_code),
      day: c.is_day === 1,
      wind: num(c.wind_speed_10m),
      gusts: num(c.wind_gusts_10m),
      dir: num(c.wind_direction_10m),
      humidity: num(c.relative_humidity_2m),
      rain: num(c.precipitation),
      cloud: num(c.cloud_cover),
    },
    hours: (h.time ?? []).map((time, i) => ({
      time: String(time),
      temp: num(h.temperature_2m?.[i]),
      chance: num(h.precipitation_probability?.[i]),
      rain: num(h.precipitation?.[i]),
      code: num(h.weather_code?.[i]),
      day: h.is_day?.[i] === 1,
      wind: num(h.wind_speed_10m?.[i]),
      gusts: num(h.wind_gusts_10m?.[i]),
      uv: num(h.uv_index?.[i]),
      visibility: num(h.visibility?.[i]),
    })),
    days: (d.time ?? []).map((date, i) => ({
      date: String(date),
      code: num(d.weather_code?.[i]),
      max: num(d.temperature_2m_max?.[i]),
      min: num(d.temperature_2m_min?.[i]),
      rain: num(d.precipitation_sum?.[i]),
      chance: num(d.precipitation_probability_max?.[i]),
      gusts: num(d.wind_gusts_10m_max?.[i]),
      sunrise: String(d.sunrise?.[i] ?? ''),
      sunset: String(d.sunset?.[i] ?? ''),
      uv: num(d.uv_index_max?.[i]),
    })),
  };
}

const CACHE = 'madeirabus.weather.v1';
let pending: Promise<{ at: number; forecasts: Forecast[] } | undefined> | undefined;

/**
 * The forecast for every part of the island: fresh from Open-Meteo at most every quarter
 * of an hour, else the last one kept (offline: however old, with when it was fetched).
 */
export function loadWeather(): Promise<{ at: number; forecasts: Forecast[] } | undefined> {
  const kept = load<{ at: number; forecasts: Forecast[] } | undefined>(CACHE, undefined);
  if (kept && Date.now() - kept.at < FRESH) return Promise.resolve(kept);
  pending ??= (async () => {
    try {
      const res = await fetch(forecastUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const answers = (await res.json()) as OpenMeteoAnswer[];
      const forecasts = WEATHER_PLACES.map((p, i) => readForecast(p, answers[i]!));
      const fresh = { at: Date.now(), forecasts };
      save(CACHE, fresh);
      return fresh;
    } catch {
      return kept;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/** The sea now and the highest waves of the days ahead, on each coast. */
export async function loadSea(): Promise<Sea[]> {
  const q = new URLSearchParams({
    latitude: SEA_PLACES.map((p) => p.lat).join(','),
    longitude: SEA_PLACES.map((p) => p.lon).join(','),
    current: 'wave_height,sea_surface_temperature',
    daily: 'wave_height_max',
    timezone: 'Atlantic/Madeira',
  });
  try {
    const res = await fetch(`${MARINE}?${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const answers = (await res.json()) as {
      current: Record<string, number>;
      daily: { wave_height_max: (number | null)[] };
    }[];
    return SEA_PLACES.map((p, i) => ({
      id: p.id,
      waves: num(answers[i]?.current.wave_height),
      temp: num(answers[i]?.current.sea_surface_temperature),
      daysMax: (answers[i]?.daily.wave_height_max ?? []).map(num),
    }));
  } catch {
    return [];
  }
}

const AREAS: readonly WarningArea[] = ['MCS', 'MCN', 'MRM', 'MPS'];
const LEVELS = { yellow: 1, orange: 2, red: 3 } as const;

/** Of IPMA's warnings for all Portugal, Madeira's that are not green and not over. */
export function madeiraWarnings(
  all: readonly {
    idAreaAviso: string;
    awarenessTypeName: string;
    awarenessLevelID: string;
    startTime: string;
    endTime: string;
    text?: string;
  }[],
  now: string,
): Warning[] {
  return all
    .filter(
      (w) =>
        AREAS.includes(w.idAreaAviso as WarningArea) &&
        w.awarenessLevelID in LEVELS &&
        w.endTime > now,
    )
    .map((w) => ({
      area: w.idAreaAviso as WarningArea,
      type: w.awarenessTypeName,
      level: w.awarenessLevelID as Warning['level'],
      start: w.startTime,
      end: w.endTime,
      text: w.text ?? '',
    }))
    .sort((a, b) => LEVELS[b.level] - LEVELS[a.level] || a.start.localeCompare(b.start));
}

/** Madeira's local time now as IPMA writes it ("2026-10-12T22:30:00"). */
export function madeiraIsoNow(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Atlantic/Madeira',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(date)
    .replace(' ', 'T');
}

/** The official warnings for Madeira now and ahead (none when IPMA cannot be reached). */
export async function loadWarnings(): Promise<Warning[] | undefined> {
  try {
    const res = await fetch(WARNINGS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return madeiraWarnings(await res.json(), madeiraIsoNow());
  } catch {
    return undefined;
  }
}

/** The worst level among warnings, if any. */
export const worstLevel = (ws: readonly Warning[]) =>
  ws.reduce<Warning['level'] | undefined>(
    (worst, w) => (!worst || LEVELS[w.level] > LEVELS[worst] ? w.level : worst),
    undefined,
  );

export type Sky =
  | 'clear'
  | 'mostlyClear'
  | 'partly'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavyRain'
  | 'showers'
  | 'thunder'
  | 'snow';

/** The sky by its WMO code. */
export function skyOf(code: number): Sky {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostlyClear';
  if (code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 65 || code === 67) return 'heavyRain';
  if (code >= 61 && code <= 67) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95) return 'thunder';
  return 'partly';
}

/** A sky in a sign, as weather apps draw it on a map (by night, the moon). */
export function skySign(code: number, day = true): string {
  const sky = skyOf(code);
  const signs: Record<Sky, string> = {
    clear: day ? '☀️' : '🌙',
    mostlyClear: day ? '🌤️' : '🌙',
    partly: '⛅',
    overcast: '☁️',
    fog: '🌫️',
    drizzle: '🌦️',
    rain: '🌧️',
    heavyRain: '🌧️',
    showers: '🌦️',
    thunder: '⛈️',
    snow: '🌨️',
  };
  return signs[sky];
}

/** A wind's direction as the compass says it (where it comes from). */
export function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
    Math.round((((deg % 360) + 360) % 360) / 45) % 8
  ]!;
}

/** Of the forecasts, those with the most sun and least rain now, best first. */
export function sunniest(forecasts: readonly Forecast[]): Forecast[] {
  const score = (f: Forecast) =>
    f.now.cloud + f.now.rain * 100 + (skyOf(f.now.code) === 'fog' ? 80 : 0);
  return [...forecasts].sort((a, b) => score(a) - score(b));
}

type Words = Record<Lang, string>;

/** The weather's words in every language of the app. */
// prettier-ignore
const WORDS = {
  title: { uk: 'Погода на Мадейрі', en: 'Weather in Madeira', pt: 'Tempo na Madeira', es: 'El tiempo en Madeira', fr: 'Météo à Madère', it: 'Meteo a Madeira', de: 'Wetter auf Madeira', cs: 'Počasí na Madeiře', pl: 'Pogoda na Maderze', ru: 'Погода на Мадейре' },
  now: { uk: 'Зараз', en: 'Now', pt: 'Agora', es: 'Ahora', fr: 'Maintenant', it: 'Ora', de: 'Jetzt', cs: 'Teď', pl: 'Teraz', ru: 'Сейчас' },
  feels: { uk: 'Відчувається як', en: 'Feels like', pt: 'Sensação', es: 'Sensación', fr: 'Ressenti', it: 'Percepita', de: 'Gefühlt', cs: 'Pocitově', pl: 'Odczuwalna', ru: 'Ощущается как' },
  wind: { uk: 'Вітер', en: 'Wind', pt: 'Vento', es: 'Viento', fr: 'Vent', it: 'Vento', de: 'Wind', cs: 'Vítr', pl: 'Wiatr', ru: 'Ветер' },
  gusts: { uk: 'пориви', en: 'gusts', pt: 'rajadas', es: 'rachas', fr: 'rafales', it: 'raffiche', de: 'Böen', cs: 'nárazy', pl: 'porywy', ru: 'порывы' },
  humidity: { uk: 'Вологість', en: 'Humidity', pt: 'Humidade', es: 'Humedad', fr: 'Humidité', it: 'Umidità', de: 'Feuchte', cs: 'Vlhkost', pl: 'Wilgotność', ru: 'Влажность' },
  uv: { uk: 'УФ-індекс', en: 'UV index', pt: 'Índice UV', es: 'Índice UV', fr: 'Indice UV', it: 'Indice UV', de: 'UV-Index', cs: 'UV index', pl: 'Indeks UV', ru: 'УФ-индекс' },
  rain: { uk: 'Опади', en: 'Rain', pt: 'Precipitação', es: 'Lluvia', fr: 'Pluie', it: 'Pioggia', de: 'Regen', cs: 'Srážky', pl: 'Opady', ru: 'Осадки' },
  clouds: { uk: 'Хмарність', en: 'Cloud', pt: 'Nebulosidade', es: 'Nubosidad', fr: 'Nébulosité', it: 'Nuvolosità', de: 'Bewölkung', cs: 'Oblačnost', pl: 'Zachmurzenie', ru: 'Облачность' },
  visibility: { uk: 'Видимість', en: 'Visibility', pt: 'Visibilidade', es: 'Visibilidad', fr: 'Visibilité', it: 'Visibilità', de: 'Sicht', cs: 'Viditelnost', pl: 'Widoczność', ru: 'Видимость' },
  hours: { uk: 'Найближчі години', en: 'Next hours', pt: 'Próximas horas', es: 'Próximas horas', fr: 'Prochaines heures', it: 'Prossime ore', de: 'Nächste Stunden', cs: 'Příští hodiny', pl: 'Najbliższe godziny', ru: 'Ближайшие часы' },
  days: { uk: 'На тиждень', en: 'This week', pt: 'Esta semana', es: 'Esta semana', fr: 'Cette semaine', it: 'Questa settimana', de: 'Diese Woche', cs: 'Tento týden', pl: 'Ten tydzień', ru: 'На неделю' },
  island: { uk: 'Де зараз сонце', en: 'Where the sun is now', pt: 'Onde está o sol agora', es: 'Dónde hace sol ahora', fr: 'Où est le soleil', it: 'Dov’è il sole adesso', de: 'Wo jetzt die Sonne scheint', cs: 'Kde teď svítí slunce', pl: 'Gdzie teraz świeci słońce', ru: 'Где сейчас солнце' },
  islandHint: { uk: 'Погода на Мадейрі різна за кілька кілометрів: на півдні сонце, на півночі й у горах — хмари. Торкніться місця.', en: 'Madeira’s weather changes within a few kilometres: sun in the south, clouds in the north and the mountains. Tap a place.', pt: 'O tempo na Madeira muda em poucos quilómetros: sol a sul, nuvens a norte e nas serras. Toque num local.', es: 'El tiempo en Madeira cambia en pocos kilómetros: sol en el sur, nubes en el norte y la montaña. Toque un lugar.', fr: 'À Madère, le temps change en quelques kilomètres : soleil au sud, nuages au nord et en montagne. Touchez un lieu.', it: 'A Madeira il tempo cambia in pochi chilometri: sole a sud, nuvole a nord e in montagna. Tocca un luogo.', de: 'Auf Madeira ändert sich das Wetter auf wenigen Kilometern: Sonne im Süden, Wolken im Norden und in den Bergen. Ort antippen.', cs: 'Počasí na Madeiře se mění na pár kilometrech: na jihu slunce, na severu a v horách mraky. Klepněte na místo.', pl: 'Pogoda na Maderze zmienia się co kilka kilometrów: słońce na południu, chmury na północy i w górach. Dotknij miejsca.', ru: 'Погода на Мадейре меняется через несколько километров: на юге солнце, на севере и в горах — облака. Нажмите на место.' },
  sea: { uk: 'Море', en: 'Sea', pt: 'Mar', es: 'Mar', fr: 'Mer', it: 'Mare', de: 'Meer', cs: 'Moře', pl: 'Morze', ru: 'Море' },
  waves: { uk: 'Хвилі', en: 'Waves', pt: 'Ondas', es: 'Olas', fr: 'Vagues', it: 'Onde', de: 'Wellen', cs: 'Vlny', pl: 'Fale', ru: 'Волны' },
  water: { uk: 'Вода', en: 'Water', pt: 'Água', es: 'Agua', fr: 'Eau', it: 'Acqua', de: 'Wasser', cs: 'Voda', pl: 'Woda', ru: 'Вода' },
  south: { uk: 'Південь (Фуншал)', en: 'South (Funchal)', pt: 'Sul (Funchal)', es: 'Sur (Funchal)', fr: 'Sud (Funchal)', it: 'Sud (Funchal)', de: 'Süden (Funchal)', cs: 'Jih (Funchal)', pl: 'Południe (Funchal)', ru: 'Юг (Фуншал)' },
  north: { uk: 'Північ (Porto Moniz)', en: 'North (Porto Moniz)', pt: 'Norte (Porto Moniz)', es: 'Norte (Porto Moniz)', fr: 'Nord (Porto Moniz)', it: 'Nord (Porto Moniz)', de: 'Norden (Porto Moniz)', cs: 'Sever (Porto Moniz)', pl: 'Północ (Porto Moniz)', ru: 'Север (Порту-Мониш)' },
  portoSanto: { uk: 'Порту-Санту', en: 'Porto Santo', pt: 'Porto Santo', es: 'Porto Santo', fr: 'Porto Santo', it: 'Porto Santo', de: 'Porto Santo', cs: 'Porto Santo', pl: 'Porto Santo', ru: 'Порту-Санту' },
  sunrise: { uk: 'Схід сонця', en: 'Sunrise', pt: 'Nascer do sol', es: 'Amanecer', fr: 'Lever du soleil', it: 'Alba', de: 'Sonnenaufgang', cs: 'Východ slunce', pl: 'Wschód słońca', ru: 'Восход' },
  sunset: { uk: 'Захід сонця', en: 'Sunset', pt: 'Pôr do sol', es: 'Atardecer', fr: 'Coucher du soleil', it: 'Tramonto', de: 'Sonnenuntergang', cs: 'Západ slunce', pl: 'Zachód słońca', ru: 'Закат' },
  warnings: { uk: 'Попередження IPMA', en: 'IPMA warnings', pt: 'Avisos do IPMA', es: 'Avisos del IPMA', fr: 'Alertes de l’IPMA', it: 'Allerte IPMA', de: 'IPMA-Warnungen', cs: 'Výstrahy IPMA', pl: 'Ostrzeżenia IPMA', ru: 'Предупреждения IPMA' },
  noWarnings: { uk: 'Офіційних попереджень про негоду немає', en: 'No official weather warnings', pt: 'Sem avisos meteorológicos', es: 'Sin avisos meteorológicos', fr: 'Aucune alerte météo officielle', it: 'Nessuna allerta meteo ufficiale', de: 'Keine amtlichen Unwetterwarnungen', cs: 'Žádné oficiální výstrahy', pl: 'Brak oficjalnych ostrzeżeń', ru: 'Официальных предупреждений нет' },
  until: { uk: 'до', en: 'until', pt: 'até', es: 'hasta', fr: 'jusqu’à', it: 'fino a', de: 'bis', cs: 'do', pl: 'do', ru: 'до' },
  from: { uk: 'з', en: 'from', pt: 'a partir de', es: 'desde', fr: 'à partir de', it: 'dalle', de: 'ab', cs: 'od', pl: 'od', ru: 'с' },
  height: { uk: 'висота {m} м', en: '{m} m up', pt: '{m} m de altitude', es: '{m} m de altitud', fr: 'altitude {m} m', it: 'quota {m} m', de: '{m} m hoch', cs: 'výška {m} m', pl: 'wys. {m} m', ru: 'высота {m} м' },
  source: { uk: 'Прогноз: Open-Meteo (моделі ECMWF, DWD та інші, CC BY 4.0). Попередження: IPMA. Оновлено о {time}.', en: 'Forecast: Open-Meteo (ECMWF, DWD and other models, CC BY 4.0). Warnings: IPMA. Updated at {time}.', pt: 'Previsão: Open-Meteo (modelos ECMWF, DWD e outros, CC BY 4.0). Avisos: IPMA. Atualizado às {time}.', es: 'Previsión: Open-Meteo (modelos ECMWF, DWD y otros, CC BY 4.0). Avisos: IPMA. Actualizado a las {time}.', fr: 'Prévisions : Open-Meteo (modèles ECMWF, DWD et autres, CC BY 4.0). Alertes : IPMA. Mis à jour à {time}.', it: 'Previsioni: Open-Meteo (modelli ECMWF, DWD e altri, CC BY 4.0). Allerte: IPMA. Aggiornato alle {time}.', de: 'Vorhersage: Open-Meteo (Modelle von ECMWF, DWD u. a., CC BY 4.0). Warnungen: IPMA. Stand {time}.', cs: 'Předpověď: Open-Meteo (modely ECMWF, DWD a další, CC BY 4.0). Výstrahy: IPMA. Aktualizováno v {time}.', pl: 'Prognoza: Open-Meteo (modele ECMWF, DWD i inne, CC BY 4.0). Ostrzeżenia: IPMA. Aktualizacja {time}.', ru: 'Прогноз: Open-Meteo (модели ECMWF, DWD и другие, CC BY 4.0). Предупреждения: IPMA. Обновлено в {time}.' },
  offline: { uk: 'Немає зв’язку — показано останній прогноз', en: 'Offline — showing the last forecast', pt: 'Sem ligação — última previsão', es: 'Sin conexión — última previsión', fr: 'Hors ligne — dernières prévisions', it: 'Offline — ultime previsioni', de: 'Offline — letzte Vorhersage', cs: 'Offline — poslední předpověď', pl: 'Offline — ostatnia prognoza', ru: 'Нет связи — последний прогноз' },
  none: { uk: 'Прогноз зараз недоступний. Спробуйте пізніше.', en: 'The forecast is not available now. Try again later.', pt: 'A previsão não está disponível. Tente mais tarde.', es: 'La previsión no está disponible. Inténtelo más tarde.', fr: 'Prévisions indisponibles. Réessayez plus tard.', it: 'Previsioni non disponibili. Riprova più tardi.', de: 'Vorhersage gerade nicht verfügbar. Später erneut versuchen.', cs: 'Předpověď teď není k dispozici. Zkuste to později.', pl: 'Prognoza jest teraz niedostępna. Spróbuj później.', ru: 'Прогноз сейчас недоступен. Попробуйте позже.' },
  loading: { uk: 'Завантажую прогноз…', en: 'Loading the forecast…', pt: 'A carregar a previsão…', es: 'Cargando la previsión…', fr: 'Chargement des prévisions…', it: 'Caricamento delle previsioni…', de: 'Vorhersage wird geladen…', cs: 'Načítám předpověď…', pl: 'Wczytuję prognozę…', ru: 'Загружаю прогноз…' },
  notify: { uk: 'Сповіщати про негоду', en: 'Notify me of bad weather', pt: 'Avisar-me do mau tempo', es: 'Avisarme del mal tiempo', fr: 'M’alerter du mauvais temps', it: 'Avvisami del maltempo', de: 'Bei Unwetter benachrichtigen', cs: 'Upozornit na nepohodu', pl: 'Powiadamiaj o niepogodzie', ru: 'Сообщать о непогоде' },
  webcams: { uk: 'Подивитися на камерах', en: 'See on the webcams', pt: 'Ver nas webcams', es: 'Ver en las webcams', fr: 'Voir sur les webcams', it: 'Guarda le webcam', de: 'Auf den Webcams ansehen', cs: 'Podívat se na kamery', pl: 'Zobacz na kamerach', ru: 'Посмотреть на камерах' },
  clear: { uk: 'Ясно', en: 'Clear', pt: 'Céu limpo', es: 'Despejado', fr: 'Ciel clair', it: 'Sereno', de: 'Klar', cs: 'Jasno', pl: 'Bezchmurnie', ru: 'Ясно' },
  mostlyClear: { uk: 'Переважно ясно', en: 'Mostly clear', pt: 'Pouco nublado', es: 'Mayormente despejado', fr: 'Plutôt dégagé', it: 'Poco nuvoloso', de: 'Überwiegend klar', cs: 'Skoro jasno', pl: 'Przeważnie bezchmurnie', ru: 'Преимущественно ясно' },
  partly: { uk: 'Мінлива хмарність', en: 'Partly cloudy', pt: 'Parcialmente nublado', es: 'Parcialmente nublado', fr: 'Partiellement nuageux', it: 'Parzialmente nuvoloso', de: 'Teilweise bewölkt', cs: 'Polojasno', pl: 'Częściowe zachmurzenie', ru: 'Переменная облачность' },
  overcast: { uk: 'Хмарно', en: 'Overcast', pt: 'Nublado', es: 'Cubierto', fr: 'Couvert', it: 'Coperto', de: 'Bedeckt', cs: 'Zataženo', pl: 'Pochmurno', ru: 'Пасмурно' },
  fog: { uk: 'Туман', en: 'Fog', pt: 'Nevoeiro', es: 'Niebla', fr: 'Brouillard', it: 'Nebbia', de: 'Nebel', cs: 'Mlha', pl: 'Mgła', ru: 'Туман' },
  drizzle: { uk: 'Мряка', en: 'Drizzle', pt: 'Chuvisco', es: 'Llovizna', fr: 'Bruine', it: 'Pioviggine', de: 'Nieselregen', cs: 'Mrholení', pl: 'Mżawka', ru: 'Морось' },
  rainSky: { uk: 'Дощ', en: 'Rain', pt: 'Chuva', es: 'Lluvia', fr: 'Pluie', it: 'Pioggia', de: 'Regen', cs: 'Déšť', pl: 'Deszcz', ru: 'Дождь' },
  heavyRain: { uk: 'Сильний дощ', en: 'Heavy rain', pt: 'Chuva forte', es: 'Lluvia fuerte', fr: 'Forte pluie', it: 'Pioggia forte', de: 'Starkregen', cs: 'Silný déšť', pl: 'Ulewa', ru: 'Сильный дождь' },
  showers: { uk: 'Злива', en: 'Showers', pt: 'Aguaceiros', es: 'Chubascos', fr: 'Averses', it: 'Rovesci', de: 'Schauer', cs: 'Přeháňky', pl: 'Przelotne opady', ru: 'Ливень' },
  thunder: { uk: 'Гроза', en: 'Thunderstorm', pt: 'Trovoada', es: 'Tormenta', fr: 'Orage', it: 'Temporale', de: 'Gewitter', cs: 'Bouřka', pl: 'Burza', ru: 'Гроза' },
  snow: { uk: 'Сніг', en: 'Snow', pt: 'Neve', es: 'Nieve', fr: 'Neige', it: 'Neve', de: 'Schnee', cs: 'Sníh', pl: 'Śnieg', ru: 'Снег' },
  yellow: { uk: 'Жовте', en: 'Yellow', pt: 'Amarelo', es: 'Amarillo', fr: 'Jaune', it: 'Gialla', de: 'Gelb', cs: 'Žlutá', pl: 'Żółte', ru: 'Жёлтое' },
  orange: { uk: 'Помаранчеве', en: 'Orange', pt: 'Laranja', es: 'Naranja', fr: 'Orange', it: 'Arancione', de: 'Orange', cs: 'Oranžová', pl: 'Pomarańczowe', ru: 'Оранжевое' },
  red: { uk: 'Червоне', en: 'Red', pt: 'Vermelho', es: 'Rojo', fr: 'Rouge', it: 'Rossa', de: 'Rot', cs: 'Červená', pl: 'Czerwone', ru: 'Красное' },
  MCS: { uk: 'південне узбережжя', en: 'south coast', pt: 'costa sul', es: 'costa sur', fr: 'côte sud', it: 'costa sud', de: 'Südküste', cs: 'jižní pobřeží', pl: 'wybrzeże południowe', ru: 'южное побережье' },
  MCN: { uk: 'північне узбережжя', en: 'north coast', pt: 'costa norte', es: 'costa norte', fr: 'côte nord', it: 'costa nord', de: 'Nordküste', cs: 'severní pobřeží', pl: 'wybrzeże północne', ru: 'северное побережье' },
  MRM: { uk: 'гори', en: 'mountains', pt: 'regiões montanhosas', es: 'montañas', fr: 'montagnes', it: 'montagne', de: 'Berge', cs: 'hory', pl: 'góry', ru: 'горы' },
  MPS: { uk: 'Порту-Санту', en: 'Porto Santo', pt: 'Porto Santo', es: 'Porto Santo', fr: 'Porto Santo', it: 'Porto Santo', de: 'Porto Santo', cs: 'Porto Santo', pl: 'Porto Santo', ru: 'Порту-Санту' },
  'Precipitação': { uk: 'Сильний дощ', en: 'Heavy rain', pt: 'Precipitação', es: 'Lluvias', fr: 'Fortes pluies', it: 'Piogge', de: 'Starkregen', cs: 'Silné srážky', pl: 'Ulewy', ru: 'Сильный дождь' },
  'Vento': { uk: 'Сильний вітер', en: 'Strong wind', pt: 'Vento forte', es: 'Viento fuerte', fr: 'Vent fort', it: 'Vento forte', de: 'Sturm', cs: 'Silný vítr', pl: 'Silny wiatr', ru: 'Сильный ветер' },
  'Agitação Marítima': { uk: 'Шторм на морі', en: 'Rough sea', pt: 'Agitação marítima', es: 'Mar agitado', fr: 'Mer agitée', it: 'Mare agitato', de: 'Hoher Seegang', cs: 'Rozbouřené moře', pl: 'Wzburzone morze', ru: 'Шторм на море' },
  'Trovoada': { uk: 'Гроза', en: 'Thunderstorms', pt: 'Trovoada', es: 'Tormentas', fr: 'Orages', it: 'Temporali', de: 'Gewitter', cs: 'Bouřky', pl: 'Burze', ru: 'Грозы' },
  'Nevoeiro': { uk: 'Туман', en: 'Fog', pt: 'Nevoeiro', es: 'Niebla', fr: 'Brouillard', it: 'Nebbia', de: 'Nebel', cs: 'Mlha', pl: 'Mgła', ru: 'Туман' },
  'Tempo Quente': { uk: 'Спека', en: 'Heat', pt: 'Tempo quente', es: 'Calor', fr: 'Chaleur', it: 'Caldo', de: 'Hitze', cs: 'Horko', pl: 'Upał', ru: 'Жара' },
  'Tempo Frio': { uk: 'Холод', en: 'Cold', pt: 'Tempo frio', es: 'Frío', fr: 'Froid', it: 'Freddo', de: 'Kälte', cs: 'Chladno', pl: 'Zimno', ru: 'Холод' },
  'Neve': { uk: 'Сніг', en: 'Snow', pt: 'Neve', es: 'Nieve', fr: 'Neige', it: 'Neve', de: 'Schnee', cs: 'Sníh', pl: 'Śnieg', ru: 'Снег' },
} satisfies Record<string, Words>;

export type WeatherWord = keyof typeof WORDS;

/** A weather word in the reader's language ({…} filled in); an unknown word as it is. */
export function weatherWord(
  word: WeatherWord | string,
  lang: Lang,
  values: Record<string, string | number> = {},
): string {
  const words = (WORDS as Record<string, Words>)[word];
  let text = words ? words[lang] : word;
  for (const [k, v] of Object.entries(values)) text = text.replace(`{${k}}`, String(v));
  return text;
}

/** A sky's name in the reader's language. */
export const skyName = (code: number, lang: Lang) => {
  const sky = skyOf(code);
  return weatherWord(sky === 'rain' ? 'rainSky' : sky, lang);
};
