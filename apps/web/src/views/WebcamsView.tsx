import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Mountain, Play, Video, X } from 'lucide-react';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n } from '../i18n.ts';
import { useBack } from '../lib/back.ts';
import type { MapContent } from '../lib/mapContent.ts';
import { navigate, type Route } from '../lib/router.ts';
import {
  loadWebcamLive,
  playerUrl,
  providerName,
  stillUrl,
  WEBCAMS,
  type Webcam,
  type WebcamLive,
} from '../lib/webcams.ts';
import { weatherWord } from '../lib/weather.ts';

/**
 * Madeira's live webcams on the map and in a list, the mountains first (is Pico do Arieiro
 * above the clouds?): a tap plays the camera's broadcast here in YouTube's player, or opens
 * the provider's page when it has none on YouTube now.
 */
export function WebcamsView({ route }: { route: Route }) {
  const t = useI18n();
  const [live, setLive] = useState<Record<string, WebcamLive>>({});
  useEffect(() => {
    let on = true;
    void loadWebcamLive().then((l) => on && setLive(l));
    return () => {
      on = false;
    };
  }, []);
  const openId = route.query.get('c');
  const open = WEBCAMS.find((c) => c.id === openId);
  // Live on YouTube: its player here. Netmadeira's cameras without one: their own page here,
  // with its picture of a minute ago (they keep the pictures to their site). Else their page.
  const inApp = (c: Webcam) => Boolean(live[c.id]) || c.provider === 'netmadeira';
  const show = (c: Webcam) => {
    if (inApp(c)) navigate('webcams', { c: c.id });
    else window.open(c.page, '_blank', 'noopener');
  };
  // The phone's back button closes the player first.
  useBack(
    useCallback(() => {
      if (!openId) return false;
      navigate('webcams');
      return true;
    }, [openId]),
  );

  const content = useMemo<MapContent>(
    () => ({
      lines: [],
      points: [],
      fitKey: 'webcams',
      fit: WEBCAMS.filter((c) => c.id !== 'porto-santo'),
      badges: WEBCAMS.map((c) => ({
        id: `webcam-${c.id}`,
        kind: 'webcam' as const,
        lat: c.lat,
        lon: c.lon,
        text: '🎥',
        sub: c.name,
        live: Boolean(live[c.id]),
        active: c.id === openId,
        onTap: () => show(c),
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, openId],
  );
  useMapContent(content);

  const sorted = useMemo(
    () =>
      [...WEBCAMS].sort(
        (a, b) =>
          Number(Boolean(live[b.id])) - Number(Boolean(live[a.id])) ||
          Number(Boolean(b.high)) - Number(Boolean(a.high)),
      ),
    [live],
  );

  return (
    <div className="webcams">
      <h2 className="weather__title">
        <Video size={20} aria-hidden /> {t.t('layers.webcams')}
      </h2>
      {open && inApp(open) && (
        <section className="webcam-player" aria-label={open.name}>
          {live[open.id] ? (
            <div className="webcam-player__frame">
              <iframe
                src={playerUrl(live[open.id]!.video)}
                title={open.name}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : (
            <div className="webcam-player__frame webcam-player__frame--page">
              <iframe src={open.page} title={open.name} />
            </div>
          )}
          <div className="webcam-player__bar">
            <div>
              <div className="strong">{open.name}</div>
              <div className="muted small">
                {providerName(open)} · {live[open.id] ? 'YouTube' : 'netmadeira.com'}
              </div>
            </div>
            <a
              className="icon-button"
              href={
                live[open.id]
                  ? `https://www.youtube.com/watch?v=${live[open.id]!.video}`
                  : open.page
              }
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
            >
              <ExternalLink size={18} />
            </a>
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => navigate('webcams')}
            >
              <X size={18} />
            </button>
          </div>
        </section>
      )}
      <ul className="webcam-list">
        {sorted.map((c) => {
          const now = live[c.id];
          return (
            <li key={c.id}>
              <button
                type="button"
                className="webcam-item"
                aria-pressed={c.id === openId}
                onClick={() => show(c)}
              >
                <span className="webcam-item__still">
                  {now ? (
                    <img src={stillUrl(now.video)} alt="" loading="lazy" />
                  ) : (
                    <Video size={22} aria-hidden />
                  )}
                  {now && (
                    <span className="webcam-item__live">
                      <Play size={10} aria-hidden /> LIVE
                    </span>
                  )}
                </span>
                <span className="webcam-item__text">
                  <span className="strong">
                    {c.high && <Mountain size={14} aria-hidden />} {c.name}
                  </span>
                  <span className="muted small">
                    {providerName(c)}
                    {!inApp(c) && (
                      <>
                        {' · '}
                        <ExternalLink size={11} aria-hidden />
                      </>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small weather__source">
        Portal Netmadeira (NOS Madeira), Madeira-Web · YouTube.{' '}
        <button type="button" className="link-button" onClick={() => navigate('weather')}>
          {weatherWord('title', t.lang)}
        </button>
      </p>
    </div>
  );
}
