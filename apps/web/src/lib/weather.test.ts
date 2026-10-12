import { describe, expect, it } from 'vitest';
import { cameraOf, isLive, readFeed } from '../../../../scripts/webcams.mjs';
import cams from './webcams.json';
import {
  compass,
  forecastUrl,
  madeiraIsoNow,
  madeiraWarnings,
  readForecast,
  skyOf,
  sunniest,
  WEATHER_PLACES,
  weatherWord,
  worstLevel,
} from './weather.ts';

describe('weather', () => {
  it('keeps Madeira’s warnings that are not green and not over, the worst first', () => {
    const w = (area: string, level: string, end: string, type = 'Precipitação') => ({
      idAreaAviso: area,
      awarenessTypeName: type,
      awarenessLevelID: level,
      startTime: '2026-10-12T06:00:00',
      endTime: end,
      text: '',
    });
    const now = '2026-10-12T12:00:00';
    const kept = madeiraWarnings(
      [
        w('MRM', 'yellow', '2026-10-12T18:00:00'),
        w('MCN', 'orange', '2026-10-13T06:00:00', 'Agitação Marítima'),
        w('MCS', 'green', '2026-10-13T06:00:00'),
        w('LSB', 'red', '2026-10-13T06:00:00'),
        w('MCS', 'yellow', '2026-10-12T09:00:00'),
      ],
      now,
    );
    expect(kept.map((k) => `${k.area} ${k.level}`)).toEqual(['MCN orange', 'MRM yellow']);
    expect(worstLevel(kept)).toBe('orange');
    expect(weatherWord(kept[0]!.type, 'uk')).toBe('Шторм на морі');
    expect(weatherWord(kept[0]!.area, 'en')).toBe('north coast');
  });

  it('writes the time as IPMA does, in Madeira', () => {
    // 12:30 UTC is 13:30 in Madeira in summer time.
    expect(madeiraIsoNow(new Date('2026-07-01T12:30:00Z'))).toBe('2026-07-01T13:30:00');
  });

  it('reads the sky and the wind as weather apps tell them', () => {
    expect(skyOf(0)).toBe('clear');
    expect(skyOf(3)).toBe('overcast');
    expect(skyOf(45)).toBe('fog');
    expect(skyOf(63)).toBe('rain');
    expect(skyOf(65)).toBe('heavyRain');
    expect(skyOf(81)).toBe('showers');
    expect(skyOf(95)).toBe('thunder');
    expect(compass(10)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(compass(350)).toBe('N');
  });

  it('asks for every part of the island at once and reads each answer', () => {
    const url = new URL(forecastUrl());
    expect(url.searchParams.get('latitude')!.split(',')).toHaveLength(WEATHER_PLACES.length);
    expect(url.searchParams.get('timezone')).toBe('Atlantic/Madeira');
    const f = readForecast(WEATHER_PLACES[0]!, {
      elevation: 32.4,
      current: {
        time: '2026-10-12T14:00',
        temperature_2m: 23.4,
        apparent_temperature: 24,
        weather_code: 1,
        is_day: 1,
        wind_speed_10m: 12,
        wind_gusts_10m: 30,
        wind_direction_10m: 60,
        relative_humidity_2m: 65,
        precipitation: 0,
        cloud_cover: 20,
      },
      hourly: {
        time: ['2026-10-12T14:00'],
        temperature_2m: [23.4],
        precipitation_probability: [5],
      },
      daily: { time: ['2026-10-12'], temperature_2m_max: [25], sunrise: ['2026-10-12T08:12'] },
    });
    expect(f.elevation).toBe(32);
    expect(f.now).toMatchObject({ temp: 23.4, day: true, gusts: 30 });
    expect(f.hours[0]).toMatchObject({ temp: 23.4, chance: 5, rain: 0 });
    expect(f.days[0]).toMatchObject({ max: 25, sunrise: '2026-10-12T08:12' });
    // The sunniest first: the clear south before the clouded north.
    const north = { ...f, place: WEATHER_PLACES[6]!, now: { ...f.now, cloud: 95, code: 3 } };
    expect(sunniest([north, f]).map((x) => x.place.id)).toEqual(['funchal', 'porto-moniz']);
  });
});

describe('webcams', () => {
  it('tells each live broadcast’s camera by the words of its title', () => {
    const of = (provider: string, title: string) => cameraOf(cams, provider, title)?.id;
    expect(of('netmadeira', 'Webcam Live @ Funchal Pontinha - Madeira / Portal Netmadeira')).toBe(
      'funchal-pontinha',
    );
    expect(of('netmadeira', 'Webcam LIVE @ Rabaçal - Madeira / Portal Netmadeira')).toBe(
      'rabacal-madeira',
    );
    expect(of('netmadeira', 'Webcam Live @ Câmara de Lobos Baía - Madeira')).toBe(
      'camara-de-lobos-baia',
    );
    expect(of('madeiraweb', '🔴 LIVE Cam: Praia dos Reis Magos Beach, Caniço | Madeira-Web')).toBe(
      'mw-reis-magos',
    );
    // Another provider's camera is not this channel's.
    expect(of('madeiraweb', 'Webcam Live @ Seixal - Madeira')).toBeUndefined();
    expect(isLive('Pico do Arieiro - incêndio Timelapse')).toBe(false);
    expect(isLive('🔴 LIVE: Calheta Beach')).toBe(true);
  });

  it('reads a channel’s public feed', () => {
    const xml = `<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>Webcam Live @ Seixal &amp; mar</title>
      <published>2026-09-22T10:00:00+00:00</published></entry></feed>`;
    expect(readFeed(xml)).toEqual([
      {
        video: 'abcdefghijk',
        title: 'Webcam Live @ Seixal & mar',
        published: '2026-09-22T10:00:00+00:00',
      },
    ]);
  });
});
