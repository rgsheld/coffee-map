/**
 * Facet index and filtering.
 *
 * Semantics: values selected *within* one facet are OR'd, and facets are AND'd
 * together. So "Gesha" alone answers "everywhere I've had a Gesha", and adding
 * "Natural" narrows it to naturally-processed Geshas rather than widening it.
 */

/** Each facet declares how to pull its values off a coffee. Array-valued fields
 *  (variety, flavour notes) contribute every entry, which is what makes a blend
 *  show up under both of its varieties. */
export const FACETS = [
  { key: 'variety',     label: 'Variety',      values: (c) => c.variety },
  { key: 'process',     label: 'Process',      values: (c) => (c.process ? [c.process] : []) },
  { key: 'roaster',     label: 'Roaster',      values: (c) => (c.roaster ? [c.roaster] : []) },
  { key: 'flavorNotes', label: 'Flavour note', values: (c) => c.flavorNotes },
  { key: 'region',      label: 'Region',       values: (c) => (c.region ? [c.region] : []) },
  { key: 'rating',      label: 'Rating',       values: (c) => (c.rating ? [`${c.rating}`] : []) },
  { key: 'year',        label: 'Year tried',   values: (c) => (c.dateTried ? [c.dateTried.slice(0, 4)] : []) },
];

export function emptyFilters() {
  return Object.fromEntries(FACETS.map((f) => [f.key, new Set()]));
}

export function countActive(filters) {
  return FACETS.reduce((n, f) => n + (filters[f.key] ? filters[f.key].size : 0), 0);
}

export function hasActiveFilters(filters, search) {
  return countActive(filters) > 0 || Boolean(search && search.trim());
}

/* ------------------------------------------------------------------ index */

/**
 * Value counts per facet, computed over the given list. Counts reflect the
 * currently visible set, so they tell you how much each chip would narrow things.
 */
export function buildFacets(coffees) {
  return FACETS.map((facet) => {
    const counts = new Map();
    for (const coffee of coffees) {
      for (const value of facet.values(coffee)) {
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

let blobVersion = 0;

function searchBlob(coffee) {
  if (coffee._blob === undefined || coffee._blobVersion !== blobVersion) {
    define(coffee, '_blob', [
      coffee.name, coffee.region, coffee.process, coffee.roaster, coffee.notes,
      coffee.country, resolveCountryName(coffee.country), coffee.dateTried,
      ...coffee.variety, ...coffee.flavorNotes,
    ].join(' ').toLowerCase());
    define(coffee, '_blobVersion', blobVersion);
  }
  return coffee._blob;
}

const define = (obj, key, value) =>
  Object.defineProperty(obj, key, { value, enumerable: false, configurable: true, writable: true });

export function matches(coffee, filters, search) {
  for (const facet of FACETS) {
    const selected = filters[facet.key];
    if (!selected || selected.size === 0) continue;
    const values = facet.values(coffee);
    if (!values.some((v) => selected.has(v))) return false;   // AND across facets
  }
  const q = (search || '').trim().toLowerCase();
  if (!q) return true;
  // Every whitespace-separated term must appear somewhere, so "gesha washed" narrows.
  return q.split(/\s+/).every((term) => searchBlob(coffee).includes(term));
}

export function applyFilters(coffees, filters, search) {
  return coffees.filter((c) => matches(c, filters, search));
}

/* ------------------------------------------------------------------ group */

/** ISO3 -> coffees, in a stable display order (most recently tried first). */
export function byCountry(coffees) {
  const map = new Map();
  for (const coffee of coffees) {
    if (!coffee.country) continue;
    if (!map.has(coffee.country)) map.set(coffee.country, []);
    map.get(coffee.country).push(coffee);
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
