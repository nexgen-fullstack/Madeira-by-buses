import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  cumulativeDistances,
  madeiraNow,
  pointAlong,
  RideTracker,
  type Leg,
  type Network,
  type RideLeg,
  type TrackedStop,
  type TrackState,
  type WalkLeg,
} from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { askNotify, canNotify, keepScreenOn, notify, speak, vibrate } from '../lib/device.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { ridesOf } from '../lib/itinerary.ts';
import { walkPath } from '../lib/mapContent.ts';
import type { LatLon } from '@madeirabus/engine';
import { RideSimulator } from '../lib/simulator.ts';
import { OffWay } from '../lib/reroute.ts';
import { useApp, type ActiveTrip } from './app.tsx';

/**
 * Following a ride runs at the level of the app, not of the trip screen: the
 * passenger can look up a line or the map mid-ride and still be told when to
 * get off.
 */

const SPEEDUP = 20;
/** A walker in the simulation (m/s), before the speed-up. */
const SIM_WALK = 1.4;

/** The walk being walked now: to the first bus, between two, from the last, or all the way. */
export interface WalkNow {
  leg: WalkLeg;
  /** Its way as the map draws it. */
  path: LatLon[];
  /** When (ms) a new way was found from where the walker turned off, as a maps app re-plans. */
  rerouted?: number;
  /** With the new way, the bus at its end leaves before the walker gets there. */
  late?: boolean;
}

export interface RideSetup {
  stops: TrackedStop[];
  shape: LatLon[];
  tracker: RideTracker;
  sim: RideSimulator;
}

export interface TripTracking {
  rides: RideLeg[];
  rideIndex: number;
  ride?: RideLeg;
  nextRide?: RideLeg;
  setup?: RideSetup;
  state?: TrackState;
  /** `walk`: a journey on foot all the way. */
  phase: 'ride' | 'transfer' | 'done' | 'walk';
  /** Where the phone is (in the simulation, where the bus or the walker is). */
  position?: LatLon & { accuracy?: number };
  /** The walk under way, with turn-by-turn guidance. */
  walk?: WalkNow;
  gpsError?: 'denied' | 'unavailable';
  notifyOn: boolean;
  enableNotify: () => void;
  /** The passenger got on the next bus of a transfer. */
  board: () => void;
}

const TripContext = createContext<TripTracking | undefined>(undefined);

export const useTripTracking = () => useContext(TripContext);

export function TripProvider({ children }: { children: ReactNode }) {
  const { data, trip } = useApp();
  const [value, setValue] = useState<TripTracking | undefined>();
  const net = data.status === 'ready' ? data.net : undefined;
  return (
    <TripContext.Provider value={trip ? value : undefined}>
      {net && trip && (
        <TripEngine
          key={`${trip.itinerary.key}@${trip.itinerary.depart}|${trip.date}|${trip.simulate}`}
          net={net}
          trip={trip}
          onChange={setValue}
        />
      )}
      {children}
    </TripContext.Provider>
  );
}

function TripEngine({
  net,
  trip,
  onChange,
}: {
  net: Network;
  trip: ActiveTrip;
  onChange: (v: TripTracking | undefined) => void;
}) {
  const t = useI18n();
  const { setTrip, data, settings } = useApp();
  const planner = data.status === 'ready' ? data.planner : undefined;
  const [rideIndex, setRideIndex] = useState(() => trip.ride ?? 0);
  const [phase, setPhase] = useState<TripTracking['phase']>(() =>
    trip.itinerary.rides === 0 ? 'walk' : 'ride',
  );
  const [state, setState] = useState<TrackState | undefined>();
  const [notifyOn, setNotifyOn] = useState(false);

  const rides = useMemo(() => ridesOf(trip.itinerary), [trip.itinerary]);
  const ride = rides[rideIndex];
  const nextRide = rides[rideIndex + 1];
  const finalStop = rides[rides.length - 1]?.to.name ?? '';
  // In the phone app, the ride is followed with the screen off too.
  const geo = useGeolocation(true, {
    title: t.t('trip.bgTitle'),
    text: t.t('trip.bgText', { stop: finalStop }),
  });

  useEffect(() => {
    void canNotify().then(setNotifyOn);
  }, []);

  // The screen stays on while a ride is followed.
  useEffect(() => keepScreenOn(), []);

  // A reopened app resumes at the same ride.
  const tripRef = useRef(trip);
  tripRef.current = trip;
  useEffect(() => {
    const current = tripRef.current;
    if (!current.simulate && current.ride !== rideIndex) setTrip({ ...current, ride: rideIndex });
  }, [rideIndex, setTrip]);

  const setup = useMemo<RideSetup | undefined>(() => {
    if (!ride) return undefined;
    const stops: TrackedStop[] = ride.stops.map((s) => {
      const st = net.stops[s.stop]!;
      return { name: st.name, lat: st.lat, lon: st.lon, arr: s.arr, dep: s.dep };
    });
    // In the bus's lane, as the map draws it: the bus on the line, not beside it.
    const shape = net.rideLane(ride.pattern, ride.boardPos, ride.alightPos);
    return {
      stops,
      shape,
      tracker: new RideTracker(stops, shape),
      sim: new RideSimulator(stops, shape),
    };
  }, [ride, net]);

  // Real GPS: start watching unless simulating.
  useEffect(() => {
    if (!trip.simulate) geo.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alertUser = useCallback(
    (s: TrackState) => {
      if (!s.alert || !setup) return;
      vibrate(s.alert === 'next' ? [400, 150, 400, 150, 400] : [200, 100, 200]);
      const stopName = setup.stops[setup.stops.length - 1]!.name;
      const text =
        s.alert === 'next'
          ? t.t('trip.getOff')
          : s.alert === 'prepare'
            ? t.t('trip.prepare')
            : s.alert === 'arrived'
              ? t.t('trip.arrived')
              : t.t('trip.offRoute');
      if (notifyOn && document.hidden) void notify(text, stopName);
    },
    [notifyOn, setup, t],
  );

  // Simulation clock: 20× real time, starting 45 s before departure.
  useEffect(() => {
    if (!trip.simulate || !setup || phase !== 'ride') return;
    const started = performance.now();
    const t0 = setup.stops[0]!.dep - 45;
    const id = window.setInterval(() => {
      const now = t0 + ((performance.now() - started) / 1000) * SPEEDUP;
      const fix = setup.sim.fixAt(now);
      const s = fix ? setup.tracker.update(fix) : setup.tracker.tick(now);
      setState(s);
      alertUser(s);
    }, 250);
    return () => window.clearInterval(id);
  }, [trip.simulate, setup, phase, alertUser]);

  // Real GPS fixes.
  useEffect(() => {
    if (trip.simulate || !setup || phase !== 'ride' || !geo.position) return;
    const s = setup.tracker.update({ ...geo.position, time: madeiraNow().time });
    setState(s);
    alertUser(s);
  }, [geo.position, trip.simulate, setup, phase, alertUser]);

  // Real mode heartbeat: keeps going on the timetable when GPS goes quiet.
  useEffect(() => {
    if (trip.simulate || !setup || phase !== 'ride') return;
    const id = window.setInterval(() => {
      const s = setup.tracker.tick(madeiraNow().time);
      setState(s);
      alertUser(s);
    }, 5000);
    return () => window.clearInterval(id);
  }, [trip.simulate, setup, phase, alertUser]);

  // Arrival → transfer or done.
  useEffect(() => {
    if (state?.status !== 'arrived' || phase !== 'ride') return;
    const id = window.setTimeout(
      () => setPhase(nextRide ? 'transfer' : 'done'),
      trip.simulate ? 1500 : 3000,
    );
    return () => window.clearTimeout(id);
  }, [state?.status, phase, nextRide, trip.simulate]);

  // The walk under way: to the first bus while it is awaited, to the next bus at a change,
  // from the last bus, or all the way.
  const legs = trip.itinerary.legs;
  const waiting = !state || state.status === 'waiting';
  const walkLeg = useMemo(() => {
    const isWalk = (l: Leg | undefined): l is WalkLeg => l?.kind === 'walk';
    if (phase === 'walk') return legs.find(isWalk);
    if (phase === 'ride')
      return rideIndex === 0 && waiting && isWalk(legs[0]) ? legs[0] : undefined;
    if (phase === 'transfer' && ride && nextRide) {
      return legs.slice(legs.indexOf(ride) + 1, legs.indexOf(nextRide)).find(isWalk);
    }
    const last = legs.at(-1);
    return phase === 'done' && isWalk(last) ? last : undefined;
  }, [legs, phase, rideIndex, waiting, ride, nextRide]);
  // Off the way (a street turned into that the walk does not take): a new way from where the
  // walker is to where the walk goes, as a maps app re-plans; told aloud with the hints on.
  const [rerouted, setRerouted] = useState<
    { for: WalkLeg; leg: WalkLeg; at: number; late: boolean } | undefined
  >();
  const walk = useMemo<WalkNow | undefined>(() => {
    if (!walkLeg) return undefined;
    if (rerouted?.for === walkLeg)
      return {
        leg: rerouted.leg,
        path: walkPath(rerouted.leg),
        rerouted: rerouted.at,
        late: rerouted.late,
      };
    return { leg: walkLeg, path: walkPath(walkLeg) };
  }, [walkLeg, rerouted]);
  const offWay = useMemo(() => walk && new OffWay(walk.path), [walk]);
  const finding = useRef(false);
  const busAfter = phase === 'transfer' ? nextRide : phase === 'ride' ? ride : undefined;
  useEffect(() => {
    const fix = geo.position;
    if (trip.simulate || !walk || !walkLeg || !offWay || !fix || !planner || finding.current)
      return;
    if (!offWay.update(fix, fix.accuracy, Date.now())) return;
    finding.current = true;
    const from = { lat: fix.lat, lon: fix.lon };
    void planner
      .travel(['walk'], from, walk.leg.to, settings.walkSpeed)
      .then(([way]) => {
        if (!way) return;
        const now = madeiraNow().time;
        const leg: WalkLeg = {
          ...walk.leg,
          from: { ...from, name: t.t('place.myLocation') },
          start: now,
          end: now + way.seconds,
          distance: Math.round(way.length),
          path: way.path,
          ...(way.kerb ? { kerb: way.kerb } : { kerb: undefined }),
          up: way.up,
          down: way.down,
          scenic: undefined,
        };
        // The bus at the end of the walk: still caught, or gone before the walker gets there.
        const late = busAfter !== undefined && busAfter.start < now + way.seconds;
        setRerouted({ for: walkLeg, leg, at: Date.now(), late });
        if (settings.walkHints ?? true) speak(t.t('guide.rerouted'), t.locale);
      })
      .catch(() => undefined)
      .finally(() => {
        finding.current = false;
      });
  }, [geo.position, trip.simulate, walk, walkLeg, offWay, planner, settings, t, busAfter]);

  // In the simulation, a walker going along it (but not to the first bus: the bus comes).
  const [walker, setWalker] = useState<LatLon | undefined>();
  useEffect(() => {
    setWalker(undefined);
    if (!trip.simulate || !walk || phase === 'ride') return;
    const cum = cumulativeDistances(walk.path);
    const started = performance.now();
    const id = window.setInterval(() => {
      const gone = ((performance.now() - started) / 1000) * SIM_WALK * SPEEDUP;
      setWalker(pointAlong(walk.path, cum, gone));
      if (gone > cum.at(-1)! + 30) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [trip.simulate, walk, phase]);
  const position = trip.simulate ? (phase === 'ride' ? state?.position : walker) : geo.position;

  const board = useCallback(() => {
    setRideIndex((i) => i + 1);
    setState(undefined);
    setPhase('ride');
  }, []);

  // In the simulation, board the next bus automatically.
  useEffect(() => {
    if (phase !== 'transfer' || !trip.simulate) return;
    const id = window.setTimeout(board, 3500);
    return () => window.clearTimeout(id);
  }, [phase, trip.simulate, board]);

  const enableNotify = useCallback(() => {
    void askNotify().then(setNotifyOn);
  }, []);

  const value = useMemo<TripTracking>(
    () => ({
      rides,
      rideIndex,
      ride,
      nextRide,
      setup,
      state,
      phase,
      position,
      walk,
      gpsError: geo.error,
      notifyOn,
      enableNotify,
      board,
    }),
    [
      rides,
      rideIndex,
      ride,
      nextRide,
      setup,
      state,
      phase,
      position,
      walk,
      geo.error,
      notifyOn,
      enableNotify,
      board,
    ],
  );
  useEffect(() => onChange(value), [value, onChange]);
  useEffect(() => () => onChange(undefined), [onChange]);
  return null;
}
