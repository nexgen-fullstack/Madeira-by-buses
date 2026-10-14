import { afterEach, describe, expect, it, vi } from 'vitest';

/** A Cache Storage in memory, as the phone's WebView has one. */
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (url: string) => store.get(url)?.clone(),
      put: async (url: string, res: Response) => void store.set(url, res),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (req: { url: string } | string) =>
        store.delete(typeof req === 'string' ? req : req.url),
    };
  };
  return {
    stores,
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (url: string) => {
        for (const store of stores.values()) if (store.has(url)) return store.get(url)!.clone();
        return undefined;
      },
    },
  };
}

/** The module afresh (its cache handle and queue are its own), over the given globals. */
async function fresh(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.resetModules();
  const memory = memoryCaches();
  vi.stubGlobal('caches', memory.caches);
  vi.stubGlobal('fetch', vi.fn(fetch));
  return { ...(await import('./mapCache.ts')), memory };
}

const TILE =
  'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile';
const bytes = (n: number) => new Response(new Uint8Array(n), { status: 200 });
const settle = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the map's files on the phone", () => {
  it('asks for the map servers through the cache, and back', async () => {
    const { cachedUrl, networkUrl } = await fresh(async () => bytes(1));
    expect(cachedUrl(`${TILE}/9/1/2`)).toBe(
      'mbc://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/9/1/2',
    );
    expect(networkUrl(cachedUrl(`${TILE}/9/1/2`))).toBe(`${TILE}/9/1/2`);
    // Not other servers, nor the app's own files.
    expect(cachedUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(cachedUrl('./land/madeira.webp')).toBe('./land/madeira.webp');
  });

  it('keeps a tile once fetched and gives it with no connection', async () => {
    let online = true;
    const { loadCached } = await fresh(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return bytes(1234);
    });
    const url = `mbc://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/12/1600/1850`;
    const first = await loadCached({ url, type: 'image' });
    expect((first.data as ArrayBuffer).byteLength).toBe(1234);
    await settle();
    online = false;
    const again = await loadCached({ url, type: 'image' });
    expect((again.data as ArrayBuffer).byteLength).toBe(1234);
    expect(fetch).toHaveBeenCalledTimes(1);
    // A tile never seen, offline: an error, as from the network.
    await expect(loadCached({ url: url.replace('1850', '1851'), type: 'image' })).rejects.toThrow();
  });

  it("gives a tile set's index with its tiles through the cache too", async () => {
    const { loadCached } = await fresh(
      async () =>
        new Response(
          JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf'] }),
        ),
    );
    const { data } = await loadCached({ url: 'mbc://tiles.openfreemap.org/planet', type: 'json' });
    expect(data).toEqual({ tiles: ['mbc://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf'] });
  });

  it('lets the names and roads go first, and the coarse imagery before the sharp', async () => {
    const order: string[] = [];
    const waiting: (() => void)[] = [];
    const { loadCached } = await fresh(
      (url) =>
        new Promise((resolve) => {
          order.push(url.replace(/^https:\/\/[^/]+\/.*?(tile\/|planet\/)/, '$1'));
          waiting.push(() => resolve(bytes(10)));
        }),
    );
    const tile = (z: number, x: number) =>
      loadCached({ url: `mbc://clarity.maptiles.arcgis.com/x/tile/${z}/${x}/0`, type: 'image' });
    // A name's tile on its way: two imagery tiles may go meanwhile, the coarse first.
    const names = loadCached({
      url: 'mbc://tiles.openfreemap.org/planet/v1/8/1/1.pbf',
      type: 'arrayBuffer',
    });
    const asked = [tile(13, 1), tile(13, 2), tile(9, 1), tile(13, 3), tile(9, 2)];
    for (let i = 0; i < 5; i++) await settle();
    expect(order).toEqual(['planet/v1/8/1/1.pbf', 'tile/9/1/0', 'tile/9/2/0']);
    // The name's tile in: the rest go.
    waiting.shift()!();
    await names;
    for (let i = 0; i < 5; i++) await settle();
    expect(order.slice(3).sort()).toEqual(['tile/13/1/0', 'tile/13/2/0', 'tile/13/3/0']);
    for (const go of waiting) go();
    await Promise.all(asked);
  });

  it('keeps all it has when a download is cut short (a tile no longer wanted)', async () => {
    const { loadCached, memory } = await fresh(
      async () =>
        new Response(
          new ReadableStream({
            start: (c) => c.error(new DOMException('The user aborted a request.', 'AbortError')),
          }),
        ),
    );
    const seen = await memory.caches.open('mb-map-v1');
    for (let i = 0; i < 3000; i++) await seen.put(`${TILE}/14/${i}/0`, bytes(1));
    await expect(
      loadCached({ url: 'mbc://clarity.maptiles.arcgis.com/x/tile/9/1/1', type: 'image' }),
    ).rejects.toThrow();
    for (let i = 0; i < 5; i++) await settle();
    expect((await seen.keys()).length).toBe(3000);
  });

  it('drops an imagery tile no longer wanted while it waits its turn', async () => {
    const { loadCached } = await fresh(() => new Promise(() => {}));
    void loadCached({
      url: 'mbc://tiles.openfreemap.org/planet/v1/8/1/1.pbf',
      type: 'arrayBuffer',
    });
    const tiles = [1, 2, 3].map((x) => {
      const abort = new AbortController();
      return {
        abort,
        done: loadCached(
          { url: `mbc://clarity.maptiles.arcgis.com/x/tile/13/${x}/0`, type: 'image' },
          abort,
        ),
      };
    });
    tiles[2]!.abort.abort();
    await expect(tiles[2]!.done).rejects.toThrow(/Abort/);
  });

  it('brings the tiles over a box onto the phone, skipping those it has', async () => {
    const { prefetch, tilesOver, tileUrl } = await fresh(async () => bytes(5));
    // Madeira at zoom 12: some forty tiles, Funchal among them.
    const tiles = tilesOver([-17.285, 32.615, -16.64, 32.89], 12);
    expect(tiles.length).toBeGreaterThan(20);
    expect(tiles.length).toBeLessThan(60);
    expect(tiles).toContainEqual([1855, 1654]);
    const urls = tiles.slice(0, 4).map(([x, y]) => tileUrl(`${TILE}/{z}/{y}/{x}`, 12, x, y));
    expect(urls[0]).toMatch(/\/tile\/12\/\d+\/\d+$/);
    expect(await prefetch(urls, () => false)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(await prefetch(urls, () => false)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('says when it could not bring them all (offline)', async () => {
    const { prefetch } = await fresh(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await prefetch([`${TILE}/12/1/1`, `${TILE}/12/1/2`], () => false)).toBe(false);
  });
});
