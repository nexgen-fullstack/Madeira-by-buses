import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clock, ExternalLink, Flag, Landmark, MapPin, Phone, X } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import {
  aboveTiles,
  languageName,
  placeArticle,
  placePhotos,
  sipaUrl,
  type PlaceArticle,
  type PlacePhotos,
} from '../lib/placeInfo.ts';
import type { PlacePhoto } from '../lib/placePhoto.ts';
import type { Poi } from '../lib/pois.ts';

/** The view from above in the card (px): a church and the street in front of it. */
const ABOVE_W = 168;
const ABOVE_H = 120;

export interface CardPlace {
  name: string;
  /** What kind of place it is, in the reader's language (or where it is). */
  kind: string;
  lat: number;
  lon: number;
  poi?: Poi;
  /** The view from a viewpoint, a beach, a peak: the scenic trip's own photo. */
  view?: PlacePhoto;
}

/**
 * The card of a place tapped on the map, as a maps app has it: its photos (its own and those
 * taken around it), how it looks from above, what it is, when it opens, its phone and website,
 * and what Wikipedia writes of it — a church's history — with the way there and from there.
 */
export function PlaceCard({
  place,
  onPhoto,
  onAbove,
  onRouteTo,
  onRouteFrom,
  onClose,
}: {
  place: CardPlace;
  /** A photo tapped: the photos large, from that one. */
  onPhoto: (photos: PlacePhoto[], at: number) => void;
  /** The view from above tapped: the map close over the place. */
  onAbove: () => void;
  onRouteTo: () => void;
  onRouteFrom: () => void;
  onClose: () => void;
}) {
  const t = useI18n();
  const { poi } = place;
  const [found, setFound] = useState<{ of: CardPlace; photos: PlacePhotos } | undefined>();
  const [article, setArticle] = useState<{ of: CardPlace; article?: PlaceArticle } | undefined>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let on = true;
    setOpen(false);
    void placePhotos(place, poi?.photo).then((photos) => on && setFound({ of: place, photos }));
    if (poi?.articles)
      void placeArticle(poi.articles, t.lang).then(
        (a) => on && setArticle({ of: place, article: a }),
      );
    return () => {
      on = false;
    };
  }, [place, poi, t.lang]);
  const loading = found?.of !== place;
  // Its own photos first; those of what is around it after the view from above, marked so.
  const own = useMemo(
    () => [...(place.view ? [place.view] : []), ...(!loading ? found!.photos.own : [])],
    [place.view, found, loading],
  );
  const near = useMemo(() => (!loading ? found!.photos.near : []), [found, loading]);
  const photos = useMemo(() => [...own, ...near], [own, near]);
  const about = article?.of === place ? article.article : undefined;
  const above = useMemo(() => aboveTiles(place, ABOVE_W, ABOVE_H), [place]);
  const church = poi?.category === 'church';
  const phone = poi?.phone?.split(/[;,]/)[0];

  return (
    <div className="place-card place-card--rich" role="dialog" aria-label={place.name}>
      <div className="place-card__media">
        {own.map((p, i) => (
          <button
            key={p.lg}
            type="button"
            className="place-card__shot"
            aria-label={t.t('place.photo', { name: p.title })}
            onClick={() => onPhoto(photos, i)}
          >
            <img src={p.sm} alt="" loading="lazy" />
          </button>
        ))}
        {/* How it looks from above: the imagery of the map, the place in its middle. */}
        <button
          type="button"
          className="place-card__shot place-card__above"
          aria-label={t.t('place.aboveShow')}
          onClick={onAbove}
        >
          {above.map((tile) => (
            <img
              key={tile.url}
              src={tile.url}
              alt=""
              loading="lazy"
              style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
            />
          ))}
          <span className="place-card__above-dot" aria-hidden />
          <span className="place-card__tag">{t.t('place.above')}</span>
        </button>
        {loading && <span className="place-card__shot place-card__shot--loading" aria-hidden />}
        {near.map((p, i) => (
          <button
            key={p.lg}
            type="button"
            className="place-card__shot"
            aria-label={t.t('place.photo', { name: p.title })}
            onClick={() => onPhoto(photos, own.length + i)}
          >
            <img src={p.sm} alt="" loading="lazy" />
            <span className="place-card__tag">{t.t('place.nearby')}</span>
          </button>
        ))}
      </div>
      <div className="place-card__text">
        <div className="strong">{place.name}</div>
        <div className="muted small">
          {place.kind}
          {poi?.built ? ` · ${t.t('place.built', { year: String(poi.built) })}` : ''}
        </div>
        {poi?.hours && (
          <div className="small place-card__line">
            <Clock size={13} aria-hidden /> {poi.hours}
          </div>
        )}
        {(phone || poi?.web) && (
          <div className="small place-card__line">
            {phone && (
              <a href={`tel:${phone.replace(/\s/g, '')}`}>
                <Phone size={13} aria-hidden /> {phone}
              </a>
            )}
            {poi?.web && (
              <a href={poi.web} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} aria-hidden /> {t.t('places.website')}
              </a>
            )}
          </div>
        )}
      </div>
      {(about || poi?.sipa) && (
        <section className="place-card__about">
          <h4>
            <BookOpen size={14} aria-hidden /> {t.t(church ? 'place.history' : 'place.about')}
          </h4>
          {about && (
            <>
              <p className={open ? '' : 'place-card__clamp'} lang={about.lang}>
                {about.text}
              </p>
              <div className="small place-card__line">
                {about.text.length > 220 && (
                  <button type="button" className="link-button" onClick={() => setOpen(!open)}>
                    {t.t(open ? 'place.less' : 'place.more')}
                  </button>
                )}
                <a href={about.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} aria-hidden /> {t.t('place.wikipedia')}
                  {about.lang !== t.lang ? ` · ${languageName(about.lang, t.lang)}` : ''}
                </a>
              </div>
            </>
          )}
          {poi?.sipa && (
            <div className="small place-card__line">
              <a href={sipaUrl(poi.sipa)} target="_blank" rel="noopener noreferrer">
                <Landmark size={13} aria-hidden /> {t.t('place.heritage')}
              </a>
            </div>
          )}
        </section>
      )}
      <div className="place-card__actions">
        <button type="button" className="button button--primary button--small" onClick={onRouteTo}>
          <Flag size={14} /> {t.t('place.routeTo')}
        </button>
        <button type="button" className="button button--small" onClick={onRouteFrom}>
          <MapPin size={14} /> {t.t('place.routeFrom')}
        </button>
        <button type="button" className="icon-button" aria-label={t.t('close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
