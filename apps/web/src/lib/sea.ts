/**
 * The sea round the islands in bands by distance from the shore (public/coast.json, from
 * scripts/coast-line.py), for the satellite map's sea (`mb-coast`, see mapStyles.ts):
 * packed small there — each ring in whole hundred-thousandths of a degree, every point
 * after the first as the step from the one before — and unpacked here.
 */
type Packed = { bands: [number, number[][][]][] };

/** The bands as the map takes them. */
export interface SeaBands {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { d: number };
    geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  }[];
}

/** A packed ring as [lon, lat] points. */
export function unpackRing(packed: readonly number[]): [number, number][] {
  const ring: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < packed.length; i += 2) {
    x += packed[i]!;
    y += packed[i + 1]!;
    ring.push([x / 1e5, y / 1e5]);
  }
  return ring;
}

/** The bands as GeoJSON: a polygon each, with its distance from the shore (`d`, m). */
export function unpackSea(packed: Packed): SeaBands {
  return {
    type: 'FeatureCollection',
    features: packed.bands.flatMap(([d, polys]) =>
      polys.map((rings) => ({
        type: 'Feature' as const,
        properties: { d },
        geometry: { type: 'Polygon' as const, coordinates: rings.map(unpackRing) },
      })),
    ),
  };
}

let loading: Promise<SeaBands | undefined> | undefined;

/** The sea's bands, fetched once; none when they cannot be had (the imagery's own sea then). */
export function loadSea(): Promise<SeaBands | undefined> {
  loading ??= fetch(`${import.meta.env.BASE_URL}coast.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Packed>;
    })
    .then(unpackSea)
    .catch(() => {
      loading = undefined;
      return undefined;
    });
  return loading;
}
