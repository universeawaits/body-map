// Leaflet wiring: map init, teardrop markers, popup HTML.
// Leaflet 1.9.4 is loaded globally by index.html.
/* global L */

import {
  TILE_URL,
  TILE_ATTRIBUTION,
  MAX_ZOOM,
  MIN_ZOOM,
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
import { UI, ROLES, MTYPES, DEFAULT_LANG } from './i18n.js';

let map = null;
let markerLayer = null;

// Teardrop geometry (see .pin in style.css): a 34px rounded square rotated
// -45° about its sharp corner. Icon box 34×42; the tip is bottom centre.
// The rotated square's visual apex overflows the icon box: it sits
// 34·√2 ≈ 48px above the tip — the popup must clear THAT, not PIN_H.
const PIN_W = 34;
const PIN_H = 42;
const PIN_APEX = Math.ceil(PIN_W * Math.SQRT2);

export function initMap(containerId) {
  map = L.map(containerId, {
    zoomControl: false,
    // Below MIN_ZOOM the world is smaller than the viewport; maxBounds stops
    // dragging past its edges into the blank space beyond, and maxBoundsViscosity
    // makes that limit solid (no rubber-banding past it either).
    minZoom: MIN_ZOOM,
    maxBounds: [
      [-90, -180],
      [90, 180],
    ],
    maxBoundsViscosity: 1.0,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer(TILE_URL, {
    maxZoom: MAX_ZOOM,
    minZoom: MIN_ZOOM,
    attribution: TILE_ATTRIBUTION,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);

  map.on('popupopen', (event) => {
    const popupEl = event.popup.getElement();
    if (!popupEl) return;

    wireCarouselNav(popupEl);

    // autoPanPaddingTopLeft (see bindPopup below) only reserves margin Leaflet's
    // own autopan uses when IT decides to pan; on short viewports with tall
    // popups it can still under-correct, leaving the popup peeking out under
    // the glass topbar. Catch anything that slips through with an explicit
    // measurement after open.
    const topbarEl = document.querySelector('.topbar');
    if (!topbarEl) return;
    requestAnimationFrame(() => {
      const popupRect = popupEl.getBoundingClientRect();
      const topbarRect = topbarEl.getBoundingClientRect();
      const deficit = topbarRect.bottom + 12 - popupRect.top;
      // A legitimate correction never needs to pan further than one viewport;
      // anything larger points at a bad measurement (e.g. mid-zoom/mid-layout)
      // rather than a real overlap, so skip it instead of flinging the view.
      if (deficit > 0 && deficit < map.getSize().y) {
        map.panBy([0, -deficit], { animate: false });
      }
    });
  });

  return map;
}

/**
 * Co-located pins carry multiple entities in one popup; only one section
 * shows at a time behind prev/next buttons (see popupHtml below). Leaflet
 * gives us the real, live popup DOM here, so wiring plain click handlers
 * works — no re-parsing or templating needed.
 */
function wireCarouselNav(popupEl) {
  const sections = popupEl.querySelectorAll('.popup-entity');
  const prevBtn = popupEl.querySelector('.popup-nav-prev');
  const nextBtn = popupEl.querySelector('.popup-nav-next');
  const countEl = popupEl.querySelector('.popup-nav-count');
  if (sections.length < 2 || !prevBtn || !nextBtn || !countEl) return;

  let index = 0;
  function show(next) {
    index = (next + sections.length) % sections.length;
    sections.forEach((section, i) => {
      section.hidden = i !== index;
    });
    countEl.textContent = `${index + 1} / ${sections.length}`;
  }
  prevBtn.addEventListener('click', () => show(index - 1));
  nextBtn.addEventListener('click', () => show(index + 1));
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
  const lang = filter.lang ?? DEFAULT_LANG;

  // Glass topbar floats over the map — keep popups from opening underneath it.
  const topbarEl = document.querySelector('.topbar');
  const topPad = (topbarEl ? topbarEl.offsetHeight : 0) + 24;

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
      .bindPopup(popupHtml(group, filter.dance, lang), {
        maxWidth: 400,
        autoPanPaddingTopLeft: [24, topPad],
        autoPanPaddingBottomRight: [24, 24],
      })
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
const ICON_CHEVRON_LEFT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_CHEVRON_RIGHT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

/**
 * A co-located pin can carry several entities. Rather than stacking every
 * entity's full card in one long scroll, only one is shown at a time behind
 * a prev/next nav strip at the top; initMap()'s popupopen handler wires the
 * actual navigation once Leaflet has the content in the DOM.
 */
function popupHtml(group, dance, lang = DEFAULT_LANG) {
  const multi = group.entities.length > 1;
  const nav = multi
    ? `<div class="popup-nav">` +
      `<button type="button" class="popup-nav-btn popup-nav-prev" aria-label="Previous entry">${ICON_CHEVRON_LEFT}</button>` +
      `<span class="popup-nav-count">1 / ${group.entities.length}</span>` +
      `<button type="button" class="popup-nav-btn popup-nav-next" aria-label="Next entry">${ICON_CHEVRON_RIGHT}</button>` +
      `</div>`
    : '';
  const sections = group.entities
    .map(
      (e, i) =>
        `<section class="popup-entity"${i === 0 ? '' : ' hidden'} data-index="${i}">${entitySectionHtml(e, dance, lang, !multi)}</section>`
    )
    .join('');
  return `<div class="popup">${nav}${sections}</div>`;
}

function entitySectionHtml(entity, dance, lang, roundHeroTop) {
  const ui = UI[lang] ?? UI[DEFAULT_LANG];
  // Translated description/schedule (§10) win over the scraped English text
  // when available for the active language; proper nouns are never translated.
  const translated = entity.translations?.[lang];
  const parts = [];

  // A hero photo (first valid image, if any) becomes a full-width header with
  // the entity name overlaid on a blurred glass plate — the small square
  // thumbnail row this replaces added little value. Entities without a photo
  // keep a plain heading instead. Top corners only round to match the card
  // when nothing (i.e. no nav strip) sits above the hero.
  const heroUrl = (Array.isArray(entity.images) ? entity.images : [])
    .map((url) => safeUrl(url))
    .find(Boolean);
  if (heroUrl) {
    parts.push(
      `<div class="popup-hero${roundHeroTop ? ' popup-hero-first' : ''}">` +
        `<img src="${escapeAttr(heroUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` +
        `<div class="popup-hero-backdrop"></div>` +
        `<h3 class="popup-hero-title">${escapeHtml(entity.name)}</h3>` +
        `</div>`
    );
  } else {
    parts.push(`<h3 class="popup-name">${escapeHtml(entity.name)}</h3>`);
  }

  const chips = orderedCategories(entity.categories)
    .map(
      (key) =>
        `<span class="chip"><span class="chip-dot" style="background:var(--cat-${key})"></span>${escapeHtml(categoryLabel(key, dance, lang))}</span>`
    )
    .join('');
  if (chips) parts.push(`<div class="popup-chips">${chips}</div>`);

  const place = [entity.address, entity.city, entity.country]
    .filter(Boolean)
    .join(', ');
  if (place) parts.push(`<p class="popup-place">${escapeHtml(place)}</p>`);

  const when = translated?.schedule?.text ?? scheduleLabel(entity, lang);
  if (when) parts.push(`<p class="popup-schedule">${escapeHtml(when)}</p>`);

  const description = translated?.description?.text ?? entity.description;
  if (description) {
    parts.push(`<p class="popup-desc">${escapeHtml(description)}</p>`);
  }

  const music = musicHtml(entity.music, lang);
  if (music) {
    parts.push(`<p class="popup-eyebrow">${escapeHtml(ui.music)}</p><p class="popup-music">${music}</p>`);
  }

  const artists = artistsHtml(entity.artists, lang);
  if (artists) {
    parts.push(
      `<p class="popup-eyebrow">${escapeHtml(ui.artists)}</p><div class="popup-artists">${artists}</div>`
    );
  }

  const links = socialLinksHtml(entity.socials, lang);
  if (links) parts.push(`<div class="popup-links">${links}</div>`);

  return parts.join('');
}

const MUSIC_TYPES = new Set(['dj', 'orchestra', 'band']);

function musicHtml(music, lang) {
  if (!Array.isArray(music)) return '';
  const mtypes = MTYPES[lang] ?? MTYPES[DEFAULT_LANG];
  return music
    .filter((m) => m && typeof m.name === 'string' && m.name)
    .map((m) => {
      const url = safeUrl(m.url);
      const name = url
        ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.name)}</a>`
        : escapeHtml(m.name);
      const type = MUSIC_TYPES.has(m.type)
        ? `<span class="music-type">${escapeHtml(mtypes[m.type] ?? m.type)}</span>`
        : '';
      return `<span class="music-row">${name}${type}</span>`;
    })
    .join('');
}

function artistsHtml(artists, lang) {
  if (!Array.isArray(artists)) return '';
  const roles = ROLES[lang] ?? ROLES[DEFAULT_LANG];
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
      // Name + role share one line (role as a muted inline suffix) rather than
      // stacking onto a second line — keeps each artist to a compact row. The
      // " · " lives in the markup, not just CSS spacing, so the two don't run
      // together for anything reading the text content directly (e.g. a11y).
      const role = a.role
        ? `<span class="artist-role"> · ${escapeHtml(roles[a.role] ?? a.role)}</span>`
        : '';
      const videoUrl = safeUrl(a.video);
      const video = videoUrl
        ? `<a class="artist-video" href="${escapeAttr(videoUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${escapeAttr(a.name)} dance" title="Watch video">${ICON_PLAY}</a>`
        : '';
      return `<div class="artist-card">${photo}<div class="artist-body"><p class="artist-name">${name}${role}</p></div>${video}</div>`;
    })
    .join('');
}

// Inline Lucide-style line icons for the popup's social-link buttons — the
// card layout uses icon-only 34px circular buttons rather than text pills.
const SOCIAL_ICONS = {
  website:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
  facebook:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 8.5V7c0-.7.3-1 1-1h1.5V3H14c-2.2 0-3.5 1.3-3.5 3.5v2H8.5v3h2V21h3.5v-9.5H16l.5-3H14z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>',
  email:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
};

const SOCIAL_KEYS = ['website', 'facebook', 'instagram', 'email'];

function socialLinksHtml(socials, lang) {
  if (!socials || typeof socials !== 'object') return '';
  const labels = (UI[lang] ?? UI[DEFAULT_LANG]).links;
  const links = [];
  for (const key of SOCIAL_KEYS) {
    const label = labels[key];
    let value = socials[key];
    if (!value || typeof value !== 'string') continue;
    if (key === 'email' && !/^mailto:/i.test(value.trim())) {
      value = `mailto:${value.trim()}`;
    }
    const url = safeUrl(value);
    if (!url) continue;
    links.push(
      `<a class="popup-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${SOCIAL_ICONS[key]}</a>`
    );
  }
  return links.join('');
}
