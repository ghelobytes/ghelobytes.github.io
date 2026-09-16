#!/usr/bin/env node
/**
 * Copy a saved version into the working tree (itinerary.md + data/*).
 *
 * Usage: node scripts/activate-version.mjs <id>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const versionsRoot = path.join(root, "versions");
const indexPath = path.join(versionsRoot, "index.json");

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/activate-version.mjs <id>");
  process.exit(1);
}

const dir = path.join(versionsRoot, id);
for (const file of ["itinerary.md", "stops.json", "route.geojson", "meta.json"]) {
  if (!fs.existsSync(path.join(dir, file))) {
    console.error(`Missing versions/${id}/${file}`);
    process.exit(1);
  }
}

fs.copyFileSync(path.join(dir, "itinerary.md"), path.join(root, "itinerary.md"));
fs.copyFileSync(path.join(dir, "stops.json"), path.join(root, "data/stops.json"));
fs.copyFileSync(path.join(dir, "route.geojson"), path.join(root, "data/route.geojson"));

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
index.activeId = id;
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

console.log(`Activated ${id} → itinerary.md + data/stops.json + data/route.geojson`);
