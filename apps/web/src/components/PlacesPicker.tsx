import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { X } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import {
  BIG_STORE_COLOR,
  POI_GROUPS,
  POI_LOOK,
  poiName,
  type Poi,
  type PoiCategory,
} from '../lib/pois.ts';

/**
 * The categories of places as a maps app lists them, by group (food and drink, things to do,
 * shopping, services): a tap shows that kind of place on the map.
 */
export function PlacesPicker({
  chosen,
  onChoose,
  onClose,
}: {
  chosen?: PoiCategory;
  onChoose: (c: PoiCategory | undefined) => void;
  onClose: () => void;
}) {
  const t = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="places-picker" role="dialog" aria-label={t.t('places.title')}>
      <div className="places-picker__head">
        <h3>{t.t('places.title')}</h3>
        <button type="button" className="icon-button" aria-label={t.t('close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="places-picker__body">
        {POI_GROUPS.map(([group, categories]) => (
          <section key={group}>
            <h4>{poiName(group, t.lang)}</h4>
            <div className="places-picker__chips">
              {categories.map((c) => {
                const { icon: Icon, color } = POI_LOOK[c];
                return (
                  <button
                    key={c}
                    type="button"
                    className="places-chip"
                    aria-pressed={chosen === c}
                    style={{ ['--poi' as string]: color }}
                    onClick={() => onChoose(chosen === c ? undefined : c)}
                  >
                    <Icon size={16} aria-hidden /> {poiName(c, t.lang)}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The kind of place shown on the map, named over it, with a cross to show none again. */
export function PlacesChip({
  category,
  onOpen,
  onClear,
}: {
  category: PoiCategory;
  onOpen: () => void;
  onClear: () => void;
}) {
  const t = useI18n();
  const { icon: Icon, color } = POI_LOOK[category];
  return (
    <div className="places-shown" style={{ ['--poi' as string]: color }}>
      <button type="button" className="places-shown__name" onClick={onOpen}>
        <Icon size={15} aria-hidden /> {poiName(category, t.lang)}
      </button>
      <button
        type="button"
        className="icon-button places-shown__clear"
        aria-label={t.t('close')}
        onClick={onClear}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Image size of a place's dot on the map (drawn at twice the size of the screen). */
const DOT = 44;

/**
 * A category's dot for the map: its icon in white on a disc of its colour, ringed in white.
 * Drawn from the same icon as the picker's (rendered once into an SVG).
 */
export async function poiImage(category: PoiCategory): Promise<ImageData | undefined> {
  const { icon: Icon, color } = POI_LOOK[category];
  // Out of whatever React is rendering now (an effect asks for it).
  await new Promise((resolve) => setTimeout(resolve, 0));
  const holder = document.createElement('div');
  const root = createRoot(holder);
  flushSync(() => root.render(<Icon size={24} color="#ffffff" strokeWidth={2.4} />));
  const svg = holder.innerHTML;
  setTimeout(() => root.unmount(), 0);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = DOT;
      canvas.height = DOT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(undefined);
      ctx.beginPath();
      ctx.arc(DOT / 2, DOT / 2, DOT / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(DOT / 2, DOT / 2, DOT / 2 - 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      const s = DOT * 0.5;
      ctx.drawImage(img, (DOT - s) / 2, (DOT - s) / 2, s, s);
      resolve(ctx.getImageData(0, 0, DOT, DOT));
    };
    img.onerror = () => resolve(undefined);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** A category's dot's image name on the map; a big supermarket's own. */
export const poiImageId = (category: PoiCategory) => `mb-poi-${category}`;
export const bigStoreImageId = (p: Pick<Poi, 'name'>) =>
  /pingo doce/i.test(p.name) ? 'mb-poi-big-pingo' : 'mb-poi-big-continente';

/** Image size of a big supermarket's sign on the map (twice the size of the screen). */
const SIGN = 60;

/**
 * A big supermarket's sign for the map, larger than the other places' dots: a rounded square
 * in the store's colour with its initials ("C", "PD"), ringed in white, so a Continente or a
 * Pingo Doce is told at a glance among the little shops.
 */
export function bigStoreImage(pingo: boolean): ImageData | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = SIGN;
  canvas.height = SIGN;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const square = (inset: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(inset, inset, SIGN - inset * 2, SIGN - inset * 2, r);
  };
  square(1, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  square(5, 12);
  ctx.fillStyle = pingo ? BIG_STORE_COLOR.pingo : BIG_STORE_COLOR.continente;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${pingo ? 22 : 30}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pingo ? 'PD' : 'C', SIGN / 2, SIGN / 2 + 1);
  return ctx.getImageData(0, 0, SIGN, SIGN);
}
