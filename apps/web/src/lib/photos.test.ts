import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { haversine, type Trail } from '@madeirabus/engine';
import { onTrail, photoCredits, trailPhotoSpots, trailViews, walkPhoto } from './photos.ts';
import { trailLines } from './trails.ts';
import { SCENIC_WALKS } from './scenic.ts';

const dir = fileURLToPath(new URL('../../public/photos/', import.meta.url));

describe('the photos of the walks, trails and viewpoints', () => {
  it('are in the app, large and small, each with its author and licence', () => {
    for (const p of photoCredits()) {
      if (!p.file.startsWith('view-'))
        expect(existsSync(`${dir}${p.file}.webp`), p.file).toBe(true);
      expect(existsSync(`${dir}${p.file}-sm.webp`), p.file).toBe(true);
      expect(p.author, p.file).not.toBe('');
      expect(p.license, p.file).toMatch(/^(CC|Public domain)/);
      expect(p.source, p.file).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it('are of nearly every walk with a view, by where it goes', () => {
    expect(SCENIC_WALKS.filter((w) => walkPhoto(w.to.name)).length).toBeGreaterThan(10);
    expect(trailViews('none')).toEqual([]);
  });

  it('stand on the map where they were taken, by their trail, a tap from its page', () => {
    const file = fileURLToPath(
      new URL('../../../../data/sources/osm/trails.json', import.meta.url),
    );
    const trails = (JSON.parse(readFileSync(file, 'utf8')) as { trails: Trail[] }).trails;
    const pr8 = trails.find((t) => t.id === 'pr8')!;
    const spots = trailPhotoSpots(pr8);
    expect(spots.length).toBeGreaterThan(2);
    for (const s of spots) {
      expect(s.href).toBe('hikes/pr8');
      expect(s.trail).toBe(true);
      // On the path itself, where the view is seen from.
      expect(onTrail(s, trailLines(pr8)).offset).toBeLessThan(1);
    }
    // Every photo with the place it was taken.
    expect(photoCredits().every((p) => p.lat !== undefined && p.lon !== undefined)).toBe(true);
  });

  it('of a view from a promenade stand on the promenade, not on the house beside it', () => {
    const file = fileURLToPath(
      new URL('../../../../data/sources/osm/trails.json', import.meta.url),
    );
    const trails = (JSON.parse(readFileSync(file, 'utf8')) as { trails: Trail[] }).trails;
    const promenade = trails.find((t) => t.id === 'osm-2232229')!;
    const salao = trailPhotoSpots(promenade).find((s) => s.name === 'Salão Ideal')!;
    const taken = trailViews(promenade.id).find((v) => v.name === 'Salão Ideal')!.photo!;
    // Commons puts the camera on the house above the road; the photo is of the view from
    // the promenade below it.
    expect(haversine(salao, { lat: taken.lat!, lon: taken.lon! })).toBeGreaterThan(10);
    expect(onTrail(salao, trailLines(promenade)).offset).toBeLessThan(1);
  });
});
