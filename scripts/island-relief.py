#!/usr/bin/env python3
"""The islands drawn from their heights, built into the app: the land under the satellite
imagery, there at once and with no connection, so the island never vanishes while the
imagery comes (or when it cannot).

Shades the open elevation model (AWS Terrain Tiles, "terrarium" PNGs: SRTM and others,
the tiles the app's relief and 3D mountains use) in the colours the imagery has at each
height (the green of the laurel forest, the brown of the heights, the drier south coast
and the sand-coloured Porto Santo), lit from the north-west, and cuts it to the
OpenStreetMap coastline (data/cache/coast.json, as scripts/coast-line.py reads it).

Writes apps/web/public/land/<island>.webp and apps/web/src/lib/land.json (each image's
corners for the map). Web Mercator rows, so the map lays each image on as it is.

Needs Python 3 with numpy, Pillow and Shapely. Downloads the elevation tiles it lacks
into data/cache/terrain/<z>/<x>/<y>.png.
Run from anywhere: python scripts/island-relief.py
"""

from __future__ import annotations

import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from shapely import ops
from shapely.geometry import LineString, MultiPolygon, Polygon

ROOT = Path(__file__).resolve().parent.parent
COAST = ROOT / 'data' / 'cache' / 'coast.json'
TILES = ROOT / 'data' / 'cache' / 'terrain'
OUT = ROOT / 'apps' / 'web' / 'public' / 'land'
INDEX = ROOT / 'apps' / 'web' / 'src' / 'lib' / 'land.json'
TILES_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
Z = 12  # elevation tiles read: 32 m a pixel here, as fine as the model under them
PX_PER_DEG = 2000  # pixels of the images per degree of longitude: about 47 m a pixel

# Each island (or group) in an image of its own: west, south, east, north (degrees).
ISLANDS = {
    'madeira': ((-17.285, 32.615, -16.640, 32.890), 'green'),
    'desertas': ((-16.575, 32.390, -16.440, 32.600), 'dry'),
    'porto-santo': ((-16.430, 32.980, -16.265, 33.105), 'dry'),
}

# Height (m) -> colour, as the imagery shows the island from above.
PALETTES = {
    'green': [
        (0, (122, 118, 92)),
        (120, (102, 108, 72)),
        (350, (68, 94, 48)),
        (700, (40, 78, 32)),
        (1100, (50, 80, 36)),
        (1350, (84, 94, 52)),
        (1550, (104, 102, 68)),
        (1862, (128, 118, 98)),
    ],
    'dry': [
        (0, (168, 146, 108)),
        (150, (150, 128, 94)),
        (350, (128, 110, 84)),
        (520, (112, 98, 78)),
    ],
}


def merc_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def tile_xy(lon, lat, z):
    n = 2**z
    return (lon + 180) / 360 * n, (1 - merc_y(lat) / math.pi) / 2 * n


def tile(z, x, y):
    path = TILES / str(z) / str(x) / f'{y}.png'
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(
            TILES_URL.format(z=z, x=x, y=y), headers={'user-agent': 'madeirabus-relief'}
        )
        path.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    rgb = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def heights(bounds):
    """The heights over the bounds at zoom Z, and the bounds' place in that grid (pixels)."""
    w, s, e, n = bounds
    x0, y0 = tile_xy(w, n, Z)
    x1, y1 = tile_xy(e, s, Z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    grid = np.vstack(
        [np.hstack([tile(Z, x, y) for x in range(tx0, tx1 + 1)]) for y in range(ty0, ty1 + 1)]
    )
    return grid, ((x0 - tx0) * 256, (y0 - ty0) * 256, (x1 - tx0) * 256, (y1 - ty0) * 256)


def resample(grid, box, width, height):
    """The grid over `box` (pixels in it) as width x height, bilinear."""
    gx = np.linspace(box[0], box[2], width) - 0.5
    gy = np.linspace(box[1], box[3], height) - 0.5
    x = np.clip(gx, 0, grid.shape[1] - 1.001)
    y = np.clip(gy, 0, grid.shape[0] - 1.001)
    xi, yi = x.astype(int), y.astype(int)
    fx, fy = x - xi, y - yi
    a = grid[np.ix_(yi, xi)]
    b = grid[np.ix_(yi, xi + 1)]
    c = grid[np.ix_(yi + 1, xi)]
    d = grid[np.ix_(yi + 1, xi + 1)]
    fx, fy = fx[None, :], fy[:, None]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def tint(h, palette):
    out = np.zeros(h.shape + (3,))
    hs = [p[0] for p in palette]
    for k in range(3):
        out[..., k] = np.interp(h, hs, [p[1][k] for p in palette])
    return out


def shade(h, metres):
    """Light from the north-west, 40 degrees up; 1 on flat ground."""
    gy, gx = np.gradient(h, metres)
    slope = np.arctan(np.hypot(gx, gy) * 1.3)
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(40)
    lit = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect - math.pi / 2)
    return lit / math.sin(alt)


# The land, as scripts/coast-line.py joins it.
ways = json.loads(COAST.read_text(encoding='utf8'))['elements']
lines = [
    LineString([(g['lon'], g['lat']) for g in w['geometry']])
    for w in ways
    if len(w.get('geometry') or []) >= 2
]
land = ops.unary_union([r for r in ops.polygonize(ops.linemerge(lines)) if r.area > 0]).buffer(0)
parts = list(land.geoms) if isinstance(land, MultiPolygon) else [land]

OUT.mkdir(parents=True, exist_ok=True)
index = []
for name, (bounds, palette) in ISLANDS.items():
    w, s, e, n = bounds
    width = round((e - w) * PX_PER_DEG)
    height = round((merc_y(n) - merc_y(s)) / math.radians(1) * PX_PER_DEG)
    grid, box = heights(bounds)
    h = np.maximum(resample(grid, box, width, height), 0)
    metres = 111_320 * math.cos(math.radians((s + n) / 2)) / PX_PER_DEG
    light = shade(h, metres)
    rgb = tint(h, PALETTES[palette]) * np.clip(0.5 + 0.5 * light, 0.42, 1.2)[..., None]
    # The coast, drawn at four times the size and brought down: a smooth edge.
    k = 4
    mask = Image.new('L', (width * k, height * k), 0)
    draw = ImageDraw.Draw(mask)
    px = lambda lon, lat: (  # noqa: E731
        (lon - w) / (e - w) * width * k,
        (merc_y(n) - merc_y(lat)) / (merc_y(n) - merc_y(s)) * height * k,
    )
    for p in parts:
        if not p.intersects(Polygon([(w, s), (e, s), (e, n), (w, n)])):
            continue
        draw.polygon([px(*c) for c in p.exterior.coords], fill=255)
        for r in p.interiors:
            draw.polygon([px(*c) for c in r.coords], fill=0)
    alpha = mask.resize((width, height), Image.LANCZOS)
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
    image = image.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    image.putalpha(alpha)
    buf = io.BytesIO()
    image.save(buf, 'WEBP', quality=82, method=6, alpha_quality=90)
    (OUT / f'{name}.webp').write_bytes(buf.getvalue())
    index.append({'id': name, 'file': f'land/{name}.webp', 'bounds': [w, s, e, n]})
    print(f'{name}: {width}x{height} -> {len(buf.getvalue()) // 1024} KB')

INDEX.write_text(json.dumps(index, indent=2) + '\n', encoding='utf8')
print(f'{len(index)} islands -> {INDEX}')
