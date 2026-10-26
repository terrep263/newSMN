#!/usr/bin/env python3
"""Second OpenStreetMap pass for Lake County, FL — bounded to the county's
bounding box so out-of-area place names (e.g. Sorrento, Italy) cannot leak in.

Fixes in this version vs collect.py:
  * every query is bounded to the Lake County bounding box (viewbox + bounded=1)
  * every result is rejected unless its coordinates fall inside that box
  * city attribution uses the address city when it is one of our 17, else the
    nearest city centroid — never the city used in the query string
  * more search terms per category, to fill the categories the first pass missed

Data (c) OpenStreetMap contributors, ODbL 1.0. Nominatim policy: <=1 req/sec.
"""
import json
import math
import time
import urllib.parse
import urllib.request

UA = "ShopMyNeighborhood/1.0 (lake@shopmyneighborhood.com)"
BASE = "https://nominatim.openstreetmap.org/search"

# Lake County, FL bounding box (south, west, north, east) - generous but still
# excludes every other Sorrento on earth.
BBOX = (28.30, -82.15, 29.25, -81.28)

CITY_CENTROIDS = {
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
ALIASES = {"howey in the hills": "Howey-in-the-Hills", "mount dora": "Mount Dora"}

CATEGORIES = {
    "restaurants-cafes": ["restaurant", "cafe", "fast food"],
    "bars-nightlife": ["bar", "pub", "nightclub"],
    "health-medical-services": ["dentist", "medical clinic", "pharmacy", "chiropractor"],
    "home-repair-handyman-services": ["hardware store", "plumber", "electrician", "roofing"],
    "hair-nails-barber-shops": ["hair salon", "barber", "nail salon", "beauty salon"],
    "local-retail-boutiques": ["boutique", "gift shop", "clothing store", "florist"],
    "auto-repair-detailing": ["auto repair", "car repair", "tire shop", "car wash"],
    "professional-services": ["insurance agency", "lawyer", "accountant", "real estate agency"],
    "spas-massage-wellness": ["spa", "massage"],
    "fitness-personal-training": ["gym", "fitness centre"],
    "grocery-markets": ["supermarket", "grocery store", "convenience store"],
    "lodging-vacation-rentals": ["hotel", "motel", "guest house", "bed and breakfast"],
}


def in_bbox(lat, lon):
    s, w, n, e = BBOX
    return s <= lat <= n and w <= lon <= e


def nearest_city(lat, lon):
    best, bestd = None, 1e9
    for name, (clat, clon) in CITY_CENTROIDS.items():
        d = math.hypot(lat - clat, (lon - clon) * math.cos(math.radians(lat)))
        if d < bestd:
            best, bestd = name, d
    return best


def address_city(addr):
    for key in ("city", "town", "village", "hamlet", "suburb"):
        v = (addr or {}).get(key)
        if not v:
            continue
        key_l = v.strip().lower()
        if key_l in ALIASES:
            return ALIASES[key_l]
        for name in CITY_CENTROIDS:
            if name.lower() == key_l:
                return name
    return None


def get(params):
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def main():
    found = {}
    rejected = {"outside_bbox": 0, "no_name": 0}
    for slug, terms in CATEGORIES.items():
        for term in terms:
            try:
                results = get({
                    "q": term,
                    "format": "jsonv2",
                    "extratags": 1,
                    "addressdetails": 1,
                    "limit": 50,
                    "viewbox": f"{BBOX[1]},{BBOX[2]},{BBOX[3]},{BBOX[0]}",  # left,top,right,bottom
                    "bounded": 1,
                })
            except Exception as e:
                print(f"  ! {term}: {e}", flush=True)
                time.sleep(1.2)
                continue
            new = 0
            for item in results:
                try:
                    lat, lon = float(item["lat"]), float(item["lon"])
                except (KeyError, TypeError, ValueError):
                    continue
                if not in_bbox(lat, lon):
                    rejected["outside_bbox"] += 1
                    continue
                name = item.get("name") or (item.get("display_name") or "").split(",")[0]
                if not name:
                    rejected["no_name"] += 1
                    continue
                key = f"{item.get('osm_type')}/{item.get('osm_id')}"
                if key in found:
                    continue
                ex = item.get("extratags") or {}
                addr = item.get("address") or {}
                city = address_city(addr) or nearest_city(lat, lon)
                street = " ".join(p for p in [addr.get("house_number"), addr.get("road")] if p) or None
                found[key] = {
                    "osm": key,
                    "osm_url": f"https://www.openstreetmap.org/{key}",
                    "name": name,
                    "category_slug": slug,
                    "matched_by": term,
                    "city": city,
                    "street": street,
                    "postcode": addr.get("postcode"),
                    "lat": lat,
                    "lon": lon,
                    "phone": ex.get("phone") or ex.get("contact:phone"),
                    "email": ex.get("email") or ex.get("contact:email"),
                    "website": ex.get("website") or ex.get("contact:website") or ex.get("url"),
                    "opening_hours": ex.get("opening_hours"),
                    "cuisine": ex.get("cuisine"),
                    "brand": ex.get("brand"),
                    "display_name": item.get("display_name"),
                }
                new += 1
            print(f"{len(found):4d} total (+{new:3d})  {slug:32s} {term}", flush=True)
            time.sleep(1.1)

    with open("/home/team/shared/osm/businesses-bounded.json", "w") as f:
        json.dump(sorted(found.values(), key=lambda x: (x["city"] or "", x["name"] or "")), f, indent=1)
    print(f"DONE {len(found)} businesses; rejected {rejected}", flush=True)


if __name__ == "__main__":
    main()
