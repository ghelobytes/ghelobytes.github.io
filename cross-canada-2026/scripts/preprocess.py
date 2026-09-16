#!/usr/bin/env python3
"""
Preprocess a Google Maps Timeline export (semanticSegments) into a compact
per-day JSON file for the trip-viewer web app.

Usage: python3 scripts/preprocess.py <input.json> <output.json> [start_date] [end_date]

start_date/end_date are inclusive local dates in YYYY-MM-DD form, used to
restrict the output to a specific date range (e.g. a single trip).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

GEOCODE_CACHE_PATH = os.path.join(os.path.dirname(__file__), "geocode_cache.json")
PHOTO_CACHE_PATH = os.path.join(os.path.dirname(__file__), "photo_cache.json")
PHOTOS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "photos")
NOMINATIM_USER_AGENT = "trip-viewer/1.0 (personal project; contact: angelo@sparkgeo.com)"
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")
PHOTO_WIDTH = 480

MODE_CODE = {
    "IN_PASSENGER_VEHICLE": 1,
    "WALKING": 2,
    "IN_FERRY": 3,
    "IN_BUS": 4,
}
MODE_NAME = {v: k for k, v in MODE_CODE.items()}


def parse_latlng(s):
    # "49.2108464°, -123.9581512°"
    lat_s, lng_s = s.split(",")
    return float(lat_s.replace("°", "").strip()), float(lng_s.replace("°", "").strip())


def parse_time(s):
    return datetime.fromisoformat(s)


def local_date(iso_s):
    return iso_s[:10]


def reverse_geocode(lat, lng):
    """Look up a human-readable place name for a coordinate via Nominatim."""
    params = urllib.parse.urlencode({
        "format": "jsonv2",
        "lat": lat,
        "lon": lng,
        "zoom": 18,
        "addressdetails": 1,
    })
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/reverse?{params}",
        headers={"User-Agent": NOMINATIM_USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())

    name = data.get("name") or None
    if not name:
        addr = data.get("address", {})
        locality = addr.get("neighbourhood") or addr.get("suburb") or addr.get("road")
        city = (
            addr.get("city") or addr.get("town") or addr.get("village")
            or addr.get("municipality") or addr.get("county")
        )
        parts = [p for p in (locality, city) if p]
        name = ", ".join(parts) if parts else None
    if not name:
        name = data.get("display_name")
    return name


def geocode_visits(days):
    """Fill in a `name` field on every visit using a coordinate -> name cache
    on disk, so re-runs only look up newly seen coordinates."""
    cache = {}
    if os.path.exists(GEOCODE_CACHE_PATH):
        with open(GEOCODE_CACHE_PATH) as f:
            cache = json.load(f)

    cache_dirty = False
    for d in days.values():
        for v in d["visits"]:
            key = f"{v['lat']},{v['lng']}"
            if key not in cache:
                try:
                    cache[key] = reverse_geocode(v["lat"], v["lng"])
                except Exception as e:
                    print(f"  warning: geocoding failed for {key}: {e}", file=sys.stderr)
                    cache[key] = None
                cache_dirty = True
                time.sleep(1)  # respect Nominatim's 1 req/sec usage policy
            v["name"] = cache[key]

    if cache_dirty:
        with open(GEOCODE_CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2, sort_keys=True)


def _download_image(url, dest_path):
    """Download url to dest_path if it actually points at an image. Returns
    True on success, False if the response wasn't an image or the request
    failed."""
    req = urllib.request.Request(url, headers={"User-Agent": NOMINATIM_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if "image" not in content_type:
                return False
            data = resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError):
        return False
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(data)
    return True


def fetch_places_photo(place_id, dest_path):
    """Try to download a Google Places photo for a place_id. Returns True on
    success. Requires GOOGLE_MAPS_API_KEY and the Places API (New) to be
    enabled on the associated Google Cloud project."""
    if not place_id or not GOOGLE_MAPS_API_KEY:
        return False
    req = urllib.request.Request(
        f"https://places.googleapis.com/v1/places/{place_id}",
        headers={
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "photos",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError):
        return False
    photos = data.get("photos") or []
    if not photos:
        return False
    media_url = (
        f"https://places.googleapis.com/v1/{photos[0]['name']}/media"
        f"?maxWidthPx={PHOTO_WIDTH}&key={GOOGLE_MAPS_API_KEY}"
    )
    return _download_image(media_url, dest_path)


def fetch_streetview_photo(lat, lng, dest_path):
    """Try to download a Street View Static image for a coordinate. Returns
    True on success. Requires GOOGLE_MAPS_API_KEY and the Street View Static
    API to be enabled on the associated Google Cloud project."""
    if not GOOGLE_MAPS_API_KEY:
        return False
    meta_params = urllib.parse.urlencode({
        "location": f"{lat},{lng}",
        "key": GOOGLE_MAPS_API_KEY,
    })
    try:
        with urllib.request.urlopen(
            f"https://maps.googleapis.com/maps/api/streetview/metadata?{meta_params}", timeout=10
        ) as resp:
            meta = json.loads(resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError):
        return False
    if meta.get("status") != "OK":
        return False  # no imagery available at this coordinate
    img_params = urllib.parse.urlencode({
        "size": f"{PHOTO_WIDTH}x360",
        "location": f"{lat},{lng}",
        "key": GOOGLE_MAPS_API_KEY,
    })
    return _download_image(f"https://maps.googleapis.com/maps/api/streetview?{img_params}", dest_path)


def fetch_visit_photo(lat, lng, place_id):
    """Try a Google Places photo first, falling back to Street View, saving
    whichever succeeds under data/photos/. Returns a path relative to the
    project root to use as the photo URL, or None if neither source had
    imagery."""
    filename = f"{lat}_{lng}.jpg"
    dest_path = os.path.join(PHOTOS_DIR, filename)
    rel_path = f"data/photos/{filename}"

    if fetch_places_photo(place_id, dest_path):
        return rel_path
    if fetch_streetview_photo(lat, lng, dest_path):
        return rel_path
    return None


def fetch_visit_photos(days):
    """Fill in a `photo` field on every visit with a local image path (or
    null), sourced from the Google Places Photos API with a Street View
    Static API fallback, using an on-disk coordinate -> photo path cache."""
    cache = {}
    if os.path.exists(PHOTO_CACHE_PATH):
        with open(PHOTO_CACHE_PATH) as f:
            cache = json.load(f)

    if not GOOGLE_MAPS_API_KEY:
        print("  warning: GOOGLE_MAPS_API_KEY not set; skipping photo lookups", file=sys.stderr)

    cache_dirty = False
    for d in days.values():
        for v in d["visits"]:
            key = f"{v['lat']},{v['lng']}"
            if key not in cache:
                try:
                    cache[key] = fetch_visit_photo(v["lat"], v["lng"], v.get("placeId"))
                except Exception as e:
                    print(f"  warning: photo lookup failed for {key}: {e}", file=sys.stderr)
                    cache[key] = None
                cache_dirty = True
                time.sleep(0.2)
            v["photo"] = cache[key]

    if cache_dirty:
        with open(PHOTO_CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2, sort_keys=True)


def main():
    if len(sys.argv) not in (3, 5):
        print("Usage: preprocess.py <input.json> <output.json> [start_date] [end_date]")
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]
    filter_start = sys.argv[3] if len(sys.argv) == 5 else None
    filter_end = sys.argv[4] if len(sys.argv) == 5 else None

    with open(in_path) as f:
        data = json.load(f)

    segs = data["semanticSegments"]

    # 1. Collect activities as (start_dt, end_dt, mode_code)
    activities = []
    for s in segs:
        if "activity" in s:
            act = s["activity"]
            tc = act.get("topCandidate", {})
            mode = MODE_CODE.get(tc.get("type"), 0)
            try:
                start_dt = parse_time(s["startTime"])
                end_dt = parse_time(s["endTime"])
            except ValueError:
                continue
            activities.append((start_dt, end_dt, mode, act.get("distanceMeters", 0)))
    activities.sort(key=lambda a: a[0])

    def mode_at(dt):
        # linear scan is fine given small n; could bisect but not needed
        for start_dt, end_dt, mode, _ in activities:
            if start_dt <= dt <= end_dt:
                return mode
        return 0

    days = {}

    def day_bucket(date_str):
        if date_str not in days:
            days[date_str] = {"points": [], "visits": []}
        return days[date_str]

    # 2. Timeline path points -> per-day point arrays, colored by mode
    for s in segs:
        if "timelinePath" not in s:
            continue
        for p in s["timelinePath"]:
            try:
                lat, lng = parse_latlng(p["point"])
                dt = parse_time(p["time"])
            except (ValueError, KeyError):
                continue
            date_str = local_date(p["time"])
            mode = mode_at(dt)
            day_bucket(date_str)["points"].append(
                [round(lat, 6), round(lng, 6), int(dt.timestamp() * 1000), mode]
            )

    # 3. Visits -> POIs, bucketed on start day (and end day if it differs)
    for s in segs:
        if "visit" not in s:
            continue
        visit = s["visit"]
        tc = visit.get("topCandidate", {})
        loc = tc.get("placeLocation", {}).get("latLng")
        if not loc:
            continue
        lat, lng = parse_latlng(loc)
        try:
            start_dt = parse_time(s["startTime"])
            end_dt = parse_time(s["endTime"])
        except ValueError:
            continue
        entry = {
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "start": int(start_dt.timestamp() * 1000),
            "end": int(end_dt.timestamp() * 1000),
            "type": tc.get("semanticType", "UNKNOWN"),
            "placeId": tc.get("placeId"),
        }
        start_date = local_date(s["startTime"])
        end_date = local_date(s["endTime"])
        day_bucket(start_date)["visits"].append(entry)
        if end_date != start_date:
            day_bucket(end_date)["visits"].append(entry)

    # 4. Restrict to the requested date range, if any
    if filter_start or filter_end:
        days = {
            d: v for d, v in days.items()
            if (filter_start is None or d >= filter_start)
            and (filter_end is None or d <= filter_end)
        }
        activities = [
            a for a in activities
            if (filter_start is None or local_date(a[0].isoformat()) >= filter_start)
            and (filter_end is None or local_date(a[0].isoformat()) <= filter_end)
        ]

    # 5. Sort points within each day by time
    for d in days.values():
        d["points"].sort(key=lambda pt: pt[2])

    # 5b. Reverse-geocode visit coordinates into place names (cached on disk)
    unique_coords = {(v["lat"], v["lng"]) for d in days.values() for v in d["visits"]}
    if unique_coords:
        print(f"Geocoding {len(unique_coords)} unique visit location(s)...")
        geocode_visits(days)
        print(f"Looking up photos for {len(unique_coords)} unique visit location(s)...")
        fetch_visit_photos(days)

    # 6. Overall stats + bounds
    all_lats = []
    all_lngs = []
    total_distance_m = sum(a[3] for a in activities)
    for d in days.values():
        for pt in d["points"]:
            all_lats.append(pt[0])
            all_lngs.append(pt[1])
        for v in d["visits"]:
            all_lats.append(v["lat"])
            all_lngs.append(v["lng"])

    home = None
    for fp in data.get("userLocationProfile", {}).get("frequentPlaces", []):
        if fp.get("label") == "HOME":
            lat, lng = parse_latlng(fp["placeLocation"])
            home = {"lat": lat, "lng": lng}
            break

    dates_sorted = sorted(days.keys())

    output = {
        "dates": dates_sorted,
        "days": days,
        "bounds": [min(all_lngs), min(all_lats), max(all_lngs), max(all_lats)] if all_lngs else None,
        "home": home,
        "stats": {
            "totalDistanceKm": round(total_distance_m / 1000, 1),
            "totalDays": len(dates_sorted),
            "totalVisits": sum(len(d["visits"]) for d in days.values()),
            "dateRange": [dates_sorted[0], dates_sorted[-1]] if dates_sorted else None,
        },
        "modeNames": MODE_NAME,
    }

    with open(out_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    print(f"Wrote {out_path}")
    print(f"Days: {len(dates_sorted)}, total points: {sum(len(d['points']) for d in days.values())}")
    import os
    print(f"Output size: {os.path.getsize(out_path) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
