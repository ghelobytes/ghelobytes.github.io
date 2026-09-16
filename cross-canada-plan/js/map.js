const STREET_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const BASEMAP_STORAGE_KEY = "cross-canada-basemap";
const VERSION_STORAGE_KEY = "cross-canada-version";
const ROUTE_LAYER_IDS = [
  "route-drive-casing",
  "route-drive",
  "route-return",
  "route-ferry",
];

/** Esri World Imagery — no API key; attribution required */
const SATELLITE_STYLE = {
  version: 8,
  name: "Esri World Imagery",
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "esri-world-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [
    {
      id: "esri-world-imagery",
      type: "raster",
      source: "esri-world-imagery",
    },
  ],
};

const ROUTE_PAINT = {
  streets: {
    casing: "#0e3f36",
    drive: "#1b6b5a",
    return: "#2c6b8a",
    ferry: "#2c6b8a",
  },
  satellite: {
    casing: "#f4f7f2",
    drive: "#7dffb3",
    return: "#7ec8ff",
    ferry: "#9ad4ff",
  },
};

const initialBasemap =
  (() => {
    try {
      const stored = localStorage.getItem(BASEMAP_STORAGE_KEY);
      if (stored === "streets" || stored === "satellite") return stored;
    } catch {
      /* ignore */
    }
    return "streets";
  })();

const map = new maplibregl.Map({
  container: "map",
  style: initialBasemap === "satellite" ? SATELLITE_STYLE : STREET_STYLE_URL,
  center: [-96, 52],
  zoom: 3.2,
  attributionControl: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

const popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "320px",
  offset: 18,
});

let stopsData = null;
let currentRoute = null;
let activeStopId = null;
let versionCatalog = null;
let loadedVersionId = null;
let activeBasemap = initialBasemap;
let styleSwapGeneration = 0;
const stopMarkers = [];

function badgeLabel(stop) {
  if (stop.kind === "start") return "S";
  if (stop.kind === "end") return "E";
  if (stop.kind === "ferry") return "F";
  return String(stop.step);
}

function amenityList(amenities) {
  if (!amenities || !amenities.length) return "";
  return `<ul class="popup__amenities">${amenities
    .slice(0, 8)
    .map((a) => `<li>${escapeHtml(a)}</li>`)
    .join("")}</ul>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatCoords(stop) {
  return `${Number(stop.lat).toFixed(5)}, ${Number(stop.lng).toFixed(5)}`;
}

function ioverlanderPlaceUrl(stop) {
  if (stop.ioverlanderUrl && /\/places\/[0-9a-fA-F-]+/.test(stop.ioverlanderUrl)) {
    return stop.ioverlanderUrl;
  }
  if (stop.ioverlanderGuid) {
    return `https://ioverlander.com/places/${stop.ioverlanderGuid}`;
  }
  return null;
}

function popupHtml(stop) {
  const coords = formatCoords(stop);
  const placeUrl = ioverlanderPlaceUrl(stop);
  const link = placeUrl
    ? `<a class="popup__link" href="${escapeHtml(placeUrl)}" target="_blank" rel="noopener">View on iOverlander</a>`
    : "";
  const cost =
    stop.cost === "free"
      ? `<span class="popup__cost popup__cost--free">Free overnight</span>`
      : stop.cost
        ? `<span class="popup__cost">${escapeHtml(stop.cost)}</span>`
        : "";
  return `
    <div class="popup">
      <p class="popup__category">${escapeHtml(stop.category || "Stop")}</p>
      <h3>${escapeHtml(stop.name)}</h3>
      <p class="popup__region">${escapeHtml(stop.region || "")}</p>
      ${cost}
      <div class="popup__coords">
        <code class="popup__coords-value">${escapeHtml(coords)}</code>
        <button type="button" class="popup__copy" data-coords="${escapeHtml(coords)}" aria-label="Copy coordinates">
          Copy
        </button>
      </div>
      <p class="popup__body">${escapeHtml(stop.description || stop.overview || "")}</p>
      ${amenityList(stop.amenities)}
      ${link}
    </div>
  `;
}

async function copyCoords(button) {
  const coords = button.dataset.coords;
  if (!coords) return;

  try {
    await navigator.clipboard.writeText(coords);
  } catch {
    const input = document.createElement("input");
    input.value = coords;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  const original = button.textContent;
  button.textContent = "Copied";
  button.classList.add("is-copied");
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove("is-copied");
  }, 1400);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".popup__copy");
  if (!button) return;
  event.preventDefault();
  copyCoords(button);
});

function renderSidebar(stops) {
  const list = document.getElementById("stop-list");
  list.innerHTML = "";

  for (const stop of stops) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stop-card";
    btn.dataset.id = stop.id;
    btn.innerHTML = `
      <div class="stop-card__row">
        <span class="stop-card__badge" data-kind="${escapeHtml(stop.kind)}">${escapeHtml(badgeLabel(stop))}</span>
        <div>
          <p class="stop-card__title">${escapeHtml(stop.label || stop.name)}</p>
          <p class="stop-card__meta">${escapeHtml(stop.category)} · ${escapeHtml(stop.region || "")}</p>
          <p class="stop-card__overview">${escapeHtml(stop.overview || "")}</p>
        </div>
      </div>
    `;
    btn.addEventListener("click", () => focusStop(stop.id, true));
    list.appendChild(btn);
  }
}

function setActiveCard(id) {
  activeStopId = id;
  for (const el of document.querySelectorAll(".stop-card")) {
    el.classList.toggle("is-active", el.dataset.id === id);
  }
  for (const marker of stopMarkers) {
    marker.getElement().classList.toggle("is-active", marker.getElement().dataset.id === id);
  }
}

function focusStop(id, fromSidebar = false) {
  const stop = stopsData.stops.find((s) => s.id === id);
  if (!stop) return;

  setActiveCard(id);

  const zoom = stop.kind === "start" || stop.kind === "end" ? 9.5 : 10.5;
  map.flyTo({
    center: [stop.lng, stop.lat],
    zoom,
    speed: 0.9,
    curve: 1.4,
    essential: true,
  });

  popup.setLngLat([stop.lng, stop.lat]).setHTML(popupHtml(stop)).addTo(map);

  if (fromSidebar && window.matchMedia("(max-width: 820px)").matches) {
    document.getElementById("sidebar").classList.remove("is-open");
    document.getElementById("sidebar-toggle").setAttribute("aria-expanded", "false");
  }
}

function fitTrip(route, stops) {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of route.features) {
    const geom = feature.geometry;
    const lines =
      geom.type === "LineString"
        ? [geom.coordinates]
        : geom.type === "MultiLineString"
          ? geom.coordinates
          : [];
    for (const line of lines) {
      for (const coord of line) bounds.extend(coord);
    }
  }
  for (const stop of stops) bounds.extend([stop.lng, stop.lat]);
  map.fitBounds(bounds, { padding: 56, duration: 900, maxZoom: 5.5 });
}

function clearRouteLayers() {
  popup.remove();
  for (const id of ROUTE_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource("route")) map.removeSource("route");
}

function addRouteLayers(route) {
  if (!route) return;
  clearRouteLayers();
  const paint = ROUTE_PAINT[activeBasemap] || ROUTE_PAINT.streets;
  map.addSource("route", { type: "geojson", data: route });

  map.addLayer({
    id: "route-drive-casing",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "drive"],
    paint: {
      "line-color": paint.casing,
      "line-width": 6,
      "line-opacity": activeBasemap === "satellite" ? 0.55 : 0.35,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "route-drive",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "drive"],
    paint: {
      "line-color": paint.drive,
      "line-width": 3.5,
      "line-opacity": 0.95,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "route-return",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "return"],
    paint: {
      "line-color": paint.return,
      "line-width": 3,
      "line-opacity": activeBasemap === "satellite" ? 0.9 : 0.75,
      "line-dasharray": [2, 1.25],
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "route-ferry",
    type: "line",
    source: "route",
    filter: ["in", ["get", "kind"], ["literal", ["ferry", "ferry-return"]]],
    paint: {
      "line-color": paint.ferry,
      "line-width": 3,
      "line-dasharray": [1.5, 1.5],
      "line-opacity": 0.95,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });
}

function syncBasemapButtons() {
  for (const btn of document.querySelectorAll(".basemap-toggle__btn")) {
    const on = btn.dataset.basemap === activeBasemap;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

function setBasemap(next) {
  if (next !== "streets" && next !== "satellite") return;
  if (next === activeBasemap && map.isStyleLoaded()) return;

  activeBasemap = next;
  syncBasemapButtons();
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }

  const generation = ++styleSwapGeneration;
  const style = next === "satellite" ? SATELLITE_STYLE : STREET_STYLE_URL;

  map.once("style.load", () => {
    if (generation !== styleSwapGeneration) return;
    if (currentRoute) addRouteLayers(currentRoute);
  });

  map.setStyle(style);
}

function addStopMarkers(stops) {
  for (const marker of stopMarkers) marker.remove();
  stopMarkers.length = 0;

  for (const stop of stops) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `map-marker map-marker--${stop.kind}`;
    el.dataset.id = stop.id;
    el.textContent = badgeLabel(stop);
    el.setAttribute("aria-label", stop.label || stop.name);
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      focusStop(stop.id);
    });

    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([stop.lng, stop.lat])
      .addTo(map);

    stopMarkers.push(marker);
  }
}

function updateStats(route, stops) {
  const drives = route.features.filter(
    (f) => f.properties?.kind === "drive" || f.properties?.kind === "return"
  );
  const meters = drives.reduce((sum, f) => sum + (f.properties.distanceMeters || 0), 0);
  const seconds = drives.reduce((sum, f) => sum + (f.properties.durationSeconds || 0), 0);
  const km = meters ? Math.round(meters / 1000) : null;
  const hours = seconds ? (seconds / 3600).toFixed(0) : null;
  const overnights = stops.filter(
    (s) => s.kind === "overnight" || s.kind === "end"
  ).length;

  if (km != null) {
    document.getElementById("stat-distance").textContent = km.toLocaleString();
    document.getElementById("stat-hours").textContent = `~${hours}`;
    document.getElementById("stat-stops").textContent = String(overnights);
    document.getElementById("stats").hidden = false;
  }
}

function updateHeader(version, stopsJson) {
  const eyebrow = document.getElementById("trip-eyebrow");
  const lede = document.getElementById("trip-lede");

  if (version?.days != null && version?.returnDays != null && version?.outboundCapHours != null) {
    eyebrow.textContent = `${version.days} days · ≤${version.outboundCapHours} h outbound · ${version.returnDays}-day return`;
  } else if (version?.label) {
    eyebrow.textContent = version.label;
  }

  if (stopsJson?.subtitle) {
    lede.textContent = stopsJson.subtitle;
  } else if (version?.summary) {
    lede.textContent = version.summary;
  }

  document.title = version?.label
    ? `Cross-Canada · ${version.label}`
    : "Cross-Canada";
}

function resolveVersionId(catalog) {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("v");
  if (fromQuery && catalog.versions.some((v) => v.id === fromQuery)) return fromQuery;

  try {
    const stored = localStorage.getItem(VERSION_STORAGE_KEY);
    if (stored && catalog.versions.some((v) => v.id === stored)) return stored;
  } catch {
    /* ignore */
  }

  if (catalog.activeId && catalog.versions.some((v) => v.id === catalog.activeId)) {
    return catalog.activeId;
  }
  return catalog.versions[0]?.id ?? null;
}

function fillVersionSelect(catalog, selectedId) {
  const select = document.getElementById("version-select");
  select.innerHTML = "";
  for (const version of catalog.versions) {
    const option = document.createElement("option");
    option.value = version.id;
    option.textContent = version.label;
    select.appendChild(option);
  }
  select.value = selectedId;
  select.disabled = catalog.versions.length < 2;
}

async function loadVersion(versionId) {
  const version = versionCatalog.versions.find((v) => v.id === versionId);
  if (!version) throw new Error(`Unknown version: ${versionId}`);

  const base = `versions/${versionId}`;
  const [route, stopsJson] = await Promise.all([
    fetch(`${base}/route.geojson`).then((r) => {
      if (!r.ok) throw new Error(`Missing route for ${versionId}`);
      return r.json();
    }),
    fetch(`${base}/stops.json`).then((r) => {
      if (!r.ok) throw new Error(`Missing stops for ${versionId}`);
      return r.json();
    }),
  ]);

  loadedVersionId = versionId;
  stopsData = stopsJson;
  currentRoute = route;
  activeStopId = null;

  updateHeader(version, stopsJson);
  renderSidebar(stopsJson.stops);
  updateStats(route, stopsJson.stops);
  addRouteLayers(route);
  addStopMarkers(stopsJson.stops);
  fitTrip(route, stopsJson.stops);

  const select = document.getElementById("version-select");
  if (select.value !== versionId) select.value = versionId;

  const url = new URL(window.location.href);
  url.searchParams.set("v", versionId);
  window.history.replaceState({}, "", url);

  try {
    localStorage.setItem(VERSION_STORAGE_KEY, versionId);
  } catch {
    /* ignore */
  }
}

document.getElementById("sidebar-toggle").addEventListener("click", () => {
  const sidebar = document.getElementById("sidebar");
  const open = !sidebar.classList.contains("is-open");
  sidebar.classList.toggle("is-open", open);
  document.getElementById("sidebar-toggle").setAttribute("aria-expanded", String(open));
});

document.getElementById("version-select").addEventListener("change", async (event) => {
  const next = event.target.value;
  if (!next || next === loadedVersionId) return;
  try {
    await loadVersion(next);
  } catch (err) {
    console.error(err);
    event.target.value = loadedVersionId;
  }
});

document.querySelector(".basemap-toggle").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-basemap]");
  if (!btn) return;
  setBasemap(btn.dataset.basemap);
});

map.on("load", async () => {
  syncBasemapButtons();

  versionCatalog = await fetch("versions/index.json").then((r) => r.json());
  const versionId = resolveVersionId(versionCatalog);
  if (!versionId) throw new Error("No itinerary versions in versions/index.json");
  fillVersionSelect(versionCatalog, versionId);
  await loadVersion(versionId);
});
