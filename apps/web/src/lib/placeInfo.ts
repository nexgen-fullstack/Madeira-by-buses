import type { LatLon } from '@madeirabus/engine';
import type { Lang } from '../i18n.ts';
import { SATELLITE_CLOSE_TILES } from './mapStyles.ts';
import type { PlacePhoto } from './placePhoto.ts';

/**
 * What a place's card shows beyond its name, as a maps app does, from open sources asked
 * when the card opens (free, without keys): its photo and those taken around it on
 * Wikimedia Commons, how it looks from above (the map's own imagery), and what Wikipedia
 * writes of it (a church's history) in the reader's language or the nearest one it has.
 */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
/** Photos taken this near a place (m) are of it or of what is around it. */
const NEAR = 60;
/** The photos a card shows at most. */
const MAX_PHOTOS = 8;
/** Thumbnail widths (of Wikimedia's usual ones): in the card, and large. */
const SM = 500;
const LG = 1280;

interface ImageInfo {
  url: string;
  thumburl?: string;
  descriptionurl: string;
  mime?: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
}
interface CommonsPage {
  title: string;
  index?: number;
  imageinfo?: ImageInfo[];
}

/** Text of a bit of HTML (an author's name, a link to their page). */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A file's name without "File:" and its extension, as a caption ("Sé do Funchal 2019"). */
const caption = (title: string) =>
  title
    .replace(/^File:/, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_/g, ' ');

function toPhoto(page: CommonsPage, title?: string): PlacePhoto | undefined {
  const info = page.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? 'image/jpeg')) return undefined;
  const meta = info.extmetadata ?? {};
  // Asked large; a photo smaller than that comes as it is.
  const lg = info.thumburl ?? info.url;
  return {
    title: title ?? caption(page.title),
    sm: lg.includes(`/${LG}px-`) ? lg.replace(`/${LG}px-`, `/${SM}px-`) : lg,
    lg,
    credit: {
      author: plainText(meta.Artist?.value ?? '') || 'Wikimedia Commons',
      license: plainText(meta.LicenseShortName?.value ?? ''),
      licenseUrl: meta.LicenseUrl?.value ?? '',
      source: info.descriptionurl,
    },
  };
}

const commonsQuery = (params: Record<string, string>) =>
  `${COMMONS_API}?${new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    iiurlwidth: String(LG),
    ...params,
  }).toString()}`;

async function commonsPages(url: string): Promise<CommonsPage[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: CommonsPage[] } };
  return json.query?.pages ?? [];
}

/** Words in many places' names and photos' (the town, "church"): not one place's own. */
const COMMON = new Set(
  (
    'madeira funchal portugal ilha island igreja capela church chapel nossa senhora santa ' +
    'santo restaurante restaurant hotel snack cafe praia beach parque park jardim garden ' +
    'museu museum casa house rua street avenida largo praca panoramio image photo ' +
    'de do da dos das of the la le el di du and img dsc jpg'
  ).split(' '),
);

/** Words of a name, plain, for telling which photos are of the place itself. */
const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !COMMON.has(w) && !/^\d+$/.test(w));

/** A place's photos: its own (or named after it), and those taken around it. */
export interface PlacePhotos {
  own: PlacePhoto[];
  near: PlacePhoto[];
}

/**
 * The photos of a place: its own (`file`, as OpenStreetMap or Wikidata name it, and those
 * on Wikimedia Commons named after it taken there), then the others taken around it, the
 * nearest first.
 */
export async function placePhotos(
  place: LatLon & { name?: string },
  file?: string,
): Promise<PlacePhotos> {
  const [own, near] = await Promise.all([
    file
      ? commonsPages(commonsQuery({ titles: `File:${file}` })).catch(() => [])
      : Promise.resolve([]),
    commonsPages(
      commonsQuery({
        generator: 'geosearch',
        ggscoord: `${place.lat}|${place.lon}`,
        ggsradius: String(NEAR),
        ggsnamespace: '6',
        ggslimit: '20',
      }),
    ).catch(() => []),
  ]);
  const named = new Set(words(place.name ?? ''));
  const says = (p: CommonsPage) => words(p.title).some((w) => named.has(w));
  // Nearest first (Commons gives their order as `index`).
  const around = [...near].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: PlacePhotos = { own: [], near: [] };
  const seen = new Set<string>();
  const add = (p: CommonsPage, to: PlacePhoto[], title?: string) => {
    if (seen.has(p.title) || out.own.length + out.near.length >= MAX_PHOTOS) return;
    seen.add(p.title);
    const photo = toPhoto(p, title);
    if (photo) to.push(photo);
  };
  for (const p of own) add(p, out.own, place.name);
  for (const p of around.filter(says)) add(p, out.own);
  for (const p of around) add(p, out.near);
  return out;
}

/** What Wikipedia writes of a place: its opening part, in what language, and the article. */
export interface PlaceArticle {
  lang: string;
  title: string;
  text: string;
  url: string;
}

/**
 * The languages to read a place's article in: the reader's, then English, Portuguese (the
 * island's own, where most of its churches are written about) and any other.
 */
export function articleLanguages(articles: Record<string, string>, lang: Lang): string[] {
  const order = [lang, 'en', 'pt', ...Object.keys(articles)];
  return [...new Set(order)].filter((l) => articles[l]);
}

/** The opening part of a place's Wikipedia article in the nearest language it has. */
export async function placeArticle(
  articles: Record<string, string>,
  lang: Lang,
): Promise<PlaceArticle | undefined> {
  for (const l of articleLanguages(articles, lang)) {
    const title = articles[l]!;
    try {
      const res = await fetch(
        `https://${l}.wikipedia.org/w/api.php?${new URLSearchParams({
          action: 'query',
          format: 'json',
          formatversion: '2',
          origin: '*',
          prop: 'extracts',
          exintro: '1',
          explaintext: '1',
          redirects: '1',
          titles: title,
        }).toString()}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        query?: { pages?: { title: string; extract?: string; missing?: boolean }[] };
      };
      const page = json.query?.pages?.[0];
      const text = page?.extract?.trim();
      if (!page || page.missing || !text) continue;
      return {
        lang: l,
        title: page.title,
        text,
        url: `https://${l}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      };
    } catch {
      // Offline or the server busy: the next language, or none.
    }
  }
  return undefined;
}

/** A language's name in the reader's ("англійська"), or its code when the phone has no name. */
export function languageName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A place's entry in Portugal's heritage register: its description and history. */
export const sipaUrl = (id: string) =>
  `http://www.monumentos.gov.pt/Site/APP_PagesUser/SIPA.aspx?id=${encodeURIComponent(id)}`;

/**
 * The imagery tile zoom of the view from above, its tiles drawn at half their size: as sharp
 * on a phone's screen as the map close in, a church and the streets around it.
 */
export const ABOVE_ZOOM = 19;
const ABOVE_TILE = 128;

/** One imagery tile of the view from above, where it goes in the picture and its size (px). */
export interface AboveTile {
  url: string;
  left: number;
  top: number;
  size: number;
}

/**
 * How a place looks from above: the imagery tiles that cover a `width` × `height` picture
 * (px) with the place in its middle, each with where it goes.
 */
export function aboveTiles(
  p: LatLon,
  width: number,
  height: number,
  zoom = ABOVE_ZOOM,
  size = ABOVE_TILE,
): AboveTile[] {
  const n = 2 ** zoom;
  const x = ((p.lon + 180) / 360) * n * size;
  const lat = (p.lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * size;
  const left = x - width / 2;
  const top = y - height / 2;
  const tiles: AboveTile[] = [];
  for (let ty = Math.floor(top / size); ty <= Math.floor((top + height - 1) / size); ty++)
    for (let tx = Math.floor(left / size); tx <= Math.floor((left + width - 1) / size); tx++)
      tiles.push({
        url: SATELLITE_CLOSE_TILES.replace('{z}', String(zoom))
          .replace('{x}', String(tx))
          .replace('{y}', String(ty)),
        left: Math.round(tx * size - left),
        top: Math.round(ty * size - top),
        size,
      });
  return tiles;
}
