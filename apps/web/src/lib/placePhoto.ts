import { haversine, normalise, type LatLon } from '@madeirabus/engine';
import { photoUrl, placedPhotos, type Photo } from './photos.ts';
import { DESTINATIONS, hasPhoto, photo, type PhotoCredit } from './scenic.ts';

/** A photo of a place tapped on the map: what it shows, small and large, and whose it is. */
export interface PlacePhoto {
  title: string;
  sm: string;
  lg: string;
  credit?: PhotoCredit;
}

/** A viewpoint's own photo may be this far from where the map has its icon (m). */
const SAME_NAME = 1500;
/** Any photo this near a place tapped is of the view from there (m). */
const NEAR = 120;

const fromPhoto = (p: Photo, title: string): PlacePhoto => ({
  title,
  sm: photoUrl(p, 'sm'),
  lg: photoUrl(p, 'lg'),
  credit: p,
});

/** Whether two names are one place's: one holds the other, accents and case aside. */
function sameName(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
}

/**
 * The photo of a place tapped on the map (a viewpoint, a beach, a peak…): the scenic trip's
 * or the trail viewpoint's of the same name near it, else one taken right there; undefined
 * when there is none.
 */
export function placePhoto(place: LatLon & { name?: string }): PlacePhoto | undefined {
  const name = place.name ?? '';
  type Hit = { photo: PlacePhoto; d: number; named: boolean };
  const hits: Hit[] = [];
  for (const d of DESTINATIONS) {
    if (!hasPhoto(d)) continue;
    const dist = haversine(place, d);
    const named = name !== '' && sameName(name, d.name);
    if ((named && dist <= SAME_NAME) || dist <= NEAR)
      hits.push({
        photo: { title: d.name, sm: photo(d, 'sm')!, lg: photo(d, 'lg')!, credit: d.credit },
        d: dist,
        named,
      });
  }
  for (const p of placedPhotos()) {
    const dist = haversine(place, p);
    const named = name !== '' && sameName(name, p.name);
    if ((named && dist <= SAME_NAME) || dist <= NEAR)
      hits.push({ photo: fromPhoto(p.photo, p.name), d: dist, named });
  }
  // Of the same name first, then the nearest.
  hits.sort((a, b) => Number(b.named) - Number(a.named) || a.d - b.d);
  return hits[0]?.photo;
}
