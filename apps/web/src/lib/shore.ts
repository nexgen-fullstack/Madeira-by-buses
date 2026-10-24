import LAND from './land.json';
import { loadCached, PROTOCOL } from './mapCache.ts';

/**
 * The imagery by the shore only. Out at sea its tiles are a patchwork of captures — black
 * squares beside glittering blue ones, another at each zoom, greyed from afar by the far
 * picture's toning — so the sea turned black, then blue, then broke into wedges as the map
 * came closer. There the sea's own blue under the imagery (IMAGERY_SEA) shows instead, the
 * same at every zoom; the land and some 150 m of water off it keep the photograph, fading
 * softly into it. A tile wholly out at sea is not even downloaded. Kept apart from the map
 * library (MapView registers `loadShore` with it as `SHORE`), as `mapCache` is.
 */
export const SHORE = 'mbs';

/** The imagery's tiles through `SHORE` (those the cache serves; others as they are). */
export const shoreUrl = (url: string): string =>
  url.startsWith(`${PROTOCOL}://`) ? `${SHORE}://${url.slice(PROTOCOL.length + 3)}` : url;

/** The water kept in the photograph off the land (m). */
const SHORE_WIDTH = 150;
/** At most this blur (px): close in, 150 m is hundreds of pixels. */
const MAX_BLUR = 40;
/** A tile's side (px), as the imagery's servers send them. */
const SIZE = 256;

const LANDS = LAND as { file: string; bounds: number[] }[];

/** A point's place in the world at tile zoom `z`, in tiles (Web Mercator, as the tiles). */
export function worldTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * n,
    ((1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2) * n,
  ];
}

/**
 * The islands' pictures (`land.json`) under tile z/x/y or within `margin` tiles of it: which,
 * and where in tiles from the tile's top left corner.
 */
export function landsOver(z: number, x: number, y: number, margin: number) {
  return LANDS.flatMap(({ bounds: [w, s, e, n] }, i) => {
    const [x0, y0] = worldTile(w!, n!, z);
    const [x1, y1] = worldTile(e!, s!, z);
    if (x1 < x - margin || x0 > x + 1 + margin || y1 < y - margin || y0 > y + 1 + margin) return [];
    return [{ i, left: x0 - x, top: y0 - y, width: x1 - x0, height: y1 - y0 }];
  });
}

/** The blur (px) that spreads the land over `SHORE_WIDTH` of water in tile z/y. */
export function shoreBlur(z: number, y: number): number {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
  const metresPerPixel = (40_075_016.686 * Math.cos(lat)) / (2 ** z * SIZE);
  return Math.min(SHORE_WIDTH / metresPerPixel, MAX_BLUR);
}

let pictures: Promise<(ImageBitmap | undefined)[]> | undefined;
/** The islands' pictures, built into the app: their outlines are the shore. */
const landPictures = () =>
  (pictures ??= Promise.all(
    LANDS.map(async ({ file }) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL ?? './'}${file}`);
        return await createImageBitmap(await res.blob());
      } catch {
        return undefined;
      }
    }),
  ));

type Mask = 'sea' | 'land' | { canvas: OffscreenCanvas; pad: number };

/** Where tile z/x/y keeps its photograph: nowhere (`sea`), all over (`land`), or as the mask's alpha. */
async function shoreMask(z: number, x: number, y: number): Promise<Mask> {
  const blur = shoreBlur(z, y);
  const pad = Math.ceil(blur * 2);
  const over = landsOver(z, x, y, pad / SIZE);
  if (over.length === 0) return 'sea';
  const pics = await landPictures();
  // Without the shore's outline (or a browser that cannot soften it): the photograph as it is.
  if (over.some((o) => !pics[o.i])) return 'land';
  const canvas = new OffscreenCanvas(SIZE + 2 * pad, SIZE + 2 * pad);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !('filter' in ctx)) return 'land';
  ctx.filter = `blur(${blur / 2}px)`;
  for (const o of over) {
    ctx.drawImage(
      pics[o.i]!,
      pad + o.left * SIZE,
      pad + o.top * SIZE,
      o.width * SIZE,
      o.height * SIZE,
    );
  }
  ctx.filter = 'none';
  // The softened outline spread out over the water: its edge's alpha doubled, twice.
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(canvas, 0, 0);
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(pad, pad, SIZE, SIZE);
  let most = 0;
  let least = 255;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > most) most = data[i]!;
    if (data[i]! < least) least = data[i]!;
  }
  if (most < 4) return 'sea';
  if (least > 250) return 'land';
  return { canvas, pad };
}

/** An imagery tile by the shore (see `SHORE`): the map library's protocol handler. */
export async function loadShore(
  params: { url: string; type?: string },
  abort?: AbortController,
): Promise<{ data: unknown }> {
  const url = `${PROTOCOL}://${params.url.slice(SHORE.length + 3)}`;
  const tile = /\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  const [z, y, x] = tile ? [Number(tile[1]), Number(tile[2]), Number(tile[3])] : [];
  if (z === undefined || x === undefined || y === undefined) {
    return loadCached({ ...params, url }, abort);
  }
  const mask = await shoreMask(z, x, y);
  // Out at sea: nothing of the imagery, the sea's own blue under it shows.
  if (mask === 'sea') return { data: await createImageBitmap(new ImageData(1, 1)) };
  const raw = await loadCached({ ...params, url }, abort);
  if (mask === 'land') return raw;
  const photo = await createImageBitmap(new Blob([raw.data as ArrayBuffer]));
  const canvas = new OffscreenCanvas(photo.width, photo.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(photo, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask.canvas, mask.pad, mask.pad, SIZE, SIZE, 0, 0, photo.width, photo.height);
  photo.close();
  return { data: canvas.transferToImageBitmap() };
}
