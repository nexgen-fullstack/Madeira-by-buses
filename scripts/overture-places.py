"""Every place on Madeira and Porto Santo from the Overture Maps Foundation, for the map.

Overture's places (Meta, Microsoft, Foursquare and others, open data under CDLA Permissive 2.0)
know many cafés, shops and restaurants OpenStreetMap does not. This writes them small: the
category path, name, where, how sure Overture is that the place exists, and its phone, website
and brand when known. The pipeline merges them with OpenStreetMap's (packages/pipeline/src/pois.ts).

    pip install duckdb
    python scripts/overture-places.py data/sources/overture/places.json [release]

Reads only the island's part of the latest release from Overture's public S3 bucket (~20 s).
"""
import json
import sys
import urllib.request

import duckdb

BBOX = (-17.35, 32.35, -16.25, 33.15)  # west, south, east, north
# Kinds of place nobody looks for on a bus and walking map: offices, trades, schools…
SKIP = ('services_and_business>b2b_service', 'services_and_business>building_or_construction_service',
        'services_and_business>corporate_or_business_office', 'services_and_business>design_service',
        'services_and_business>environmental_or_ecological_service', 'services_and_business>event_or_party_service',
        'services_and_business>family_service', 'services_and_business>home_service',
        'services_and_business>housing_or_property_service', 'services_and_business>legal_service',
        'services_and_business>media_service', 'services_and_business>printing_service',
        'services_and_business>professional_service', 'services_and_business>real_estate_service',
        'services_and_business>storage_facility', 'services_and_business>technical_service',
        'services_and_business>agricultural_service', 'services_and_business>security_service',
        'education>educational', 'education>place_of_learning', 'education>research_institute',
        'community_and_government>civic_organization', 'community_and_government>social_or_community_service',
        'community_and_government>public_utility', 'community_and_government>military_site',
        'cultural_and_historic>religious_organization', 'sports_and_recreation>sport_league',
        'sports_and_recreation>sport_team', 'sports_and_recreation>recreational_trail_or_path')


def latest_release() -> str:
    req = urllib.request.Request('https://stac.overturemaps.org/catalog.json',
                                 headers={'user-agent': 'MadeiraBus places collector'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)['latest']


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else 'data/sources/overture/places.json'
    release = sys.argv[2] if len(sys.argv) > 2 else latest_release()
    con = duckdb.connect()
    for ext in ('httpfs', 'spatial'):
        con.execute(f'INSTALL {ext}; LOAD {ext};')
    con.execute("SET s3_region='us-west-2'")
    w, s, e, n = BBOX
    rows = con.execute(f"""
      SELECT array_to_string(taxonomy.hierarchy, '>') AS path, names.primary AS name,
             bbox.ymin AS lat, bbox.xmin AS lon, confidence,
             phones[1] AS phone, websites[1] AS web, brand.names.primary AS brand
      FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*',
                        hive_partitioning=1, union_by_name=true)
      WHERE bbox.xmin BETWEEN {w} AND {e} AND bbox.ymin BETWEEN {s} AND {n}
        AND names.primary IS NOT NULL AND taxonomy.hierarchy IS NOT NULL
        AND coalesce(operating_status, 'open') = 'open' AND confidence >= 0.4
      ORDER BY path, lat
    """).fetchall()
    places = []
    for path, name, lat, lon, conf, phone, web, brand in rows:
        if path.startswith(SKIP) or path.startswith('geographic_entities>water_feature>river'):
            continue
        extra = {k: v for k, v in (('p', phone), ('w', web), ('b', brand)) if v}
        row = [path, name.strip(), round(lat, 5), round(lon, 5), round(conf, 2)]
        places.append(row + [extra] if extra else row)
    if not places:
        raise SystemExit('No places from Overture; keeping the previous file')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'release': release, 'licence': 'CDLA-Permissive-2.0', 'places': places},
                  f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(places)} Overture places ({release}) written to {out}')


if __name__ == '__main__':
    main()
