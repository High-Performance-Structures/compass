import json, math, base64, sys
import numpy as np
from PIL import Image

S = sys.argv[1]  # folder holding osm/roads.json and osm/tiles/7_<x>_<y>.png
WEST, EAST, NORTH, SOUTH = -109.05, -102.05, 41.0, 37.0
Z = 7
GX, GZ = 301, 221  # grid vertices (lon x lat)

# Mosaic terrarium tiles x 25..27, y 47..49 at zoom 7.
tiles = {}
for x in range(25, 28):
    for y in range(47, 50):
        im = np.asarray(Image.open(f"{S}/osm/tiles/7_{x}_{y}.png").convert("RGB")).astype(np.float64)
        tiles[(x, y)] = im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768
mosaic = np.zeros((3 * 256, 3 * 256))
for (x, y), a in tiles.items():
    mosaic[(y - 47) * 256:(y - 46) * 256, (x - 25) * 256:(x - 24) * 256] = a

def pixel(lon, lat):
    n = 2 ** Z
    px = (lon + 180) / 360 * n * 256 - 25 * 256
    lr = math.radians(lat)
    py = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256 - 47 * 256
    return px, py

def sample(px, py):
    x0, y0 = int(math.floor(px)), int(math.floor(py))
    fx, fy = px - x0, py - y0
    x0 = max(0, min(mosaic.shape[1] - 2, x0)); y0 = max(0, min(mosaic.shape[0] - 2, y0))
    a, b = mosaic[y0, x0], mosaic[y0, x0 + 1]
    c, d = mosaic[y0 + 1, x0], mosaic[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

heights = np.zeros((GZ, GX))
for j in range(GZ):
    lat = NORTH - (NORTH - SOUTH) * j / (GZ - 1)
    for i in range(GX):
        lon = WEST + (EAST - WEST) * i / (GX - 1)
        heights[j, i] = sample(*pixel(lon, lat))
hmin, hmax = float(heights.min()), float(heights.max())
q = np.clip(np.round(heights), 0, 65535).astype("<u2")
print("elevation m", round(hmin), round(hmax))

# Roads: simplify each OSM way (Douglas-Peucker), keep within the state box.
def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = np.hypot(*ab)
    best, idx = 0.0, 0
    for k in range(1, len(pts) - 1):
        p = np.array(pts[k])
        dist = np.hypot(*(p - a)) if L == 0 else abs(ab[0] * (a[1] - p[1]) - ab[1] * (a[0] - p[0])) / L
        if dist > best:
            best, idx = dist, k
    if best > eps:
        return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]

data = json.load(open(f"{S}/osm/roads.json"))
classes = {"motorway": 0, "trunk": 1, "primary": 2}
eps = {0: 0.004, 1: 0.006, 2: 0.008}
roads = []
for el in data["elements"]:
    if el.get("type") != "way" or "geometry" not in el:
        continue
    c = classes.get(el.get("tags", {}).get("highway"))
    if c is None:
        continue
    pts = [(round(g["lon"], 4), round(g["lat"], 4)) for g in el["geometry"]
           if WEST <= g["lon"] <= EAST and SOUTH <= g["lat"] <= NORTH]
    if len(pts) < 2:
        continue
    s = rdp(pts, eps[c])
    if c == 2 and math.hypot(s[-1][0] - s[0][0], s[-1][1] - s[0][1]) < 0.01 and len(s) <= 2:
        continue  # drop tiny primary stubs
    roads.append([c] + [v for p in s for v in (round(p[0], 3), round(p[1], 3))])

out = {
    "source": "Elevation: AWS Terrain Tiles (Mapzen; USGS 3DEP, SRTM). Roads: (c) OpenStreetMap contributors, ODbL.",
    "grid": {"w": GX, "h": GZ, "west": WEST, "east": EAST, "north": NORTH, "south": SOUTH,
             "min": round(hmin), "max": round(hmax), "u16": base64.b64encode(q.tobytes()).decode()},
    "roads": roads,
}
json.dump(out, open(f"{S}/colorado-terrain-v1.json", "w"), separators=(",", ":"))
print("ways", len(roads), "by class", {k: sum(1 for r in roads if r[0] == v) for k, v in classes.items()},
      "points", sum((len(r) - 1) // 2 for r in roads))
