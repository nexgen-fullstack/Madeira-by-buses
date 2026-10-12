// Types of webcams.mjs for the app's tests.
export function plain(s: string): string;
export function isLive(title: string): boolean;
export function cameraOf<C extends { provider: string; match: readonly string[] }>(
  cameras: readonly C[],
  provider: string,
  title: string,
): C | undefined;
export function readFeed(xml: string): { video: string; title: string; published: string }[];
