/**
 * Who scores a coffee.
 *
 * Ratings are per-person rather than one number on the coffee, so two people can
 * disagree about the same cup and each keep their own record. The first rater is
 * the original one: a pre-v3 file had a single unnamed score, and that score was
 * theirs, which is what the migration in store.js assumes.
 *
 * Order matters — it drives column order in the list, field order in the form,
 * and which id inherits the legacy score. Adding a third person here is enough to
 * surface them everywhere; nothing else hard-codes the pair.
 */
export const RATERS = [
  { id: 'RH', label: 'RH' },
  { id: 'AS', label: 'AS' },
];

export const RATER_IDS = RATERS.map((r) => r.id);

/** One person's score, or null when they haven't rated it. */
export const scoreOf = (coffee, id) => {
  const v = coffee && coffee.ratings ? coffee.ratings[id] : null;
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
};

/** Every score actually recorded for this coffee, in rater order. */
export const scoresOf = (coffee) =>
  RATERS.map((r) => scoreOf(coffee, r.id)).filter((v) => v != null);

/** Mean across whoever rated it — the "combined" view. Null if nobody has. */
export function meanScore(coffee) {
  const list = scoresOf(coffee);
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

/** Resolves the map/legend selector: a rater id, or 'avg' for the combined mean. */
export const scoreFor = (coffee, key) =>
  (key === 'avg' ? meanScore(coffee) : scoreOf(coffee, key));

export const raterLabel = (key) =>
  (key === 'avg' ? 'Combined' : (RATERS.find((r) => r.id === key) || {}).label || key);
