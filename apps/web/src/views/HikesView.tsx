import { useEffect, useMemo, useRef, useState } from 'react';
import { Bus, Clock, MoveHorizontal, Repeat, TrendingUp } from 'lucide-react';
import { haversine, trailMinutes, type Trail, type TrailKind } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { duration } from '../lib/format.ts';
import { useQuietPosition } from '../lib/geolocation.ts';
import { EMPTY_CONTENT, ISLAND, type MapContent } from '../lib/mapContent.ts';
import { photoUrl, trailPhoto } from '../lib/photos.ts';
import { navigate } from '../lib/router.ts';
import { REGIONS } from '../lib/scenic.ts';
import { nearestStop, startOf, TRAIL_KINDS, trailRegion, useTrails } from '../lib/trails.ts';
import { useApp, useNetwork } from '../state/app.tsx';

/** Kilometres with one decimal, as the language writes them. */
export const trailKm = (m: number, locale: string) =>
  (m / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A trail's number on a plate in the red and yellow of its waymarks (PR), or plain. */
export function TrailBadge({ trail }: { trail: Trail }) {
  if (!trail.ref) return null;
  return (
    <span className={`trail-badge${trail.kind === 'pr' ? ' trail-badge--pr' : ''}`}>
      {trail.ref}
    </span>
  );
}

/** One trail in the list: its number, name, length, climb and time, and its bus. */
function TrailCard({ trail, bus }: { trail: Trail; bus?: number }) {
  const t = useI18n();
  const pic = trailPhoto(trail.id);
  return (
    <a
      className={`trail-card${pic ? ' trail-card--photo' : ''}`}
      href={`#/hikes/${trail.id}`}
      onClick={(e) => {
        // As a step of the app, so "back" comes to the list where it was.
        e.preventDefault();
        navigate(`hikes/${trail.id}`);
      }}
    >
      {pic && (
        <img
          className="trail-card__photo"
          src={photoUrl(pic, 'sm')}
          width={480}
          height={320}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <span className="trail-card__head">
        <TrailBadge trail={trail} />
        <span className="trail-card__name">{trail.name}</span>
      </span>
      <span className="trail-card__facts">
        <span className="nowrap">
          <MoveHorizontal size={13} aria-hidden />{' '}
          {t.t('scenic.km', { km: trailKm(trail.length, t.locale) })}
        </span>
        {trail.up >= 20 && (
          <span className="nowrap">
            <TrendingUp size={13} aria-hidden /> {t.t('hike.upShort', { m: trail.up })}
          </span>
        )}
        <span className="nowrap">
          <Clock size={13} aria-hidden />{' '}
          {duration(t, trailMinutes(trail.length, trail.up, trail.down) * 60)}
        </span>
        {trail.roundtrip && (
          <span className="nowrap">
            <Repeat size={13} aria-hidden /> {t.t('hike.loopShort')}
          </span>
        )}
      </span>
      <span className={`trail-card__bus${bus === undefined ? ' muted' : ''}`}>
        <Bus size={13} aria-hidden />{' '}
        {bus === undefined ? t.t('hikes.noBus') : t.t('hikes.byBus', { m: bus })}
      </span>
    </a>
  );
}

/** The trails tab's filters, kept while the app is open. */
const shownFilters: { kind: TrailKind | 'all'; busOnly: boolean } = { kind: 'all', busOnly: false };

/**
 * The trails on the map, with their photos, while the trails tab is open when they were
 * off; put away again as it closes, unless the trails button was used meanwhile.
 */
function useTrailsWhileOpen() {
  const { settings, setSettings } = useApp();
  const layers = useRef(settings.map);
  layers.current = settings.map;
  useEffect(() => {
    if (layers.current.trails) return;
    setSettings({ map: { ...layers.current, trails: true, trailPhotos: true } });
    return () => {
      const now = layers.current;
      if (now.trails && now.trailPhotos) setSettings({ map: { ...now, trails: false } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * The trails tab: the island's official PR trails, its levadas and veredas, by region,
 * each with how long, how high and how far its start is from a bus; the trails on the map.
 */
export function HikesView() {
  const t = useI18n();
  const { net } = useNetwork();
  const trails = useTrails();
  // The filters as they were left: back from a trail, the list is the same.
  const [kind, setKindState] = useState<TrailKind | 'all'>(shownFilters.kind);
  const [busOnly, setBusOnlyState] = useState(shownFilters.busOnly);
  const setKind = (k: TrailKind | 'all') => setKindState((shownFilters.kind = k));
  const setBusOnly = (f: (b: boolean) => boolean) =>
    setBusOnlyState((b) => (shownFilters.busOnly = f(b)));

  useTrailsWhileOpen();

  // How far each trail's start is from a bus stop (m), where one is near.
  const bus = useMemo(
    () => new Map((trails ?? []).map((tr) => [tr.id, nearestStop(net, startOf(tr))?.metres])),
    [trails, net],
  );
  // One list, the nearest to the phone first (where it is known), else by region.
  const here = useQuietPosition();
  const shown = useMemo(() => {
    const list = (trails ?? []).filter(
      (tr) => (kind === 'all' || tr.kind === kind) && (!busOnly || bus.get(tr.id) !== undefined),
    );
    const order = (tr: Trail) =>
      here ? haversine(here, startOf(tr)) : REGIONS.indexOf(trailRegion(tr));
    return list
      .map((tr) => [order(tr), tr] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, tr]) => tr);
  }, [trails, kind, busOnly, bus, here]);
  // On the map, the trails the filters keep, as in the list.
  const filtered = kind !== 'all' || busOnly;
  const ids = useMemo(() => shown.map((tr) => tr.id).join(','), [shown]);
  useMapContent(
    useMemo<MapContent>(
      () => ({
        ...EMPTY_CONTENT,
        fitKey: 'island',
        fit: ISLAND,
        ...(filtered ? { trailIds: ids ? ids.split(',') : [] } : {}),
      }),
      [filtered, ids],
    ),
  );
  const kinds = TRAIL_KINDS.filter((k) => trails?.some((tr) => tr.kind === k));

  return (
    <div className="hikes">
      <h2 className="view-title">{t.t('hikes.title')}</h2>
      <p className="muted">{t.t('hikes.intro')}</p>
      <div className="chips hikes__filters" role="group" aria-label={t.t('hikes.filter')}>
        {(['all', ...kinds] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {t.t(k === 'all' ? 'hikes.all' : (`hikes.kind.${k}` as Key))}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={busOnly}
          onClick={() => setBusOnly((b) => !b)}
        >
          <Bus size={14} aria-hidden /> {t.t('hikes.busOnly')}
        </button>
      </div>
      {!trails && <p className="muted">{t.t('loading')}</p>}
      {trails && shown.length === 0 && <p className="muted">{t.t('hikes.none')}</p>}
      {shown.length > 0 && (
        <div className="trail-list">
          {shown.map((tr) => (
            <TrailCard key={tr.id} trail={tr} bus={bus.get(tr.id)} />
          ))}
        </div>
      )}
      <p className="muted small">{t.t('hike.timeNote')}</p>
    </div>
  );
}
