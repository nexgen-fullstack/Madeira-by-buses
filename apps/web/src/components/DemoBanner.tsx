import { useState } from 'react';
import { CalendarClock, FlaskConical, TriangleAlert, WifiOff, X } from 'lucide-react';
import { madeiraNow } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { fullDate } from '../lib/format.ts';
import { load, save } from '../lib/storage.ts';
import { navigate } from '../lib/router.ts';
import { useWeatherAlerts } from '../lib/useWeather.ts';
import { weatherWord } from '../lib/weather.ts';
import { useApp } from '../state/app.tsx';

const DISMISSED_KEY = 'madeirabus.dataNotice.v1';

export function StatusBanners() {
  const t = useI18n();
  const { data, online } = useApp();
  const bundle = data.status === 'ready' ? data.net.bundle : undefined;
  // The data notice comes back whenever a new timetable is published.
  const [dismissed, setDismissed] = useState(() => load(DISMISSED_KEY, { at: '' }).at);
  const projected =
    bundle?.projected && madeiraNow().date > bundle.projected.officialUntil
      ? bundle.projected
      : undefined;
  const missing = bundle?.missingOperators ?? [];
  const partial = bundle?.partialOperators ?? [];
  const showNotice =
    bundle &&
    !bundle.demo &&
    (projected || missing.length > 0 || partial.length > 0) &&
    dismissed !== bundle.generatedAt;
  return (
    <>
      {bundle?.demo && (
        <div className="banner banner--demo" role="note">
          <FlaskConical size={16} aria-hidden />
          <span>{t.t('demo.banner')}</span>
        </div>
      )}
      {showNotice && (
        <div className="banner banner--info" role="note">
          <CalendarClock size={16} aria-hidden />
          <span>
            {projected && t.t('data.projected', { date: fullDate(t, projected.officialUntil) })}
            {projected && missing.length > 0 && ' '}
            {missing.length > 0 && t.t('data.missing', { operators: missing.join(', ') })}
            {(projected || missing.length > 0) && partial.length > 0 && ' '}
            {partial.length > 0 && t.t('data.partial', { operators: partial.join(', ') })}
          </span>
          <button
            type="button"
            className="banner__close"
            aria-label={t.t('close')}
            onClick={() => {
              save(DISMISSED_KEY, { at: bundle.generatedAt });
              setDismissed(bundle.generatedAt);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!online && (
        <div className="banner banner--offline" role="status">
          <WifiOff size={16} aria-hidden />
          <span>{t.t('offline')}</span>
        </div>
      )}
      <WeatherBanner />
    </>
  );
}

const WEATHER_SEEN = 'madeirabus.weatherBanner.v1';

/**
 * IPMA's warnings for Madeira over every screen (and told as notifications where allowed):
 * the worst of them, a tap away from the weather; closed, it stays closed until a new one.
 */
function WeatherBanner() {
  const t = useI18n();
  const warnings = useWeatherAlerts();
  const key = warnings?.map((w) => `${w.area}|${w.type}|${w.level}|${w.start}`).join(',') ?? '';
  const [closed, setClosed] = useState(() => load(WEATHER_SEEN, { key: '' }).key);
  const worst = warnings?.[0];
  if (!worst || closed === key) return null;
  const more = warnings.length > 1 ? ` +${warnings.length - 1}` : '';
  return (
    <div className={`banner banner--weather banner--weather-${worst.level}`} role="alert">
      <TriangleAlert size={16} aria-hidden />
      <button type="button" className="banner__link" onClick={() => navigate('weather')}>
        {weatherWord(worst.level, t.lang)} · {weatherWord(worst.type, t.lang)} ·{' '}
        {weatherWord(worst.area, t.lang)} {weatherWord('until', t.lang)} {worst.end.slice(11, 16)}
        {more}
      </button>
      <button
        type="button"
        className="banner__close"
        aria-label={t.t('close')}
        onClick={() => {
          save(WEATHER_SEEN, { key });
          setClosed(key);
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
