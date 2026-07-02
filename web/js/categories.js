// Single source of truth for dance keys/labels and category keys/labels/
// colors (JS side). The same category hexes exist once more as CSS custom
// properties --cat-social … --cat-class in css/style.css.
// Fixed display order: social, marathon, festival, class.

export const DANCES = [
  { key: 'tango', label: 'Tango' },
  { key: 'salsa', label: 'Salsa' },
  { key: 'bachata', label: 'Bachata' },
  { key: 'kizomba', label: 'Kizomba' },
];

export const DANCE_KEYS = DANCES.map((d) => d.key);

export const DANCE_BY_KEY = Object.fromEntries(DANCES.map((d) => [d.key, d]));

export const DEFAULT_DANCE = 'tango';

// `labels.default` is the display label; a dance-keyed entry overrides it
// (the social category reads "Milongas" in tango, "Socials" elsewhere).
export const CATEGORIES = [
  {
    key: 'social',
    labels: { tango: 'Milongas', default: 'Socials' },
    color: '#F2B134',
  },
  { key: 'marathon', labels: { default: 'Marathons' }, color: '#7A1E2B' },
  { key: 'festival', labels: { default: 'Festivals' }, color: '#6F2DA8' },
  { key: 'class', labels: { default: 'Classes' }, color: '#2B5FD9' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export const CATEGORY_BY_KEY = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c])
);
