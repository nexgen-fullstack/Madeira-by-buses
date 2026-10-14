import { describe, expect, it } from 'vitest';
import { compassHeading, turnBetween } from './compass.ts';
import { bearing } from '../components/meMarker.ts';

describe('the way the phone points', () => {
  it("reads Android's compass (alpha turns anticlockwise) and iOS' heading", () => {
    expect(compassHeading({ alpha: 0, absolute: true })).toBe(0);
    expect(compassHeading({ alpha: 270, absolute: true })).toBe(90);
    expect(compassHeading({ alpha: 135, absolute: true })).toBe(225);
    expect(compassHeading({ alpha: 10, absolute: false, webkitCompassHeading: 42 })).toBe(42);
    // A phone's own frame, not the world's: no compass in it.
    expect(compassHeading({ alpha: 10, absolute: false })).toBeUndefined();
    expect(compassHeading({ alpha: null, absolute: true })).toBeUndefined();
  });

  it('counts the screen turned on its side', () => {
    expect(compassHeading({ alpha: 0, absolute: true }, 90)).toBe(90);
    expect(compassHeading({ alpha: 90, absolute: true }, 270)).toBe(180);
  });

  it('turns the short way round', () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(90, 270)).toBe(-180);
  });

  it('knows the way gone between two fixes', () => {
    const funchal = { lat: 32.65, lon: -16.91 };
    expect(bearing(funchal, { lat: 32.66, lon: -16.91 })).toBeCloseTo(0, 0);
    expect(bearing(funchal, { lat: 32.65, lon: -16.9 })).toBeCloseTo(90, 0);
    expect(bearing(funchal, { lat: 32.64, lon: -16.91 })).toBeCloseTo(180, 0);
    expect(bearing(funchal, { lat: 32.65, lon: -16.92 })).toBeCloseTo(270, 0);
  });
});
