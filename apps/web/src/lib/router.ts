import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

/** Called as the address changes, before the next screen is drawn: the one leaving is still there. */
const leaving = new Set<() => void>();
// Registered as the module loads, so before any screen listens for the change.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => leaving.forEach((f) => f()));
}

/** Runs `f` each time a screen is about to be left; returns how to stop. */
export function onLeave(f: () => void): () => void {
  leaving.add(f);
  return () => leaving.delete(f);
}

/** Minimal hash router: works from any base path and offline. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * What the app keeps on each step of the history it made: that it made it, the address it
 * was taken from, how many steps deep it is, and for a screen changed in place (the
 * planner's places and options) the screen it was first opened from and its depth.
 */
interface Step {
  inApp?: boolean;
  prev?: string;
  depth?: number;
  origin?: string;
  originDepth?: number;
}

const stepNow = (): Step => (history.state as Step | null) ?? {};

/** A screen's address without its options. */
const screenOf = (hash: string) => hash.replace(/^#\/?/, '').split('?')[0] ?? '';

const hashOf = (path: string, query?: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
};

export function navigate(path: string, query?: Record<string, string | undefined>): void {
  const from = location.hash;
  const was = stepNow();
  location.hash = hashOf(path, query);
  // Marks the entry as reached from inside the app, so "back" can return to it, and where
  // from: the same screen changed keeps the screen it was opened from.
  const same = screenOf(from) === screenOf(location.hash);
  const step: Step = {
    inApp: true,
    prev: from,
    depth: (was.depth ?? 0) + 1,
    origin: same ? was.origin : from,
    originDepth: same ? was.originDepth : (was.depth ?? 0),
  };
  try {
    history.replaceState({ ...(history.state as object | null), ...step }, '');
  } catch {
    // History state unavailable (sandboxed frames): back falls back to the planner.
  }
}

/**
 * Back to `path` with `query`: a step back through the history when that is the screen
 * before (the list of ways after one of them), or else opened anew.
 */
export function backTo(path: string, query?: Record<string, string | undefined>): void {
  if (stepNow().prev === hashOf(path, query)) history.back();
  else navigate(path, query);
}

/**
 * Back to the screen another one was opened from, before it was changed in place (a trail
 * the planner was opened from with the way to it): false when it was not opened from one
 * or that was the same kind of screen (`kind`, the planner from the planner).
 */
export function backToOrigin(kind: string): boolean {
  const { origin, depth, originDepth } = stepNow();
  if (!origin || depth === undefined || originDepth === undefined || depth <= originDepth)
    return false;
  if (screenOf(origin).split('/')[0] === kind || screenOf(origin) === '') return false;
  history.go(originDepth - depth);
  return true;
}

/** The same screen another way (a trail walked from its end): no new step to go back through. */
export function replaceRoute(path: string, query?: Record<string, string | undefined>): void {
  const state = history.state as object | null;
  location.replace(hashOf(path, query));
  try {
    history.replaceState(state, '');
  } catch {
    // History state unavailable (sandboxed frames).
  }
}

/**
 * Goes back when the current screen was opened from inside the app, or to
 * `fallback` when it was opened directly (a shared link, a restored tab), so
 * "back" never leaves the app.
 */
export function goBack(fallback = 'plan'): void {
  if ((history.state as { inApp?: boolean } | null)?.inApp) history.back();
  else navigate(fallback);
}
