import { describe, expect, it } from 'vitest';
import type { PoiRow } from './pois.ts';
import { attachWikidata, sameOwnName, type WikidataItem } from './wikidata.ts';

const SE: WikidataItem = {
  q: 'Q1004331',
  lat: 32.64817,
  lon: -16.90825,
  names: ['Sé do Funchal', 'Catedral do Funchal', 'Cathedral of Our Lady of the Assumption'],
  image: 'Catedral, Funchal.jpg',
  articles: { uk: 'Фуншалський собор', pt: 'Sé do Funchal' },
  year: 1514,
  sipa: '5015',
  is: ['Q2977'],
};
/** The parish of the same name, with its own photo. */
const PARISH: WikidataItem = {
  q: 'Q2190091',
  lat: 32.6469,
  lon: -16.9123,
  names: ['Sé', 'Sé (Funchal)'],
  image: 'Coastline.jpg',
  is: ['Q1131296'],
};
const SAO_PEDRO: WikidataItem = {
  q: 'Q10300',
  lat: 32.6489,
  lon: -16.9135,
  names: ['Igreja de São Pedro (Funchal)'],
  articles: { pt: 'Igreja de São Pedro (Funchal)' },
  is: ['Q16970'],
};

describe('places with what Wikidata knows of them', () => {
  it('knows a church under its own name, not under a word every church has', () => {
    expect(sameOwnName('Igreja de São Pedro', 'Capela de São Pedro')).toBe(true);
    expect(sameOwnName('Igreja de São Pedro', 'Igreja Paroquial de São Pedro Apóstolo')).toBe(true);
    expect(
      sameOwnName('Igreja de Nossa Senhora do Monte', 'Capela de Nossa Senhora da Conceição'),
    ).toBe(false);
    expect(sameOwnName('Jardim Municipal', 'Teatro Municipal Baltazar Dias')).toBe(false);
    expect(sameOwnName('Igreja', 'Capela')).toBe(false);
  });

  it('gives a place its item by its tag or by its name near it, never a parish', () => {
    const pois: PoiRow[] = [
      ['church', 'Sé', 32.64815, -16.90826, { wd: 'Q1004331', i: 'Own photo.jpg' }],
      ['church', 'Igreja de São Pedro', 32.64885, -16.9134],
      // Of the same name, 2 km away: another church.
      ['church', 'Igreja de São Pedro', 32.665, -16.93],
      // An Overture twin of the cathedral.
      ['church', 'Cathedral of Our Lady of the Assumption', 32.6482, -16.9081, { o: 1 }],
      ['cafe', 'Café Sé', 32.6469, -16.9123],
      // Overture's name for the cathedral nobody gave Wikidata: beside it, the same church.
      ['church', 'Catedral', 32.6483, -16.9084, { o: 1 }],
      // A pharmacy named after the church beside it: not the church.
      ['pharmacy', 'São Pedro', 32.6489, -16.9135],
    ];
    const { pois: out, tagged, named, twins } = attachWikidata(pois, [SE, PARISH, SAO_PEDRO]);
    expect([tagged, named, twins]).toEqual([1, 1, 2]);
    expect(out).toHaveLength(5);
    // OpenStreetMap's own photo kept, the rest from the item.
    expect(out[0]![4]).toMatchObject({ wd: 'Q1004331', i: 'Own photo.jpg', y: 1514, s: '5015' });
    expect(out[0]![4]?.wp?.uk).toBe('Фуншалський собор');
    expect(out[1]![4]).toMatchObject({ wd: 'Q10300', wp: { pt: 'Igreja de São Pedro (Funchal)' } });
    expect(out[2]![4]).toBeUndefined();
    expect(out[3]![4]).toBeUndefined();
    expect(out[4]![4]).toBeUndefined();
  });
});
