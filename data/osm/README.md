# OpenStreetMap data for the Lake County, FL directory

Every business in the `businesses` table comes from OpenStreetMap, under the
Open Database Licence (ODbL 1.0). Attribution is rendered on every directory
page and each business profile links to its own OSM record.

## Files

| File | Purpose |
| --- | --- |
| `collect-bounded.py` | Nominatim pull bounded to the Lake County, FL bounding box. Rejects any result whose coordinates fall outside it, and assigns the community by nearest centroid. |
| `filter-final.py` | Keeps only records within 10–12 km of one of the 17 communities and re-assigns them to the nearest one. |
| `businesses-final.json` | The filtered dataset that was ingested. |

## Why the bounding box and the distance rule exist

The first pass filtered on the **city name in the query**, and "Sorrento,
Florida" also returns **Sorrento, Italy**. 94 Naples restaurants and hotels were
ingested as Lake County businesses before this was caught.

Never filter by name alone. Filter by coordinates, then assign the community by
nearest centroid, then re-check the distance before inserting.

## Re-running

```bash
python3 collect-bounded.py          # ~40 min, Nominatim allows max 1 request/second
python3 filter-final.py
cd .. && bun run ingest:osm -- data/osm/businesses-final.json
```

The ingest is an upsert keyed on the OSM id and preserves existing slugs, so it
is safe to re-run. It rejects any record more than 12 km from a community and
assigns the city from the nearest centroid.

## Data quality

Name, category, address and coordinates are near-complete. Phone, opening hours
and website are present for a minority of rows; email is rare. Missing values
are omitted from the UI — never invented. Vendors supply the rest by claiming
their listing.
