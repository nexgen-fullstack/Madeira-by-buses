import { luminance, readableOn } from '../lib/color.ts';
import type { LiveBus } from '../lib/liveBus.ts';

/** The image of a bus on the map, one for each colour, number and whether you are in it. */
export const busImageId = (b: Pick<LiveBus, 'color' | 'text' | 'aboard'>) =>
  `mb-bus-${b.color.replace('#', '').toLowerCase()}-${b.text}-${b.aboard ? 'in' : 'out'}`;

/** Size in image pixels (drawn at twice the size of the screen). */
const W = 88;
const H = 56;
/** The dot of the person in the bus, its middle at the top right corner. */
const ME = 13;

/**
 * A bus seen from the front on a rounded plate of its ride's colour (dark round a light
 * colour, white round a dark one) with its number beside it; the bus you are in in gold,
 * with your turquoise dot on its corner.
 */
export function busImage(b: Pick<LiveBus, 'color' | 'text' | 'aboard'>): ImageData | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const fill = b.color;
  const edge = luminance(fill) > 0.25 ? '#14181F' : '#ffffff';
  const ink = readableOn(fill);
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const top = ME;
  const h = H - ME - 4;
  const w = W - ME;
  // A shadow under it, so it reads on a busy map.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  round(2, top, w - 2, h, 10);
  ctx.fillStyle = edge;
  ctx.fill();
  ctx.restore();
  round(5, top + 3, w - 8, h - 6, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  // The bus from the front: body, windscreen, lamps and wheels.
  const bx = 11;
  const by = top + 8;
  const bw = 20;
  const bh = h - 16;
  ctx.fillStyle = ink;
  round(bx, by, bw, bh - 3, 4);
  ctx.fill();
  ctx.fillStyle = fill;
  round(bx + 3, by + 3, bw - 6, bh * 0.42, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx + 5, by + bh - 9, 2, 0, Math.PI * 2);
  ctx.arc(bx + bw - 5, by + bh - 9, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.fillRect(bx + 2, by + bh - 4, 4, 4);
  ctx.fillRect(bx + bw - 6, by + bh - 4, 4, 4);
  // Its number, as big as fits.
  const text = b.text;
  const room = w - bw - 22;
  let size = 26;
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  while (size > 12 && ctx.measureText(text).width > room) {
    size -= 1;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + bw + 4 + room / 2, top + h / 2 + 1);
  if (b.aboard) {
    // You, in it: the turquoise dot of where you are, ringed in white.
    ctx.beginPath();
    ctx.arc(W - ME, ME, ME - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W - ME, ME, ME - 5, 0, Math.PI * 2);
    ctx.fillStyle = '#00C9B7';
    ctx.fill();
  }
  return ctx.getImageData(0, 0, W, H);
}
