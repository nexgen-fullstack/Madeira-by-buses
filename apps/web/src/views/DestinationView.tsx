import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Footprints,
  Loader2,
  Mountain,
  TrendingUp,
  Waves,
  Navigation,
  Play,
  Route as RouteIcon,
} from 'lucide-react';
import { haversine, madeiraNow, trailMinutes, type Itinerary } from '@madeirabus/engine';
import { ItineraryCard } from '../components/ItineraryCard.tsx';
import { ItineraryDetail } from '../components/ItineraryDetail.tsx';
import { ScenicArt } from '../components/ScenicCard.tsx';
import { MapContentContext, useMapContent } from '../components/mapContext.tsx';
import { type PlaceValue } from '../components/PlaceSearch.tsx';
import { RouteFields, type RouteEnd } from '../components/RouteFields.tsx';
import { ModeTabs, modeOf, TravelCard, useTravels } from '../components/TravelModes.tsx';
import { DayTrips } from '../components/DayTrips.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { findOptions, firstDeparture, type Found } from '../lib/ahead.ts';
import { aheadFrom, capitalise, dayAhead, duration, longDate } from '../lib/format.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { decodePlace, encodePlace, walkItinerary } from '../lib/itinerary.ts';
import { itineraryContent, travelContent, type MapContent } from '../lib/mapContent.ts';
import { goBack, navigate, type Route } from '../lib/router.ts';
import {
  centreStops,
  CENTRE,
  destinationStops,
  hasPhoto,
  photo,
  reachable,
  SCENIC_WALKS,
  tripsByLine,
  walkFromCentre,
  type Destination,
} from '../lib/scenic.ts';
import { endOf, startOf, useTrails } from '../lib/trails.ts';
import { useNow } from '../lib/useNow.ts';
import { planOptions, useApp, useNetwork } from '../state/app.tsx';

/** A walk along the sea starting or ending this near a place (m) is a stroll from it. */
const STROLL_NEAR = 900;
/** And a trail starting or ending this near (m). */
const TRAIL_NEAR = 700;
/** How many ways there to list before "more in the planner". */
const SHOWN = 3;
/** Farther than this from Funchal (m), you are not on the island: the trip starts in its centre. */
const ON_ISLAND = 60_000;

export function DestinationView({ d, route }: { d: Destination; route: Route }) {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { settings, setTrip } = useApp();
  const geo = useGeolocation(false);
  const now = useNow();
  const q = route.query;
  const fromParam = q.get('from');
  const date = q.get('d') ?? now.date;
  const selected = q.get('i') !== null ? Number(q.get('i')) : undefined;
  const served = reachable(net, d);
  const walk = walkFromCentre(d);

  // Where one can stroll from here: the walks along the sea and the trails that start or end
  // by the place, with how long they are, how long they take and how much they climb.
  const pace = useMemo(() => planOptions(settings), [settings]);
  const strolls = useMemo(
    () =>
      SCENIC_WALKS.filter(
        (w) => haversine(w.from, d) <= STROLL_NEAR || haversine(w.to, d) <= STROLL_NEAR,
      ),
    [d],
  );
  const [strollFacts, setStrollFacts] = useState<(Itinerary | null)[] | undefined>();
  useEffect(() => {
    if (strolls.length === 0) return;
    let cancelled = false;
    planner
      .walks(strolls.map((w) => ({ from: w.from, to: w.to, date, time: 9 * 3600, options: pace })))
      .then((r) => !cancelled && setStrollFacts(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [strolls, planner, pace, date]);
  const allTrails = useTrails();
  const trailsHere = useMemo(
    () =>
      (allTrails ?? [])
        .map((tr) => ({
          tr,
          m: Math.min(haversine(startOf(tr), d), haversine(endOf(tr), d)),
        }))
        .filter((x) => x.m <= TRAIL_NEAR)
        .sort((a, b) => a.m - b.m)
        .slice(0, 2)
        .map((x) => x.tr),
    [allTrails, d],
  );
  const km = (m: number) =>
    (m / 1000).toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) =>
      navigate(`explore/${d.id}`, { ...Object.fromEntries(q.entries()), ...patch }),
    [d.id, q],
  );

  // The two ends of the trip, as in a maps app: from where you are to the place, unless you
  // choose a stop, an address or a point on the map for either, or turn the trip round.
  // "here": where you are (central Funchal when the phone cannot tell, or you are not on
  // the island); "place": this place; "none": the field emptied, to type in it.
  const centreName = t.t('scenic.centre');
  const myLocation = t.t('place.myLocation');
  const fromToken = fromParam ?? 'here';
  const toToken = q.get('to') ?? 'place';
  const located = useMemo<PlaceValue | undefined>(
    () =>
      geo.position && haversine(geo.position, CENTRE) < ON_ISLAND
        ? { lat: geo.position.lat, lon: geo.position.lon, name: myLocation, kind: 'location' }
        : undefined,
    [geo.position, myLocation],
  );
  const wantsHere = fromToken === 'here' || toToken === 'here';
  const toCentre = wantsHere && !located && (geo.error !== undefined || geo.position !== undefined);
  const placeValue = useMemo<PlaceValue>(
    () => ({ lat: d.lat, lon: d.lon, name: d.name, kind: 'location' }),
    [d],
  );
  const resolve = useCallback(
    (token: string): PlaceValue | undefined => {
      if (token === 'none') return undefined;
      if (token === 'place') return placeValue;
      if (token === 'here')
        return (
          located ??
          (toCentre
            ? { ...CENTRE, name: centreName, stops: centreStops(net), kind: 'location' }
            : undefined)
        );
      return decodePlace(net, token, myLocation);
    },
    [placeValue, located, toCentre, centreName, net, myLocation],
  );
  const origin = useMemo(() => resolve(fromToken), [resolve, fromToken]);
  const target = useMemo(() => resolve(toToken), [resolve, toToken]);
  useEffect(() => {
    if (wantsHere && !geo.position && !geo.pending && !geo.error) geo.request();
  }, [wantsHere, geo]);
  // Choosing the start on the map: the pin starts where the trip starts now.
  const { setPick } = useContext(MapContentContext);
  useEffect(() => () => setPick(undefined), [setPick]);

  // The ways there, each with its day: today's, or the next day's when none goes any more.
  const [found, setFound] = useState<Found | undefined>();
  const results = found?.options;
  const [loading, setLoading] = useState(false);
  const searchKey =
    origin && target
      ? `${encodePlace(origin)}>${encodePlace(target)}@${date}|${settings.walkSpeed}|${settings.route}`
      : '';
  useEffect(() => {
    if (!origin || !target || !served) {
      setFound(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const today = madeiraNow().date;
    findOptions(
      planner,
      {
        from: origin,
        to: target,
        date,
        // Today from now; another day from the first buses.
        time: date === today ? madeiraNow().time : 5 * 3600,
        options: planOptions(settings),
      },
      // Nothing there any more today: the next day a bus goes.
      date === today,
    )
      .then((r) => !cancelled && setFound(r))
      .catch(() => !cancelled && setFound({ options: [], days: [] }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, planner, served]);

  // The day's direct buses between the centre and the place, both ways.
  const timetable = useMemo(() => {
    if (!served || walk !== undefined) return undefined;
    const centre = centreStops(net);
    const stops = destinationStops(net, d);
    return {
      // Boarded where the bus passes nearest Avenida do Mar, left nearest the place.
      there: tripsByLine(net, centre, stops, date, 'listed'),
      // Back: from the stop nearest the place to the one nearest the centre.
      back: tripsByLine(net, stops, centre, date, 'listed'),
    };
  }, [net, d, date, served, walk]);

  // By bus, or by car, on foot, by bike, as a maps app offers beside it.
  const mode = modeOf(q.get('m'));
  const { travels, loading: travelling } = useTravels(origin, target);
  const travelShown = mode !== 'bus' ? travels[mode] : undefined;
  const selectedIt = selected !== undefined && mode === 'bus' ? results?.[selected] : undefined;
  const selectedDay = (selected !== undefined && found?.days[selected]) || date;
  useMapContent(
    useMemo<MapContent>(() => {
      if (travelShown) return travelContent(travelShown, { from: origin?.name, to: d.name });
      const it = selectedIt ?? results?.find((r) => r.rides > 0);
      if (it) return itineraryContent(net, it, undefined, it === selectedIt);
      return {
        lines: [],
        points: [{ lat: d.lat, lon: d.lon, kind: 'destination', color: '#14181F', label: d.name }],
        fitKey: `place:${d.id}`,
        fit: [
          d,
          { lat: d.lat + 0.01, lon: d.lon + 0.01 },
          { lat: d.lat - 0.01, lon: d.lon - 0.01 },
        ],
      };
    }, [net, d, results, selectedIt, travelShown, origin?.name]),
  );

  if (selectedIt) {
    return (
      <ItineraryDetail
        it={selectedIt}
        date={selectedDay}
        ahead={selectedDay !== date}
        onBack={() => setParams({ i: undefined })}
        onStart={(simulate) => {
          setTrip({
            itinerary: selectedIt,
            date: selectedDay,
            simulate,
            generatedAt: net.bundle.generatedAt,
          });
          navigate('trip');
        }}
        onShare={async () => {
          try {
            if (navigator.share) await navigator.share({ title: d.name, url: location.href });
            else await navigator.clipboard.writeText(location.href);
          } catch {
            // Share sheet dismissed.
          }
        }}
      />
    );
  }

  // A field of the form: a place typed or chosen on the map, emptied, or where you are.
  const end = (field: 'from' | 'to', value: PlaceValue | undefined): RouteEnd => ({
    value,
    onChange: (v) => setParams({ [field]: v ? encodePlace(v, net) : 'none', i: undefined }),
    // "Where you are" on either field, as in a maps app: from here, or a way back to here.
    onUseLocation: () => {
      setParams({ [field]: 'here', i: undefined });
      geo.request();
    },
    locating: geo.pending && (field === 'from' ? fromToken : toToken) === 'here',
    onPickOnMap: (area) => setPick(field, area, value),
  });

  // A line of the timetable: its way on the map and its timetable from where it is boarded;
  // back returns here.
  const openLine = (route: number, stop: number) =>
    navigate(`lines/${route}`, { s: String(stop), d: q.get('d') ?? undefined });
  const missing = (net.bundle.missingOperators ?? net.bundle.partialOperators)?.join(', ');
  const shownResults = results?.slice(0, SHOWN) ?? [];
  // An end chosen as it is; else a point, not the dozens of central stops, and "my
  // location" unnamed.
  const linkEnd = (token: string, p: PlaceValue) =>
    token === 'here' || token === 'place'
      ? encodePlace({ lat: p.lat, lon: p.lon, name: p === located ? undefined : p.name })
      : encodePlace(p, net);
  const plannerLink =
    origin &&
    target &&
    `#/plan?${new URLSearchParams({
      from: linkEnd(fromToken, origin),
      to: linkEnd(toToken, target),
      ...(q.get('d') ? { d: date, t: '05:00' } : {}),
    })}`;

  return (
    <div className="destination">
      <div className={`destination__hero${hasPhoto(d) ? '' : ' destination__hero--art'}`} data-peek>
        {hasPhoto(d) ? (
          <img
            className="destination__photo"
            src={photo(d, 'lg')}
            width={960}
            height={640}
            alt=""
            style={{ backgroundImage: `url("${photo(d, 'sm')}")` }}
          />
        ) : (
          <ScenicArt d={d} className="destination__photo" />
        )}
        <span className="destination__shade" aria-hidden />
        <button
          type="button"
          className="icon-button destination__back"
          onClick={() => goBack('explore')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="destination__title">
          <span className="destination__tag">{t.t(`scenic.${d.id}.tag` as Key)}</span>
          <h2>{d.name}</h2>
          {(strolls.length > 0 || trailsHere.length > 0) && (
            <ul className="destination__strolls" aria-label={t.t('scenic.strollHere')}>
              {strolls.map((w, i) => {
                const it = strollFacts?.[i];
                const leg = it?.legs[0];
                return (
                  <li key={`${w.from.name}>${w.to.name}`}>
                    <a
                      href={`#/plan?${new URLSearchParams({ from: encodePlace(w.from), to: encodePlace(w.to) })}`}
                    >
                      <Waves size={14} aria-hidden />
                      <span>
                        {w.from.name} → {w.to.name}
                        {it && leg?.kind === 'walk' && (
                          <span className="destination__facts">
                            {t.t('scenic.km', { km: km(leg.distance) })} ·{' '}
                            {t.t('walk.min', { m: Math.max(1, Math.round(it.duration / 60)) })}
                            {(leg.up ?? 0) >= 10 && (
                              <>
                                {' '}
                                · <TrendingUp size={12} aria-hidden />{' '}
                                {t.t('walk.dist', { d: Math.round((leg.up ?? 0) / 10) * 10 })}
                              </>
                            )}
                          </span>
                        )}
                      </span>
                    </a>
                  </li>
                );
              })}
              {trailsHere.slice(0, Math.max(0, 3 - strolls.length)).map((tr) => (
                <li key={tr.id}>
                  <a href={`#/hikes/${tr.id}`}>
                    <Mountain size={14} aria-hidden />
                    <span>
                      {tr.ref ? `${tr.ref} ` : ''}
                      {tr.name}
                      <span className="destination__facts">
                        {t.t('scenic.km', { km: km(tr.length) })} ·{' '}
                        {duration(t, trailMinutes(tr.length, tr.up, tr.down) * 60)}
                        {tr.up >= 10 && (
                          <>
                            {' '}
                            · <TrendingUp size={12} aria-hidden />{' '}
                            {t.t('walk.dist', { d: Math.round(tr.up / 10) * 10 })}
                          </>
                        )}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {served && (
          <button
            type="button"
            className="destination__start"
            title={t.t('scenic.startHint')}
            // The best way there from where the trip starts (where you are), on the whole map;
            // the sheet with the steps and the timetables comes up from its handle.
            onClick={() => setParams({ i: '0', m: undefined })}
          >
            <Play size={14} aria-hidden /> {t.t('scenic.start')}
          </button>
        )}
      </div>
      <p className="destination__text">{t.t(`scenic.${d.id}.text` as Key)}</p>

      {!served ? (
        <div className="banner banner--info">
          {t.t('scenic.laterHint', { operators: missing ?? '—' })}
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card__row card__row--wrap">
              <h3 className="card__title">
                <RouteIcon size={16} aria-hidden /> {t.t('scenic.getThere')}
              </h3>
            </div>
            <div className="plan__form plan__form--flat">
              <RouteFields
                from={end('from', origin)}
                to={end('to', target)}
                onSwap={() => setParams({ from: toToken, to: fromToken, i: undefined })}
              />
            </div>
            {toCentre && <p className="muted small">{t.t('scenic.fromCentreNote')}</p>}
            {origin && target && (
              <ModeTabs
                mode={mode}
                onMode={(m) => setParams({ m: m === 'bus' ? undefined : m, i: undefined })}
                bus={results?.find((it) => it.rides > 0)?.duration}
                travels={travels}
                loading={travelling}
              />
            )}
            {mode !== 'bus' && (
              <TravelCard
                mode={mode}
                travel={travelShown}
                loading={travelling}
                onStart={(simulate) => {
                  if (!travelShown || !origin) return;
                  setTrip({
                    itinerary: walkItinerary(
                      travelShown,
                      { name: origin.name, lat: origin.lat, lon: origin.lon },
                      { name: d.name, lat: d.lat, lon: d.lon },
                      now.time,
                    ),
                    date: now.date,
                    simulate,
                    generatedAt: net.bundle.generatedAt,
                  });
                  navigate('trip');
                }}
              />
            )}
            {mode === 'bus' && (loading || (wantsHere && geo.pending)) && (
              <p className="plan__status" role="status">
                <Loader2 size={16} className="spin" aria-hidden /> {t.t('searching')}
              </p>
            )}
            {mode === 'bus' && !loading && results && results.length === 0 && (
              <p className="muted">{t.t('scenic.noTrips')}</p>
            )}
            {mode === 'bus' && shownResults.length > 0 && found && (
              <div className="results">
                {shownResults.map((it, i) => {
                  const day = found.days[i]!;
                  const later = day !== date;
                  return (
                    <Fragment key={`${day}|${it.key}@${it.depart}`}>
                      {later && found.days[i - 1] !== day && (
                        <div className="banner banner--ahead" role="status">
                          <CalendarClock size={18} aria-hidden />
                          <div>
                            <strong>{t.t('ahead.none')}</strong>
                            {aheadFrom(
                              t,
                              day,
                              now.date,
                              firstDeparture(found.options.filter((_, k) => found.days[k] === day)),
                            )}
                          </div>
                        </div>
                      )}
                      <ItineraryCard
                        it={it}
                        day={later ? capitalise(t, dayAhead(t, day, now.date)) : undefined}
                        now={day === now.date ? now.time : undefined}
                        onSelect={() => setParams({ i: String(i) })}
                      />
                    </Fragment>
                  );
                })}
              </div>
            )}
            {plannerLink && (
              <a
                className="button button--ghost button--block destination__more"
                href={plannerLink}
              >
                <Navigation size={16} aria-hidden /> {t.t('scenic.openPlanner')}
              </a>
            )}
          </section>

          <section className="card day-timetable">
            <div className="card__row card__row--wrap">
              <h3 className="card__title">
                <CalendarClock size={16} aria-hidden />{' '}
                {t.t('lines.timetable', { date: longDate(t, date) })}
              </h3>
              <input
                type="date"
                aria-label={t.t('time.date')}
                value={date}
                min={net.bundle.validity.from}
                max={net.bundle.validity.to}
                onChange={(e) =>
                  e.target.value &&
                  setParams({
                    d: e.target.value === now.date ? undefined : e.target.value,
                    i: undefined,
                  })
                }
              />
            </div>
            {walk !== undefined ? (
              <p className="first-last">
                <Footprints size={16} aria-hidden /> {t.t('scenic.walk', { m: walk })}
              </p>
            ) : timetable && timetable.there.length > 0 ? (
              <>
                <p className="muted small">{t.t('scenic.linesHint')}</p>
                <DayTrips
                  lines={timetable.there}
                  date={date}
                  tag={t.t('scenic.there')}
                  from={centreName}
                  to={d.name}
                  onLine={openLine}
                />
                <DayTrips
                  lines={timetable.back}
                  date={date}
                  tag={t.t('detail.wayBack')}
                  from={d.name}
                  to={centreName}
                  back
                  onLine={openLine}
                />
              </>
            ) : (
              <p className="muted">{t.t('scenic.noDirect')}</p>
            )}
          </section>
        </>
      )}
      {d.credit && (
        <p className="destination__credit muted small">
          <a href={d.credit.source} target="_blank" rel="noopener noreferrer">
            {t.t('scenic.photo', { author: d.credit.author, license: d.credit.license })}
          </a>
        </p>
      )}
    </div>
  );
}
