/**
 * DOM rendering: facet chips, the country panel, the coffee form, settings, toasts.
 * This module knows nothing about GitHub — it takes data and callbacks.
 */

import { FACETS, averageRating, components, countryNameOf, countriesOf,
         isRatingFacet } from './filters.js?v=4';
import { RATERS, scoreOf, raterLabel } from './raters.js?v=4';

const $ = (sel, root = document) => root.querySelector(sel);
const CHIP_LIMIT = 10;          // collapse long facets; roasters especially

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ------------------------------------------------------------------ facets */

const expanded = new Set();
const collapsed = new Set();

export function renderFacets(container, facets, filters, onToggle) {
  container.innerHTML = '';

  for (const facet of facets) {
    const selected = filters[facet.key] || new Set();
    const isOpen = !collapsed.has(facet.key);
    const showAll = expanded.has(facet.key);
    const shown = showAll ? facet.values : facet.values.slice(0, CHIP_LIMIT);

    const section = document.createElement('section');
    section.className = 'facet';
    section.dataset.open = String(isOpen);

    const head = document.createElement('button');
    head.className = 'facet-head';
    head.type = 'button';
    head.setAttribute('aria-expanded', String(isOpen));
    head.innerHTML =
      `<span class="caret" aria-hidden="true">&#9660;</span>${escapeHtml(facet.label)}` +
      `<span class="n">${selected.size ? `${selected.size} selected` : facet.values.length}</span>`;
    head.addEventListener('click', () => {
      if (collapsed.has(facet.key)) collapsed.delete(facet.key); else collapsed.add(facet.key);
      renderFacets(container, facets, filters, onToggle);
    });
    section.append(head);

    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const { value, count } of shown) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(selected.has(value)));
      chip.innerHTML = `${escapeHtml(label(facet.key, value))}<span class="cnt">${count}</span>`;
      chip.addEventListener('click', () => onToggle(facet.key, value));
      chips.append(chip);
    }
    if (facet.values.length > CHIP_LIMIT) {
      const more = document.createElement('button');
      more.className = 'chip-more';
      more.type = 'button';
      more.textContent = showAll ? 'Show fewer' : `+${facet.values.length - CHIP_LIMIT} more`;
      more.addEventListener('click', () => {
        if (showAll) expanded.delete(facet.key); else expanded.add(facet.key);
        renderFacets(container, facets, filters, onToggle);
      });
      chips.append(more);
    }
    section.append(chips);
    container.append(section);
  }
}

const label = (key, value) => (isRatingFacet(key) ? `${value} ★` : value);

/* ------------------------------------------------------------------ cards */

function stars(rating) {
  if (rating == null || Number.isNaN(rating)) return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '');
}

/**
 * A coffee card. `matchedValues` is the set of currently-filtered values, used to
 * light up exactly the tags that caused this coffee to match — so it's obvious
 * *why* a country is highlighted.
 */
export function coffeeCard(coffee, { matchedValues, dimmed, onEdit, onDelete, canEdit, hideCountry }) {
  const card = document.createElement('article');
  card.className = 'card' + (dimmed ? ' dimmed' : '');

  const isMatch = (v) => matchedValues && matchedValues.has(v);
  const tag = (value, extra = '') =>
    `<span class="tag ${extra}${isMatch(value) ? ' match' : ''}">${escapeHtml(value)}</span>`;

  const comps = components(coffee);
  const blend = comps.length > 1;

  /* In the country panel the heading already names the country, so repeating it on
     every card is noise — but a blend has to name each origin or the rows are
     ambiguous. */
  const originRow = (comp) => {
    const showCountry = blend || !hideCountry;
    const place = [showCountry ? countryNameOf(comp.country) : '', comp.region, comp.producer]
      .filter(Boolean).join(' · ');
    const aside = [comp.share ? `${comp.share}%` : '', comp.altitude ? `${comp.altitude} masl` : '']
      .filter(Boolean).join(' · ');
    const tags = [
      ...comp.variety.map((v) => tag(v, 'variety')),
      comp.process ? tag(comp.process) : '',
    ].filter(Boolean).join('');
    if (!place && !tags && !aside) return '';
    return `<li class="origin">
        ${place || aside ? `<div class="origin-place"><span>${escapeHtml(place)}</span>` +
          `${aside ? `<span class="origin-extra">${escapeHtml(aside)}</span>` : ''}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </li>`;
  };

  const origins = comps.map(originRow).filter(Boolean).join('');
  const notes = coffee.flavorNotes.map((v) => tag(v)).join('');

  const meta = [coffee.dateTried && formatDate(coffee.dateTried)]
    .filter(Boolean).map((m) => `<span>${m}</span>`).join('');

  card.innerHTML = `
    <div class="card-top">
      <h3>${escapeHtml(coffee.name)}${blend ? '<span class="blend-badge">blend</span>' : ''}</h3>
      ${scoreBadges(coffee)}
    </div>
    ${coffee.roaster ? `<p class="roaster">${escapeHtml(coffee.roaster)}</p>` : ''}
    ${origins ? `<ul class="origins-list${blend ? ' blend' : ''}">${origins}</ul>` : ''}
    ${notes ? `<div class="tags flavour">${notes}</div>` : ''}
    ${coffee.notes ? `<p class="notes">${escapeHtml(coffee.notes)}</p>` : ''}
    ${meta ? `<div class="card-meta">${meta}</div>` : ''}
  `;

  if (canEdit) {
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const edit = document.createElement('button');
    edit.className = 'btn';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => onEdit(coffee));
    const del = document.createElement('button');
    del.className = 'btn danger-text';
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => onDelete(coffee));
    actions.append(edit, del);
    card.append(actions);
  }
  return card;
}

/** A badge per rater who scored it. People who haven't rated it are simply absent,
 *  which keeps a one-person coffee looking the same as it always did. */
function scoreBadges(coffee) {
  return RATERS.map((r) => {
    const v = scoreOf(coffee, r.id);
    if (v == null) return '';
    return `<span class="score" title="${escapeHtml(r.label)} rated this ${v} out of 5">` +
           `<b>${escapeHtml(r.label)}</b><span class="stars">${stars(v)}</span></span>`;
  }).filter(Boolean).join('');
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ panel */

export function renderPanel({ iso, name, coffees, matchedIds, matchedValues, filtering,
                              onEdit, onDelete, canEdit }) {
  $('#panel-title').textContent = name;
  const bits = [`${coffees.length} coffee${coffees.length === 1 ? '' : 's'}`];
  for (const r of RATERS) {
    const avg = averageRating(coffees, r.id);
    if (avg != null) bits.push(`${r.label} ${avg.toFixed(1)} ★`);
  }
  if (filtering) {
    const n = coffees.filter((c) => matchedIds.has(c.id)).length;
    bits.push(`${n} match the filter`);
  }
  $('#panel-sub').textContent = bits.join(' · ');

  const body = $('#panel-body');
  body.innerHTML = '';
  body.scrollTop = 0;

  if (!coffees.length) {
    body.innerHTML = `<p class="panel-empty">No coffees from ${escapeHtml(name)} yet.</p>`;
    return;
  }

  // Matching coffees first when filtering, so the reason for a highlight is at the top.
  const ordered = filtering
    ? [...coffees].sort((a, b) => Number(matchedIds.has(b.id)) - Number(matchedIds.has(a.id)))
    : coffees;

  for (const coffee of ordered) {
    body.append(coffeeCard(coffee, {
      matchedValues,
      dimmed: filtering && !matchedIds.has(coffee.id),
      hideCountry: true,
      onEdit, onDelete, canEdit,
    }));
  }
}

/* ------------------------------------------------------------------ form */

const listFrom = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

const blank = () =>
  ({ country: '', region: '', producer: '', variety: [], process: '', altitude: null, share: null });

const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));

/** One origin row. Share is only offered on a blend, where it means something. */
function componentRow(comp, index, { countries, showShare, removable, onRemove }) {
  const row = document.createElement('fieldset');
  row.className = 'component';
  row.innerHTML = `
    <div class="component-head"><span class="component-title">Origin ${index + 1}</span></div>
    <div class="component-grid">
      <div class="field">
        <label>Country <span class="req">*</span></label>
        <select class="c-country">
          <option value="">Choose a country…</option>
          ${countries.map((c) => `<option value="${c.iso}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Region</label>
        <input class="c-region" list="dl-region" placeholder="e.g. Yirgacheffe" autocomplete="off">
      </div>
      <div class="field">
        <label>Producer / farm</label>
        <input class="c-producer" list="dl-producer" placeholder="e.g. Finca Milán" autocomplete="off">
      </div>
      <div class="field">
        <label>Variety <span class="hint">comma-separated</span></label>
        <input class="c-variety" list="dl-variety" placeholder="e.g. Gesha" autocomplete="off">
      </div>
      <div class="field">
        <label>Process</label>
        <input class="c-process" list="dl-process" placeholder="e.g. Washed" autocomplete="off">
      </div>
      <div class="field">
        <label>Altitude <span class="hint">masl</span></label>
        <input class="c-altitude" type="number" min="0" max="4000" step="10" placeholder="2100">
      </div>
      ${showShare ? `<div class="field">
        <label>Share <span class="hint">%</span></label>
        <input class="c-share" type="number" min="0" max="100" step="5" placeholder="60">
      </div>` : ''}
    </div>
  `;

  row.querySelector('.c-country').value  = comp.country || '';
  row.querySelector('.c-region').value   = comp.region || '';
  row.querySelector('.c-producer').value = comp.producer || '';
  row.querySelector('.c-variety').value  = (comp.variety || []).join(', ');
  row.querySelector('.c-process').value  = comp.process || '';
  row.querySelector('.c-altitude').value = comp.altitude != null ? String(comp.altitude) : '';
  if (showShare) row.querySelector('.c-share').value = comp.share != null ? String(comp.share) : '';

  if (removable) {
    const kill = document.createElement('button');
    kill.type = 'button';
    kill.className = 'icon-btn remove-origin';
    kill.setAttribute('aria-label', `Remove origin ${index + 1}`);
    kill.innerHTML = '&times;';
    kill.addEventListener('click', onRemove);
    row.querySelector('.component-head').append(kill);
  }
  return row;
}

function readRow(row) {
  const val = (sel) => { const el = row.querySelector(sel); return el ? el.value : ''; };
  return {
    country:  val('.c-country'),
    region:   val('.c-region').trim(),
    producer: val('.c-producer').trim(),
    variety:  listFrom(val('.c-variety')),
    process:  val('.c-process').trim(),
    altitude: numOrNull(val('.c-altitude')),
    share:    numOrNull(val('.c-share')),
  };
}

const SCORE_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** Score selects are generated from the rater roster rather than written into the
 *  markup, so adding a third person to raters.js surfaces them here for free. */
function buildRatingFields(coffee) {
  const wrap = $('#f-ratings');
  wrap.innerHTML = RATERS.map((r) => `
    <div class="rating-slot">
      <label for="f-rating-${escapeHtml(r.id)}">${escapeHtml(r.label)} rating</label>
      <select id="f-rating-${escapeHtml(r.id)}" data-rater="${escapeHtml(r.id)}">
        <option value="">&mdash;</option>
        ${SCORE_STEPS.map((n) => `<option value="${n}">${n}</option>`).join('')}
      </select>
    </div>`).join('');

  for (const r of RATERS) {
    const v = scoreOf(coffee, r.id);
    $(`#f-rating-${r.id}`).value = v == null ? '' : String(v);
  }
}

/** Only scores actually given are stored, so "unrated" stays distinct from zero. */
function collectRatings() {
  const out = {};
  for (const r of RATERS) {
    const raw = $(`#f-rating-${r.id}`).value;
    if (raw) out[r.id] = Number(raw);
  }
  return out;
}

export function openCoffeeForm({ coffee, countryIso, countries, suggestions, onSave, onDelete }) {
  const dlg = $('#dlg-coffee');
  const editing = Boolean(coffee);

  $('#coffee-form-title').textContent = editing ? 'Edit coffee' : 'Add a coffee';
  $('#form-error').hidden = true;

  fillDatalist('#dl-variety', suggestions.variety);
  fillDatalist('#dl-process', unionWith(suggestions.process,
    ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Carbonic Maceration', 'Wet-hulled', 'Yeast Inoculated']));
  fillDatalist('#dl-roaster', suggestions.roaster);
  fillDatalist('#dl-flavor', suggestions.flavorNotes);
  fillDatalist('#dl-region', suggestions.region);
  fillDatalist('#dl-producer', suggestions.producer);

  // Live working copy of the origins; the DOM is re-read before every structural change
  // so half-typed values survive adding or removing a row.
  let comps = coffee && coffee.components.length
    ? coffee.components.map((c) => ({ ...c }))
    : [{ ...blank(), country: countryIso || '' }];

  const host = $('#components');
  const sync = () => { comps = [...host.querySelectorAll('.component')].map(readRow); };

  function renderRows() {
    host.innerHTML = '';
    const showShare = comps.length > 1;
    comps.forEach((comp, i) => host.append(componentRow(comp, i, {
      countries,
      showShare,
      removable: comps.length > 1,
      onRemove: () => { sync(); comps.splice(i, 1); renderRows(); },
    })));
  }
  renderRows();

  $('#f-name').value    = coffee ? coffee.name : '';
  $('#f-roaster').value = coffee ? coffee.roaster : '';
  $('#f-flavor').value  = coffee ? coffee.flavorNotes.join(', ') : '';
  buildRatingFields(coffee);
  $('#f-date').value    = coffee ? coffee.dateTried : new Date().toISOString().slice(0, 10);
  $('#f-notes').value   = coffee ? coffee.notes : '';

  $('#btn-delete-coffee').hidden = !editing;

  const collect = () => {
    sync();
    return {
      ...(coffee || {}),
      name: $('#f-name').value.trim(),
      roaster: $('#f-roaster').value.trim(),
      flavorNotes: listFrom($('#f-flavor').value),
      ratings: collectRatings(),
      dateTried: $('#f-date').value,
      notes: $('#f-notes').value.trim(),
      components: comps,
    };
  };

  const fail = (message, focusEl) => {
    const box = $('#form-error');
    box.textContent = message;
    box.hidden = false;
    if (focusEl) focusEl.focus();
  };

  const save = () => {
    const draft = collect();
    if (!draft.name) return fail('Give the coffee a name.', $('#f-name'));
    const missing = draft.components.findIndex((c) => !c.country);
    if (missing !== -1) {
      return fail(draft.components.length > 1
        ? `Pick a country for origin ${missing + 1}.`
        : 'Pick a country of origin.', host.querySelectorAll('.c-country')[missing]);
    }
    dlg.close();
    onSave(draft);
  };

  // Rebind fresh each open so a previous dialog's closure can't fire twice.
  bindOnce($('#btn-add-component'), 'click', () => { sync(); comps.push(blank()); renderRows(); });
  bindOnce($('#btn-save-coffee'), 'click', save);
  bindOnce($('#btn-cancel-coffee'), 'click', () => dlg.close());
  bindOnce($('#btn-delete-coffee'), 'click', () => { dlg.close(); onDelete(coffee); });
  bindOnce($('#form-coffee'), 'submit', (e) => { e.preventDefault(); save(); });
  bindOnce($('#f-name'), 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  dlg.showModal();
  setTimeout(() => {
    const first = editing || countryIso ? $('#f-name') : host.querySelector('.c-country');
    if (first) first.focus();
  }, 30);
}

/** Replace any handler added by a previous open, avoiding stacked listeners. */
function bindOnce(el, type, handler) {
  const key = `_h_${type}`;
  if (el[key]) el.removeEventListener(type, el[key]);
  el[key] = handler;
  el.addEventListener(type, handler);
}

function fillDatalist(sel, values) {
  $(sel).innerHTML = [...values].sort((a, b) => a.localeCompare(b))
    .map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
}

const unionWith = (set, extra) => new Set([...set, ...extra]);

/** Distinct values per free-text field, for the datalists. Keeps spellings
 *  consistent, which matters because facets group on exact strings. */
export function buildSuggestions(coffees) {
  const out = { variety: new Set(), process: new Set(), roaster: new Set(),
                flavorNotes: new Set(), region: new Set(), producer: new Set() };
  for (const c of coffees) {
    c.flavorNotes.forEach((v) => out.flavorNotes.add(v));
    if (c.roaster) out.roaster.add(c.roaster);
    for (const comp of components(c)) {
      comp.variety.forEach((v) => out.variety.add(v));
      if (comp.process)  out.process.add(comp.process);
      if (comp.region)   out.region.add(comp.region);
      if (comp.producer) out.producer.add(comp.producer);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ toasts */

let toastTimer = null;

export function toast(message, { kind = '', action, actionLabel, duration = 4200 } = {}) {
  const stack = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.append(document.createTextNode(message));

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel || 'Retry';
    btn.addEventListener('click', () => { el.remove(); action(); });
    el.append(btn);
  }

  stack.append(el);
  clearTimeout(toastTimer);
  // Errors with an action stay until dismissed or acted on.
  if (!action) toastTimer = setTimeout(() => el.remove(), duration);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  return el;
}

/* ------------------------------------------------------------------ legend */

export function renderLegend({ colorBy, filtering, total }) {
  const el = $('#legend');
  if (!total) { el.hidden = true; return; }
  el.hidden = false;
  const swatches = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6']
    .map((t) => `<span class="sw" style="background:var(${t})"></span>`).join('');
  const isCount = colorBy === 'count';
  const ends = isCount ? ['1', '12+'] : ['1 ★', '5 ★'];
  el.innerHTML = `
    <h4>${isCount ? 'Coffees tried' : `${escapeHtml(raterLabel(colorBy))} rating`}</h4>
    <div class="ramp">${swatches}</div>
    <div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>
    ${isCount ? '' : `<div class="no-score-row"><span class="ns-sw"></span> tried, not scored by ${escapeHtml(raterLabel(colorBy))}</div>`}
    ${filtering ? '<div class="hi-row"><span class="hi-sw"></span> matches filter</div>' : ''}
  `;
}

/* ------------------------------------------------------------------ list */

const uniq  = (xs) => [...new Set(xs.filter(Boolean))];
const pills = (xs, cls = '') => xs.map((v) => `<span class="pill ${cls}">${escapeHtml(v)}</span>`).join('');

const originsOf    = (c) => countriesOf(c).map(countryNameOf);
const varietiesOf  = (c) => uniq(components(c).flatMap((k) => k.variety));
const processesOf  = (c) => uniq(components(c).map((k) => k.process));

/**
 * Table columns. `get` yields a sort key, `cell` the rendered HTML. A blend
 * flattens across its components here — the list is for scanning everything at
 * once, and the card or form is where the per-origin detail lives.
 */
export const LIST_COLUMNS = [
  { key: 'name',    label: 'Coffee',  get: (c) => c.name,
    cell: (c) => `<span class="lc-name">${escapeHtml(c.name)}</span>` +
                 (components(c).length > 1 ? '<span class="blend-badge">blend</span>' : '') },
  { key: 'roaster', label: 'Roaster', get: (c) => c.roaster, cell: (c) => escapeHtml(c.roaster) },
  { key: 'origin',  label: 'Origin',  get: (c) => originsOf(c)[0] || '',
    cell: (c) => pills(originsOf(c), 'origin') },
  { key: 'variety', label: 'Variety', get: (c) => varietiesOf(c)[0] || '',
    cell: (c) => pills(varietiesOf(c), 'variety') },
  { key: 'process', label: 'Process', get: (c) => processesOf(c)[0] || '',
    cell: (c) => pills(processesOf(c)) },
  ...RATERS.map((r) => ({
    key: `rating:${r.id}`, label: r.label, numeric: true, numCol: true,
    get: (c) => scoreOf(c, r.id),
    cell: (c) => {
      const v = scoreOf(c, r.id);
      return v == null ? '<span class="unrated">&mdash;</span>' : `<span class="num">${v}</span>`;
    },
  })),
  { key: 'date',    label: 'Tried',   get: (c) => c.dateTried,
    cell: (c) => (c.dateTried ? formatDate(c.dateTried) : '') },
];

const isEmptyCell = (v) => v == null || v === '';

/** Unrated and unfilled cells sort last in *both* directions — flipping to
 *  descending should surface the best coffees, not a wall of blanks. */
function compareBy(col, dir) {
  return (a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (isEmptyCell(va) && isEmptyCell(vb)) return 0;
    if (isEmptyCell(va)) return 1;
    if (isEmptyCell(vb)) return -1;
    const r = col.numeric ? Number(va) - Number(vb)
                          : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
    return dir === 'desc' ? -r : r;
  };
}

export function renderList({ coffees, sort, total, filtering, onSort, onEdit, onDelete, canEdit }) {
  const count = $('#list-count');
  count.textContent = filtering
    ? `${coffees.length} of ${total} coffee${total === 1 ? '' : 's'}`
    : `${total} coffee${total === 1 ? '' : 's'}`;

  const head = $('#list-head');
  head.innerHTML = `<tr>${LIST_COLUMNS.map((col) => {
    const on = sort.key === col.key;
    const dir = on ? sort.dir : 'none';
    return `<th scope="col" class="${col.numCol ? 'num-col' : ''}${on ? ' sorted' : ''}"` +
           ` aria-sort="${on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}">` +
           `<button type="button" data-sort="${col.key}">${escapeHtml(col.label)}` +
           `<span class="arrow" aria-hidden="true">${on ? (dir === 'asc' ? '▲' : '▼') : ''}</span>` +
           `</button></th>`;
  }).join('')}${canEdit ? '<th scope="col"><span class="sr-only">Actions</span></th>' : ''}</tr>`;

  for (const btn of head.querySelectorAll('button[data-sort]')) {
    btn.addEventListener('click', () => onSort(btn.dataset.sort));
  }

  const body = $('#list-body');
  body.innerHTML = '';
  const empty = $('#list-empty');

  if (!coffees.length) {
    empty.hidden = false;
    empty.textContent = total
      ? 'No coffees match the current filters.'
      : 'No coffees logged yet. Use Add coffee to log your first one.';
    return;
  }
  empty.hidden = true;

  const col = LIST_COLUMNS.find((c) => c.key === sort.key) || LIST_COLUMNS[0];
  const rows = [...coffees].sort(compareBy(col, sort.dir));

  for (const coffee of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = LIST_COLUMNS
      .map((c) => `<td class="${c.numCol ? 'num-col' : ''}">${c.cell(coffee)}</td>`).join('');

    if (canEdit) {
      const td = document.createElement('td');
      td.className = 'row-actions';
      const edit = document.createElement('button');
      edit.className = 'btn tiny';
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => onEdit(coffee));
      const del = document.createElement('button');
      del.className = 'btn tiny danger-text';
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', () => onDelete(coffee));
      td.append(edit, del);
      tr.append(td);
    }
    body.append(tr);
  }
}
