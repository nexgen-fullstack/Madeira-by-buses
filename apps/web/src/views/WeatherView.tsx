import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BellRing,
  Droplets,
  Gauge,
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
  skyName,
  skySign,
  sunniest,
  WEATHER_PLACES,
  weatherWord,
  type Forecast,
  type Warning,
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
  const chosen = forecasts?.find((f) => f.place.id === placeId) ?? forecasts?.[0];
  const choose = (id: string) => navigate('weather', { p: id });

  const content = useMemo<MapContent | undefined>(
    () =>
      forecasts && {
        lines: [],
        points: [],
        fitKey: 'weather',
        fit: WEATHER_PLACES.filter((p) => p.area !== 'MPS'),
        badges: forecasts.map((f) => ({
          id: `weather-${f.place.id}`,
          kind: 'weather' as const,
          lat: f.place.lat,
          lon: f.place.lon,
          text: `${skySign(f.now.code, f.now.day)} ${Math.round(f.now.temp)}°`,
          sub: f.place.name,
          active: f.place.id === chosen?.place.id,
          onTap: () => choose(f.place.id),
        })),
      },
    [forecasts, chosen?.place.id],
  );
  useMapContent(content);

  // The warnings told as notifications: a button to allow them where the phone does not yet.
  const [notifyOn, setNotifyOn] = useState<boolean | undefined>();
  useEffect(() => void canNotify().then(setNotifyOn), []);

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
            <Fact icon={Gauge} label={weatherWord('uv', lang)}>
              {chosen.days[0] ? Math.round(chosen.days[0].uv) : '—'}
            </Fact>
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

      {chosen && <Hours forecast={chosen} />}

      {chosen && (
        <section className="weather-card">
          <h3>{weatherWord('days', lang)}</h3>
          <ol className="weather-days">
            {chosen.days.map((d) => (
              <li key={d.date}>
                <span className="weather-days__day">{weekday(d.date)}</span>
                <span aria-hidden>{skySign(d.code)}</span>
                <span className="weather-days__sky small muted">{skyName(d.code, lang)}</span>
                <span className="weather-days__rain small">
                  {d.chance >= 20 ? `💧 ${d.chance}%` : ''}
                </span>
                <span className="weather-days__temp">
                  <b>{Math.round(d.max)}°</b> <span className="muted">{Math.round(d.min)}°</span>
                </span>
              </li>
            ))}
          </ol>
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

/** The next day hour by hour: the sky, the warmth, the chance of rain, the gusts. */
function Hours({ forecast }: { forecast: Forecast }) {
  const t = useI18n();
  const now = forecast.now.time.slice(0, 13);
  const next = forecast.hours.filter((h) => h.time.slice(0, 13) >= now).slice(0, 24);
  return (
    <section className="weather-card">
      <h3>{weatherWord('hours', t.lang)}</h3>
      <div className="weather-hours" role="list">
        {next.map((h, i) => (
          <div key={h.time} className="weather-hour" role="listitem">
            <span className="muted small">
              {i === 0 ? weatherWord('now', t.lang) : h.time.slice(11, 16)}
            </span>
            <span aria-hidden className="weather-hour__sign">
              {skySign(h.code, h.day)}
            </span>
            <span className="strong">{Math.round(h.temp)}°</span>
            <span className="weather-hour__rain small">{h.chance >= 10 ? `${h.chance}%` : ''}</span>
            <span className="muted small">💨 {Math.round(h.gusts)}</span>
          </div>
        ))}
      </div>
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
