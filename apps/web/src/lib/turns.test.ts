import { describe, expect, it } from 'vitest';
import type { LatLon } from '@madeirabus/engine';
import { turnKind, WalkFollower, walkTurns } from './turns.ts';

/** A point `x` m east and `y` m north of a corner of Funchal. */
const at = (x: number, y: number): LatLon => ({
  lat: 32.65 + y / 111_320,
  lon: -16.91 + x / (111_320 * Math.cos((32.65 * Math.PI) / 180)),
});

/** North 100 m, right (east) 100 m, left (north) again 100 m, every 10 m a point. */
const steps = (from: [number, number], to: [number, number]) =>
  Array.from({ length: 10 }, (_, i) =>
    at(from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10),
  );
const zigzag = [
  ...steps([0, 0], [0, 100]),
  ...steps([0, 100], [100, 100]),
  ...steps([100, 100], [100, 200]),
  at(100, 200),
];

describe('turns on foot', () => {
  it('are told by how sharp they are, to the right positive', () => {
    expect(turnKind(10)).toBeUndefined();
    expect(turnKind(45)).toBe('slight-right');
    expect(turnKind(-90)).toBe('left');
    expect(turnKind(150)).toBe('sharp-right');
    expect(turnKind(-178)).toBe('uturn');
  });

  it('are where a walk turns, each once, and then where it arrives', () => {
    const turns = walkTurns(zigzag);
    expect(turns.map((t) => t.kind)).toEqual(['right', 'left', 'arrive']);
    expect(turns[0]!.at).toBeCloseTo(100, -1);
    expect(turns[1]!.at).toBeCloseTo(200, -1);
    expect(turns[2]!.at).toBeCloseTo(300, -1);
  });

  it('are none along a street that only wobbles', () => {
    const wobbly = Array.from({ length: 30 }, (_, i) => at(i % 2 ? 1.5 : 0, i * 10));
    expect(walkTurns(wobbly).map((t) => t.kind)).toEqual(['arrive']);
  });
});

describe('following a walk', () => {
  it('tells the next turn, how far, and says it once coming and once there', () => {
    const walk = new WalkFollower(zigzag);
    const first = walk.update(at(1, 20));
    expect(first.next.kind).toBe('right');
    expect(first.toNext).toBeCloseTo(80, -1);
    expect(first.cue).toBeUndefined();
    const soon = walk.update(at(1, 50));
    expect(soon.cue).toEqual({ turn: soon.next, stage: 'soon' });
    expect(walk.update(at(0, 55)).cue).toBeUndefined();
    const now = walk.update(at(0, 92));
    expect(now.cue?.stage).toBe('now');
    expect(now.cue?.turn.kind).toBe('right');
    expect(walk.update(at(0, 95)).cue).toBeUndefined();
    // Round the corner, the next turn is the left one.
    const on = walk.update(at(30, 101));
    expect(on.next.kind).toBe('left');
    expect(on.left).toBeCloseTo(170, -1);
  });

  it('knows a walker gone off the way (after a second fix), and one arrived', () => {
    const walk = new WalkFollower(zigzag);
    walk.update(at(0, 30));
    expect(walk.update(at(-80, 30)).offRoute).toBe(false);
    expect(walk.update(at(-80, 32)).offRoute).toBe(true);
    // Back on it, where it was left.
    expect(walk.update(at(0, 40)).offRoute).toBe(false);
    expect(walk.update(at(100, 195)).arrived).toBe(true);
  });

  it('does not take a poor fix for a walker off the way', () => {
    const walk = new WalkFollower(zigzag);
    walk.update(at(40, 10), 50);
    expect(walk.update(at(40, 12), 50).offRoute).toBe(false);
  });
});
