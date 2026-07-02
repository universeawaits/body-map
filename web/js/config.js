// App configuration. The tile URL and attribution live ONLY here —
// swap tile providers by editing this file alone.

export const DATA_URL = 'data/entities.json';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const MAX_ZOOM = 19;

// Used when there are no visible pins to fit: center of Europe, zoom 4.
export const FALLBACK_CENTER = [50.0, 15.0];
export const FALLBACK_ZOOM = 4;

// fitBounds tuning for first load.
export const FIT_PADDING = [48, 48];
export const FIT_MAX_ZOOM = 13;
