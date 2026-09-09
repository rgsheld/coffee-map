/**
 * The map: country polygons, choropleth shading, and filter highlighting.
 *
 * No tile layer by design — just polygons on a flat ocean. That keeps the page
 * free of third-party requests at runtime, works offline, and is quick on a phone.
 */

const GEO_PATH = 'data/countries.geo.json';

/**
 * The 180-feature world file omits four small island producers. Rather than
 * special-casing them, any country that has coffees but no polygon is drawn as a
 * circle marker that behaves identically on click, hover, shading and highlight.
 */
const ORIGIN_FALLBACKS = {
  STP: { name: 'São Tomé and Príncipe', lat: 0.24,   lng: 6.61   },
  COM: { name: 'Comoros',               lat: -11.65, lng: 43.33  },
  MUS: { name: 'Mauritius',             lat: -20.28, lng: 57.55  },
  CPV: { name: 'Cabo Verde',            lat: 15.12,  lng: -23.61 },
};

const RAMP = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];
const WORLD_BOUNDS = [[-56, -168], [75, 178]];

let map = null;
let geoLayer = null;
let markerLayer = null;
const markers = new Map();          // iso3 -> circleMarker
const names = new Map();            // iso3 -> display name
let view = { counts: new Map(), matched: null, colorBy: 'count', selected: null, ratings: new Map() };
let onSelect = () => {};

const css = (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();

/* On a touch screen there is no hover to end a tooltip, so tapping a country
   leaves the label stranded on the map. Tapping already opens the panel, which
   says more than the tooltip would. */
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ------------------------------------------------------------------ setup */

export async function initMap({ onCountryClick }) {
  onSelect = onCountryClick;

  const container = document.getElementById('map');

  // An explicit starting view matters: without one, Leaflet can measure the
  // container before layout settles, cache a 0x0 size, and then compute a
  // fitBounds zoom of maxZoom instead of whole-world.
  map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: false,
    center: [15, 0],
    zoom: 2,
    minZoom: 1,
    maxZoom: 7,
    maxBoundsViscosity: 0.75,
    scrollWheelZoom: true,
  });

  const res = await fetch(GEO_PATH);
  if (!res.ok) throw new Error(`Could not load ${GEO_PATH} (${res.status})`);
  const geo = await res.json();

  for (const f of geo.features) names.set(f.id, f.properties.name);
  for (const [iso, meta] of Object.entries(ORIGIN_FALLBACKS)) {
    if (!names.has(iso)) names.set(iso, meta.name);
  }

  geoLayer = L.geoJSON(geo, {
    style: () => baseStyle(),
    onEachFeature: (feature, layer) => {
      layer.on({
        click: () => onSelect(feature.id),
        mouseover: (e) => hoverOn(e.target, feature.id),
        mouseout: (e) => hoverOff(e.target, feature.id),
      });
      if (canHover) {
        layer.bindTooltip(() => tooltipHtml(feature.id), {
          sticky: true, direction: 'top', className: 'country-tip', opacity: 1,
        });
      }
    },
  }).addTo(map);

  // Stamp the ISO code onto each rendered path. Handy when debugging, and it
  // makes a country addressable from CSS or a test without a lookup table.
  geoLayer.eachLayer((layer) => {
    const el = layer.getElement ? layer.getElement() : layer._path;
    if (el) el.setAttribute('data-iso', layer.feature.id);
  });

  markerLayer = L.layerGroup().addTo(map);

  // Fit once the container actually has a size, and re-measure whenever it
  // changes -- which also covers the detail panel opening and closing.
  let fitted = false;
  const fitWorld = () => {
    map.invalidateSize();
    // The inhabited world; the poles are wasted pixels, especially on a phone.
    map.fitBounds(WORLD_BOUNDS, { padding: [6, 6], animate: false });
    // Stop people zooming out past the whole world into grey nothing.
    map.setMinZoom(map.getZoom());
    map.setMaxBounds(L.latLngBounds(WORLD_BOUNDS).pad(0.25));
  };

  const observer = new ResizeObserver(() => {
    map.invalidateSize();
    if (!fitted && container.clientWidth > 0 && container.clientHeight > 0) {
      fitted = true;
      fitWorld();
    }
  });
  observer.observe(container);

  if (container.clientWidth > 0 && container.clientHeight > 0) {
    fitted = true;
    fitWorld();
  }

  return { countryNames: names };
}

/* ------------------------------------------------------------------ styling */

function baseStyle() {
  return {
    weight: 0.6, color: css('--land-stroke'), opacity: 1,
    fillColor: css('--land-empty'), fillOpacity: 1,
  };
}

/** Bucket a value onto the ramp. Counts use a compressed scale so one coffee is
 *  already clearly visible and a favourite origin still stands out at the top. */
function shadeFor(iso) {
  const count = view.counts.get(iso) || 0;
  if (!count) return null;
  if (view.colorBy !== 'count') {
    const avg = view.ratings.get(iso);
    // Nobody has scored it *as this rater*. Painting it --c1 would be a lie: it
    // would read as a genuine 1-star average rather than an absent opinion.
    if (avg == null) return css('--no-score');
    const idx = Math.min(RAMP.length - 1, Math.max(0, Math.round((avg - 1) / 4 * (RAMP.length - 1))));
    return css(RAMP[idx]);
  }
  const idx = count >= 12 ? 5 : count >= 8 ? 4 : count >= 5 ? 3 : count >= 3 ? 2 : count >= 2 ? 1 : 0;
  return css(RAMP[idx]);
}

function styleFor(iso) {
  const style = baseStyle();
  const fill = shadeFor(iso);
  const highlighting = view.matched !== null;
  const isMatch = highlighting && view.matched.has(iso);

  if (highlighting) {
    if (isMatch) {
      style.fillColor = css('--hi');
      style.fillOpacity = 1;
      style.color = css('--text');
      style.weight = 1.4;
    } else {
      // Dim rather than hide: the matches should dominate, but the surrounding
      // world still has to read as a map or the highlight loses its context.
      style.fillColor = fill || css('--land-empty');
      style.fillOpacity = 0.4;
      style.opacity = 0.55;
    }
  } else if (fill) {
    style.fillColor = fill;
    style.weight = 0.8;
  }

  if (iso === view.selected) {
    style.color = css('--accent');
    style.weight = 2.4;
  }
  return style;
}

function hoverOn(layer, iso) {
  if (!(view.counts.get(iso) || iso === view.selected)) {
    layer.setStyle({ fillColor: css('--accent-soft') });
  }
  layer.setStyle({ weight: 2, color: css('--accent') });
  if (layer.bringToFront) layer.bringToFront();
}

function hoverOff(layer, iso) {
  layer.setStyle(styleFor(iso));
}

function tooltipHtml(iso) {
  const name = names.get(iso) || iso;
  const count = view.counts.get(iso) || 0;
  const matching = view.matched !== null && view.matched.has(iso);
  let sub;
  if (!count) sub = 'none tried yet';
  else if (matching) sub = `${count} tried · matches filter`;
  else sub = `${count} coffee${count === 1 ? '' : 's'}`;
  return `${escapeHtml(name)} <span class="tip-sub">— ${sub}</span>`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ------------------------------------------------------------------ render */

/**
 * @param counts   Map<iso3, number>  all coffees per country (drives shading)
 * @param ratings  Map<iso3, number>  average rating per country
 * @param matched  Set<iso3>|null     countries matching the active filter, or null when idle
 */
export function render({ counts, ratings, matched, colorBy, selected }) {
  view = { counts, ratings, matched, colorBy, selected };
  if (geoLayer) geoLayer.setStyle((feature) => styleFor(feature.id));
  renderFallbackMarkers();
}

/** Draw circle markers for any origin with coffees but no polygon in the file. */
function renderFallbackMarkers() {
  if (!markerLayer) return;
  const needed = new Set();
  for (const iso of view.counts.keys()) {
    if (!names.has(iso)) continue;
    if (ORIGIN_FALLBACKS[iso]) needed.add(iso);
  }
  if (view.selected && ORIGIN_FALLBACKS[view.selected]) needed.add(view.selected);

  for (const [iso, marker] of markers) {
    if (!needed.has(iso)) { markerLayer.removeLayer(marker); markers.delete(iso); }
  }

  for (const iso of needed) {
    const meta = ORIGIN_FALLBACKS[iso];
    let marker = markers.get(iso);
    if (!marker) {
      marker = L.circleMarker([meta.lat, meta.lng], { radius: 7, weight: 1.5 });
      marker.on('click', () => onSelect(iso));
      if (canHover) {
        marker.bindTooltip(() => tooltipHtml(iso), {
          direction: 'top', className: 'country-tip', opacity: 1,
        });
      }
      marker.addTo(markerLayer);
      markers.set(iso, marker);
    }
    const style = styleFor(iso);
    marker.setStyle({ ...style, fillOpacity: Math.max(style.fillOpacity, 0.85) });
  }
}

/* ------------------------------------------------------------------ helpers */

export function focusCountry(iso) {
  if (!map) return;
  if (ORIGIN_FALLBACKS[iso]) {
    map.flyTo([ORIGIN_FALLBACKS[iso].lat, ORIGIN_FALLBACKS[iso].lng], 5, { duration: 0.5 });
    return;
  }
  const layer = findLayer(iso);
  if (layer) map.flyToBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 5, duration: 0.5 });
}

function findLayer(iso) {
  let found = null;
  geoLayer.eachLayer((layer) => { if (layer.feature && layer.feature.id === iso) found = layer; });
  return found;
}

export function countryName(iso) { return names.get(iso) || iso; }

/** All selectable origins, name-sorted, for the form's country dropdown. */
export function countryOptions() {
  return [...names.entries()]
    .map(([iso, name]) => ({ iso, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The ResizeObserver above handles layout changes; this is just a nudge for
 *  transitions that finish after the size has already settled. */
export function invalidate() { if (map) setTimeout(() => map.invalidateSize(), 240); }
