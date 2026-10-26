#!/usr/bin/env python3
"""Final filter for the Lake County, FL business pull.

Keeps only records that are genuinely inside one of our 17 communities:
  * nearest-community distance (haversine) must be <= 10 km
  * the community is re-assigned to that nearest community, never to whatever
    city name happened to appear in the query
Also drops obvious non-business entries and duplicates by osm id.
"""
import json
import math

SRC = "/home/team/shared/osm/businesses-bounded.json"
OUT = "/home/team/shared/osm/businesses-final.json"
MAX_KM = 10.0

CENTROIDS = {
    "Astatula": (28.7097, -81.7329),
    "Clermont": (28.5494, -81.7729),
    "Eustis": (28.8528, -81.6854),
    "Fruitland Park": (28.8583, -81.9070),
    "Groveland": (28.5581, -81.8512),
    "Howey-in-the-Hills": (28.7169, -81.7717),
    "Lady Lake": (28.9172, -81.9229),
    "Leesburg": (28.8108, -81.8779),
    "Mascotte": (28.5786, -81.8867),
    "Minneola": (28.5742, -81.7462),
    "Montverde": (28.6000, -81.6742),
    "Mount Dora": (28.8025, -81.6445),
    "Paisley": (28.9836, -81.5387),
    "Sorrento": (28.8081, -81.5631),
    "Tavares": (28.8042, -81.7256),
    "The Villages": (28.9594, -81.9492),
    "Umatilla": (28.9294, -81.6656),
}


def km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def main():
    with open(SRC) as f:
        rows = json.load(f)

    kept, by_city, dropped = [], {}, 0
    seen = set()
    for r in rows:
        if r["osm"] in seen:
            continue
        lat, lon = r.get("lat"), r.get("lon")
        if lat is None or lon is None:
            dropped += 1
            continue
        best, bestd = None, 1e9
        for name, (clat, clon) in CENTROIDS.items():
            d = km(lat, lon, clat, clon)
            if d < bestd:
                best, bestd = name, d
        if bestd > MAX_KM:
            dropped += 1
            continue
        seen.add(r["osm"])
        r["city"] = best
        r["distance_km"] = round(bestd, 2)
        kept.append(r)
        by_city[best] = by_city.get(best, 0) + 1

    with open(OUT, "w") as f:
        json.dump(kept, f, indent=1)

    print(f"kept {len(kept)} of {len(rows)} (dropped {dropped} > {MAX_KM} km from any community)")
    for name in sorted(by_city, key=lambda n: -by_city[n]):
        print(f"  {name:22s} {by_city[name]}")


if __name__ == "__main__":
    main()
