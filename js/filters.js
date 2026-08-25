/**
 * Facet index and filtering.
 *
 * A coffee is a cup you drank; a *component* is one origin that went into it.
 * Single-origin coffees have exactly one. Blends have several, and their
 * attributes travel together — the Gesha half is the natural one, the Caturra
 * half is the washed one.
 *
 * Semantics: values within one facet are OR'd, and facets are AND'd. Crucially,
 * component-scoped facets must be satisfied by a *single shared component*, so
 * "Gesha" + "Washed" matches a blend only if one of its origins is both. A flat
 * model would report that blend as a washed Gesha, which it never was.
 */

/** `scope` decides what a facet reads from, and how the AND above is evaluated.
 *  'coffee'    — properties of the cup as drunk (you rate and taste the blend).
 *  'component' — properties of one origin (varieties, process, place). */
export const FACETS = [
  { key: 'variety',     label: 'Variety',      scope: 'component', values: (x) => x.variety },
  { key: 'process',     label: 'Process',      scope: 'component', values: (x) => (x.process ? [x.process] : []) },
  { key: 'region',      label: 'Region',       scope: 'component', values: (x) => (x.region ? [x.region] : []) },
  { key: 'producer',    label: 'Producer',     scope: 'component', values: (x) => (x.producer ? [x.producer] : []) },
  { key: 'roaster',     label: 'Roaster',      scope: 'coffee',    values: (c) => (c.roaster ? [c.roaster] : []) },
  { key: 'flavorNotes', label: 'Flavour note', scope: 'coffee',    values: (c) => c.flavorNotes },
  { key: 'rating',      label: 'Rating',       scope: 'coffee',    values: (c) => (c.rating ? [`${c.rating}`] : []) },
  { key: 'year',        label: 'Year tried',   scope: 'coffee',    values: (c) => (c.dateTried ? [c.dateTried.slice(0, 4)] : []) },
];

const COMPONENT_FACETS = FACETS.filter((f) => f.scope === 'component');
const COFFEE_FACETS    = FACETS.filter((f) => f.scope === 'coffee');

export function emptyFilters() {
  return Object.fromEntries(FACETS.map((f) => [f.key, new Set()]));
}

export function countActive(filters) {
  return FACETS.reduce((n, f) => n + (filters[f.key] ? filters[f.key].size : 0), 0);
}

export function hasActiveFilters(filters, search) {
  return countActive(filters) > 0 || Boolean(search && search.trim());
}

const active = (filters) => (facet) => filters[facet.key] && filters[facet.key].size > 0;

/* ------------------------------------------------------------------ values */

export const components = (coffee) =>
  (Array.isArray(coffee.components) ? coffee.components : []);

/** Every value a coffee contributes to a facet, deduped. A blend whose two
 *  origins are both washed still counts once towards "Washed". */
export function valuesOf(facet, coffee) {
  if (facet.scope === 'coffee') return [...new Set(facet.values(coffee))];
  const out = new Set();
  for (const comp of components(coffee)) for (const v of facet.values(comp)) out.add(v);
  return [...out];
}

/** ISO3 codes this coffee draws on, deduped and in component order. */
export const countriesOf = (coffee) =>
  [...new Set(components(coffee).map((c) => c.country).filter(Boolean))];

export const isBlend = (coffee) => countriesOf(coffee).length > 1 || components(coffee).length > 1;

/* ------------------------------------------------------------------ index */

/**
 * Value counts per facet, computed over the given list. Counts reflect the
 * currently visible set, so they tell you how much each chip would narrow things.
 */
export function buildFacets(coffees) {
  return FACETS.map((facet) => {
    const counts = new Map();
    for (const coffee of coffees) {
      for (const value of valuesOf(facet, coffee)) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    const values = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || collate(a.value, b.value));
    // Ratings and years read better in numeric order than by popularity.
    if (facet.key === 'rating') values.sort((a, b) => Number(b.value) - Number(a.value));
    if (facet.key === 'year')   values.sort((a, b) => Number(b.value) - Number(a.value));
    return { ...facet, values };
  }).filter((f) => f.values.length > 0);
}

const collate = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/* ------------------------------------------------------------------ match */

/* Coffees store an ISO code, but people search for "Panama", not "PAN". The map
   module owns the code-to-name table, so it injects a resolver at startup. */
let resolveCountryName = () => '';
export function setCountryNameResolver(fn) {
  resolveCountryName = fn;
  blobVersion += 1;          // invalidate any blobs built before the names existed
}
export const countryNameOf = (iso) => resolveCountryName(iso) || iso || '';

let blobVersion = 0;

function searchBlob(coffee) {
  if (coffee._blob === undefined || coffee._blobVersion !== blobVersion) {
    const parts = [coffee.name, coffee.roaster, coffee.notes, coffee.dateTried, ...coffee.flavorNotes];
    for (const comp of components(coffee)) {
      parts.push(comp.region, comp.producer, comp.process, comp.country,
                 resolveCountryName(comp.country), ...comp.variety);
    }
    define(coffee, '_blob', parts.filter(Boolean).join(' ').toLowerCase());
    define(coffee, '_blobVersion', blobVersion);
  }
  return coffee._blob;
}

const define = (obj, key, value) =>
  Object.defineProperty(obj, key, { value, enumerable: false, configurable: true, writable: true });

/** Does one component satisfy every active component-scoped facet? */
const componentSatisfies = (comp, facets, filters) =>
  facets.every((f) => f.values(comp).some((v) => filters[f.key].has(v)));

export function matches(coffee, filters, search) {
  for (const facet of COFFEE_FACETS) {
    if (!active(filters)(facet)) continue;
    if (!facet.values(coffee).some((v) => filters[facet.key].has(v))) return false;
  }

  // All active component facets must land on the *same* component.
  const compFacets = COMPONENT_FACETS.filter(active(filters));
  if (compFacets.length &&
      !components(coffee).some((comp) => componentSatisfies(comp, compFacets, filters))) {
    return false;
  }

  const q = (search || '').trim().toLowerCase();
  if (!q) return true;
  // Every whitespace-separated term must appear somewhere, so "gesha washed" narrows.
  return q.split(/\s+/).every((term) => searchBlob(coffee).includes(term));
}

export function applyFilters(coffees, filters, search) {
  return coffees.filter((c) => matches(c, filters, search));
}

/**
 * Which of a coffee's countries actually caused the match. Filtering on "Gesha"
 * lights up only the origin that grew the Gesha, not every country in the blend.
 * With no component facets active, that's all of them.
 */
export function matchingCountries(coffee, filters) {
  const compFacets = COMPONENT_FACETS.filter(active(filters));
  const out = new Set();
  for (const comp of components(coffee)) {
    if (!comp.country) continue;
    if (componentSatisfies(comp, compFacets, filters)) out.add(comp.country);
  }
  return out;
}

/* ------------------------------------------------------------------ group */

/** ISO3 -> coffees, in a stable display order (most recently tried first).
 *  A blend is listed under each of its origins. */
export function byCountry(coffees) {
  const map = new Map();
  for (const coffee of coffees) {
    for (const iso of countriesOf(coffee)) {
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso).push(coffee);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.dateTried || '').localeCompare(a.dateTried || '')
                     || collate(a.name, b.name));
  }
  return map;
}

export function averageRating(coffees) {
  const rated = coffees.filter((c) => typeof c.rating === 'number' && !Number.isNaN(c.rating));
  if (!rated.length) return null;
  return rated.reduce((sum, c) => sum + c.rating, 0) / rated.length;
}
