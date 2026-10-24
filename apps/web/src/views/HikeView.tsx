import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bus,
  Camera,
  ExternalLink,
  Flag,
  Merge,
  Minus,
  Navigation,
  Plus,
  Split,
  TriangleAlert,
  Unlink,
  X,
} from 'lucide-react';
import { haversine, trailMinutes, type LatLon, type Trail } from '@madeirabus/engine';
import { useMapContent, useSpotlight } from '../components/mapContext.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { duration } from '../lib/format.ts';
import { encodePlace } from '../lib/itinerary.ts';
import { useQuietPosition } from '../lib/geolocation.ts';
import {
  flagPoint,
  pairFlags,
  TRAIL_RED,
  type MapContent,
  type MapPoint,
} from '../lib/mapContent.ts';
import { photoUrl, trailPhoto, trailPhotoSpots, trailViews } from '../lib/photos.ts';
import { goBack, navigate, replaceRoute } from '../lib/router.ts';
import {
  branchKeys,
  endOf,
  JUNCTION,
  linesAt,
  mergeWalk,
  nearbyTrails,
  nearestStop,
  reversedTrail,
  startOf,
  startsAtEnd,
  trailBranches,
  trailById,
  trailLines,
  useTrails,
  walkEnds,
  type TrailBranch,
} from '../lib/trails.ts';
import { useApp, useNetwork } from '../state/app.tsx';
import { TrailBadge, trailKm } from './HikesView.tsx';

/** The regional forestry service, which keeps the PR trails and says when one is closed. */
const IFCN = 'https://ifcn.madeira.gov.pt';

/**
 * The other trails met on the way, each in a colour of its own, none the red of the trail
 * chosen nor the yellow and turquoise of the buses.
 */
const BRANCH_COLORS = ['#1565C0', '#8E24AA', '#2E7D32', '#EF6C00', '#D81B60', '#00838F', '#F9A825'];

/** Each other trail met on the way and its colour, in the order they are met. */
function branchColors(branches: readonly TrailBranch[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const b of branches) {
    if (!colors.has(b.trail.id)) {
      colors.set(b.trail.id, BRANCH_COLORS[colors.size % BRANCH_COLORS.length]!);
    }
  }
  return colors;
}

const ONE_JUNCTION = JUNCTION;

/** A line's length (m). */
const lengthOf = (line: readonly LatLon[]) =>
  line.slice(1).reduce((m, p, i) => m + haversine(line[i]!, p), 0);

/** Another trail met by its number and name. */
const nameOf = (b: TrailBranch) => (b.trail.ref ? `${b.trail.ref} ${b.trail.name}` : b.trail.name);

/** A trail's page, walked from its start or (`reversed`) from its end, as it is shown. */
const hikeHref = (id: string, reversed: boolean) => `hikes/${id}?rev=${reversed ? 1 : 0}`;

/**
 * A trail's flags and those of the trails met on its way, each with a hiker in its colour:
 * one start flag where several start together and one chequered flag where several end
 * (the trail's own first), and where one ends and another starts, the two side by side. No
 * names on the map: a finger held on a flag tells it.
 */
function trailFlags(
  trail: { start: LatLon; end: LatLon; name: string },
  branches: readonly { coords: LatLon[]; color: string; name: string }[],
): MapPoint[] {
  const own = { mode: 'trail', color: TRAIL_RED } as const;
  const starts = [
    flagPoint(trail.start, false, own, trail.name),
    ...branches.map((b) =>
      flagPoint(b.coords[0]!, false, { mode: 'trail', color: b.color }, b.name),
    ),
  ];
  const ends = [
    flagPoint(trail.end, true, own, trail.name),
    ...branches.map((b) =>
      flagPoint(b.coords.at(-1)!, true, { mode: 'trail', color: b.color }, b.name),
    ),
  ];
  const once = (all: MapPoint[]) =>
    all.filter((p, i) => all.findIndex((q) => haversine(p, q) < ONE_JUNCTION) === i);
  const points = [...once(starts), ...once(ends)];
  pairFlags(points, ONE_JUNCTION);
  return points;
}

/** A bus stop near an end of a trail: its name, how far, its lines. */
function StopNear({ at, label }: { at: LatLon; label: string }) {
  const t = useI18n();
  const { net } = useNetwork();
  const near = nearestStop(net, at);
  return (
    <div className="hike-stop">
      <div className="hike-stop__label">{label}</div>
      {near ? (
        <button
          type="button"
          className="hike-stop__stop"
          onClick={() => navigate('stop', { ids: String(near.stop) })}
        >
          <Bus size={15} aria-hidden />{' '}
          {t.t('hike.stopNear', { stop: net.stops[near.stop]!.name, m: near.metres })}
          <span className="muted small">
            {' '}
            · {t.t('hike.lines', { lines: linesAt(net, near.stop).join(', ') })}
          </span>
        </button>
      ) : (
        <p className="muted small">{t.t('hike.noStop')}</p>
      )}
    </div>
  );
}

/**
 * One trail: on the map from its start flag to its chequered one, the other trails met on
 * the way each in a colour of its own from a start flag where it turns off to a chequered
 * one where it ends (a tap chooses it), its facts, and the buses to it. Walked `reversed`,
 * its end is its start.
 */
function Hike({
  trail: asMapped,
  rev,
  add,
  merge,
}: {
  trail: Trail;
  rev: string | null;
  add: string | null;
  merge: boolean;
}) {
  const t = useI18n();
  const { net } = useNetwork();
  // Walked as asked, or else from the end nearer to where the phone is (of the whole walk,
  // with trails merged into it).
  const here = useQuietPosition();
  const loadedTrails = useTrails();
  const mergedAsMapped = useMemo(() => {
    if (!merge || !loadedTrails || !add) return undefined;
    const bs = trailBranches(asMapped, loadedTrails);
    const ks = branchKeys(bs);
    const on = new Set(add.split(','));
    const chosen = bs.filter((_, i) => on.has(ks[i]!));
    return chosen.length ? mergeWalk(asMapped, chosen) : undefined;
  }, [merge, loadedTrails, add, asMapped]);
  const reversed =
    rev !== null
      ? rev === '1'
      : mergedAsMapped && here && !asMapped.roundtrip
        ? haversine(here, mergedAsMapped.end.at) < haversine(here, mergedAsMapped.start.at)
        : startsAtEnd(asMapped, here);
  const trail = useMemo(
    () => (reversed ? reversedTrail(asMapped) : asMapped),
    [asMapped, reversed],
  );
  const start = startOf(trail);
  const end = endOf(trail);
  const all = useTrails();
  // The trails button off: the other trails met stay off the map too, only those added show.
  const othersOn = useApp().settings.map.trails;
  const branches = useMemo(() => (all ? trailBranches(trail, all) : []), [trail, all]);
  const colors = useMemo(() => branchColors(branches), [branches]);
  // The trails near it, the only others on the map with it: those met, those a quarter of an
  // hour away on foot.
  const nearby = useMemo(
    () =>
      all
        ? [
            ...nearbyTrails(
              trail,
              all,
              branches.map((b) => b.trail.id),
            ),
          ]
        : undefined,
    [trail, all, branches],
  );
  // The other trails added to the walk (a tap on one), kept in the address with the way.
  const keys = useMemo(() => branchKeys(branches), [branches]);
  const added = useMemo(() => new Set((add ?? '').split(',').filter(Boolean)), [add]);
  const setAdded = (next: Set<string>, merged = merge) =>
    replaceRoute(`hikes/${asMapped.id}`, {
      rev: rev ?? undefined,
      add: [...next].join(','),
      merge: merged && next.size > 0 ? '1' : undefined,
    });
  const addedBranches = useMemo(
    () => branches.filter((_, i) => added.has(keys[i]!)),
    [branches, keys, added],
  );
  // The trails added merged with it into one walk: its facts, its ends, its way as one.
  const merged = useMemo(
    () => (merge && addedBranches.length > 0 ? mergeWalk(trail, addedBranches) : undefined),
    [merge, trail, addedBranches],
  );
  // Where the walk starts: the start nearest to the phone, or the one chosen.
  const ends = walkEnds(trail, addedBranches, here);
  const [startChosen, setStartChosen] = useState<number | undefined>();
  const walkStart = merged
    ? merged.start
    : ends.starts[
        startChosen !== undefined && startChosen < ends.starts.length ? startChosen : ends.start
      ]!;
  const walkEnd = merged ? merged.end : ends.end;
  // Another trail about to be added: whether to merge it with this one into one walk.
  const [asking, setAsking] = useState<{ keys: string[]; name: string } | undefined>();
  // A tap on another trail asks to add it to the walk; a tap or a finger held on one added
  // takes it off.
  const onLine = (key: string, held: boolean) => {
    const b = branches[keys.indexOf(key)];
    if (!b) return undefined;
    const title = nameOf(b);
    if (added.has(key)) {
      const next = new Set(added);
      next.delete(key);
      setAdded(next);
    } else if (held) return { title, lines: [t.t('hike.tapToAdd')] };
    else setAsking({ keys: [key], name: b.trail.name });
    return undefined;
  };

  useMapContent(
    useMemo<MapContent>(() => {
      const lines = trailLines(trail);
      const near = (
        merged ? [merged.start.at, merged.end.at] : [start, ...(trail.roundtrip ? [] : [end])]
      ).flatMap((p) => {
        const s = nearestStop(net, p);
        if (!s) return [];
        const st = net.stops[s.stop]!;
        return [
          {
            lat: st.lat,
            lon: st.lon,
            kind: 'stop',
            color: '#002F85',
            label: st.name,
            stops: [s.stop],
          },
        ] as MapPoint[];
      });
      if (merged) {
        // One walk: each of its stretches in its trail's colour with arrows the way it is
        // walked, from one start flag to one chequered flag; the trails not added pale.
        const pieceColor = (p: (typeof merged.pieces)[number]) =>
          p.main ? TRAIL_RED : (colors.get(p.trail.id) ?? TRAIL_RED);
        const mergedFlags = [
          flagPoint(
            merged.start.at,
            false,
            { mode: 'trail', color: pieceColor(merged.pieces[0]!) },
            merged.start.trail.name,
          ),
          flagPoint(
            merged.end.at,
            true,
            { mode: 'trail', color: pieceColor(merged.pieces.at(-1)!) },
            merged.end.trail.name,
          ),
        ];
        pairFlags(mergedFlags, ONE_JUNCTION);
        return {
          lines: [
            ...branches.flatMap((b, i) =>
              added.has(keys[i]!) || !othersOn
                ? []
                : [
                    {
                      coords: b.coords,
                      color: colors.get(b.trail.id)!,
                      width: 4,
                      faint: true,
                      key: keys[i]!,
                    },
                  ],
            ),
            ...merged.pieces.map((p) => {
              // An added trail's stretch is taken off again by a tap, as before.
              const k = p.main ? -1 : branches.findIndex((b) => b.trail === p.trail);
              return {
                coords: p.coords,
                color: pieceColor(p),
                width: 6,
                arrows: true,
                ...(k >= 0 ? { key: keys[k]! } : {}),
              };
            }),
          ],
          points: [...mergedFlags, ...near],
          scenic: [
            ...trailPhotoSpots(trail),
            ...addedBranches.flatMap((b) => trailPhotoSpots(b.trail)),
          ],
          fitKey: `hike:${trail.id}:merged`,
          fit: merged.pieces.flatMap((p) => p.coords),
          focus: `hike:${trail.id}`,
          onLine,
          ...(nearby ? { trailIds: nearby } : {}),
        };
      }
      return {
        lines: [
          // Added to the walk: as wide as the trail, with its arrows; the others pale, not
          // part of the way until a tap adds them.
          ...branches.flatMap((b, i) => {
            const on = added.has(keys[i]!);
            if (!on && !othersOn) return [];
            return {
              coords: b.coords,
              color: colors.get(b.trail.id)!,
              width: on ? 6 : 4,
              arrows: on,
              ...(on ? {} : { faint: true }),
              key: keys[i]!,
            };
          }),
          ...lines.map((coords) => ({ coords, color: TRAIL_RED, width: 6, arrows: true })),
        ],
        points: [
          // Flags for the trail and those added to it: the others are not part of the way.
          ...trailFlags(
            { start, end, name: trail.name },
            addedBranches.map((b) => ({
              coords: b.coords,
              color: colors.get(b.trail.id)!,
              name: nameOf(b),
            })),
          ),
          ...near,
        ],
        // Its photos where they were taken: its own, its viewpoints'.
        scenic: trailPhotoSpots(trail),
        fitKey: `hike:${trail.id}`,
        fit: lines.flat(),
        focus: `hike:${trail.id}`,
        onLine,
        // Of the other trails, only those near it.
        ...(nearby ? { trailIds: nearby } : {}),
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trail, net, branches, colors, keys, added, nearby, merged, othersOn]),
  );
  // Each other trail met, once, as listed under the trail: walked the way it turns off.
  const met = [...colors].map(([id, color]) => {
    const of = branches.filter((b) => b.trail.id === id);
    const mine = keys.filter((_, i) => branches[i]!.trail.id === id);
    return {
      trail: of[0]!.trail,
      reversed: of.every((b) => b.reversed),
      color,
      keys: mine,
      on: mine.some((k) => added.has(k)),
    };
  });
  // The walk with the trails added to it: how long, how much time.
  const addedLength = addedBranches.reduce((m, b) => m + lengthOf(b.coords), 0);

  // Merged: the photo of the trail the walk starts on, when it has one.
  const pic = (merged && trailPhoto(merged.start.trail.id)) || trailPhoto(trail.id);
  const views = trailViews(trail.id);
  const credits = [
    ...new Map(
      [pic, ...views.map((v) => v.photo)].flatMap((p) => (p ? [[p.file, p] as const] : [])),
    ).values(),
  ];
  // A viewpoint tapped: shown on the map.
  const spot = useSpotlight();
  // The walk's facts: the trail's, or the merged walk's as one.
  const walk = merged ?? trail;
  const minutes = trailMinutes(walk.length, walk.up, walk.down);
  const backSameWay = !trail.roundtrip && !nearestStop(net, walkEnd.at);
  const facts: [Key, string][] = [
    ['hike.length', t.t('scenic.km', { km: trailKm(walk.length, t.locale) })],
    ['hike.time', duration(t, minutes * 60)],
    ['hike.climb', t.t('travel.climb', { up: walk.up, down: walk.down })],
    ['hike.height', t.t('hike.heights', { low: walk.low, high: walk.high })],
  ];
  const mergedNames = merged
    ? [...new Set(merged.pieces.map((p) => p.trail.name))].join(' + ')
    : undefined;
  const kind = merged ? (
    <>{t.t('hike.merged')}</>
  ) : (
    <>
      {t.t(`hikes.kind.${trail.kind}` as Key)} ·{' '}
      {t.t(trail.roundtrip ? 'hike.loop' : 'hike.oneWay')}
    </>
  );
  return (
    <div className="hike">
      {pic ? (
        // Its photo, its name over it, as a place with a view.
        <div className="destination__hero hike__hero" data-peek>
          <img
            className="destination__photo"
            src={photoUrl(pic, 'lg')}
            width={960}
            height={640}
            alt=""
            style={{ backgroundImage: `url("${photoUrl(pic, 'sm')}")` }}
          />
          <span className="destination__shade" aria-hidden />
          <button
            type="button"
            className="icon-button destination__back"
            onClick={() => goBack('hikes')}
            aria-label={t.t('back')}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="destination__title">
            <span className="destination__tag">{kind}</span>
            <h2>
              <TrailBadge trail={trail} /> {mergedNames ?? trail.name}
            </h2>
          </div>
        </div>
      ) : (
        <div className="line-hero">
          <button
            type="button"
            className="icon-button line-hero__back"
            onClick={() => goBack('hikes')}
            aria-label={t.t('back')}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="line-hero__text">
            <h2 className="line-hero__name">
              <TrailBadge trail={trail} /> {mergedNames ?? trail.name}
            </h2>
            <div className="line-hero__meta">{kind}</div>
          </div>
        </div>
      )}

      <dl className="hike__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{t.t(k)}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="card">
        <h3 className="card__title">
          <Bus size={16} aria-hidden /> {t.t('hike.byBus')}
        </h3>
        {/* With trails added, where the walk may start: the nearest one first chosen. */}
        {!merged && ends.starts.length > 1 && (
          <div className="chips hike__starts" role="group" aria-label={t.t('hike.startFrom')}>
            <span className="muted small">{t.t('hike.startFrom')}</span>
            {ends.starts.map((s, i) => (
              <button
                key={`${s.trail.id}-${i}`}
                type="button"
                className="chip"
                aria-pressed={s === walkStart}
                onClick={() => setStartChosen(i)}
              >
                {s.trail.name}
              </button>
            ))}
          </div>
        )}
        {merged && (
          <div className="hike__merged">
            <Merge size={16} aria-hidden />
            <span className="small">{t.t('hike.mergedNote', { names: mergedNames! })}</span>
            <button
              type="button"
              className="button button--small"
              onClick={() => setAdded(added, false)}
            >
              <Unlink size={14} aria-hidden /> {t.t('hike.unmerge')}
            </button>
          </div>
        )}
        {!merged && addedLength > 0 && (
          <p className="small">
            {t.t('hike.withAdded', {
              km: trailKm(trail.length + addedLength, t.locale),
              time: duration(
                t,
                trailMinutes(trail.length + addedLength, trail.up, trail.down) * 60,
              ),
            })}
          </p>
        )}
        <StopNear at={walkStart.at} label={t.t('hike.start')} />
        {(merged || !trail.roundtrip) && <StopNear at={walkEnd.at} label={t.t('hike.end')} />}
        {/* No bus at its end: back the same way, as most walk PR 8 or the 25 Fontes. */}
        {backSameWay && (
          <p className="small hike__back">
            {t.t('hike.backSameWay', {
              time: duration(t, (minutes + trailMinutes(trail.length, trail.down, trail.up)) * 60),
            })}
          </p>
        )}
        <div className="detail__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() =>
              navigate('plan', { to: encodePlace({ ...walkStart.at, name: walkStart.trail.name }) })
            }
          >
            <Navigation size={16} aria-hidden /> {t.t('hike.routeTo')}
          </button>
          {!trail.roundtrip && !backSameWay && (
            <button
              type="button"
              className="button"
              onClick={() =>
                navigate('plan', { from: encodePlace({ ...walkEnd.at, name: walkEnd.trail.name }) })
              }
            >
              <Flag size={16} aria-hidden /> {t.t('hike.routeFrom')}
            </button>
          )}
          {/* Its end the start: the flags, the arrows, the climb and the buses swap round. */}
          <button
            type="button"
            className="button"
            aria-pressed={reversed}
            onClick={() =>
              replaceRoute(`hikes/${trail.id}`, {
                rev: reversed ? '0' : '1',
                add: add ?? undefined,
                merge: merge ? '1' : undefined,
              })
            }
          >
            <ArrowLeftRight size={16} aria-hidden />{' '}
            {t.t(trail.roundtrip ? 'hike.reverseLoop' : 'hike.reverse')}
          </button>
        </div>
      </section>

      {met.length > 0 && (
        <section className="card">
          <h3 className="card__title">
            <Split size={16} aria-hidden /> {t.t('hike.branches')}
          </h3>
          <p className="muted small">{t.t('hike.branchesNote')}</p>
          <ul className="hike-branches">
            {met.map((m) => (
              <li key={m.trail.id} className="hike-branch__row">
                {/* Added to the walk, or taken off it; its own page beside. */}
                <button
                  type="button"
                  className="hike-branch"
                  aria-pressed={m.on}
                  onClick={() => {
                    if (!m.on) {
                      setAsking({ keys: m.keys, name: m.trail.name });
                      return;
                    }
                    const next = new Set(added);
                    for (const k of m.keys) next.delete(k);
                    setAdded(next);
                  }}
                >
                  <span
                    className="hike-branch__swatch"
                    style={{ background: m.color }}
                    aria-hidden
                  />
                  <span className="hike-branch__name">
                    <TrailBadge trail={m.trail} /> {m.trail.name}
                  </span>
                  <span className="muted small">
                    {t.t('scenic.km', { km: trailKm(m.trail.length, t.locale) })}
                  </span>
                  {m.on ? <Minus size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
                </button>
                <button
                  type="button"
                  className="icon-button hike-branch__open"
                  aria-label={t.t('hike.open', { name: m.trail.name })}
                  title={t.t('hike.open', { name: m.trail.name })}
                  onClick={() => navigate(hikeHref(m.trail.id, m.reversed))}
                >
                  <ExternalLink size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {views.length > 0 && (
        <section className="card">
          <h3 className="card__title">
            <Camera size={16} aria-hidden /> {t.t('hike.views')}
          </h3>
          <ul className="hike-views">
            {views.map((v) => (
              <li key={`${v.lat},${v.lon}`}>
                <button
                  type="button"
                  className="hike-view"
                  aria-pressed={spot.isShown(v)}
                  title={t.t('map.showStop')}
                  onClick={() => spot.show({ lat: v.lat, lon: v.lon, name: v.name })}
                >
                  {v.photo ? (
                    <img
                      className="hike-view__photo"
                      src={photoUrl(v.photo, 'sm')}
                      width={480}
                      height={320}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="hike-view__photo hike-view__photo--none" aria-hidden>
                      <Camera size={22} />
                    </span>
                  )}
                  <span className="hike-view__name">{v.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Over the whole screen, not inside the sheet it is asked from. */}
      {asking &&
        createPortal(
          <div
            className="confirm"
            role="dialog"
            aria-modal="true"
            aria-label={t.t('hike.mergeAsk')}
          >
            <div className="confirm__card">
              <button
                type="button"
                className="icon-button confirm__close"
                aria-label={t.t('close')}
                onClick={() => setAsking(undefined)}
              >
                <X size={18} />
              </button>
              <h3 className="confirm__title">
                <Merge size={18} aria-hidden /> {t.t(merge ? 'hike.mergeMore' : 'hike.mergeAsk')}
              </h3>
              <p className="small">
                {t.t('hike.mergeText', { name: asking.name, trail: trail.name })}
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    setAdded(new Set([...added, ...asking.keys]), true);
                    setAsking(undefined);
                  }}
                >
                  <Merge size={16} aria-hidden /> {t.t('hike.mergeYes')}
                </button>
                {!merge && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setAdded(new Set([...added, ...asking.keys]), false);
                      setAsking(undefined);
                    }}
                  >
                    {t.t('hike.mergeNo')}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="banner banner--warn hike__safety">
        <TriangleAlert size={18} aria-hidden />
        <div>
          {t.t('hike.safety')}{' '}
          <a href={IFCN} target="_blank" rel="noopener noreferrer">
            {t.t('hike.official')}
          </a>
        </div>
      </div>
      <p className="muted small">
        {t.t('hike.timeNote')}{' '}
        <a
          href={`https://www.openstreetmap.org/${trail.osmType ?? 'relation'}/${trail.osm}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.t('hike.osm')} <ExternalLink size={12} aria-hidden />
        </a>
      </p>
      {credits.length > 0 && (
        <p className="destination__credit muted small">
          {credits.map((c, i) => (
            <span key={c.file}>
              {i > 0 && ' · '}
              <a href={c.source} target="_blank" rel="noopener noreferrer">
                {t.t('scenic.photo', { author: c.author, license: c.license })}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * A trail's page, once the trails are loaded; `rev` "1": walked from its end, "0": from its
 * start, none: from the end nearer to the phone.
 */
export function HikeView({
  id,
  rev = null,
  add = null,
  merge = false,
}: {
  id: string;
  rev?: string | null;
  add?: string | null;
  merge?: boolean;
}) {
  const t = useI18n();
  const trails = useTrails();
  const trail = trailById(trails, id);
  if (!trails) return <p className="muted">{t.t('loading')}</p>;
  if (!trail) return <p className="error">{t.t('hikes.none')}</p>;
  return <Hike key={trail.id} trail={trail} rev={rev} add={add} merge={merge} />;
}
