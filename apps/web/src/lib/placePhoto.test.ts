import { describe, expect, it } from 'vitest';
import { placePhoto } from './placePhoto.ts';

describe('the photo of a place tapped on the map', () => {
  it('finds the view from a viewpoint by its name nearby', () => {
    // The map's viewpoint of Pico do Arieiro, a little off the trail's viewpoint.
    const p = placePhoto({ name: 'Pico do Arieiro', lat: 32.7357, lon: -16.9288 });
    expect(p?.title).toBe('Pico do Arieiro');
    expect(p?.sm).toMatch(/view-.*-sm\.webp$/);
  });

  it('finds the scenic trip of the same name', () => {
    expect(placePhoto({ name: 'Miradouro do Pináculo', lat: 32.6458, lon: -16.8712 })?.title).toBe(
      'Miradouro do Pináculo',
    );
  });

  it('has none for a place far from every photo', () => {
    expect(placePhoto({ name: 'Somewhere', lat: 32.9, lon: -16.5 })).toBeUndefined();
  });
});
