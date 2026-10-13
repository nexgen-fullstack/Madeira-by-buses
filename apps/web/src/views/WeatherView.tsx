import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BellRing,
  Cloud,
  Droplets,
  Eye,
  Gauge,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  TriangleAlert,
  Umbrella,
  Video,
  Waves,
  Wind,
} from 'lucide-react';
import { haversine } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n } from '../i18n.ts';
import { askNotify, canNotify } from '../lib/device.ts';
import { useQuietPosition } from '../lib/geolocation.ts';
import type { MapContent } from '../lib/mapContent.ts';
import { navigate, type Route } from '../lib/router.ts';
import { useWarnings, useWeather } from '../lib/useWeather.ts';
import {
  compass,
  loadFullForecast,
  readSpot,
  skyName,
  skySign,
  spotPlace,
  sunniest,
  WEATHER_PLACES,
  weatherWord,
  type Forecast,
  type Warning,
  type WeatherHour,
  type WeatherPlace,
} from '../lib/weather.ts';

/**
 * The weather on Madeira for each part of the island — the sky and warmth of each on the
 * map, the official warnings, the place chosen now, hour by hour and day by day, and the
 * sea — and where the sun is now, for a day out: the south may be clear while the north and
 * the mountains are in the clouds.
 */
export function WeatherView({ route }: { route: Route }) {
  const t = useI18n();
  const lang = t.lang;
  const here = useQuietPosition();
  const { forecasts, at, sea, failed } = useWeather(true);
  const warnings = useWarnings();
  // The place asked for, else the part of the island nearest the phone, else Funchal.
  const asked = route.query.get('p');
  const nearest = useMemo(
    () =>
      here
        ? WEATHER_PLACES.reduce((a, b) => (haversine(here, b) < haversine(here, a) ? b : a))
        : WEATHER_PLACES[0]!,
    [here],
  );
  const placeId = asked ?? nearest.id;
  // A spot tapped on the map: its own place, named after what is there, or near which town.
  const spot = readSpot(placeId);
  const spotName = route.query.get('n');
  const place = useMemo<WeatherPlace>(() => {
    if (!spot) return WEATHER_PLACES.find((p) => p.id === placeId) ?? WEATHER_PLACES[0]!;
    const town = WEATHER_PLACES.reduce((a, b) => (haversine(spot, b) < haversine(spot, a) ? b : a));
    // Always the spot itself: "near" what the map has there, or the nearest town.
    const by = spotName ?? (haversine(spot, town) < 4000 ? town.name : undefined);
    const name = by
      ? `${weatherWord('spot', lang)} · ${weatherWord('near', lang, { place: by })}`
      : weatherWord('spot', lang);
    return spotPlace(spot.lat, spot.lon, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, spotName, lang]);
  // The place's whole forecast: every hour of every day the models reach.
  const [full, setFull] = useState<Forecast | undefined>();
  useEffect(() => {
    let on = true;
    setFull(undefined);
    void loadFullForecast(place).then((f) => on && setFull(f));
    return () => {
      on = false;
    };
  }, [place]);
  const chosen =
    full ??
    (spot ? undefined : (forecasts?.find((f) => f.place.id === place.id) ?? forecasts?.[0]));
  const choose = (id: string) => navigate('weather', { p: id });
  // The day whose hours are shown: today until another is tapped.
  const [dayPicked, setDayPicked] = useState<string | undefined>();
  useEffect(() => setDayPicked(undefined), [place]);

  const content = useMemo<MapContent | undefined>(
    () =>
      forecasts && {
        lines: [],
        // The yellow pin on the place chosen; the map goes to a place chosen in the list.
        points: [{ lat: place.lat, lon: place.lon, kind: 'destination' as const }],
        ...(asked && !spot
          ? {
              fitKey: `weather:${place.id}`,
              fit: [
                { lat: place.lat - 0.025, lon: place.lon - 0.03 },
                { lat: place.lat + 0.025, lon: place.lon + 0.03 },
              ],
            }
          : spot
            ? {}
            : { fitKey: 'weather', fit: WEATHER_PLACES.filter((p) => p.area !== 'MPS') }),
        // Any spot tapped: its weather.
        onMapTap: (at) =>
          navigate('weather', {
            p: `spot:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`,
            ...(at.name ? { n: at.name } : {}),
          }),
        badges: [
          // The spot tapped: its own weather (… while it comes), and its height.
          ...(spot
            ? [
                {
                  id: 'weather-spot',
                  kind: 'weather' as const,
                  lat: spot.lat,
                  lon: spot.lon,
                  text: full
                    ? `${skySign(full.now.code, full.now.day)} ${Math.round(full.now.temp)}°`
                    : '…',
                  sub: full ? `${full.elevation} m` : weatherWord('spot', lang),
                  active: true,
                },
              ]
            : []),
          // The places near the spot step aside: their weather is not its own.
          ...forecasts
            .filter((f) => !spot || haversine(spot, f.place) > 1500)
            .map((f) => ({
              id: `weather-${f.place.id}`,
              kind: 'weather' as const,
              lat: f.place.lat,
              lon: f.place.lon,
              text: `${skySign(f.now.code, f.now.day)} ${Math.round(f.now.temp)}°`,
              sub: f.place.name,
              active: f.place.id === chosen?.place.id,
              onTap: () => choose(f.place.id),
            })),
        ],
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forecasts, chosen?.place.id, spot?.lat, spot?.lon, full, place, asked],
  );
  useMapContent(content);

  // The warnings told as notifications: a button to allow them where the phone does not yet.
  const [notifyOn, setNotifyOn] = useState<boolean | undefined>();
  useEffect(() => void canNotify().then(setNotifyOn), []);

  const nowHour = chosen?.hours.find((h) => h.time.slice(0, 13) === chosen.now.time.slice(0, 13));
  const time = (iso: string) => iso.slice(11, 16);
  const weekday = (iso: string) =>
    new Intl.DateTimeFormat(t.locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  return (
    <div className="weather">
      <h2 className="weather__title">{weatherWord('title', lang)}</h2>

      <Warnings warnings={warnings} lang={lang} />

      {!forecasts && failed && <p className="muted">{weatherWord('none', lang)}</p>}
      {!forecasts && !failed && <p className="muted">{weatherWord('loading', lang)}</p>}

      {chosen && (
        <section className="weather-now" aria-live="polite">
          <div className="weather-now__head">
            <span className="weather-now__sign" aria-hidden>
              {skySign(chosen.now.code, chosen.now.day)}
            </span>
            <div>
              <div className="weather-now__temp">{Math.round(chosen.now.temp)}°</div>
              <div className="strong">{chosen.place.name}</div>
              <div className="muted small">
                {skyName(chosen.now.code, lang)} ·{' '}
                {weatherWord('height', lang, { m: chosen.elevation })}
              </div>
            </div>
          </div>
          <div className="weather-now__facts">
            <Fact icon={Thermometer} label={weatherWord('feels', lang)}>
              {Math.round(chosen.now.feels)}°
            </Fact>
            <Fact icon={Wind} label={weatherWord('wind', lang)}>
              {compass(chosen.now.dir)} {Math.round(chosen.now.wind)} km/h ·{' '}
              {weatherWord('gusts', lang)} {Math.round(chosen.now.gusts)}
            </Fact>
            <Fact icon={Droplets} label={weatherWord('humidity', lang)}>
              {Math.round(chosen.now.humidity)}%
            </Fact>
            <Fact icon={Umbrella} label={weatherWord('rain', lang)}>
              {chosen.days[0]
                ? `${chosen.days[0].chance}% · ${chosen.days[0].rain.toFixed(1)} mm`
                : '—'}
            </Fact>
            <Fact icon={Cloud} label={weatherWord('clouds', lang)}>
              {Math.round(chosen.now.cloud)}%
            </Fact>
            <Fact icon={Sun} label={weatherWord('uv', lang)}>
              {chosen.days[0] ? Math.round(chosen.days[0].uv) : '—'}
              {chosen.days[0] && chosen.days[0].sun > 0
                ? ` · ☀️ ${chosen.days[0].sun.toFixed(1)} h`
                : ''}
            </Fact>
            {nowHour && (
              <>
                <Fact icon={Gauge} label={weatherWord('pressure', lang)}>
                  {Math.round(nowHour.pressure)} hPa
                </Fact>
                <Fact icon={Eye} label={weatherWord('visibility', lang)}>
                  {visibilityText(nowHour.visibility)}
                </Fact>
                <Fact icon={Droplets} label={weatherWord('dew', lang)}>
                  {Math.round(nowHour.dew)}°
                </Fact>
              </>
            )}
            {chosen.days[0] && (
              <Fact icon={Sunrise} label={weatherWord('sunrise', lang)}>
                {time(chosen.days[0].sunrise)}
                <Sunset size={14} aria-hidden className="weather-fact__inline" />
                {time(chosen.days[0].sunset)}
              </Fact>
            )}
          </div>
        </section>
      )}

      {!spot && <p className="muted small">{weatherWord('tapMap', lang)}</p>}
      {spot && !chosen && <p className="muted">{weatherWord('loading', lang)}</p>}

      {chosen && <Hours forecast={chosen} day={dayPicked} />}

      {chosen && (
        <section className="weather-card">
          <h3>
            {chosen.days.length > 7
              ? weatherWord('daysAll', lang, { n: chosen.days.length })
              : weatherWord('days', lang)}
          </h3>
          <ol className="weather-days">
            {chosen.days.map((d, i) => (
              <li key={d.date}>
                <button
                  type="button"
                  className="weather-days__pick"
                  aria-pressed={(dayPicked ?? chosen.days[0]?.date) === d.date}
                  disabled={!chosen.hours.some((h) => h.time.startsWith(d.date))}
                  onClick={() => setDayPicked(i === 0 ? undefined : d.date)}
                >
                  <span className="weather-days__day">
                    {weekday(d.date)} <span className="muted small">{d.date.slice(8, 10)}</span>
                  </span>
                  <span aria-hidden>{skySign(d.code)}</span>
                  <span className="weather-days__sky small muted">{skyName(d.code, lang)}</span>
                  <span className="weather-days__rain small">
                    {d.chance >= 20 ? `💧 ${d.chance}%` : ''}
                  </span>
                  <span className="weather-days__wind small muted">
                    💨 {compass(d.dir)} {Math.round(d.wind)}
                  </span>
                  <span className="weather-days__temp">
                    <b>{Math.round(d.max)}°</b> <span className="muted">{Math.round(d.min)}°</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {chosen.days.length > 7 && <p className="muted small">{weatherWord('rough', lang)}</p>}
        </section>
      )}

      {forecasts && (
        <section className="weather-card">
          <h3>{weatherWord('island', lang)}</h3>
          <p className="muted small">{weatherWord('islandHint', lang)}</p>
          <div className="weather-places">
            {sunniest(forecasts).map((f) => (
              <button
                key={f.place.id}
                type="button"
                className="weather-place"
                aria-pressed={f.place.id === chosen?.place.id}
                onClick={() => choose(f.place.id)}
              >
                <span aria-hidden>{skySign(f.now.code, f.now.day)}</span>
                <span className="weather-place__name">{f.place.name}</span>
                <span className="strong">{Math.round(f.now.temp)}°</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {sea && sea.length > 0 && (
        <section className="weather-card">
          <h3>
            <Waves size={18} aria-hidden /> {weatherWord('sea', lang)}
          </h3>
          <div className="weather-sea">
            {sea.map((s) => (
              <div key={s.id} className="weather-sea__coast">
                <div className="strong small">
                  {weatherWord(
                    s.id === 'funchal' ? 'south' : s.id === 'porto-moniz' ? 'north' : 'portoSanto',
                    lang,
                  )}
                </div>
                <div>
                  {weatherWord('waves', lang)} {s.waves.toFixed(1)} m
                </div>
                <div className="muted small">
                  {weatherWord('water', lang)} {Math.round(s.temp)}°
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="weather__actions">
        <button type="button" className="button" onClick={() => navigate('webcams')}>
          <Video size={18} /> {weatherWord('webcams', lang)}
        </button>
        {notifyOn === false && (
          <button
            type="button"
            className="button"
            onClick={() => void askNotify().then(setNotifyOn)}
          >
            <BellRing size={18} /> {weatherWord('notify', lang)}
          </button>
        )}
      </div>

      {at && (
        <p className="muted small weather__source">
          {weatherWord('source', lang, {
            time: new Intl.DateTimeFormat(t.locale, {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Atlantic/Madeira',
            }).format(new Date(at)),
          })}
        </p>
      )}
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Wind;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="weather-fact">
      <Icon size={16} aria-hidden />
      <div>
        <div className="muted small">{label}</div>
        <div className="weather-fact__value">{children}</div>
      </div>
    </div>
  );
}

const visibilityText = (m: number) =>
  m >= 10_000
    ? `${Math.round(m / 1000)} km`
    : m >= 1000
      ? `${(m / 1000).toFixed(1)} km`
      : `${Math.round(m)} m`;

/** What the hours can be followed by: each hour a bar, its value over it. */
const METRICS = {
  temp: { icon: Thermometer, word: 'temp', of: (h: WeatherHour) => h.temp, unit: '°' },
  rain: { icon: Umbrella, word: 'rain', of: (h: WeatherHour) => h.chance, unit: '%' },
  wind: { icon: Wind, word: 'wind', of: (h: WeatherHour) => h.gusts, unit: '' },
  humidity: { icon: Droplets, word: 'humidity', of: (h: WeatherHour) => h.humidity, unit: '%' },
  clouds: { icon: Cloud, word: 'clouds', of: (h: WeatherHour) => h.cloud, unit: '%' },
  uv: { icon: Sun, word: 'uv', of: (h: WeatherHour) => h.uv, unit: '' },
  visibility: {
    icon: Eye,
    word: 'visibility',
    of: (h: WeatherHour) => h.visibility / 1000,
    unit: '',
  },
  pressure: { icon: Gauge, word: 'pressure', of: (h: WeatherHour) => h.pressure, unit: '' },
} as const;
type Metric = keyof typeof METRICS;

/**
 * A day hour by hour (today: the next 24 hours from now): the sky of each, and one measure
 * as bars to follow through the day — warmth, rain, gusts, humidity, cloud, UV, visibility,
 * pressure — with everything about an hour tapped.
 */
function Hours({ forecast, day }: { forecast: Forecast; day?: string }) {
  const t = useI18n();
  const lang = t.lang;
  const [metric, setMetric] = useState<Metric>('temp');
  const [hourPicked, setHourPicked] = useState<string | undefined>();
  useEffect(() => setHourPicked(undefined), [day, forecast]);
  const now = forecast.now.time.slice(0, 13);
  const next = day
    ? forecast.hours.filter((h) => h.time.startsWith(day))
    : forecast.hours.filter((h) => h.time.slice(0, 13) >= now).slice(0, 24);
  const m = METRICS[metric];
  const values = next.map(m.of);
  const lo = metric === 'temp' || metric === 'pressure' ? Math.min(...values) - 1 : 0;
  const hi = Math.max(...values, lo + 1);
  const text = (v: number) =>
    `${metric === 'visibility' && v < 10 ? v.toFixed(1) : Math.round(v)}${m.unit}`;
  const picked = next.find((h) => h.time === hourPicked);
  return (
    <section className="weather-card">
      <h3>
        {weatherWord('hourly', lang)}
        {day && (
          <span className="muted small">
            {' · '}
            {new Intl.DateTimeFormat(t.locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${day}T00:00:00Z`))}
          </span>
        )}
      </h3>
      <div className="chips weather-metrics" role="group">
        {(Object.keys(METRICS) as Metric[]).map((k) => {
          const Icon = METRICS[k].icon;
          return (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={metric === k}
              onClick={() => setMetric(k)}
            >
              <Icon size={14} aria-hidden /> {weatherWord(METRICS[k].word, lang)}
            </button>
          );
        })}
      </div>
      <div className="weather-hours" role="list">
        {next.map((h, i) => (
          <button
            key={h.time}
            type="button"
            className="weather-hour"
            role="listitem"
            aria-pressed={h.time === hourPicked}
            onClick={() => setHourPicked(h.time === hourPicked ? undefined : h.time)}
          >
            <span className="muted small">
              {i === 0 && !day ? weatherWord('now', lang) : h.time.slice(11, 16)}
            </span>
            <span aria-hidden className="weather-hour__sign">
              {skySign(h.code, h.day)}
            </span>
            <span className="strong small">{text(values[i]!)}</span>
            <span className="weather-hour__bar" aria-hidden>
              <span style={{ height: `${Math.max(4, ((values[i]! - lo) / (hi - lo)) * 100)}%` }} />
            </span>
            <span className="muted small">
              {metric === 'wind'
                ? compass(h.dir)
                : metric === 'temp'
                  ? ''
                  : `${Math.round(h.temp)}°`}
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">
        {metric === 'wind' && `km/h · ${weatherWord('gusts', lang)}`}
        {metric === 'visibility' && 'km'}
        {metric === 'pressure' && 'hPa'}
      </p>
      {picked && (
        <div className="weather-now__facts">
          <Fact
            icon={Thermometer}
            label={`${picked.time.slice(11, 16)} · ${weatherWord('feels', lang)}`}
          >
            {Math.round(picked.temp)}° · {Math.round(picked.feels)}°
          </Fact>
          <Fact icon={Wind} label={weatherWord('wind', lang)}>
            {compass(picked.dir)} {Math.round(picked.wind)} km/h · {weatherWord('gusts', lang)}{' '}
            {Math.round(picked.gusts)}
          </Fact>
          <Fact icon={Umbrella} label={weatherWord('rain', lang)}>
            {picked.chance}% · {picked.rain.toFixed(1)} mm
          </Fact>
          <Fact icon={Droplets} label={weatherWord('humidity', lang)}>
            {Math.round(picked.humidity)}% · {weatherWord('dew', lang)} {Math.round(picked.dew)}°
          </Fact>
          <Fact icon={Cloud} label={weatherWord('clouds', lang)}>
            {Math.round(picked.cloud)}% · {skyName(picked.code, lang)}
          </Fact>
          <Fact icon={Eye} label={weatherWord('visibility', lang)}>
            {visibilityText(picked.visibility)}
          </Fact>
          <Fact icon={Sun} label={weatherWord('uv', lang)}>
            {Math.round(picked.uv)}
          </Fact>
          <Fact icon={Gauge} label={weatherWord('pressure', lang)}>
            {Math.round(picked.pressure)} hPa
          </Fact>
        </div>
      )}
    </section>
  );
}

/** IPMA's warnings, worst first, each with its part of the island and when; or none. */
function Warnings({
  warnings,
  lang,
}: {
  warnings?: Warning[];
  lang: ReturnType<typeof useI18n>['lang'];
}) {
  if (!warnings) return null;
  if (warnings.length === 0)
    return <p className="weather-ok small">✓ {weatherWord('noWarnings', lang)}</p>;
  return (
    <section className="weather-warnings" aria-label={weatherWord('warnings', lang)}>
      {warnings.map((w) => (
        <div
          key={`${w.area}|${w.type}|${w.start}`}
          className={`weather-warning weather-warning--${w.level}`}
          role="alert"
        >
          <TriangleAlert size={18} aria-hidden />
          <div>
            <div className="strong">
              {weatherWord(w.level, lang)} · {weatherWord(w.type, lang)}
            </div>
            <div className="small">
              {weatherWord(w.area, lang)} · {weatherWord('from', lang)} {w.start.slice(8, 10)}.
              {w.start.slice(5, 7)} {w.start.slice(11, 16)} {weatherWord('until', lang)}{' '}
              {w.end.slice(8, 10)}.{w.end.slice(5, 7)} {w.end.slice(11, 16)}
            </div>
            {w.text && <div className="small">{w.text}</div>}
          </div>
        </div>
      ))}
    </section>
  );
}
