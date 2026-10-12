import { describe, expect, it } from 'vitest';
import { isBigStore, mergePois, overtureCategory, sameName, type PoiRow } from './pois.ts';

describe('places from OpenStreetMap and Overture', () => {
  it('puts Overture categories in the app’s', () => {
    expect(overtureCategory('food_and_drink>restaurant>seafood_restaurant')).toBe('restaurant');
    expect(overtureCategory('food_and_drink>casual_eatery>bakery')).toBe('cafe');
    expect(overtureCategory('food_and_drink>casual_eatery>fast_food_restaurant')).toBe(
      'restaurant',
    );
    expect(overtureCategory('shopping>food_and_beverage_store>grocery_store')).toBe('grocery');
    expect(overtureCategory('shopping>fashion_and_apparel_store>shoe_store')).toBe('shop');
    expect(overtureCategory('shopping>specialty_store>pharmacy_and_drug_store')).toBe('pharmacy');
    expect(overtureCategory('lifestyle_services>wellness_service>spa')).toBe('hair');
    expect(overtureCategory('travel_and_transportation>travel_service>tour_operator')).toBe('tour');
    expect(overtureCategory('cultural_and_historic>historic_site>fort')).toBe('attraction');
    // Offices, trades and car dealers stay off the map.
    expect(overtureCategory('services_and_business>real_estate_service')).toBeUndefined();
    expect(overtureCategory('shopping>vehicle_dealer>auto_dealer')).toBeUndefined();
    expect(overtureCategory('health_care>medical_service')).toBeUndefined();
  });

  it('knows the same place under two names', () => {
    expect(sameName('Restaurante O Lagar', 'O Lagar')).toBe(true);
    expect(sameName('Pingo Doce', 'Pingo Doce Super Câmara de Lobos')).toBe(true);
    expect(sameName('Café do Teatro', 'Teatro Café')).toBe(true);
    expect(sameName('Pastelaria Penha', 'Snack Bar Vila Rosa')).toBe(false);
    expect(sameName('Restaurante', 'Restaurante')).toBe(false);
  });

  it('marks every Continente and Pingo Doce as a big supermarket', () => {
    expect(isBigStore('Continente Modelo Monumental')).toBe(true);
    expect(isBigStore('Pingo Doce')).toBe(true);
    expect(isBigStore('Minimercado Continental')).toBe(false);
  });

  it('adds only the places OpenStreetMap lacks, each once, with what it lacks', () => {
    const osm: PoiRow[] = [
      ['restaurant', 'Restaurante O Lagar', 32.65, -16.9, { h: 'Mo-Su 12:00-22:00' }],
      ['grocery', 'Pingo Doce', 32.66, -16.92, { k: 'supermarket' }],
    ];
    const { pois, overture, matched } = mergePois(osm, [
      // The same restaurant 30 m away: its phone added.
      ['food_and_drink>restaurant', 'O Lagar', 32.6503, -16.9, 0.9, { p: '+351 291 000 000' }],
      // A café OpenStreetMap does not know, twice (Meta and Microsoft): once.
      ['food_and_drink>casual_eatery>cafe', 'Café Bom Gosto', 32.651, -16.901, 0.95],
      ['food_and_drink>casual_eatery>cafe', 'Bom Gosto', 32.6511, -16.901, 0.8],
      // Overture is not sure it exists.
      ['food_and_drink>bar', 'Bar Fantasma', 32.652, -16.902, 0.3],
      // A Continente only Overture knows.
      ['shopping>food_and_beverage_store>grocery_store', 'Continente', 32.67, -16.93, 0.99],
      // An estate agent: not for the map.
      ['services_and_business>real_estate_service', 'Casas Lda', 32.653, -16.903, 0.99],
    ]);
    expect(overture).toBe(2);
    expect(matched).toBe(2);
    expect(pois).toEqual([
      ['cafe', 'Café Bom Gosto', 32.651, -16.901, { o: 1 }],
      ['grocery', 'Pingo Doce', 32.66, -16.92, { k: 'supermarket', b: 1 }],
      ['grocery', 'Continente', 32.67, -16.93, { o: 1, b: 1 }],
      [
        'restaurant',
        'Restaurante O Lagar',
        32.65,
        -16.9,
        { h: 'Mo-Su 12:00-22:00', p: '+351 291 000 000' },
      ],
    ]);
  });
});
