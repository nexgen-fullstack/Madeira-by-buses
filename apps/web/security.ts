import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * The website's Content Security Policy: the browser runs no script but our own (and the
 * launch screen's, by its hash), and talks to no server but those listed — so a script
 * slipped into a page (a poisoned name in the map data, a browser add-on, a hijacked
 * link) can neither run nor send anything anywhere. Not in the phone app's build
 * (`--mode app`): Capacitor puts its bridge into the page as a script of its own.
 *
 * GitHub Pages sets no headers of ours, so the policy goes in a <meta> tag; the servers
 * of the build's own settings (an imagery provider in VITE_SATELLITE_TILES…) are let in too.
 */
export function contentSecurity(): Plugin {
  let mode = '';
  let extra: (string | undefined)[] = [];
  return {
    name: 'madeirabus-content-security',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      mode = config.mode;
      const env = config.env as Record<string, string | undefined>;
      extra = [
        env.VITE_SATELLITE_TILES,
        env.VITE_SATELLITE_CLOSE_TILES,
        env.VITE_SITE_URL,
        env.VITE_REMOTE_DATA,
      ];
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (mode === 'app') return html;
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
        const hashes = inline.map(
          (m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`,
        );
        const others = [...new Set(extra.flatMap(origins))];
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          // React and the map set styles on elements.
          "style-src 'self' 'unsafe-inline'",
          `img-src 'self' data: blob: https://i.ytimg.com ${MAP_SERVERS} ${others.join(' ')}`.trim(),
          `connect-src 'self' data: blob: ${MAP_SERVERS} ${DATA_SERVERS} ${others.join(' ')}`.trim(),
          "font-src 'self' data:",
          // The webcams' live broadcasts.
          'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
          // The map draws in workers it makes from blobs.
          "worker-src 'self' blob:",
          "child-src 'self' blob:",
          "manifest-src 'self'",
          "media-src 'self' blob: data:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          'upgrade-insecure-requests',
        ].join('; ');
        return html.replace(
          /(<meta charset="UTF-8" \/>)/i,
          `$1\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />` +
            '\n    <meta name="referrer" content="strict-origin-when-cross-origin" />',
        );
      },
    },
  };
}

/** The basemap (OpenFreeMap: style, tiles, fonts), the imagery (Esri) and the heights (AWS). */
const MAP_SERVERS = [
  'https://tiles.openfreemap.org',
  'https://clarity.maptiles.arcgis.com',
  'https://server.arcgisonline.com',
  'https://s3.amazonaws.com',
].join(' ');

/** The weather (Open-Meteo, IPMA) and the website itself (webcams, timetables for the app). */
const DATA_SERVERS = [
  'https://api.open-meteo.com',
  'https://marine-api.open-meteo.com',
  'https://api.ipma.pt',
  'https://nexgen-fullstack.github.io',
  'https://raw.githubusercontent.com',
].join(' ');

/** The origins of one or more addresses separated by spaces ("" for none). */
function origins(urls: string | undefined): string[] {
  return (urls ?? '').split(/\s+/).flatMap((u) => {
    try {
      return u ? [new URL(u.replace(/\{[^}]*\}/g, '0')).origin] : [];
    } catch {
      return [];
    }
  });
}
