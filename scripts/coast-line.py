#!/usr/bin/env python3
"""The coastline of Madeira, Porto Santo and the Desertas for the map's turquoise shallows.

Reads OpenStreetMap's coastline ways (natural=coastline, as Overpass gives them with their
geometry: data/cache/coast.json, the same file the walk.bin scenery step uses), keeps
their direction (OpenStreetMap draws a coastline with the land on its left, so the sea is
to its right: the map lays the shallows on that side), thins each way to a point every
few metres and writes apps/web/public/coast.json, a small GeoJSON.

Run from anywhere: python scripts/coast-line.py [in.json] [out.json]
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'cache' / 'coast.json'
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'apps' / 'web' / 'public' / 'coast.json'
TOLERANCE = 6.0  # metres a thinned line may stray from the real one


def thin(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Douglas-Peucker in metres."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][1])
    kx, ky = 111_320 * math.cos(lat0), 110_540
    xy = [(p[0] * kx, p[1] * ky) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy) or 1e-9
        far, at = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / seg
            if d > far:
                far, at = d, i
        if far > TOLERANCE:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep) if k]


ways = json.loads(SRC.read_text(encoding='utf8'))['elements']
features = []
for w in ways:
    pts = [(round(g['lon'], 5), round(g['lat'], 5)) for g in w.get('geometry') or []]
    pts = thin(pts)
    if len(pts) >= 2:
        features.append(
            {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': pts}}
        )
OUT.write_text(
    json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')),
    encoding='utf8',
)
print(f'{len(features)} coastline ways, {sum(len(f["geometry"]["coordinates"]) for f in features)} points -> {OUT} ({OUT.stat().st_size // 1024} KB)')
