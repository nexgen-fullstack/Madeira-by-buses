import { useMemo, useState } from 'react';
import {
  BellRing,
  Bus,
  Flag,
  Footprints,
  Info,
  Megaphone,
  Satellite,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useMapBuses, useMapContent } from '../components/mapContext.tsx';
import { ABOARD_GOLD, type LiveBus } from '../lib/liveBus.ts';
import { useSnapped } from '../lib/snap.ts';
import { useNow } from '../lib/useNow.ts';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { isNative } from '../lib/device.ts';
import { clock } from '../lib/format.ts';
import { encodePlace } from '../lib/itinerary.ts';
import { hasView } from '@madeirabus/engine';
import { WalkGuide } from '../components/WalkGuide.tsx';
import {
  flagPoint,
  pairFlags,
  RIDE_WIDTH,
  rideColor,
  walkColor,
  type FlagLook,
  type MapContent,
  type MapPoint,
} from '../lib/mapContent.ts';
import { goBack, navigate } from '../lib/router.ts';
import { useApp, useNetwork } from '../state/app.tsx';
import { useTripTracking } from '../state/trip.tsx';
import { routeColor } from '../lib/color.ts';

/** The ride being followed (the following itself runs in state/trip.tsx). */
export function TripView() {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { trip, setTrip, settings } = useApp();
  const tracking = useTripTracking();
  const [driver, setDriver] = useState(false);
  const {
    rides = [],
    rideIndex = 0,
    ride,
    nextRide,
    setup,
    state,
    phase = 'ride',
  } = tracking ?? {};

  const walk = tracking?.walk;
  const raw = tracking?.position;
  // In the bus: you are in it, gold, where the bus is on its road.
  const aboard =
    phase === 'ride' &&
    state !== undefined &&
    (state.status === 'riding' || state.status === 'prepare' || state.status === 'next');
  // On foot, where the phone says the person is (on a pedestrian street beside the way
  // drawn, in a square, in a church), not pulled onto the way; at speed, on the road.
  const placed = useSnapped(trip?.simulate ? undefined : raw, planner);
  const position = trip?.simulate ? raw : (placed ?? raw);
  // The bus to take, where its timetable has it while it is awaited; the bus you are in.
  const clockNow = useNow(5_000);
  const buses = useMemo<LiveBus[] | undefined>(() => {
    if (!ride || phase !== 'ride' || !trip) return undefined;
    const text = net.routes[ride.route]!.short;
    const key = `${ride.pattern}:${ride.dayTrip}`;
    if (aboard) return [{ key, ...state.position, color: ABOARD_GOLD, text, aboard: true }];
    const at = net.busAt(ride.pattern, trip.date, ride.dayTrip, clockNow.time);
    return at && at.pos <= ride.boardPos
      ? [{ key, ...at.point, color: rideColor(rideIndex), text }]
      : undefined;
  }, [ride, phase, trip, net, aboard, state, clockNow, rideIndex]);
  useMapBuses(buses);
  const content = useMemo<MapContent | undefined>(() => {
    // On foot: the walk from its start flag to its chequered one, and the walker on it.
    const walkLine = walk && {
      coords: walk.path,
      // In the colour this walk has on the route.
      color: walkColor(
        Math.max(
          0,
          (trip?.itinerary.legs ?? []).filter((l) => l.kind === 'walk').indexOf(walk.leg),
        ),
      ),
      ...(hasView(walk.leg) ? { view: true } : {}),
      dashed: true,
    };
    const walkFlags = walk
      ? [
          flagPoint(
            walk.path[0]!,
            false,
            { mode: 'walk', color: walkLine!.color },
            walk.leg.from.name,
          ),
          flagPoint(
            walk.path.at(-1)!,
            true,
            { mode: 'walk', color: walkLine!.color },
            walk.leg.to.name,
            {
              label: walk.leg.to.name,
            },
          ),
        ]
      : [];
    // The person in the middle of the screen as they go, their dot and beam drawn by the map;
    // aboard, the bus they are in.
    const follow: MapContent['follow'] =
      aboard && state?.position
        ? { lat: state.position.lat, lon: state.position.lon, me: false }
        : position
          ? { lat: position.lat, lon: position.lon }
          : undefined;
    if (walk && phase !== 'ride') {
      return {
        lines: [walkLine!],
        points: walkFlags,
        fitKey: `trip:walk:${phase}:${rideIndex}`,
        fit: walk.path,
        focus: 'trip',
        ...(follow ? { follow } : {}),
      };
    }
    if (!setup || !ride) return undefined;
    const last = setup.stops.length - 1;
    // Boarded at the start flag, left at the chequered one, on the bus's side of the road,
    // both in the colour the ride is drawn in with its number.
    const ends = [setup.shape[0], setup.shape.at(-1)];
    const look: FlagLook = {
      mode: 'bus',
      color: rideColor(rideIndex),
      text: net.routes[ride.route]!.short,
    };
    const points: MapPoint[] = setup.stops.map((s, i) => {
      const at = (i === 0 ? ends[0] : i === last ? ends[1] : undefined) ?? s;
      if (i === 0 || i === last) return flagPoint(at, i === last, look, s.name, { label: s.name });
      return { lat: at.lat, lon: at.lon, kind: 'stop', color: '#14181F' };
    });
    // The ride in the colour it has on the route, alone on the map (with the walk to it
    // while the bus is awaited), and where the phone is.
    const lines: MapContent['lines'] = [
      { coords: setup.shape, color: rideColor(rideIndex), width: RIDE_WIDTH, arrows: true },
    ];
    if (walkLine) lines.unshift(walkLine);
    const all = [...walkFlags, ...points];
    pairFlags(all);
    return {
      lines,
      points: all,
      fitKey: `trip:${rideIndex}${walk ? ':walk' : ''}`,
      fit: [...setup.shape, ...(walk?.path ?? [])],
      focus: 'trip',
      ...(follow ? { follow } : {}),
    };
  }, [
    setup,
    ride,
    net,
    rideIndex,
    walk,
    position,
    phase,
    trip?.itinerary.legs,
    aboard,
    state?.position,
  ]);
  useMapContent(content);

  // The way found anew misses the bus at its end: said, with a new search from here.
  const lateBus = phase === 'transfer' ? nextRide : phase === 'ride' ? ride : undefined;
  const late =
    walk?.late && lateBus
      ? t.t('guide.late', { route: net.routes[lateBus.route]!.short, t: clock(lateBus.start) })
      : undefined;

  if (trip && tracking && phase === 'walk') {
    return (
      <div className="trip">
        <div className="trip__header">
          <span className="trip__walk-badge" aria-hidden>
            <Footprints size={22} />
          </span>
          <div className="trip__headsign">
            <div className="strong">{t.t('guide.title')}</div>
            <div className="muted small">{trip.simulate ? 'Simulation' : 'GPS'}</div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setTrip(undefined);
              goBack('plan');
            }}
            aria-label={t.t('trip.end')}
          >
            <X size={20} />
          </button>
        </div>
        {walk && (
          <WalkGuide
            path={walk.path}
            position={position}
            to={walk.leg.to.name}
            speed={settings.walkSpeed}
            rerouted={walk.rerouted}
          />
        )}
        {tracking.gpsError && <p className="muted small">{t.t('trip.gpsDenied')}</p>}
      </div>
    );
  }

  if (!trip || !tracking || !ride || !setup) {
    return (
      <div className="trip">
        <p className="muted">{t.t('trip.done')}</p>
        <button type="button" className="button" onClick={() => navigate('plan')}>
          {t.t('back')}
        </button>
      </div>
    );
  }

  const route = net.routes[ride.route]!;
  const alightName = setup.stops[setup.stops.length - 1]!.name;
  const end = () => {
    setTrip(undefined);
    goBack('plan');
  };

  const walkBefore = nextRide
    ? trip.itinerary.legs
        .slice(trip.itinerary.legs.indexOf(ride) + 1, trip.itinerary.legs.indexOf(nextRide))
        .find((l) => l.kind === 'walk')
    : undefined;
  const walkSeconds = walkBefore ? walkBefore.end - walkBefore.start : 0;
  const missing = Boolean(
    nextRide &&
    state &&
    phase === 'ride' &&
    !setup.tracker.canConnect(state, nextRide.start, walkSeconds),
  );

  const status = state?.status ?? 'waiting';
  const headline =
    status === 'next'
      ? t.t('trip.getOff')
      : status === 'prepare'
        ? t.t('trip.prepare')
        : status === 'arrived'
          ? t.t('trip.arrived')
          : status === 'off-route'
            ? t.t('trip.offRoute')
            : t.t('trip.ride', { route: route.short });

  return (
    <div className="trip">
      <div className="trip__header">
        <RouteBadge route={route} size="lg" />
        <div className="trip__headsign">
          <div className="strong">{ride.headsign}</div>
          <div className="muted small">
            {rides.length > 1 && `${rideIndex + 1}/${rides.length} · `}
            {trip.simulate
              ? 'Simulation'
              : state?.source === 'timetable'
                ? t.t('trip.gpsLost')
                : 'GPS'}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={end} aria-label={t.t('trip.end')}>
          <X size={20} />
        </button>
      </div>

      {late && (
        <div className="banner banner--warn" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span>{late}</span>
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              // From where the phone is now (the planner's start by default) to the same end.
              const last = trip.itinerary.legs[trip.itinerary.legs.length - 1]!;
              const dest = last.kind === 'ride' ? { ...last.to, stops: [last.to.stop!] } : last.to;
              navigate('plan', { to: encodePlace(dest, net), d: trip.date });
            }}
          >
            {t.t('trip.replan')}
          </button>
        </div>
      )}

      {phase === 'ride' && (
        <>
          {walk && (
            <WalkGuide
              path={walk.path}
              position={position}
              to={walk.leg.to.name}
              speed={settings.walkSpeed}
              rerouted={walk.rerouted}
              late={late}
            />
          )}
          <section className={`trip__status trip__status--${status}`} aria-live="assertive">
            <div className="trip__headline">
              {status === 'next' && <Megaphone size={22} aria-hidden />}
              {status === 'off-route' && <TriangleAlert size={22} aria-hidden />}
              {headline}
            </div>
            {status === 'next' && <div className="trip__hint">{t.t('trip.pressStop')}</div>}
            <div className="trip__label">{t.t('trip.next')}</div>
            <div className="trip__stop">
              {state ? setup.stops[state.nextStop]!.name : setup.stops[1]?.name}
            </div>
            {state && (
              <div className="trip__facts">
                {state.stopsRemaining > 0 && <span>{t.tn('trip.left', state.stopsRemaining)}</span>}
                <span>{t.t('trip.eta', { t: clock(state.eta) })}</span>
                <span>
                  {Math.abs(state.delay) < 60
                    ? t.t('trip.onTime')
                    : state.delay > 0
                      ? t.t('trip.late', { n: Math.round(state.delay / 60) })
                      : t.t('trip.early', { n: Math.round(-state.delay / 60) })}
                </span>
              </div>
            )}
            {!state && !trip.simulate && (
              <div className="trip__facts">
                {tracking.gpsError ? t.t('trip.gpsDenied') : t.t('trip.gpsWaiting')}
              </div>
            )}
            {state?.source === 'timetable' && (
              <div className="trip__gps">
                <Satellite size={14} aria-hidden /> {t.t('trip.gpsLost')}
              </div>
            )}
          </section>

          {missing && nextRide && (
            <div className="banner banner--warn" role="alert">
              <TriangleAlert size={16} aria-hidden />
              <span>{t.t('trip.missed')}</span>
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  const last = trip.itinerary.legs[trip.itinerary.legs.length - 1]!;
                  const dest =
                    last.kind === 'ride' ? { ...last.to, stops: [last.to.stop!] } : last.to;
                  navigate('plan', {
                    from: encodePlace({ ...ride.to, stops: [ride.to.stop!] }, net),
                    to: encodePlace(dest, net),
                    t: clock(state!.eta),
                    d: trip.date,
                  });
                }}
              >
                {t.t('trip.replan')}
              </button>
            </div>
          )}

          <ol className="trip__stops" style={{ ['--route' as string]: routeColor(route) }}>
            {setup.stops.map((s, i) => {
              const passed = state ? i < state.nextStop : i === 0;
              const isNext = state ? i === state.nextStop : i === 1;
              return (
                <li
                  key={`${s.name}-${i}`}
                  className={`${passed ? 'is-passed' : ''} ${isNext ? 'is-next' : ''} ${i === setup.stops.length - 1 ? 'is-alight' : ''}`}
                >
                  <span className="trip__stop-time">{clock(s.arr)}</span>
                  <span className="trip__stop-name">{s.name}</span>
                  {i === setup.stops.length - 1 && <Flag size={14} aria-hidden />}
                </li>
              );
            })}
          </ol>

          <div className="detail__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => setDriver(true)}
            >
              <Bus size={18} /> {t.t('trip.showDriver')}
            </button>
            {!tracking.notifyOn && (isNative() || typeof Notification !== 'undefined') && (
              <button type="button" className="button" onClick={tracking.enableNotify}>
                <BellRing size={18} /> {t.t('trip.notify')}
              </button>
            )}
          </div>
          {!trip.simulate && !isNative() && (
            <p className="muted small trip__note">
              <Info size={14} aria-hidden /> {t.t('trip.keepOpen')}
            </p>
          )}
        </>
      )}

      {phase === 'transfer' && nextRide && (
        <section className="trip__status trip__status--transfer">
          <div className="trip__headline">
            {t.t('trip.transfer', { route: net.routes[nextRide.route]!.short })}
          </div>
          {walkBefore && (
            <div className="trip__facts">
              <Footprints size={16} aria-hidden />{' '}
              {t.t('trip.walkTo', {
                stop: nextRide.from.name,
                m: Math.max(1, Math.round(walkSeconds / 60)),
              })}
            </div>
          )}
          <div className="trip__stop">
            {t.t('trip.waitBus', {
              route: net.routes[nextRide.route]!.short,
              t: clock(nextRide.start),
            })}
          </div>
          <div className="muted">{nextRide.from.name}</div>
          {!trip.simulate && (
            <button type="button" className="button button--primary" onClick={tracking.board}>
              <Bus size={18} /> {t.t('detail.board')}
            </button>
          )}
        </section>
      )}
      {phase === 'transfer' && walk && (
        <WalkGuide
          path={walk.path}
          position={position}
          to={walk.leg.to.name}
          speed={settings.walkSpeed}
          rerouted={walk.rerouted}
          late={late}
        />
      )}

      {phase === 'done' && walk && (
        <WalkGuide
          path={walk.path}
          position={position}
          to={walk.leg.to.name}
          speed={settings.walkSpeed}
          rerouted={walk.rerouted}
          late={late}
        />
      )}
      {phase === 'done' && (
        <section className="trip__status trip__status--arrived">
          <div className="trip__headline">{t.t('trip.done')}</div>
          <button type="button" className="button" onClick={end}>
            {t.t('trip.end')}
          </button>
        </section>
      )}

      {driver && (
        <div className="driver" role="dialog" aria-modal="true" onClick={() => setDriver(false)}>
          <div className="driver__text">{t.t('trip.driverText')}</div>
          <div className="driver__stop">{alightName}</div>
          <div className="driver__route">
            <RouteBadge route={route} size="lg" />
          </div>
        </div>
      )}
    </div>
  );
}
