#!/usr/bin/env node
/**
 * Snapshot working itinerary files into versions/<id>/.
 *
 * Usage:
 *   node scripts/snapshot-version.mjs <id> --label "..." --summary "..." [--activate]
 *
 * Copies:
 *   itinerary.md          → versions/<id>/itinerary.md
 *   data/stops.json       → versions/<id>/stops.json
 *   data/route.geojson    → versions/<id>/route.geojson
 *
 * Updates versions/index.json (and sets activeId when --activate).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const versionsRoot = path.join(root, "versions");
const indexPath = path.join(versionsRoot, "index.json");

function usage() {
  console.error(
    `Usage: node scripts/snapshot-version.mjs <id> --label "..." --summary "..." [--activate]
  id: kebab-case, e.g. v02-fundy-relaxed-return`
  );
  process.exit(1);
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function readIndex() {
  if (!fs.existsSync(indexPath)) {
    return { activeId: null, versions: [] };
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  const label = argValue(args, "--label");
  const summary = argValue(args, "--summary");
  const activate = args.includes("--activate");
  const days = argValue(args, "--days");
  const outboundCap = argValue(args, "--outbound-cap");
  const returnDays = argValue(args, "--return-days");

  if (!id || !label || !summary) usage();
  if (!/^v\d{2}-[a-z0-9-]+$/.test(id)) {
    console.error(`id must match vNN-slug (got ${id})`);
    process.exit(1);
  }

  const src = {
    itinerary: path.join(root, "itinerary.md"),
    stops: path.join(root, "data/stops.json"),
    route: path.join(root, "data/route.geojson"),
  };
  for (const [key, file] of Object.entries(src)) {
    if (!fs.existsSync(file)) {
      console.error(`Missing ${key}: ${file}`);
      process.exit(1);
    }
  }

  const dir = path.join(versionsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src.itinerary, path.join(dir, "itinerary.md"));
  fs.copyFileSync(src.stops, path.join(dir, "stops.json"));
  fs.copyFileSync(src.route, path.join(dir, "route.geojson"));

  const today = new Date().toISOString().slice(0, 10);
  const meta = {
    id,
    label,
    summary,
    created: today,
    days: days ? Number(days) : undefined,
    outboundCapHours: outboundCap ? Number(outboundCap) : undefined,
    returnDays: returnDays ? Number(returnDays) : undefined,
    files: {
      itinerary: "itinerary.md",
      stops: "stops.json",
      route: "route.geojson",
    },
  };
  Object.keys(meta).forEach((k) => meta[k] === undefined && delete meta[k]);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  const index = readIndex();
  const entry = {
    id,
    label,
    summary,
    created: today,
    days: meta.days,
    outboundCapHours: meta.outboundCapHours,
    returnDays: meta.returnDays,
  };
  Object.keys(entry).forEach((k) => entry[k] === undefined && delete entry[k]);

  const existing = index.versions.findIndex((v) => v.id === id);
  if (existing >= 0) index.versions[existing] = entry;
  else index.versions.push(entry);

  if (activate || !index.activeId) index.activeId = id;

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  console.log(`Snapshot ${id} → versions/${id}/`);
  console.log(`Active: ${index.activeId}`);
}

main();
