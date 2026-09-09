/**
 * Bootstrap and wiring. Holds view state (filters, search, selection), derives
 * everything else from the store on each render, and pushes it to the map and DOM.
 */

import * as store from './store.js?v=4';
import * as mapView from './map.js?v=4';
import * as ui from './ui.js?v=4';
import { buildFacets, applyFilters, byCountry, averageRating, emptyFilters,
         hasActiveFilters, setCountryNameResolver, matchingCountries, countriesOf,
         FACETS } from './filters.js?v=4';
import { RATERS } from './raters.js?v=4';

const $ = (sel) => document.querySelector(sel);

const view = {
  filters: emptyFilters(),
  search: '',
  colorBy: 'count',
  mode: 'map',                        // 'map' | 'list'
  sort: { key: 'date', dir: 'desc' }, // list view; most recently tried first
  selected: null,
  countries: [],
};

/* ------------------------------------------------------------------ derive */

function derive() {
  const { coffees } = store.get();
  const filtering = hasActiveFilters(view.filters, view.search);
  const filtered = filtering ? applyFilters(coffees, view.filters, view.search) : coffees;

  // 'count' shades by volume, but the map still needs *some* score to fall back on.
  const scoreKey = view.colorBy === 'count' ? 'avg' : view.colorBy;
  const grouped = byCountry(coffees);
  const counts = new Map();
  const ratings = new Map();
  for (const [iso, list] of grouped) {
    counts.set(iso, list.length);
    const avg = averageRating(list, scoreKey);
    if (avg != null) ratings.set(iso, avg);
  }

  let matched = null;
  if (filtering) {
    // A blend lights up only the origin responsible for the match: filtering on
    // "Gesha" highlights the country that grew the Gesha, not its washed partner.
    matched = new Set();
    for (const c of filtered) for (const iso of matchingCountries(c, view.filters)) matched.add(iso);
  }
  const matchedIds = new Set(filtered.map((c) => c.id));
  const matchedValues = new Set();
  for (const facet of FACETS) for (const v of view.filters[facet.key]) matchedValues.add(v);

  return { coffees, filtered, filtering, grouped, counts, ratings, matched, matchedIds, matchedValues };
}

/* ------------------------------------------------------------------ render */

function render() {
  const d = derive();

  const listMode = view.mode === 'list';
  $('#map-wrap').hidden   = listMode;
  $('#list-wrap').hidden  = !listMode;
  $('#colorby-wrap').hidden = listMode;      // shading is a map-only idea
  $('#btn-view-map').setAttribute('aria-pressed', String(!listMode));
  $('#btn-view-list').setAttribute('aria-pressed', String(listMode));
  $('#panel').hidden = listMode || !view.selected;

  if (listMode) {
    ui.renderList({
      coffees: d.filtered, sort: view.sort, total: d.coffees.length, filtering: d.filtering,
      onSort: setSort, onEdit: editCoffee, onDelete: deleteCoffee, canEdit: true,
    });
  } else {
    mapView.render({
      counts: d.counts, ratings: d.ratings, matched: d.matched,
      colorBy: view.colorBy, selected: view.selected,
    });
  }

  // Facet counts are computed over the *unfiltered* list so chips never vanish
  // mid-selection, which would make the filter panel jump around under the cursor.
  ui.renderFacets($('#facets'), buildFacets(d.coffees), view.filters, toggleFilter);
  $('#sidebar-empty').hidden = d.coffees.length > 0;

  const status = $('#filter-status');
  status.hidden = !d.filtering;
  if (d.filtering) {
    const countries = d.matched.size;
    $('#filter-status-text').textContent =
      `${d.filtered.length} of ${d.coffees.length} coffee${d.coffees.length === 1 ? '' : 's'} · ` +
      `${countries} countr${countries === 1 ? 'y' : 'ies'}`;
  }

  const totalCountries = d.grouped.size;
  $('#summary').textContent = d.coffees.length
    ? `${d.coffees.length} coffee${d.coffees.length === 1 ? '' : 's'} · ${totalCountries} countr${totalCountries === 1 ? 'y' : 'ies'}`
    : 'No coffees logged yet';

  ui.renderLegend({ colorBy: view.colorBy, filtering: d.filtering, total: d.coffees.length });

  if (view.selected) {
    ui.renderPanel({
      iso: view.selected,
      name: mapView.countryName(view.selected),
      coffees: d.grouped.get(view.selected) || [],
      matchedIds: d.matchedIds,
      matchedValues: d.matchedValues,
      filtering: d.filtering,
      canEdit: true,
      onEdit: (coffee) => editCoffee(coffee),
      onDelete: (coffee) => deleteCoffee(coffee),
    });
  }

  renderSyncState();
}

function renderSyncState() {
  const { status, statusText, config, dirty } = store.get();
  const dot = $('#sync-dot');
  dot.dataset.state = status;
  dot.title = statusText || status;

  const syncing = store.isSyncing();
  $('#sync-summary').textContent = syncing
    ? (dirty ? 'Connected, with local edits waiting to push.' : `Syncing with ${config.repo}. Every save is a commit.`)
    : 'Not connected. Coffees are saved in this browser only — add a token below to sync across devices.';
  const n = store.get().coffees.length;
  $('#data-count').textContent = `${n} coffee${n === 1 ? '' : 's'}`;

  const samples = store.get().coffees.filter((c) => c.sample).length;
  const clearBtn = $('#btn-clear-samples');
  clearBtn.hidden = samples === 0;
  clearBtn.textContent = `Clear ${samples} sample coffee${samples === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ view */

function setMode(mode) {
  if (view.mode === mode) return;
  view.mode = mode;
  render();
  // Leaflet measures itself on show; without this it renders into a stale size.
  if (mode === 'map') mapView.invalidate();
}

/** Re-clicking a column flips it. A fresh column starts descending for scores and
 *  dates (best and newest first) and ascending for text, which is what people expect. */
function setSort(key) {
  view.sort = view.sort.key === key
    ? { key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: (key === 'date' || key.startsWith('rating:')) ? 'desc' : 'asc' };
  render();
}

/* ------------------------------------------------------------------ filters */

function toggleFilter(key, value) {
  const set = view.filters[key];
  if (set.has(value)) set.delete(value); else set.add(value);
  render();
}

function clearFilters() {
  view.filters = emptyFilters();
  view.search = '';
  $('#search').value = '';
  render();
}

/* ------------------------------------------------------------------ panel */

function openCountry(iso) {
  view.selected = iso;
  $('#panel').hidden = false;
  closeSheet();
  render();
  mapView.invalidate();
}

function closePanel() {
  view.selected = null;
  $('#panel').hidden = true;
  render();
  mapView.invalidate();
}

/* ------------------------------------------------------------------ edits */

function suggestions() { return ui.buildSuggestions(store.get().coffees); }

function addCoffee(countryIso) {
  ui.openCoffeeForm({
    coffee: null,
    countryIso,
    countries: view.countries,
    suggestions: suggestions(),
    onSave: (draft) => commit(
      store.upsert(stamp({ ...draft, id: store.newId(), createdAt: new Date().toISOString() })),
      `Add ${draft.name} (${isoLabel(draft)})`,
      () => { view.selected = countriesOf(draft)[0] || view.selected; $('#panel').hidden = false; },
    ),
    onDelete: () => {},
  });
}

function editCoffee(coffee) {
  ui.openCoffeeForm({
    coffee,
    countryIso: countriesOf(coffee)[0] || '',
    countries: view.countries,
    suggestions: suggestions(),
    onSave: (draft) => commit(
      store.upsert(stamp(draft)),
      `Update ${draft.name} (${isoLabel(draft)})`,
      () => {
        // Keep the panel on a country the coffee still belongs to.
        const origins = countriesOf(draft);
        if (!origins.includes(view.selected)) view.selected = origins[0] || view.selected;
      },
    ),
    onDelete: (c) => deleteCoffee(c),
  });
}

function deleteCoffee(coffee) {
  if (!confirm(`Delete "${coffee.name}"? This commits the removal, so you can still recover it from the repo history.`)) return;
  commit(store.remove(coffee.id), `Remove ${coffee.name} (${isoLabel(coffee)})`);
}

const stamp = (c) => ({ ...c, updatedAt: new Date().toISOString() });

/** "ETH+COL" for a blend, so the commit log stays readable at a glance. */
const isoLabel = (c) => countriesOf(c).join('+') || '??';

/** Apply a store operation, then reflect the outcome in the UI. */
async function commit(operation, message, before) {
  if (before) before();
  render();
  const result = await store.applyChange(operation, message);
  render();

  if (result.ok && result.mode === 'sync') ui.toast('Saved to GitHub');
  else if (result.ok) ui.toast('Saved on this device');
  else {
    ui.toast(result.error.message, {
      kind: 'bad',
      actionLabel: 'Retry',
      action: async () => {
        const retry = await store.retryPush();
        render();
        ui.toast(retry.ok ? 'Saved to GitHub' : 'Still failing — check Settings', { kind: retry.ok ? '' : 'bad' });
      },
    });
  }
}

/* ------------------------------------------------------------------ settings */

function openSettings() {
  const { config } = store.get();
  $('#f-repo').value = config.repo;
  $('#f-token').value = config.token;
  $('#test-result').hidden = true;
  $('#import-result').hidden = true;
  renderSyncState();
  $('#dlg-settings').showModal();
}

function showResult(sel, message, ok) {
  const el = $(sel);
  el.textContent = message;
  el.className = `test-result ${ok ? 'ok' : 'bad'}`;
  el.hidden = false;
}

async function testConnection() {
  const btn = $('#btn-test');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    const info = await store.testConnection({ repo: $('#f-repo').value, token: $('#f-token').value });
    showResult('#test-result',
      `Connected to ${info.fullName}. ` +
      (info.fileExists ? 'Found the existing coffee list.' : 'No coffee list there yet — the first save will create it.'),
      true);
  } catch (err) {
    showResult('#test-result', err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test connection';
  }
}

async function saveSettings() {
  store.saveConfig({ repo: $('#f-repo').value.trim(), token: $('#f-token').value.trim() });
  const hadLocalEdits = store.get().dirty;
  await store.load();
  render();

  if (store.isSyncing() && hadLocalEdits) {
    const result = await store.retryPush();
    render();
    ui.toast(result.ok ? 'Local coffees pushed to GitHub' : result.error.message,
             { kind: result.ok ? '' : 'bad' });
  } else {
    ui.toast(store.isSyncing() ? 'Connected' : 'Saved on this device only');
  }
  $('#dlg-settings').close();
}

/* ------------------------------------------------------------------ transfer */

function exportJson() {
  const blob = new Blob([store.exportText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coffees-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importJson(file) {
  try {
    const incoming = store.parseImport(await file.text());
    const existing = store.get().coffees;
    const replace = existing.length === 0 || confirm(
      `Import ${incoming.length} coffees.\n\nOK = merge with the ${existing.length} already here.\n` +
      `Cancel = replace them entirely.`);

    const merged = replace
      ? [...new Map([...existing, ...incoming].map((c) => [c.id, c])).values()]
      : incoming;

    await commit(store.replaceAll(merged), `Import ${incoming.length} coffees`);
    showResult('#import-result', `Imported. Now holding ${merged.length} coffees.`, true);
  } catch (err) {
    showResult('#import-result', `Could not import: ${err.message}`, false);
  }
}

/* ------------------------------------------------------------------ sheets */

function openSheet() {
  $('#sidebar').dataset.open = 'true';
  $('#scrim').hidden = false;
}
function closeSheet() {
  $('#sidebar').dataset.open = 'false';
  $('#scrim').hidden = true;
}
const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

/* ------------------------------------------------------------------ wiring */

function wire() {
  $('#search').addEventListener('input', (e) => { view.search = e.target.value; render(); });
  $('#btn-clear-filters').addEventListener('click', clearFilters);
  $('#color-by').addEventListener('change', (e) => { view.colorBy = e.target.value; render(); });

  $('#btn-close-panel').addEventListener('click', closePanel);
  $('#btn-add-here').addEventListener('click', () => addCoffee(view.selected));

  // A global add matters for the island origins that have no polygon to click:
  // their marker only appears once they have a coffee, so the panel route can't
  // reach them for a first entry.
  $('#btn-add').addEventListener('click', () => addCoffee(view.selected));

  $('#btn-view-map').addEventListener('click', () => setMode('map'));
  $('#btn-view-list').addEventListener('click', () => setMode('list'));

  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', () => $('#dlg-settings').close());
  $('#btn-test').addEventListener('click', testConnection);
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-forget-token').addEventListener('click', () => {
    store.forgetToken();
    $('#f-token').value = '';
    renderSyncState();
    ui.toast('Token removed from this browser');
  });

  $('#btn-clear-samples').addEventListener('click', async () => {
    const n = store.get().coffees.filter((c) => c.sample).length;
    if (!confirm(`Remove the ${n} example coffees that shipped with the app?`)) return;
    $('#dlg-settings').close();
    await commit((list) => list.filter((c) => !c.sample), 'Clear sample data');
  });

  $('#btn-export').addEventListener('click', exportJson);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  $('#btn-facets').addEventListener('click', () =>
    ($('#sidebar').dataset.open === 'true' ? closeSheet() : openSheet()));
  $('#scrim').addEventListener('click', closeSheet);
  $('#sidebar .sheet-grip').addEventListener('click', closeSheet);
  $('#panel .sheet-grip').addEventListener('click', closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); if (view.selected) closePanel(); }
    // "/" focuses search, the way it does in most map and list apps.
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      if (isMobile()) openSheet();
      $('#search').focus();
    }
  });

  store.subscribe(renderSyncState);
}

/** Shade-by options come from the rater roster, so a third person needs no markup. */
function fillColorBy() {
  $('#color-by').innerHTML =
    '<option value="count">Number tried</option>' +
    RATERS.map((r) => `<option value="${r.id}">${r.label} rating</option>`).join('') +
    (RATERS.length > 1 ? '<option value="avg">Combined rating</option>' : '');
}

/* ------------------------------------------------------------------ start */

async function start() {
  wire();
  try {
    await mapView.initMap({ onCountryClick: openCountry });
  } catch (err) {
    ui.toast(`Map failed to load: ${err.message}`, { kind: 'bad', duration: 10000 });
    return;
  }
  view.countries = mapView.countryOptions();
  // Lets the search box match "Ethiopia" as well as the stored "ETH".
  setCountryNameResolver(mapView.countryName);

  // Browsers restore form controls on reload without firing change/input, so read
  // the rendered values rather than assuming the defaults still hold.
  fillColorBy();
  view.colorBy = $('#color-by').value || 'count';
  view.search = $('#search').value || '';

  await store.load();
  render();

  const { status, statusText } = store.get();
  if (status === 'error') {
    ui.toast(statusText, { kind: 'bad', actionLabel: 'Settings', action: openSettings });
  }
}

start();
