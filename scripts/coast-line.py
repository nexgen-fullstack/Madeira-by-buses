#!/usr/bin/env python3
"""The sea round Madeira, Porto Santo and the Desertas for the map, by distance from the shore.

Reads OpenStreetMap's coastline ways (natural=coastline with their geometry, as Overpass
gives them: data/cache/coast.json, the same file the walk.bin scenery step uses), joins
them into the islands' land, and cuts the sea into bands by how far they are from it:
0-20 m, 20-45 m … 210-280 m, and the open sea beyond. Each band carries its distance
(`d`, m); the map paints them from a muted turquoise by the shore to the deep teal of the
ocean, in steps small enough to read as one smooth fade, opaque enough that the seams of
the satellite imagery under the sea do not show. Writes apps/web/public/coast.json.

Needs Python 3 with Shapely (pip install shapely).
Run from anywhere: python scripts/coast-line.py [in.json] [out.json]
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from shapely import ops
from shapely.affinity import affine_transform
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'cache' / 'coast.json'
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'apps' / 'web' / 'public' / 'coast.json'
# The bands' outer edges (m from the shore); the open sea lies beyond the last.
BANDS = [20, 45, 75, 110, 155, 210, 280]
# The open sea reaches this far round the islands (degrees): the map's bounds.
SEA = box(-18.2, 32.0, -15.6, 33.5)
SIMPLIFY = 6.0  # metres

# Work in metres: a flat projection about Madeira is good to a few centimetres here.
LAT0 = 32.75
KX = 111_320 * math.cos(math.radians(LAT0))
KY = 110_540
to_m = [KX, 0, 0, KY, 0, 0]
to_deg = [1 / KX, 0, 0, 1 / KY, 0, 0]

ways = json.loads(SRC.read_text(encoding='utf8'))['elements']
lines = [
    LineString([(g['lon'], g['lat']) for g in w['geometry']])
    for w in ways
    if len(w.get('geometry') or []) >= 2
]
merged = ops.linemerge(lines)
rings = list(ops.polygonize(merged))
land_deg = ops.unary_union([r for r in rings if r.area > 0])
land = affine_transform(land_deg, to_m).buffer(0)
# Rocks smaller than a house: their shallows are the shore's.
if isinstance(land, MultiPolygon):
    land = MultiPolygon([p for p in land.geoms if p.area >= 400])
print(f'{len(lines)} coastline ways -> {len(rings)} pieces of land')

features = []
# Each edge once, shared by the bands on both sides of it: thinned on its own, it would
# leave slivers of the dark imagery between them.
edges = [land.simplify(SIMPLIFY)] + [
    land.buffer(d, quad_segs=5).simplify(min(SIMPLIFY + d / 30, 14)) for d in BANDS
]
for i, d in enumerate(BANDS):
    band = edges[i + 1].difference(edges[i])
    geom = affine_transform(band, to_deg)
    features.append({'type': 'Feature', 'properties': {'d': d}, 'geometry': mapping(geom)})
inner = edges[-1]
# The open sea in squares a tenth of a degree wide: one polygon the size of the map, with the
# islands as holes, loses them in some of the map's tiles when it is cut up for drawing.
coast = affine_transform(inner, to_deg)
x0, y0, x1, y1 = SEA.bounds
step = 0.1
x = x0
while x < x1:
    y = y0
    while y < y1:
        cell = box(x, y, min(x + step, x1), min(y + step, y1))
        sea = cell.difference(coast) if cell.intersects(coast) else cell
        if not sea.is_empty:
            features.append({'type': 'Feature', 'properties': {'d': 9999}, 'geometry': mapping(sea)})
        y += step
    x += step


def rounded(o):
    if isinstance(o, float):
        return round(o, 5)
    if isinstance(o, (list, tuple)):
        return [rounded(x) for x in o]
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    return o


OUT.write_text(
    json.dumps({'type': 'FeatureCollection', 'features': rounded(features)}, separators=(',', ':')),
    encoding='utf8',
)
print(f'{len(features)} bands of sea -> {OUT} ({OUT.stat().st_size // 1024} KB)')
