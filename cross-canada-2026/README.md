# Cross-Canada Timeline Viewer

A static, dark-themed MapLibre viewer for a Google Maps Timeline export. Browse
by day in the calendar to see that day's route (colored by mode of transport)
and points of interest on the map.

## Running

Browsers block `fetch()` of local files under `file://`, so serve the folder
over HTTP:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/index.html.

## Regenerating the data

`data/timeline.json` is a compact, pre-processed version of the raw Google
Takeout export (only `semanticSegments` — the 15MB `rawSignals` array of noisy
raw GPS pings isn't needed). To regenerate it from a new export:

```bash
python3 scripts/preprocess.py <path-to-export.json> data/timeline.json
```

The script also reverse-geocodes each visit's coordinates into a place name
(via OpenStreetMap's Nominatim API, rate-limited to 1 request/sec) so the
sidebar and map popups show an actual name instead of a generic "Point of
interest" label. Results are cached in `scripts/geocode_cache.json`, so
re-running the script only looks up coordinates it hasn't seen before.

Each visit also gets a photo for the map popup: the script tries the Google
Places Photos API first (using the visit's `placeId`), then falls back to a
Street View Static image for that coordinate if no place photo is available.
This requires a Google Cloud API key with the **Places API (New)** and
**Street View Static API** enabled, passed via an environment variable:

```bash
export GOOGLE_MAPS_API_KEY=<your-key>
python3 scripts/preprocess.py <path-to-export.json> data/timeline.json
```

The key is only ever used server-side by this script — it's never shipped to
the browser. Downloaded images are saved under `data/photos/` and referenced
by local path in `data/timeline.json`; the coordinate → photo path cache in
`scripts/photo_cache.json` means re-running the script only fetches photos
for coordinates it hasn't seen before. Without the API key set, photo lookups
are skipped and visits simply have no photo.

## Structure

- `index.html` / `css/style.css` / `js/app.js` — the app (vanilla JS, no build step)
- `data/timeline.json` — preprocessed timeline data, grouped by local day
- `scripts/preprocess.py` — converts a raw Timeline export into `data/timeline.json`
- `scripts/geocode_cache.json` — coordinate → place name cache used by the preprocessing script
