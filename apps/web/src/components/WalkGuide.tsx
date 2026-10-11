import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { LatLon } from '@madeirabus/engine';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { speak, vibrate } from '../lib/device.ts';
import { capitalise, duration } from '../lib/format.ts';
import { WalkFollower, type Turn, type TurnKind, type WalkState } from '../lib/turns.ts';
import { useApp } from '../state/app.tsx';

const ICONS: Record<TurnKind, typeof ArrowUp> = {
  left: CornerUpLeft,
  right: CornerUpRight,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  'sharp-left': CornerUpLeft,
  'sharp-right': CornerUpRight,
  uturn: Undo2,
  arrive: Flag,
};

const KEYS: Record<TurnKind, Key> = {
  left: 'guide.turn.left',
  right: 'guide.turn.right',
  'slight-left': 'guide.turn.slightLeft',
  'slight-right': 'guide.turn.slightRight',
  'sharp-left': 'guide.turn.sharpLeft',
  'sharp-right': 'guide.turn.sharpRight',
  uturn: 'guide.turn.uturn',
  arrive: 'guide.turn.arrive',
};

/** Metres as said: to ten metres, to fifty from two hundred. */
const roundM = (m: number) =>
  m < 200 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;

/** What a turn is told as: "in 50 m turn left", "turn left here", "you are there: …". */
function turnText(t: I18n, turn: Turn, toNext: number, to: string): string {
  if (turn.kind === 'arrive' && toNext <= 15) return t.t('guide.arrived', { name: to });
  const what = t.t(KEYS[turn.kind]);
  if (toNext <= 15) return capitalise(t, t.t('guide.now', { turn: what }));
  return t.t('guide.in', { m: roundM(toNext), turn: what });
}

/**
 * The way on foot as a maps app guides it: the next turn, large, and how far it is; how
 * much is left; a word when the walker leaves the way. With the hints on (the button: as
 * a maps app's voice), each turn is said aloud as it comes close and again when it is
 * there, and felt.
 */
export function WalkGuide({
  path,
  position,
  to,
  speed,
}: {
  path: readonly LatLon[];
  position?: LatLon & { accuracy?: number };
  /** Where the walk goes. */
  to: string;
  /** Walking speed (m/s), for the time left. */
  speed: number;
}) {
  const t = useI18n();
  const { settings, setSettings } = useApp();
  const hints = settings.walkHints ?? true;
  const follower = useMemo(() => new WalkFollower(path), [path]);
  const [state, setState] = useState<WalkState | undefined>();
  const lat = position?.lat;
  const lon = position?.lon;
  const accuracy = position?.accuracy;
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    setState(follower.update({ lat, lon }, accuracy));
  }, [follower, lat, lon, accuracy]);
  // Each turn said once as it comes and once when it is there.
  const cue = state?.cue;
  useEffect(() => {
    if (!cue || !hints) return;
    speak(turnText(t, cue.turn, cue.stage === 'now' ? 0 : (state?.toNext ?? 0), to), t.locale);
    if (cue.stage === 'now') vibrate(cue.turn.kind === 'arrive' ? [400, 150, 400] : [250]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue]);

  // Over the top of the map, as a maps app's banner, whatever the sheet over it does: the
  // map's buttons step down below it, and a way fitted keeps clear of it.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.querySelector<HTMLElement>('.map-wrap')), []);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!host || !el) return;
    const measure = () => host.style.setProperty('--guide-h', `${el.offsetHeight}px`);
    measure();
    host.classList.add('map-wrap--guided');
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.classList.remove('map-wrap--guided');
      host.style.removeProperty('--guide-h');
    };
  }, [host]);

  const next = state?.next ?? follower.turns[0];
  const toNext = state?.toNext ?? next?.at ?? 0;
  const Icon = !next
    ? ArrowUp
    : toNext > 200 && next.kind !== 'arrive'
      ? ArrowUp
      : ICONS[next.kind];
  const headline = !next
    ? t.t('guide.to', { name: to })
    : toNext > 200 && next.kind !== 'arrive'
      ? t.t('guide.straight', { m: roundM(toNext) })
      : turnText(t, next, toNext, to);
  const card = (
    <section
      ref={box}
      className={`walk-guide${state?.arrived ? ' walk-guide--there' : ''}${host ? ' walk-guide--over' : ''}`}
      aria-live="polite"
      data-turn={next?.kind}
    >
      <div className="walk-guide__head">
        <span className="walk-guide__icon" aria-hidden>
          <Icon size={34} strokeWidth={2.6} />
        </span>
        <div className="walk-guide__text">
          <div className="walk-guide__headline">{headline}</div>
          <div className="walk-guide__to muted small">
            {t.t('guide.to', { name: to })}
            {state && !state.arrived && (
              <>
                {' · '}
                {t.t('guide.left', {
                  m: roundM(state.left),
                  time: duration(t, state.left / speed),
                })}
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="icon-button walk-guide__hints"
          aria-pressed={hints}
          aria-label={t.t('guide.hints')}
          title={t.t('guide.hints')}
          onClick={() => setSettings({ walkHints: !hints })}
        >
          {hints ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </div>
      {state?.offRoute && (
        <div className="walk-guide__off" role="alert">
          <TriangleAlert size={16} aria-hidden /> {t.t('guide.offRoute')}
        </div>
      )}
      {!position && <div className="muted small">{t.t('trip.gpsWaiting')}</div>}
    </section>
  );
  return host ? createPortal(card, host) : card;
}
