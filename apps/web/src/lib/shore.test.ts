import { describe, expect, it } from 'vitest';
import { landsOver, shoreBlur, shoreUrl, worldTile } from './shore.ts';

describe('the imagery by the shore only', () => {
  const tileAt = (lon: number, lat: number, z: number) =>
    worldTile(lon, lat, z).map(Math.floor) as [number, number];

  it('goes through its own protocol, only for the tiles the cache serves', () => {
    expect(shoreUrl('mbc://server.arcgisonline.com/tile/{z}/{y}/{x}')).toBe(
      'mbs://server.arcgisonline.com/tile/{z}/{y}/{x}',
    );
    expect(shoreUrl('https://example.com/{z}/{x}/{y}.jpg')).toBe(
      'https://example.com/{z}/{x}/{y}.jpg',
    );
  });

  it('knows a tile by the islands from one out at sea', () => {
    // Funchal's harbour, and the open sea 20 km south of it.
    const [hx, hy] = tileAt(-16.91, 32.643, 15);
    expect(landsOver(15, hx, hy, 0).map((o) => o.i)).toEqual([0]);
    const [sx, sy] = tileAt(-16.91, 32.45, 15);
    expect(landsOver(15, sx, sy, 0)).toEqual([]);
  });

  it('keeps some 150 m of water off the land, softly, at most 40 px', () => {
    const [, y13] = tileAt(-16.91, 32.643, 13);
    // At tile zoom 13 a pixel is some 16 m: 150 m are some 9 px.
    expect(shoreBlur(13, y13)).toBeCloseTo(9.2, 0);
    const [, y19] = tileAt(-16.91, 32.643, 19);
    expect(shoreBlur(19, y19)).toBe(40);
  });
});
