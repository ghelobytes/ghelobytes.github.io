#!/usr/bin/env node
/**
 * One-shot corridor builder: OSRM driving legs + BC Ferries dashed segment.
 * Working tree currently builds the active itinerary plan (see versions/).
 * Usage: node scripts/build-route.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** lon, lat — v03: v02 outbound + alternate return overnight ladder */
const WAYPOINTS = {
  departure_bay: [-123.9537888, 49.1912971],
  horseshoe_bay: [-123.2758982, 49.3685581],
  kamloops: [-120.31215, 50.67518],
  golden: [-116.96462, 51.3001],
  canmore: [-115.35499, 51.09716],
  banff: [-115.5708, 51.1784],
  calgary: [-114.0719, 51.0447],
  medicine_hat: [-110.70722, 50.02242],
  swift_current: [-107.78461, 50.30329],
  regina: [-104.65016, 50.40457],
  brandon: [-99.94159, 49.85208],
  winnipeg: [-97.21941, 49.83917],
  kenora: [-94.47212, 49.75793],
  ignace: [-91.62698, 49.40419],
  thunder_bay: [-89.23083, 48.37552],
  nipigon: [-88.25117, 49.01889],
  // alternate return
  dryden: [-92.83306, 49.78667],
  portage: [-98.3309, 49.975],
  yorkton: [-102.44455, 51.20544],
  moose_jaw: [-105.52268, 50.41007],
  brooks: [-111.90086, 50.57872],
  calgary_south: [-114.06225, 50.9505],
  revelstoke: [-118.19832, 51.00206],
  hope: [-121.48193, 49.36529],
};

const OUTBOUND = [
  "horseshoe_bay",
  "kamloops",
  "golden",
  "canmore",
  "banff",
  "calgary",
  "medicine_hat",
  "swift_current",
  "regina",
  "brandon",
  "winnipeg",
  "kenora",
  "ignace",
  "thunder_bay",
  "nipigon",
];

/** Return: new overnight towns (not used as outbound sleeps) */
const RETURN = [
  "nipigon",
  "dryden",
  "portage",
  "yorkton",
  "moose_jaw",
  "brooks",
  "calgary_south",
  "revelstoke",
  "hope",
  "horseshoe_bay",
];function ll(key) {
  const p = WAYPOINTS[key];
  if (!p) throw new Error(`Missing waypoint: ${key}`);
  return p;
}

async function routeLeg(a, b) {
  const url = `${OSRM}/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status} ${url}`);
  const json = await res.json();
  if (json.code !== "Ok" || !json.routes?.[0]) {
    throw new Error(`OSRM failed: ${JSON.stringify(json)}`);
  }
  const route = json.routes[0];
  return {
    coordinates: route.geometry.coordinates,
    distance: route.distance,
    duration: route.duration,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function project(p, lon0, lat0) {
  return [
    ((p[0] * Math.PI) / 180 - lon0) * Math.cos(lat0) * 6371000,
    ((p[1] * Math.PI) / 180 - lat0) * 6371000,
  ];
}

function perpendicularDistance(point, start, end) {
  const lon0 = (((start[0] + end[0]) / 2) * Math.PI) / 180;
  const lat0 = (((start[1] + end[1]) / 2) * Math.PI) / 180;
  const p = project(point, lon0, lat0);
  const s = project(start, lon0, lat0);
  const e = project(end, lon0, lat0);
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(p[0] - s[0], p[1] - s[1]);
  }
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(p[0] - (s[0] + t * dx), p[1] - (s[1] + t * dy));
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  let dmax = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

function simplifyLine(points, epsilon) {
  if (points.length < 5000) return douglasPeucker(points, epsilon);
  const out = [points[0]];
  const chunk = 3000;
  for (let i = 0; i < points.length - 1; ) {
    const j = Math.min(points.length - 1, i + chunk);
    const part = douglasPeucker(points.slice(i, j + 1), epsilon);
    out.push(...part.slice(1));
    i = j;
  }
  return douglasPeucker(out, epsilon);
}

async function buildLine(keys, kind, name) {
  const driveCoords = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < keys.length - 1; i++) {
    const aKey = keys[i];
    const bKey = keys[i + 1];
    process.stdout.write(`Routing ${kind} ${aKey} → ${bKey}... `);
    const leg = await routeLeg(ll(aKey), ll(bKey));
    console.log(`${(leg.distance / 1000).toFixed(0)} km`);
    totalDistance += leg.distance;
    totalDuration += leg.duration;
    const coords = leg.coordinates;
    if (driveCoords.length === 0) {
      driveCoords.push(...coords);
    } else {
      driveCoords.push(...coords.slice(1));
    }
    await sleep(250);
  }

  return {
    type: "Feature",
    properties: {
      kind,
      name,
      mode: "driving",
      distanceMeters: Math.round(totalDistance),
      durationSeconds: Math.round(totalDuration),
      waypoints: keys,
    },
    geometry: {
      type: "LineString",
      coordinates: simplifyLine(driveCoords, 80),
    },
  };
}

async function main() {
  const outbound = await buildLine(
    OUTBOUND,
    "drive",
    "Outbound · Nanaimo corridor → Nipigon (v03)"
  );
  const ret = await buildLine(
    RETURN,
    "return",
    "Return · alternate ladder → Hope → Horseshoe Bay"
  );

  const ferryOut = {
    type: "Feature",
    properties: {
      kind: "ferry",
      name: "BC Ferries · Departure Bay → Horseshoe Bay",
      mode: "ferry",
    },
    geometry: {
      type: "LineString",
      coordinates: [ll("departure_bay"), ll("horseshoe_bay")],
    },
  };

  const ferryReturn = {
    type: "Feature",
    properties: {
      kind: "ferry-return",
      name: "BC Ferries · Horseshoe Bay → Departure Bay",
      mode: "ferry",
    },
    geometry: {
      type: "LineString",
      coordinates: [ll("horseshoe_bay"), ll("departure_bay")],
    },
  };

  const fc = {
    type: "FeatureCollection",
    features: [ferryOut, outbound, ret, ferryReturn],
  };

  const out = path.join(root, "data/route.geojson");
  fs.writeFileSync(out, JSON.stringify(fc));
  const totalKm =
    (outbound.properties.distanceMeters + ret.properties.distanceMeters) / 1000;
  const totalH =
    (outbound.properties.durationSeconds + ret.properties.durationSeconds) / 3600;
  console.log(
    `Wrote ${out} — round trip ~${totalKm.toFixed(0)} km, ~${totalH.toFixed(1)} h drive`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
