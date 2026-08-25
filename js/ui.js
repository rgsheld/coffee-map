/**
 * DOM rendering: facet chips, the country panel, the coffee form, settings, toasts.
 * This module knows nothing about GitHub — it takes data and callbacks.
 */

import { FACETS, averageRating } from './filters.js';

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

const label = (key, value) => (key === 'rating' ? `${value} ★` : value);

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
export function coffeeCard(coffee, { matchedValues, dimmed, onEdit, onDelete, canEdit }) {
  const card = document.createElement('article');
  card.className = 'card' + (dimmed ? ' dimmed' : '');

  const isMatch = (v) => matchedValues && matchedValues.has(v);
  const tag = (value, extra = '') =>
    `<span class="tag ${extra}${isMatch(value) ? ' match' : ''}">${escapeHtml(label('', value))}</span>`;

  const tags = [
    ...coffee.variety.map((v) => tag(v, 'variety')),
    coffee.process ? tag(coffee.process) : '',
    ...coffee.flavorNotes.map((v) => tag(v)),
  ].filter(Boolean).join('');

  const meta = [
    coffee.region && `${escapeHtml(coffee.region)}`,
    coffee.altitude && `${coffee.altitude} masl`,
    coffee.dateTried && formatDate(coffee.dateTried),
  ].filter(Boolean).map((m) => `<span>${m}</span>`).join('');

  card.innerHTML = `
    <div class="card-top">
      <h3>${escapeHtml(coffee.name)}</h3>
      ${coffee.rating ? `<span class="stars" title="${coffee.rating} out of 5">${stars(coffee.rating)}</span>` : ''}
    </div>
    ${coffee.roaster ? `<p class="roaster">${escapeHtml(coffee.roaster)}</p>` : ''}
    ${tags ? `<div class="tags">${tags}</div>` : ''}
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

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ panel */

export function renderPanel({ iso, name, coffees, matchedIds, matchedValues, filtering,
                              onEdit, onDelete, canEdit }) {
  $('#panel-title').textContent = name;
  const avg = averageRating(coffees);
  const bits = [`${coffees.length} coffee${coffees.length === 1 ? '' : 's'}`];
  if (avg != null) bits.push(`avg ${avg.toFixed(1)} ★`);
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
      onEdit, onDelete, canEdit,
    }));
  }
}

/* ------------------------------------------------------------------ form */

const listFrom = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

export function openCoffeeForm({ coffee, countryIso, countries, suggestions, onSave, onDelete }) {
  const dlg = $('#dlg-coffee');
  const editing = Boolean(coffee);

  $('#coffee-form-title').textContent = editing ? 'Edit coffee' : 'Add a coffee';
  $('#form-error').hidden = true;

  const select = $('#f-country');
  select.innerHTML = '<option value="">Choose a country…</option>' +
    countries.map((c) => `<option value="${c.iso}">${escapeHtml(c.name)}</option>`).join('');

  fillDatalist('#dl-variety', suggestions.variety);
  fillDatalist('#dl-process', unionWith(suggestions.process,
    ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Carbonic Maceration', 'Wet-hulled', 'Yeast Inoculated']));
  fillDatalist('#dl-roaster', suggestions.roaster);
  fillDatalist('#dl-flavor', suggestions.flavorNotes);
  fillDatalist('#dl-region', suggestions.region);

  $('#f-name').value      = coffee ? coffee.name : '';
  select.value            = coffee ? coffee.country : (countryIso || '');
  $('#f-region').value    = coffee ? coffee.region : '';
  $('#f-variety').value   = coffee ? coffee.variety.join(', ') : '';
  $('#f-process').value   = coffee ? coffee.process : '';
  $('#f-roaster').value   = coffee ? coffee.roaster : '';
  $('#f-flavor').value    = coffee ? coffee.flavorNotes.join(', ') : '';
  $('#f-rating').value    = coffee && coffee.rating != null ? String(coffee.rating) : '';
  $('#f-date').value      = coffee ? coffee.dateTried : new Date().toISOString().slice(0, 10);
  $('#f-altitude').value  = coffee && coffee.altitude != null ? String(coffee.altitude) : '';
  $('#f-notes').value     = coffee ? coffee.notes : '';

  $('#btn-delete-coffee').hidden = !editing;

  const collect = () => ({
    ...(coffee || {}),
    name: $('#f-name').value.trim(),
    country: select.value,
    region: $('#f-region').value.trim(),
    variety: listFrom($('#f-variety').value),
    process: $('#f-process').value.trim(),
    roaster: $('#f-roaster').value.trim(),
    flavorNotes: listFrom($('#f-flavor').value),
    rating: $('#f-rating').value ? Number($('#f-rating').value) : null,
    dateTried: $('#f-date').value,
    altitude: $('#f-altitude').value ? Number($('#f-altitude').value) : null,
    notes: $('#f-notes').value.trim(),
  });

  const fail = (message, focusSel) => {
    const box = $('#form-error');
    box.textContent = message;
    box.hidden = false;
    $(focusSel).focus();
  };

  const save = () => {
    const draft = collect();
    if (!draft.name)    return fail('Give the coffee a name.', '#f-name');
    if (!draft.country) return fail('Pick a country of origin.', '#f-country');
    dlg.close();
    onSave(draft);
  };

  // Rebind fresh each open so a previous dialog's closure can't fire twice.
  bindOnce($('#btn-save-coffee'), 'click', save);
  bindOnce($('#btn-cancel-coffee'), 'click', () => dlg.close());
  bindOnce($('#btn-delete-coffee'), 'click', () => { dlg.close(); onDelete(coffee); });
  bindOnce($('#form-coffee'), 'submit', (e) => { e.preventDefault(); save(); });
  bindOnce($('#f-name'), 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  dlg.showModal();
  setTimeout(() => $(editing ? '#f-name' : (countryIso ? '#f-name' : '#f-country')).focus(), 30);
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
                flavorNotes: new Set(), region: new Set() };
  for (const c of coffees) {
    c.variety.forEach((v) => out.variety.add(v));
    c.flavorNotes.forEach((v) => out.flavorNotes.add(v));
    if (c.process) out.process.add(c.process);
    if (c.roaster) out.roaster.add(c.roaster);
    if (c.region) out.region.add(c.region);
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
  const ends = colorBy === 'rating' ? ['1 ★', '5 ★'] : ['1', '12+'];
  el.innerHTML = `
    <h4>${colorBy === 'rating' ? 'Average rating' : 'Coffees tried'}</h4>
    <div class="ramp">${swatches}</div>
    <div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>
    ${filtering ? '<div class="hi-row"><span class="hi-sw"></span> matches filter</div>' : ''}
  `;
}
