import { skyOf } from './weather.ts';

/**
 * The sky drawn as weather apps draw it, by day the sun and by night the moon — behind the
 * clouds too, which the emoji cannot (their only sun behind a cloud shows at midnight) —
 * as SVG markup: for the map's little signs and the weather screen alike.
 */

const SUN = '#FDB813';
const MOON = '#F6C945';
const CLOUD = '#E9EEF3';
const CLOUD_EDGE = '#8A97A6';
const DARK_CLOUD = '#B7C2CE';
const RAIN = '#2F80ED';

const sun = (cx: number, cy: number, r: number) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 1.6);
    const y1 = cy + Math.sin(a) * (r + 1.6);
    const x2 = cx + Math.cos(a) * (r + 3.4);
    const y2 = cy + Math.sin(a) * (r + 3.4);
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join('');
  return `<g stroke="${SUN}" stroke-width="1.6" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>`;
};

/** A crescent moon: a disc with a smaller one taken out of it. */
const moon = (cx: number, cy: number, r: number) =>
  `<path d="M${cx + r * 0.35} ${cy - r} A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.45} A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.35} ${cy - r}Z" fill="${MOON}"/>`;

/** A cloud, its bottom left corner at (x, y), `w` wide. */
const cloud = (x: number, y: number, w: number, fill = CLOUD) => {
  const s = w / 16;
  return `<path transform="translate(${x} ${y - 10 * s}) scale(${s})" d="M4 10h9a3 3 0 0 0 .4-5.97A4.5 4.5 0 0 0 4.9 3.6 3.2 3.2 0 0 0 4 10Z" fill="${fill}" stroke="${CLOUD_EDGE}" stroke-width="${(0.9 / s).toFixed(2)}" stroke-linejoin="round"/>`;
};

const drops = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const x = 8 + i * (8 / Math.max(1, n - 1)) - (n === 1 ? -4 : 0);
    return `<line x1="${x}" y1="19" x2="${x - 1.2}" y2="22.5" stroke="${RAIN}" stroke-width="1.6" stroke-linecap="round"/>`;
  }).join('');

const flakes = () =>
  [8, 12, 16]
    .map(
      (x) =>
        `<circle cx="${x}" cy="20.6" r="1.2" fill="#9CC3F5" stroke="${CLOUD_EDGE}" stroke-width=".4"/>`,
    )
    .join('');

/** The sun by day, the moon by night, at a corner behind a cloud or alone in the middle. */
const light = (day: boolean, corner: boolean) =>
  corner ? (day ? sun(8.5, 8, 3.6) : moon(8.5, 8, 4.2)) : day ? sun(12, 12, 5) : moon(12, 12, 6.5);

/** A sky's picture as SVG markup (`size` px square). */
export function skySvg(code: number, day = true, size = 24): string {
  const sky = skyOf(code);
  let body: string;
  switch (sky) {
    case 'clear':
      body = light(day, false);
      break;
    case 'mostlyClear':
      body = light(day, true) + cloud(11, 19, 11);
      break;
    case 'partly':
      body = light(day, true) + cloud(5, 20, 17);
      break;
    case 'overcast':
      body = cloud(9, 14, 13, DARK_CLOUD) + cloud(2, 20, 18);
      break;
    case 'fog':
      body =
        cloud(3, 14, 17) +
        [17, 20, 23]
          .map(
            (y, i) =>
              `<line x1="${4 + i}" y1="${y - 0.5}" x2="${20 - i}" y2="${y - 0.5}" stroke="${CLOUD_EDGE}" stroke-width="1.5" stroke-linecap="round"/>`,
          )
          .join('');
      break;
    case 'drizzle':
    case 'showers':
      body = light(day, true) + cloud(5, 17, 16) + drops(2);
      break;
    case 'rain':
      body = cloud(3, 17, 18) + drops(3);
      break;
    case 'heavyRain':
      body = cloud(3, 17, 18, DARK_CLOUD) + drops(4);
      break;
    case 'thunder':
      body =
        cloud(3, 16, 18, DARK_CLOUD) +
        `<path d="M12.5 14.5 9.5 19.5h2.6l-1.4 4 4.3-5.6h-2.7l1.6-3.4Z" fill="${SUN}" stroke="#C98A00" stroke-width=".5" stroke-linejoin="round"/>`;
      break;
    case 'snow':
      body = cloud(3, 17, 18) + flakes();
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
