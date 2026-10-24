import type { Map as MapLibreMap } from 'maplibre-gl';
import { onCompass } from '../lib/compass.ts';

/**
 * The compass beside the zoom buttons, three ways in turn with a tap:
 * - `north`: the map points north, as it always did; the beam turns on it;
 * - `heading`: the camera turns with the phone, so the beam (the way the phone points, or the
 *   way a person riding goes) is always up — kept so when a route is chosen or on foot;
 * - `free`: the map stays where the hand left it, the beam turns on it.
 * Turning the map by hand makes it `free`.
 */
export type CompassWay = 'north' | 'heading' | 'free';

const NEXT: Record<CompassWay, CompassWay> = { north: 'heading', heading: 'free', free: 'north' };

const TITLE: Record<CompassWay, string> = {
  north: 'Compass: north up',
  heading: 'Compass: the map turns with the phone',
  free: 'Compass: the map stays where it is turned',
};

export class CompassButton {
  way: CompassWay = 'north';
  private heading?: number;
  private stopCompass?: () => void;
  private readonly button = document.createElement('button');
  private readonly icon = document.createElement('span');

  /**
   * In `group`, after the zoom buttons. `located` says whether the person's beam is on the map:
   * then the beam turns the map (`turnTo`), else the phone's own compass does.
   */
  constructor(
    private readonly map: MapLibreMap,
    group: HTMLElement,
    private readonly located: () => boolean,
  ) {
    this.button.type = 'button';
    this.button.className = 'maplibregl-ctrl-compass';
    this.icon.className = 'maplibregl-ctrl-icon';
    this.icon.setAttribute('aria-hidden', 'true');
    this.button.append(this.icon);
    group.append(this.button);
    this.button.addEventListener('click', () => this.set(NEXT[this.way]));
    map.on('rotate', this.turnIcon);
    map.on('pitch', this.turnIcon);
    // Turned by the hand (not by the phone or a tap): the map stays where it is turned.
    map.on('rotatestart', (e) => {
      if (e.originalEvent && this.way !== 'free') this.set('free');
    });
    this.paint();
    this.turnIcon();
  }

  /** The beam now points this way (degrees clockwise from north): the map turns to it on `heading`. */
  turnTo(deg: number) {
    this.heading = deg;
    if (this.way === 'heading') this.map.jumpTo({ bearing: deg });
  }

  private set(way: CompassWay) {
    this.way = way;
    this.stopCompass?.();
    this.stopCompass = undefined;
    this.paint();
    if (way === 'north') this.map.resetNorthPitch({ duration: 300 });
    if (way === 'heading') {
      this.stopCompass = onCompass((h) => {
        if (!this.located()) this.turnTo(h);
      });
      if (this.heading !== undefined) this.map.easeTo({ bearing: this.heading, duration: 400 });
    }
  }

  private paint() {
    this.button.title = TITLE[this.way];
    this.button.setAttribute('aria-label', TITLE[this.way]);
    this.button.setAttribute('aria-pressed', String(this.way === 'heading'));
  }

  private turnIcon = () => {
    this.icon.style.transform = `rotateX(${this.map.getPitch()}deg) rotateZ(${-this.map.getBearing()}deg)`;
  };
}
