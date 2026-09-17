(() => {
  'use strict';

  const MODE_COLORS = {
    0: '#4a5261',
    1: '#5b8def',
    2: '#f2b84b',
    3: '#a78bfa',
    4: '#fb7185',
  };
  const MODE_LABELS = {
    0: 'Stationary / unknown',
    1: 'Driving',
    2: 'Walking',
    3: 'Ferry',
    4: 'Bus',
  };
  const VISIT_TYPE_LABELS = {
    HOME: 'Home',
    INFERRED_WORK: 'Work',
    SEARCHED_ADDRESS: 'Searched address',
    UNKNOWN: 'Point of interest',
  };

  const BASEMAPS = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    satellite: {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
      },
      layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
    },
  };
  const BASEMAP_LABELS = { dark: 'Dark', light: 'Light', satellite: 'Satellite' };

  let tripData = null;
  let map = null;
  let currentBasemap = 'dark';
  let mapFullyLoaded = false; // true once the initial 'load' event has fired
  let selectedDate = null; // 'YYYY-MM-DD' or null (whole trip)
  let calendarCursor = null; // Date, first-of-month currently shown
  const dateSet = new Set();
  const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' });

  const $ = (id) => document.getElementById(id);

  // ---------- Data loading ----------

  async function loadData() {
    const res = await fetch('data/timeline.json');
    if (!res.ok) throw new Error('Failed to load timeline data: ' + res.status);
    tripData = await res.json();
    tripData.dates.forEach((d) => dateSet.add(d));
  }

  function fmtDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function fmtDuration(startMs, endMs) {
    const mins = Math.round((endMs - startMs) / 60000);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // ---------- Stats bar ----------

  function renderStats() {
    $('statDistance').textContent = tripData.stats.totalDistanceKm.toLocaleString();
    $('statDays').textContent = tripData.stats.totalDays;
    $('statVisits').textContent = tripData.stats.totalVisits;
  }

  // ---------- Calendar ----------

  function initCalendarCursor() {
    const firstDate = tripData.dates[0];
    const [y, m] = firstDate.split('-').map(Number);
    calendarCursor = new Date(y, m - 1, 1);
  }

  function renderCalendar() {
    const y = calendarCursor.getFullYear();
    const m = calendarCursor.getMonth();
    $('monthLabel').textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const grid = $('calendarGrid');
    grid.innerHTML = '';

    const firstDay = new Date(y, m, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < startOffset; i++) {
      const cell = document.createElement('div');
      cell.className = 'day-cell empty';
      grid.appendChild(cell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      cell.textContent = day;

      if (dateSet.has(dateStr)) {
        cell.classList.add('has-data');
        cell.addEventListener('click', () => selectDate(dateStr));
      }
      if (dateStr === todayStr) cell.classList.add('today-marker');
      if (dateStr === selectedDate) cell.classList.add('selected');

      grid.appendChild(cell);
    }

    // nav bounds
    const firstTripDate = tripData.dates[0];
    const lastTripDate = tripData.dates[tripData.dates.length - 1];
    const [fy, fm] = firstTripDate.split('-').map(Number);
    const [ly, lm] = lastTripDate.split('-').map(Number);
    $('prevMonth').disabled = y === fy && m === fm - 1;
    $('nextMonth').disabled = y === ly && m === lm - 1;
  }

  function changeMonth(delta) {
    calendarCursor.setMonth(calendarCursor.getMonth() + delta);
    renderCalendar();
  }

  // ---------- Selection panel ----------

  function renderSelectionPanel() {
    const title = $('selectionTitle');
    const meta = $('selectionMeta');
    const list = $('visitList');
    const clearBtn = $('clearSelection');
    const dayTitleEl = $('dayTitle');

    list.innerHTML = '';

    if (!selectedDate) {
      title.textContent = 'Entire trip';
      const [start, end] = tripData.stats.dateRange;
      meta.textContent = `${fmtDateLabel(start).split(',')[0]} – ${fmtDateLabel(end)}`;
      clearBtn.hidden = true;
      dayTitleEl.hidden = true;
      list.innerHTML = '<div class="empty-hint">Select a highlighted day on the calendar to see its route and stops.</div>';
      return;
    }

    const day = tripData.days[selectedDate];
    title.textContent = fmtDateLabel(selectedDate).split(',')[0];
    clearBtn.hidden = false;

    const visits = dedupeVisits(day.visits);
    meta.textContent = `${visits.length} stop${visits.length === 1 ? '' : 's'} · ${day.points.length} tracked points`;

    dayTitleEl.hidden = false;
    dayTitleEl.innerHTML = `${fmtDateLabel(selectedDate)}<span class="sub">${visits.length} stop${visits.length === 1 ? '' : 's'} logged</span>`;

    if (visits.length === 0) {
      list.innerHTML = '<div class="empty-hint">No points of interest logged for this day.</div>';
      return;
    }

    visits
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((v) => {
        const card = document.createElement('div');
        card.className = 'visit-card';
        const label = v.name || VISIT_TYPE_LABELS[v.type] || v.type;
        card.innerHTML = `
          <div class="visit-card-top">
            <span class="visit-dot"></span>
            <span class="visit-name">${label}</span>
          </div>
          <div class="visit-time">${fmtTime(v.start)} – ${fmtTime(v.end)} · ${fmtDuration(v.start, v.end)}</div>
        `;
        card.addEventListener('click', () => {
          map.flyTo({ center: [v.lng, v.lat], zoom: 13, duration: 800 });
          showVisitPopup(v);
        });
        list.appendChild(card);
      });
  }

  function dedupeVisits(visits) {
    const seen = new Set();
    const out = [];
    for (const v of visits) {
      const key = `${v.placeId || ''}-${v.start}-${v.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }

  // ---------- Map ----------

  class BasemapControl {
    onAdd(mapInstance) {
      this._map = mapInstance;
      const el = document.createElement('div');
      el.className = 'maplibregl-ctrl basemap-ctrl';
      Object.keys(BASEMAPS).forEach((key) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'basemap-btn' + (key === currentBasemap ? ' active' : '');
        btn.textContent = BASEMAP_LABELS[key];
        btn.dataset.basemap = key;
        btn.addEventListener('click', () => setBasemap(key));
        el.appendChild(btn);
      });
      this._el = el;
      return el;
    }
    onRemove() {
      this._el.remove();
      this._map = undefined;
    }
  }

  function setBasemap(key) {
    if (key === currentBasemap || !BASEMAPS[key]) return;
    currentBasemap = key;
    map.setStyle(BASEMAPS[key], { diff: false });
    document.querySelectorAll('.basemap-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.basemap === key);
    });
  }

  function addDataLayers() {
    map.addSource('route', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 8, 3.2, 14, 5],
        'line-opacity': 0.9,
      },
    });

    map.addSource('visits', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'visit-glow',
      type: 'circle',
      source: 'visits',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 10, 12],
        'circle-color': '#5eead4',
        'circle-opacity': 0.18,
        'circle-blur': 0.9,
      },
    });
    map.addLayer({
      id: 'visit-point',
      type: 'circle',
      source: 'visits',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 6.5],
        'circle-color': '#5eead4',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#06110f',
      },
    });
  }

  function initMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: BASEMAPS[currentBasemap],
      center: [-96, 56],
      zoom: 3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new BasemapControl(), 'top-right');

    map.on('click', 'visit-point', (e) => {
      const f = e.features[0];
      showVisitPopup({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        start: Number(f.properties.start),
        end: Number(f.properties.end),
        type: f.properties.type,
        name: f.properties.name || null,
        photo: f.properties.photo || null,
      });
    });
    map.on('mouseenter', 'visit-point', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'visit-point', () => (map.getCanvas().style.cursor = ''));

    map.on('style.load', () => {
      addDataLayers();
      if (mapFullyLoaded && tripData) restoreMapData();
    });

    map.on('load', () => {
      mapFullyLoaded = true;
      $('loadingScreen').classList.add('hidden');
      if (tripData) renderRoute();
    });
  }

  function emptyFC() {
    return { type: 'FeatureCollection', features: [] };
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function googleMapsUrl(v) {
    if (v.placeId) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.name || '')}&query_place_id=${encodeURIComponent(v.placeId)}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`;
  }

  function showVisitPopup(v) {
    const label = v.name || VISIT_TYPE_LABELS[v.type] || v.type;
    const photoHtml = v.photo
      ? `<img class="popup-photo" src="${escapeHtml(v.photo)}" alt="${escapeHtml(label)}">`
      : '';
    const mapsUrl = googleMapsUrl(v);
    popup
      .setLngLat([v.lng, v.lat])
      .setHTML(`
        ${photoHtml}
        <div class="popup-title"><a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></div>
        <div class="popup-row">${fmtTime(v.start)} – ${fmtTime(v.end)} (${fmtDuration(v.start, v.end)})</div>
        <div class="popup-row">${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}</div>
      `)
      .addTo(map);
  }

  function pointsToRouteFeatures(points) {
    // points: [lat, lng, epoch, mode] sorted by time.
    // Break into contiguous runs by mode, and break on large time gaps.
    const features = [];
    if (points.length === 0) return features;

    const GAP_MS = 30 * 60 * 1000; // 30 min gap => new segment
    let currentMode = points[0][3];
    let coords = [[points[0][1], points[0][0]]];
    let lastTime = points[0][2];

    const flush = () => {
      if (coords.length > 1) {
        features.push({
          type: 'Feature',
          properties: { mode: currentMode, color: MODE_COLORS[currentMode] || MODE_COLORS[0] },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
    };

    for (let i = 1; i < points.length; i++) {
      const [lat, lng, t, mode] = points[i];
      const gap = t - lastTime;
      if (mode !== currentMode || gap > GAP_MS) {
        flush();
        coords = [coords[coords.length - 1]]; // bridge from last point for visual continuity
        currentMode = mode;
      }
      coords.push([lng, lat]);
      lastTime = t;
    }
    flush();
    return features;
  }

  function visitsToFeatures(visits) {
    return dedupeVisits(visits).map((v) => ({
      type: 'Feature',
      properties: { type: v.type, start: v.start, end: v.end, placeId: v.placeId || '', name: v.name || '', photo: v.photo || '' },
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
    }));
  }

  function boundsOfPoints(points, visits) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const consider = (lat, lng) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };
    points.forEach((p) => consider(p[0], p[1]));
    visits.forEach((v) => consider(v.lat, v.lng));
    if (minLng === Infinity) return null;
    return [[minLng, minLat], [maxLng, maxLat]];
  }

  function currentSelectionData() {
    if (selectedDate) {
      const day = tripData.days[selectedDate];
      return { points: day.points, visits: day.visits };
    }
    return {
      points: tripData.dates.flatMap((d) => tripData.days[d].points),
      visits: tripData.dates.flatMap((d) => tripData.days[d].visits),
    };
  }

  function restoreMapData() {
    const { points, visits } = currentSelectionData();
    map.getSource('route').setData({ type: 'FeatureCollection', features: pointsToRouteFeatures(points) });
    map.getSource('visits').setData({ type: 'FeatureCollection', features: visitsToFeatures(visits) });
  }

  function renderRoute() {
    if (!map.isStyleLoaded() && !map.getSource('route')) return;

    const { points, visits } = currentSelectionData();

    map.getSource('route').setData({ type: 'FeatureCollection', features: pointsToRouteFeatures(points) });
    map.getSource('visits').setData({ type: 'FeatureCollection', features: visitsToFeatures(visits) });

    const bounds = selectedDate
      ? boundsOfPoints(points, visits)
      : tripData.bounds
        ? [[tripData.bounds[0], tripData.bounds[1]], [tripData.bounds[2], tripData.bounds[3]]]
        : boundsOfPoints(points, visits);

    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        duration: 900,
        maxZoom: selectedDate ? 13 : 6,
      });
    }
  }

  // ---------- Selection flow ----------

  function selectDate(dateStr) {
    selectedDate = selectedDate === dateStr ? null : dateStr;
    renderCalendar();
    renderSelectionPanel();
    renderRoute();
  }

  function clearSelection() {
    selectedDate = null;
    renderCalendar();
    renderSelectionPanel();
    renderRoute();
  }

  // ---------- Mobile sidebar ----------

  function initMobileSidebar() {
    const sidebar = $('sidebar');
    const toggleBtn = $('sidebarToggle');
    const closeBtn = $('sidebarClose');
    const scrim = $('sidebarScrim');
    const mobileQuery = window.matchMedia('(max-width: 700px)');

    function openSidebar() {
      sidebar.classList.add('open');
      scrim.classList.add('open');
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      scrim.classList.remove('open');
    }

    toggleBtn.addEventListener('click', openSidebar);
    closeBtn.addEventListener('click', closeSidebar);
    scrim.addEventListener('click', closeSidebar);

    sidebar.addEventListener('click', (e) => {
      if (!mobileQuery.matches) return;
      if (e.target.closest('.day-cell.has-data') || e.target.closest('.visit-card')) {
        closeSidebar();
      }
    });
  }

  // ---------- Init ----------

  async function init() {
    initMap();
    try {
      await loadData();
    } catch (err) {
      $('loadingScreen').innerHTML = `<span style="color:#fb7185">Failed to load timeline data.<br>${err.message}</span>`;
      return;
    }
    renderStats();
    initCalendarCursor();
    renderCalendar();
    renderSelectionPanel();

    $('prevMonth').addEventListener('click', () => changeMonth(-1));
    $('nextMonth').addEventListener('click', () => changeMonth(1));
    $('clearSelection').addEventListener('click', clearSelection);
    initMobileSidebar();

    if (mapFullyLoaded) {
      $('loadingScreen').classList.add('hidden');
      renderRoute();
    }
  }

  init();
})();
