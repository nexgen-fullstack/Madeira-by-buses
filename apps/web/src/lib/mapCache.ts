/**
 * The map's files kept on the phone (the browser's Cache Storage): the satellite imagery,
 * the streets and names (OpenFreeMap), the heights. Each file seen once comes from the phone
 * after that, at once and with no connection, however slow the network (a phone on EDGE
 * waits a minute for one screen of imagery). The map asks for them as `mbc://host/path`
 * (see `cachedUrl`), which `loadCached` answers: from the phone when it has the file, from
 * the network otherwise, keeping what comes. Where there is no Cache Storage (a website on
 * plain http) the addresses stay as they are and the browser's own cache does what it can.
 *
 * Kept apart from the map library (MapView registers `loadCached` with it), so the screens
 * that only read the map's settings do not load it.
 */

export const PROTOCOL = 'mbc';

/** What the map shows from far and near as it is first opened (`prefetchIsland`), kept for good. */
const KEEP = 'mb-map-keep-v1';
/** All else seen, the oldest dropped beyond `MAX_ENTRIES`. */
const SEEN = 'mb-map-v1';
/** Some 30 KB a file: about 150 MB at most. */
const MAX_ENTRIES = 5000;
/** The website's old caches of the same files (its service worker kept them until 2026-10). */
const OLD = ['basemap', 'terrain'];

const HOSTS = [
  'tiles.openfreemap.org',
  'clarity.maptiles.arcgis.com',
  'server.arcgisonline.com',
  's3.amazonaws.com',
];

const DAY = 24 * 3600 * 1000;

/** How long a file is good for: the style and the tiles' index change weekly, a tile not. */
function maxAge(url: string): number {
  if (/openfreemap\.org\/(styles|planet$)/.test(url)) return DAY / 2;
  if (/openfreemap\.org\/planet\//.test(url)) return Infinity; // under its version's name
  if (/openfreemap\.org\/(fonts|sprites)\//.test(url)) return 60 * DAY;
  return 180 * DAY; // imagery and heights
}

const canCache = () => typeof caches !== 'undefined' && typeof fetch === 'function';

/** A map file's address through the phone's cache (`mbc://`), where it can be kept. */
export function cachedUrl(url: string): string {
  if (!canCache()) return url;
  const m = /^https:\/\/([^/]+)(\/.*)?$/.exec(url);
  return m && HOSTS.includes(m[1]!) ? `${PROTOCOL}://${m[1]}${m[2] ?? ''}` : url;
}

/** The address on the network of a file asked for through the cache. */
export function networkUrl(url: string): string {
  return url.startsWith(`${PROTOCOL}://`) ? `https://${url.slice(PROTOCOL.length + 3)}` : url;
}

let opened: Promise<Cache | undefined> | undefined;
function seen(): Promise<Cache | undefined> {
  opened ??= caches.open(SEEN).catch(() => undefined);
  return opened;
}

/** When a kept file was stored (ms), 0 when not known. */
const storedAt = (res: Response) => Number(res.headers.get('x-mb-at')) || 0;

async function lookup(url: string): Promise<Response | undefined> {
  try {
    return (await caches.match(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

let stores = 0;
async function store(url: string, res: Response, keep = false): Promise<void> {
  try {
    const cache = keep ? await caches.open(KEEP) : await seen();
    if (!cache) return;
    const body = await res.arrayBuffer();
    await cache.put(
      url,
      new Response(body, {
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
          'x-mb-at': String(Date.now()),
        },
      }),
    );
    // Now and then, the oldest files make room.
    if (!keep && ++stores % 200 === 0) void trim();
  } catch (err) {
    // The phone full: half the room made at once. Otherwise (a tile no longer wanted, its
    // download cut short; no cache) nothing is kept, and the map works on from the network.
    if ((err as Error)?.name === 'QuotaExceededError') void trim(0.5);
  }
}

/** Drops the oldest files seen beyond the limit (down to `share` of it). */
export async function trim(share = 0.9): Promise<void> {
  if (!canCache()) return;
  try {
    const cache = await seen();
    if (!cache) return;
    const keys = await cache.keys();
    const limit = Math.floor(MAX_ENTRIES * share);
    if (keys.length <= limit && share >= 0.9) return;
    // Oldest first, as they were put.
    for (const req of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(req);
  } catch {
    // Nothing to do.
  }
}

/** The website's service worker kept the same files before: not twice. */
export function dropOldCaches(): void {
  if (!canCache()) return;
  for (const name of OLD) void caches.delete(name).catch(() => undefined);
}

type Kind = 'json' | 'string' | 'arrayBuffer' | 'image' | string | undefined;

async function decode(res: Response, type: Kind): Promise<unknown> {
  if (type === 'json') {
    const data = (await res.json()) as { tiles?: string[] };
    // A tile set's index: its tiles through the cache too.
    if (Array.isArray(data?.tiles)) data.tiles = data.tiles.map(cachedUrl);
    return data;
  }
  if (type === 'string') return res.text();
  return res.arrayBuffer();
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
  }
}

/** Waits at most `ms` for the network when an older copy is at hand. */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  signal?.addEventListener('abort', () => ctrl.abort());
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/**
 * A map file asked for through the cache: kept and fresh, from the phone; otherwise from the
 * network (kept for next time), falling back on an older copy when the network fails. The
 * map library's protocol handler (see MapView).
 */
export async function loadCached(
  params: { url: string; type?: Kind },
  abort?: AbortController,
): Promise<{ data: unknown }> {
  const url = networkUrl(params.url);
  const hit = await lookup(url);
  if (hit && Date.now() - storedAt(hit) < maxAge(url))
    return { data: await decode(hit, params.type) };
  // Asked for twice at once (the map's style swapped while its tiles were coming): once on
  // the network.
  const coming = onTheWay.get(url);
  if (coming) {
    try {
      return { data: await decode(new Response(await coming), params.type) };
    } catch (err) {
      if (abort?.signal.aborted) throw err;
      // The other asker gave up: on its own.
    }
  }
  const tile = pictureZoom(url);
  const bytes = (async () => {
    if (tile !== undefined && !(await turn(tile, abort?.signal)))
      throw new DOMException('Aborted', 'AbortError');
    if (tile === undefined) urgent++;
    // An older copy: the network gets a few seconds, then the copy does.
    const wait = hit ? withTimeout(abort?.signal, 4000) : undefined;
    try {
      const res = await fetch(url, { signal: wait?.signal ?? abort?.signal });
      if (!res.ok) throw new HttpError(res.status, url);
      const body = await res.arrayBuffer();
      void store(url, new Response(body, { headers: res.headers }));
      return body;
    } finally {
      wait?.done();
      if (tile === undefined) urgent--;
      else pictures--;
      nextTurn();
    }
  })();
  onTheWay.set(url, bytes);
  try {
    return { data: await decode(new Response(await bytes), params.type) };
  } catch (err) {
    if (hit && !abort?.signal.aborted) return { data: await decode(hit, params.type) };
    throw err;
  } finally {
    if (onTheWay.get(url) === bytes) onTheWay.delete(url);
  }
}

/** The files on their way from the network, by address. */
const onTheWay = new Map<string, Promise<ArrayBuffer>>();

/*
 * On a slow connection every file shares the little there is: the imagery takes its turn, so
 * the names and roads (small, and what the passenger reads) come first, and of the imagery
 * the coarse tiles (lower zoom: a whole view in a few) before the sharp ones.
 */

/** The imagery's (and the heights') tile zoom from its address; none for the rest. */
function pictureZoom(url: string): number | undefined {
  const m = /arcgis.*\/tile\/(\d+)\/|elevation-tiles-prod\/terrarium\/(\d+)\//.exec(url);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

const PICTURES = 6;
/** The names' and roads' files on their way, and the imagery's. */
let urgent = 0;
let pictures = 0;
const queue: { z: number; go: (ok: boolean) => void }[] = [];

function nextTurn() {
  // A couple of tiles go on while the names come, so neither waits for the other for long.
  const limit = urgent > 0 ? 2 : PICTURES;
  queue.sort((a, b) => a.z - b.z);
  while (pictures < limit && queue.length > 0) {
    pictures++;
    queue.shift()!.go(true);
  }
}

/** A file the map needs before its imagery (its style), fetched ahead of the tiles. */
export async function fetchFirst(url: string, init?: RequestInit): Promise<Response> {
  urgent++;
  try {
    return await fetch(url, init);
  } finally {
    urgent--;
    nextTurn();
  }
}

/** Waits for an imagery tile's turn on the network; false when no longer wanted. */
function turn(z: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const item = { z, go: resolve };
    queue.push(item);
    signal?.addEventListener('abort', () => {
      const i = queue.indexOf(item);
      if (i >= 0) {
        queue.splice(i, 1);
        resolve(false);
      }
    });
    // Once all the tiles the map asks for together are in the queue, by their zoom.
    sorting ??= setTimeout(() => {
      sorting = undefined;
      nextTurn();
    });
  });
}
let sorting: ReturnType<typeof setTimeout> | undefined;

/** A JSON file through the cache, as the app reads it itself (the map's style). */
export async function cachedJson<T>(url: string): Promise<T> {
  if (!canCache()) {
    const res = await fetch(url);
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  }
  return (await loadCached({ url, type: 'json' })).data as T;
}

/** The tiles over a box (west, south, east, north) at a zoom, as x, y. */
export function tilesOver(
  [w, s, e, n]: readonly [number, number, number, number],
  z: number,
): [number, number][] {
  const count = 2 ** z;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * count);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * count);
  };
  const out: [number, number][] = [];
  for (let x = tx(w); x <= tx(e); x++) for (let y = ty(n); y <= ty(s); y++) out.push([x, y]);
  return out;
}

/** A tile's address from its template. */
export const tileUrl = (template: string, z: number, x: number, y: number) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/**
 * Brings files into the phone's cache in the background, a few at a time, waiting while
 * `busy()` (the map is moving or loading what is on screen) so they never hold up what
 * the passenger looks at. Files already kept are skipped. Resolves true when all are kept.
 */
export async function prefetch(
  urls: string[],
  busy: () => boolean,
  stop: () => boolean = () => false,
): Promise<boolean> {
  if (!canCache()) return false;
  let failed = false;
  let next = 0;
  const pause = () => new Promise((r) => setTimeout(r, 400));
  const worker = async () => {
    while (next < urls.length && !stop() && !failed) {
      if (busy()) {
        await pause();
        continue;
      }
      const url = networkUrl(urls[next++]!);
      if (await lookup(url)) continue;
      try {
        const res = await fetch(url);
        if (res.ok) await store(url, res, true);
        // A tile the server has not (the open sea far out): nothing to keep.
        else if (res.status !== 404) failed = true;
      } catch {
        // Offline again: the rest another time.
        failed = true;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return !failed && !stop() && next >= urls.length;
}
