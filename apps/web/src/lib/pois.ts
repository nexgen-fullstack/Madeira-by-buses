import {
  Banknote,
  BedDouble,
  Building2,
  Car,
  CarTaxiFront,
  Castle,
  Church,
  Coffee,
  Compass,
  Drama,
  Droplets,
  Dumbbell,
  Fuel,
  GlassWater,
  Hospital,
  Info,
  Landmark,
  Library,
  Mail,
  Pill,
  PlugZap,
  Scissors,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  SquareParking,
  Stethoscope,
  Store,
  Toilet,
  Trees,
  Umbrella,
  UtensilsCrossed,
  Wine,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Lang } from '../i18n.ts';

/**
 * The places of everyday life, on the map's "Places" button as Google Maps groups them —
 * food and drink, things to do, shopping, services — and along every street close in
 * (data/pois.json: OpenStreetMap's by scripts/pois.mjs with those only Overture Maps knows,
 * merged by the pipeline; the categories there and here are the same). `bigstore` is not a
 * category of its own: the groceries that are a Continente or a Pingo Doce.
 */
export type PoiCategory =
  | 'hospital'
  | 'doctor'
  | 'pharmacy'
  | 'police'
  | 'hotel'
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'grocery'
  | 'bigstore'
  | 'mall'
  | 'shop'
  | 'tour'
  | 'park'
  | 'beach'
  | 'attraction'
  | 'museum'
  | 'culture'
  | 'church'
  | 'gym'
  | 'library'
  | 'government'
  | 'info'
  | 'rental'
  | 'fuel'
  | 'charging'
  | 'garage'
  | 'carwash'
  | 'parking'
  | 'hair'
  | 'laundry'
  | 'atm'
  | 'post'
  | 'taxi'
  | 'toilets'
  | 'water';

export interface Poi {
  category: PoiCategory;
  name: string;
  lat: number;
  lon: number;
  /** OpenStreetMap's own kind ("pastry", "supermarket", "car_rental"…). */
  kind?: string;
  /** Opening hours as OpenStreetMap writes them ("Mo-Fr 09:00-19:00"). */
  hours?: string;
  phone?: string;
  web?: string;
  /** A big supermarket (Continente, Pingo Doce): drawn larger, in its own colour, named. */
  big?: boolean;
}

/** The big supermarkets' own colours, for their dots. */
export const BIG_STORE_COLOR = { continente: '#E30613', pingo: '#2E8B3A' } as const;

/** A big supermarket's colour by its name. */
export const bigStoreColor = (name: string) =>
  /pingo doce/i.test(name) ? BIG_STORE_COLOR.pingo : BIG_STORE_COLOR.continente;

export type PoiGroup = 'food' | 'things' | 'shopping' | 'services';

/** The groups and their categories, in the order the picker shows them. */
export const POI_GROUPS: readonly [PoiGroup, readonly PoiCategory[]][] = [
  ['food', ['restaurant', 'cafe', 'bar']],
  [
    'things',
    [
      'attraction',
      'museum',
      'culture',
      'park',
      'beach',
      'tour',
      'gym',
      'church',
      'library',
      'info',
    ],
  ],
  ['shopping', ['bigstore', 'grocery', 'mall', 'shop', 'pharmacy']],
  [
    'services',
    [
      'hotel',
      'hospital',
      'doctor',
      'police',
      'government',
      'atm',
      'rental',
      'fuel',
      'charging',
      'garage',
      'carwash',
      'parking',
      'taxi',
      'hair',
      'laundry',
      'post',
      'toilets',
      'water',
    ],
  ],
];

/** Each category's icon and the colour of its dots on the map. */
export const POI_LOOK: Record<PoiCategory, { icon: LucideIcon; color: string }> = {
  restaurant: { icon: UtensilsCrossed, color: '#E8710A' },
  cafe: { icon: Coffee, color: '#E8710A' },
  bar: { icon: Wine, color: '#E8710A' },
  park: { icon: Trees, color: '#188038' },
  beach: { icon: Umbrella, color: '#0B8DA8' },
  attraction: { icon: Castle, color: '#0F8C7E' },
  museum: { icon: Landmark, color: '#0F8C7E' },
  culture: { icon: Drama, color: '#0F8C7E' },
  church: { icon: Church, color: '#6D6F73' },
  gym: { icon: Dumbbell, color: '#188038' },
  tour: { icon: Compass, color: '#0F8C7E' },
  library: { icon: Library, color: '#188038' },
  info: { icon: Info, color: '#188038' },
  bigstore: { icon: ShoppingCart, color: BIG_STORE_COLOR.continente },
  grocery: { icon: ShoppingBasket, color: '#1A73E8' },
  mall: { icon: Store, color: '#1A73E8' },
  shop: { icon: ShoppingBag, color: '#1A73E8' },
  pharmacy: { icon: Pill, color: '#D93025' },
  hotel: { icon: BedDouble, color: '#C2185B' },
  hospital: { icon: Hospital, color: '#D93025' },
  doctor: { icon: Stethoscope, color: '#D93025' },
  police: { icon: ShieldCheck, color: '#1F3A93' },
  government: { icon: Building2, color: '#1F3A93' },
  atm: { icon: Banknote, color: '#5E35B1' },
  rental: { icon: Car, color: '#5E35B1' },
  fuel: { icon: Fuel, color: '#5E35B1' },
  charging: { icon: PlugZap, color: '#5E35B1' },
  garage: { icon: Wrench, color: '#5E35B1' },
  carwash: { icon: Droplets, color: '#5E35B1' },
  parking: { icon: SquareParking, color: '#1F3A93' },
  taxi: { icon: CarTaxiFront, color: '#5E35B1' },
  hair: { icon: Scissors, color: '#5E35B1' },
  laundry: { icon: Shirt, color: '#5E35B1' },
  post: { icon: Mail, color: '#5E35B1' },
  toilets: { icon: Toilet, color: '#546E7A' },
  water: { icon: GlassWater, color: '#0B8DA8' },
};

/** The names of the groups and categories in every language of the app. */
// prettier-ignore
const LABELS: Record<PoiGroup | PoiCategory, Record<Lang, string>> = {
  food: { uk: 'Їжа та напої', en: 'Food & drink', pt: 'Comer e beber', es: 'Comida y bebida', fr: 'Manger et boire', it: 'Cibo e bevande', de: 'Essen & Trinken', nl: 'Eten en drinken', cs: 'Jídlo a pití', pl: 'Jedzenie i picie', ru: 'Еда и напитки' },
  things: { uk: 'Чим зайнятися', en: 'Things to do', pt: 'O que fazer', es: 'Qué hacer', fr: 'À faire', it: 'Cosa fare', de: 'Unternehmungen', nl: 'Wat te doen', cs: 'Co dělat', pl: 'Co robić', ru: 'Чем заняться' },
  shopping: { uk: 'Покупки', en: 'Shopping', pt: 'Compras', es: 'Compras', fr: 'Shopping', it: 'Shopping', de: 'Einkaufen', nl: 'Winkelen', cs: 'Nákupy', pl: 'Zakupy', ru: 'Покупки' },
  services: { uk: 'Послуги', en: 'Services', pt: 'Serviços', es: 'Servicios', fr: 'Services', it: 'Servizi', de: 'Dienste', nl: 'Diensten', cs: 'Služby', pl: 'Usługi', ru: 'Услуги' },
  restaurant: { uk: 'Ресторани', en: 'Restaurants', pt: 'Restaurantes', es: 'Restaurantes', fr: 'Restaurants', it: 'Ristoranti', de: 'Restaurants', nl: 'Restaurants', cs: 'Restaurace', pl: 'Restauracje', ru: 'Рестораны' },
  cafe: { uk: 'Кав’ярні й пастеларії', en: 'Cafés & pastry shops', pt: 'Cafés e pastelarias', es: 'Cafeterías y pastelerías', fr: 'Cafés et pâtisseries', it: 'Caffè e pasticcerie', de: 'Cafés & Konditoreien', nl: 'Cafés en banketbakkers', cs: 'Kavárny a cukrárny', pl: 'Kawiarnie i cukiernie', ru: 'Кафе и кондитерские' },
  bar: { uk: 'Бари', en: 'Bars', pt: 'Bares', es: 'Bares', fr: 'Bars', it: 'Bar', de: 'Bars', nl: 'Bars', cs: 'Bary', pl: 'Bary', ru: 'Бары' },
  park: { uk: 'Парки й сади', en: 'Parks & gardens', pt: 'Parques e jardins', es: 'Parques y jardines', fr: 'Parcs et jardins', it: 'Parchi e giardini', de: 'Parks & Gärten', nl: 'Parken en tuinen', cs: 'Parky a zahrady', pl: 'Parki i ogrody', ru: 'Парки и сады' },
  beach: { uk: 'Пляжі й басейни', en: 'Beaches & pools', pt: 'Praias e piscinas', es: 'Playas y piscinas', fr: 'Plages et piscines', it: 'Spiagge e piscine', de: 'Strände & Bäder', nl: 'Stranden en zwembaden', cs: 'Pláže a koupaliště', pl: 'Plaże i kąpieliska', ru: 'Пляжи и бассейны' },
  attraction: { uk: 'Пам’ятки', en: 'Sights', pt: 'Monumentos e atrações', es: 'Monumentos y atracciones', fr: 'Sites et monuments', it: 'Monumenti e attrazioni', de: 'Sehenswürdigkeiten', nl: 'Bezienswaardigheden', cs: 'Památky', pl: 'Zabytki i atrakcje', ru: 'Достопримечательности' },
  culture: { uk: 'Театри, кіно й концерти', en: 'Theatres, cinemas & venues', pt: 'Teatros, cinemas e espetáculos', es: 'Teatros, cines y espectáculos', fr: 'Théâtres, cinémas et salles', it: 'Teatri, cinema e locali', de: 'Theater, Kinos & Bühnen', nl: 'Theaters, bioscopen en zalen', cs: 'Divadla, kina a koncerty', pl: 'Teatry, kina i koncerty', ru: 'Театры, кино и концерты' },
  church: { uk: 'Церкви', en: 'Churches', pt: 'Igrejas', es: 'Iglesias', fr: 'Églises', it: 'Chiese', de: 'Kirchen', nl: 'Kerken', cs: 'Kostely', pl: 'Kościoły', ru: 'Церкви' },
  gym: { uk: 'Спорт і фітнес', en: 'Sport & fitness', pt: 'Desporto e ginásios', es: 'Deporte y gimnasios', fr: 'Sport et fitness', it: 'Sport e palestre', de: 'Sport & Fitness', nl: 'Sport en fitness', cs: 'Sport a fitness', pl: 'Sport i fitness', ru: 'Спорт и фитнес' },
  tour: { uk: 'Екскурсії й тури', en: 'Tours & trips', pt: 'Passeios e excursões', es: 'Excursiones y tours', fr: 'Excursions et visites', it: 'Escursioni e tour', de: 'Touren & Ausflüge', nl: 'Tours en uitstapjes', cs: 'Výlety a zájezdy', pl: 'Wycieczki i rejsy', ru: 'Экскурсии и туры' },
  government: { uk: 'Державні установи', en: 'Public offices', pt: 'Serviços públicos', es: 'Organismos públicos', fr: 'Services publics', it: 'Uffici pubblici', de: 'Behörden', nl: 'Overheidsloketten', cs: 'Úřady', pl: 'Urzędy', ru: 'Госучреждения' },
  bigstore: { uk: 'Супермаркети Continente і Pingo Doce', en: 'Continente & Pingo Doce supermarkets', pt: 'Supermercados Continente e Pingo Doce', es: 'Supermercados Continente y Pingo Doce', fr: 'Supermarchés Continente et Pingo Doce', it: 'Supermercati Continente e Pingo Doce', de: 'Supermärkte Continente & Pingo Doce', nl: 'Supermarkten Continente en Pingo Doce', cs: 'Supermarkety Continente a Pingo Doce', pl: 'Supermarkety Continente i Pingo Doce', ru: 'Супермаркеты Continente и Pingo Doce' },
  doctor: { uk: 'Лікарі й стоматологи', en: 'Doctors & dentists', pt: 'Médicos e dentistas', es: 'Médicos y dentistas', fr: 'Médecins et dentistes', it: 'Medici e dentisti', de: 'Ärzte & Zahnärzte', nl: 'Artsen en tandartsen', cs: 'Lékaři a zubaři', pl: 'Lekarze i dentyści', ru: 'Врачи и стоматологи' },
  museum: { uk: 'Музеї', en: 'Museums', pt: 'Museus', es: 'Museos', fr: 'Musées', it: 'Musei', de: 'Museen', nl: 'Musea', cs: 'Muzea', pl: 'Muzea', ru: 'Музеи' },
  library: { uk: 'Бібліотеки', en: 'Libraries', pt: 'Bibliotecas', es: 'Bibliotecas', fr: 'Bibliothèques', it: 'Biblioteche', de: 'Bibliotheken', nl: 'Bibliotheken', cs: 'Knihovny', pl: 'Biblioteki', ru: 'Библиотеки' },
  info: { uk: 'Туристична інформація', en: 'Tourist information', pt: 'Posto de turismo', es: 'Información turística', fr: 'Office de tourisme', it: 'Informazioni turistiche', de: 'Touristinfo', nl: 'Toeristeninformatie', cs: 'Turistické informace', pl: 'Informacja turystyczna', ru: 'Туристическая информация' },
  grocery: { uk: 'Продукти й ринки', en: 'Groceries & markets', pt: 'Mercearias e mercados', es: 'Alimentación y mercados', fr: 'Alimentation et marchés', it: 'Alimentari e mercati', de: 'Lebensmittel & Märkte', nl: 'Levensmiddelen en markten', cs: 'Potraviny a trhy', pl: 'Spożywcze i targi', ru: 'Продукты и рынки' },
  mall: { uk: 'Торгові центри', en: 'Shopping centres', pt: 'Centros comerciais', es: 'Centros comerciales', fr: 'Centres commerciaux', it: 'Centri commerciali', de: 'Einkaufszentren', nl: 'Winkelcentra', cs: 'Obchodní centra', pl: 'Centra handlowe', ru: 'Торговые центры' },
  shop: { uk: 'Магазини', en: 'Shops', pt: 'Lojas', es: 'Tiendas', fr: 'Boutiques', it: 'Negozi', de: 'Geschäfte', nl: 'Winkels', cs: 'Obchody', pl: 'Sklepy', ru: 'Магазины' },
  pharmacy: { uk: 'Аптеки', en: 'Pharmacies', pt: 'Farmácias', es: 'Farmacias', fr: 'Pharmacies', it: 'Farmacie', de: 'Apotheken', nl: 'Apotheken', cs: 'Lékárny', pl: 'Apteki', ru: 'Аптеки' },
  hotel: { uk: 'Готелі', en: 'Hotels', pt: 'Hotéis', es: 'Hoteles', fr: 'Hôtels', it: 'Hotel', de: 'Hotels', nl: 'Hotels', cs: 'Hotely', pl: 'Hotele', ru: 'Отели' },
  hospital: { uk: 'Лікарні й клініки', en: 'Hospitals & clinics', pt: 'Hospitais e clínicas', es: 'Hospitales y clínicas', fr: 'Hôpitaux et cliniques', it: 'Ospedali e cliniche', de: 'Krankenhäuser & Kliniken', nl: 'Ziekenhuizen en klinieken', cs: 'Nemocnice a kliniky', pl: 'Szpitale i kliniki', ru: 'Больницы и клиники' },
  police: { uk: 'Поліція', en: 'Police', pt: 'Polícia', es: 'Policía', fr: 'Police', it: 'Polizia', de: 'Polizei', nl: 'Politie', cs: 'Policie', pl: 'Policja', ru: 'Полиция' },
  atm: { uk: 'Банкомати й банки', en: 'Cash machines & banks', pt: 'Multibanco e bancos', es: 'Cajeros y bancos', fr: 'Distributeurs et banques', it: 'Bancomat e banche', de: 'Geldautomaten & Banken', nl: 'Geldautomaten en banken', cs: 'Bankomaty a banky', pl: 'Bankomaty i banki', ru: 'Банкоматы и банки' },
  rental: { uk: 'Оренда авто й мопедів', en: 'Car & scooter hire', pt: 'Aluguer de carros e motas', es: 'Alquiler de coches y motos', fr: 'Location de voitures et scooters', it: 'Noleggio auto e scooter', de: 'Auto- & Rollerverleih', nl: 'Auto- en scooterverhuur', cs: 'Půjčovny aut a skútrů', pl: 'Wypożyczalnie aut i skuterów', ru: 'Прокат авто и мопедов' },
  fuel: { uk: 'АЗС', en: 'Petrol stations', pt: 'Postos de combustível', es: 'Gasolineras', fr: 'Stations-service', it: 'Distributori', de: 'Tankstellen', nl: 'Tankstations', cs: 'Čerpací stanice', pl: 'Stacje paliw', ru: 'АЗС' },
  charging: { uk: 'Зарядні станції', en: 'Charging stations', pt: 'Carregamento elétrico', es: 'Puntos de recarga', fr: 'Bornes de recharge', it: 'Colonnine di ricarica', de: 'Ladestationen', nl: 'Laadpalen', cs: 'Nabíjecí stanice', pl: 'Stacje ładowania', ru: 'Зарядные станции' },
  garage: { uk: 'Автосервіси', en: 'Car repair', pt: 'Oficinas', es: 'Talleres', fr: 'Garages', it: 'Officine', de: 'Autowerkstätten', nl: 'Autogarages', cs: 'Autoservisy', pl: 'Warsztaty samochodowe', ru: 'Автосервисы' },
  carwash: { uk: 'Автомийки', en: 'Car washes', pt: 'Lavagem de carros', es: 'Lavaderos de coches', fr: 'Lavage auto', it: 'Autolavaggi', de: 'Autowaschanlagen', nl: 'Wasstraten', cs: 'Myčky aut', pl: 'Myjnie', ru: 'Автомойки' },
  parking: { uk: 'Автостоянки', en: 'Car parks', pt: 'Parques de estacionamento', es: 'Aparcamientos', fr: 'Parkings', it: 'Parcheggi', de: 'Parkplätze', nl: 'Parkeerplaatsen', cs: 'Parkoviště', pl: 'Parkingi', ru: 'Автостоянки' },
  taxi: { uk: 'Стоянки таксі', en: 'Taxi ranks', pt: 'Praças de táxis', es: 'Paradas de taxi', fr: 'Stations de taxi', it: 'Posteggi taxi', de: 'Taxistände', nl: 'Taxistandplaatsen', cs: 'Stanoviště taxi', pl: 'Postoje taxi', ru: 'Стоянки такси' },
  hair: { uk: 'Перукарні, краса й спа', en: 'Hair, beauty & spa', pt: 'Cabeleireiros, estética e spa', es: 'Peluquerías, estética y spa', fr: 'Coiffure, beauté et spa', it: 'Parrucchieri, estetica e spa', de: 'Friseure, Kosmetik & Spa', nl: 'Kapper, schoonheid en spa', cs: 'Kadeřnictví, kosmetika a spa', pl: 'Fryzjerzy, uroda i spa', ru: 'Парикмахерские, красота и спа' },
  laundry: { uk: 'Пральні й хімчистки', en: 'Laundry & dry cleaning', pt: 'Lavandarias', es: 'Lavanderías', fr: 'Laveries et pressings', it: 'Lavanderie', de: 'Wäschereien & Reinigungen', nl: 'Wasserette en stomerij', cs: 'Prádelny a čistírny', pl: 'Pralnie', ru: 'Прачечные и химчистки' },
  post: { uk: 'Пошта', en: 'Post offices', pt: 'Correios', es: 'Correos', fr: 'Bureaux de poste', it: 'Uffici postali', de: 'Postämter', nl: 'Postkantoren', cs: 'Pošty', pl: 'Poczty', ru: 'Почта' },
  toilets: { uk: 'Туалети', en: 'Toilets', pt: 'Casas de banho', es: 'Aseos', fr: 'Toilettes', it: 'Bagni', de: 'Toiletten', nl: 'Toiletten', cs: 'Toalety', pl: 'Toalety', ru: 'Туалеты' },
  water: { uk: 'Питна вода', en: 'Drinking water', pt: 'Água potável', es: 'Agua potable', fr: 'Eau potable', it: 'Acqua potabile', de: 'Trinkwasser', nl: 'Drinkwater', cs: 'Pitná voda', pl: 'Woda pitna', ru: 'Питьевая вода' },
};

/** A group's or category's name in the reader's language. */
export const poiName = (id: PoiGroup | PoiCategory, lang: Lang) => LABELS[id][lang];

/** The places of a category chosen on the "Places" button (the big stores: of the groceries). */
export const ofCategory = (pois: readonly Poi[], c: PoiCategory) =>
  c === 'bigstore' ? pois.filter((p) => p.big) : pois.filter((p) => p.category === c);

/**
 * How much a kind of place matters on a map seen close in, as Google Maps shows first the
 * landmarks and big stores, then where to eat and shop, then everything else: lower first.
 */
export function poiRank(p: Poi): number {
  if (p.big) return 0;
  switch (p.category) {
    case 'attraction':
    case 'museum':
    case 'hospital':
    case 'mall':
      return 1;
    case 'restaurant':
    case 'cafe':
    case 'bar':
    case 'hotel':
    case 'grocery':
    case 'pharmacy':
    case 'church':
    case 'culture':
      return 2;
    case 'parking':
    case 'toilets':
    case 'water':
    case 'charging':
    case 'taxi':
      return 4;
    default:
      return 3;
  }
}

type Row = [
  PoiCategory,
  string,
  number,
  number,
  { k?: string; h?: string; p?: string; w?: string; b?: 1 }?,
];

let loading: Promise<Poi[]> | undefined;

/** The places, loaded once, the first time a category is chosen; none when they cannot be read. */
export function loadPois(): Promise<Poi[]> {
  loading ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/pois.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { pois } = (await res.json()) as { pois: Row[] };
      return pois.map(([category, name, lat, lon, x]) => ({
        category,
        name,
        lat,
        lon,
        kind: x?.k,
        hours: x?.h,
        phone: x?.p,
        web: x?.w,
        ...(x?.b ? { big: true } : {}),
      }));
    } catch {
      loading = undefined;
      return [];
    }
  })();
  return loading;
}
