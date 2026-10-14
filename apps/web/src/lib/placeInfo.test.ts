import { describe, expect, it } from 'vitest';
import { aboveTiles, articleLanguages, plainText } from './placeInfo.ts';

describe('a place’s card', () => {
  it('reads the article in the reader’s language, else English, Portuguese, any', () => {
    const articles = {
      pt: 'Sé do Funchal',
      en: 'Cathedral of Funchal',
      de: 'Kathedrale von Funchal',
    };
    expect(articleLanguages(articles, 'uk')).toEqual(['en', 'pt', 'de']);
    expect(articleLanguages(articles, 'de')).toEqual(['de', 'en', 'pt']);
    expect(articleLanguages({ fr: 'Cathédrale' }, 'uk')).toEqual(['fr']);
  });

  it('writes a photo’s author without the HTML around it', () => {
    expect(plainText('<a href="//commons.wikimedia.org/wiki/User:X">Jo&#039;s &amp; Co</a>')).toBe(
      "Jo's & Co",
    );
  });

  it('lays the imagery tiles so the place is in the middle of the view from above', () => {
    const tiles = aboveTiles({ lat: 32.64817, lon: -16.90825 }, 168, 120);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    expect(tiles.length).toBeLessThanOrEqual(6);
    // Together they cover the whole picture, each in the imagery of zoom 19.
    for (const t of tiles) expect(t.url).toMatch(/\/19\/\d+\/\d+$/);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.size))).toBeGreaterThanOrEqual(168);
    expect(Math.max(...tiles.map((t) => t.top + t.size))).toBeGreaterThanOrEqual(120);
  });
});
