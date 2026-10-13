import cams from './webcams.json';
import { isNative } from './device.ts';
import { SITE_URL } from './site.ts';

/**
 * Madeira's live webcams: where each stands and who runs it. Portal Netmadeira (NOS Madeira)
 * and Madeira-Web broadcast theirs live on YouTube; data/webcams.json (scripts/webcams.mjs,
 * every night) has each camera's broadcast now, which the app plays in YouTube's own player.
 * A camera without one opens its page on the provider's site.
 */

export interface Webcam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  provider: 'netmadeira' | 'madeiraweb';
  /** Its page on the provider's site. */
  page: string;
  /** Words of its broadcasts' titles on YouTube that tell it apart (lower case, plain). */
  match: readonly string[];
  /** Up in the mountains: where people look before going (clouds, sun above them). */
  high?: boolean;
}

/**
 * The cameras (webcams.json, which scripts/webcams.mjs reads too), mountains first: where
 * people look before going up, to see whether they will be above the clouds.
 */
export const WEBCAMS: readonly Webcam[] = (cams as Omit<Webcam, 'page'>[]).map((c) => ({
  ...c,
  page:
    c.provider === 'netmadeira'
      ? `https://www.netmadeira.com/webcams-madeira/${c.id}`
      : 'https://www.youtube.com/@MadeiraWebLive/streams',
}));

/** A camera's broadcast now: its YouTube video, and its title there. */
export interface WebcamLive {
  video: string;
  title: string;
}

let pending: Promise<Record<string, WebcamLive>> | undefined;

/**
 * Each camera's broadcast now (data/webcams.json): the website's of the night, else the one
 * the app came with; none when neither can be read.
 */
export function loadWebcamLive(): Promise<Record<string, WebcamLive>> {
  pending ??= (async () => {
    for (const base of [SITE_URL, import.meta.env.BASE_URL]) {
      try {
        const res = await fetch(`${base}data/webcams.json`, { cache: 'no-cache' });
        if (!res.ok) continue;
        const { live } = (await res.json()) as { live?: Record<string, WebcamLive> };
        if (live) return live;
      } catch {
        // The next place, or none.
      }
    }
    pending = undefined;
    return {};
  })();
  return pending;
}

/** The player of a camera's broadcast, without YouTube's cookies until it is played. */
export const playerUrl = (video: string) =>
  `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`;

/** YouTube's still of a broadcast, renewed every few minutes while it is live. */
export const stillUrl = (video: string) => `https://i.ytimg.com/vi/${video}/hqdefault_live.jpg`;

let netmadeiraKey: Promise<string | undefined> | undefined;
let netmadeiraKeyAt = 0;

/**
 * Netmadeira's pictures of its cameras, a minute old, are signed for about a minute
 * ("/<time>/<hash>", the same for every camera): the key off one of its pages, read natively
 * in the app (the website cannot read their pages); none on the website.
 */
export function loadNetmadeiraKey(): Promise<string | undefined> {
  if (netmadeiraKey && Date.now() - netmadeiraKeyAt < 20_000) return netmadeiraKey;
  netmadeiraKeyAt = Date.now();
  netmadeiraKey = (async () => {
    if (!isNative()) return undefined;
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({
        url: 'https://www.netmadeira.com/webcams-madeira/monte',
        responseType: 'text',
      });
      const html = typeof res.data === 'string' ? res.data : '';
      return /webcams-madeira\/load\/netmadeira\/[a-z0-9-]+\/(\d+\/[0-9a-f]+)/.exec(html)?.[1];
    } catch {
      netmadeiraKeyAt = 0;
      return undefined;
    }
  })();
  return netmadeiraKey;
}

/** Netmadeira's picture of one of its cameras, with the key; `n` makes it a new one. */
export const netmadeiraStill = (id: string, key: string, n = 0) =>
  `https://www.netmadeira.com/webcams-madeira/load/netmadeira/${id}/${key}${n ? `?n=${n}` : ''}`;

/** Who runs a camera, as their credit reads. */
export const providerName = (c: Webcam) =>
  c.provider === 'netmadeira' ? 'Portal Netmadeira' : 'Madeira-Web';
