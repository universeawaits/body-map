// Leaflet wiring: map init, teardrop markers, popup HTML.
// Leaflet 1.9.4 is loaded globally by index.html.
/* global L */

import {
  TILE_URL,
  TILE_ATTRIBUTION,
  MAX_ZOOM,
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  FIT_PADDING,
  FIT_MAX_ZOOM,
} from './config.js';
import {
  groupEntities,
  effectiveColors,
  pinBackground,
  escapeHtml,
  escapeAttr,
  safeUrl,
  scheduleLabel,
  orderedCategories,
  categoryLabel,
} from './logic.js';

let map = null;
let markerLayer = null;

// Teardrop geometry (see .pin in style.css): a 34px rounded square rotated
// -45° about its sharp corner. Icon box 34×42; the tip is bottom center.
// The rotated square's visual apex overflows the icon box: it sits
// 34·√2 ≈ 48px above the tip — the popup must clear THAT, not PIN_H.
const PIN_W = 34;
const PIN_H = 42;
const PIN_APEX = Math.ceil(PIN_W * Math.SQRT2);

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer(TILE_URL, {
    maxZoom: MAX_ZOOM,
    attribution: TILE_ATTRIBUTION,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
  return map;
}

/**
 * Re-render all pins for the given filter.
 * @param {object[]} entities
 * @param {{dance: string, categories: Set<string>, dates: Set<string>}} filter
 * @param {{fit?: boolean}} options - fit=true fits bounds to visible pins
 */
export function renderMarkers(entities, filter, { fit = false } = {}) {
  markerLayer.clearLayers();
  const groups = groupEntities(entities, filter);
  const points = [];

  for (const group of groups) {
    const colors = effectiveColors(group, filter.categories);
    if (!colors.length) continue;
    const icon = L.divIcon({
      className: 'pin-anchor',
      iconSize: [PIN_W, PIN_H],
      iconAnchor: [PIN_W / 2, PIN_H], // the tip, exactly on the lat/lng
      popupAnchor: [0, -(PIN_APEX + 2)], // above the head's visual apex
      html: pinHtml(group, colors),
    });
    L.marker([group.lat, group.lng], {
      icon,
      title: group.entities.map((e) => e.name).join(', '),
    })
      .bindPopup(popupHtml(group, filter.dance), { maxWidth: 340 })
      .addTo(markerLayer);
    points.push([group.lat, group.lng]);
  }

  if (fit) {
    if (points.length) {
      map.fitBounds(points, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
    } else {
      map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    }
  }
}

function pinHtml(group, colors) {
  const multi = colors.length > 1;
  const style = multi
    ? `background-image:${pinBackground(colors)};background-size:300% 300%;`
    : `background:${colors[0]};`;
  const badge =
    group.entities.length > 1
      ? `<span class="pin-badge">${group.entities.length}</span>`
      : '';
  return `<span class="pin${multi ? ' pin-multi' : ''}" style="${style}">${badge}</span>`;
}

// --- popup -----------------------------------------------------------------
// Every dynamic string below is scraped/scrapable content: text goes through
// escapeHtml/escapeAttr, hrefs additionally through safeUrl (scheme check).

const ICON_PLAY =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

function popupHtml(group, dance) {
  const sections = group.entities.map((e) => entitySectionHtml(e, dance));
  return `<div class="popup">${sections.join('<hr class="popup-divider">')}</div>`;
}

function entitySectionHtml(entity, dance) {
  const parts = [`<h3 class="popup-name">${escapeHtml(entity.name)}</h3>`];

  const chips = orderedCategories(entity.categories)
    .map(
      (key) =>
        `<span class="chip"><span class="chip-dot" style="background:var(--cat-${key})"></span>${escapeHtml(categoryLabel(key, dance))}</span>`
    )
    .join('');
  if (chips) parts.push(`<div class="popup-chips">${chips}</div>`);

  const place = [entity.address, entity.city, entity.country]
    .filter(Boolean)
    .join(', ');
  if (place) parts.push(`<p class="popup-place">${escapeHtml(place)}</p>`);

  const when = scheduleLabel(entity);
  if (when) parts.push(`<p class="popup-schedule">${escapeHtml(when)}</p>`);

  if (entity.description) {
    parts.push(`<p class="popup-desc">${escapeHtml(entity.description)}</p>`);
  }

  const music = musicHtml(entity.music);
  if (music) {
    parts.push(`<p class="popup-eyebrow">Music</p><p class="popup-music">${music}</p>`);
  }

  const organizer = organizerHtml(entity.organizer);
  if (organizer) {
    parts.push(
      `<p class="popup-eyebrow">Organized by</p><p class="popup-organizer">${organizer}</p>`
    );
  }

  const artists = artistsHtml(entity.artists);
  if (artists) {
    parts.push(
      `<p class="popup-eyebrow">Artists</p><div class="popup-artists">${artists}</div>`
    );
  }

  const images = (Array.isArray(entity.images) ? entity.images : [])
    .map((url) => safeUrl(url))
    .filter(Boolean)
    .slice(0, 3)
    .map(
      (url) =>
        `<img class="popup-thumb" src="${escapeAttr(url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    )
    .join('');
  if (images) parts.push(`<div class="popup-thumbs">${images}</div>`);

  const links = socialLinksHtml(entity.socials);
  if (links) parts.push(`<div class="popup-links">${links}</div>`);

  return `<section class="popup-entity">${parts.join('')}</section>`;
}

const MUSIC_TYPES = new Set(['dj', 'orchestra', 'band']);

function musicHtml(music) {
  if (!Array.isArray(music)) return '';
  return music
    .filter((m) => m && typeof m.name === 'string' && m.name)
    .map((m) => {
      const url = safeUrl(m.url);
      const name = url
        ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.name)}</a>`
        : escapeHtml(m.name);
      const type = MUSIC_TYPES.has(m.type)
        ? `<span class="music-type">${escapeHtml(m.type)}</span>`
        : '';
      return `<span class="music-row">${name}${type}</span>`;
    })
    .join('');
}

function organizerHtml(organizer) {
  if (!organizer || typeof organizer !== 'object' || !organizer.name) return '';
  const url = safeUrl(organizer.url);
  return url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(organizer.name)}</a>`
    : escapeHtml(organizer.name);
}

function artistsHtml(artists) {
  if (!Array.isArray(artists)) return '';
  return artists
    .filter((a) => a && typeof a.name === 'string' && a.name)
    .map((a) => {
      const photoUrl = safeUrl(a.photo);
      const photo = photoUrl
        ? `<img class="artist-photo" src="${escapeAttr(photoUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '';
      const pageUrl = safeUrl(a.url);
      const name = pageUrl
        ? `<a href="${escapeAttr(pageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.name)}</a>`
        : escapeHtml(a.name);
      const role = a.role
        ? `<p class="artist-role">${escapeHtml(a.role)}</p>`
        : '';
      const videoUrl = safeUrl(a.video);
      const video = videoUrl
        ? `<a class="artist-video" href="${escapeAttr(videoUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${escapeAttr(a.name)} dance" title="Watch video">${ICON_PLAY}</a>`
        : '';
      return `<div class="artist-card">${photo}<div class="artist-body"><p class="artist-name">${name}</p>${role}</div>${video}</div>`;
    })
    .join('');
}

const SOCIAL_LABELS = [
  ['website', 'Website'],
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['email', 'Email'],
];

function socialLinksHtml(socials) {
  if (!socials || typeof socials !== 'object') return '';
  const links = [];
  for (const [key, label] of SOCIAL_LABELS) {
    let value = socials[key];
    if (!value || typeof value !== 'string') continue;
    if (key === 'email' && !/^mailto:/i.test(value.trim())) {
      value = `mailto:${value.trim()}`;
    }
    const url = safeUrl(value);
    if (!url) continue;
    links.push(
      `<a class="popup-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
  }
  return links.join('');
}
