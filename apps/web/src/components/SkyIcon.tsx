import { skySvg } from '../lib/skyIcon.ts';

/** The sky drawn: the sun by day, the moon by night, with their clouds (see `skySvg`). */
export function SkyIcon({
  code,
  day = true,
  size = 24,
}: {
  code: number;
  day?: boolean;
  size?: number;
}) {
  return (
    <span
      className="sky-icon"
      aria-hidden
      // Our own markup, made of numbers only.
      dangerouslySetInnerHTML={{ __html: skySvg(code, day, size) }}
    />
  );
}
