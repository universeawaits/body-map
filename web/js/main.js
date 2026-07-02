// Bootstrap: theme, dance resolution (hash → localStorage → default),
// map + tabs + date strip + dance switcher, load data, first fitBounds.

import { initMap, renderMarkers } from './map.js';
import { loadEntities } from './data.js';
import {
  initTabs,
  initDateStrip,
  initDanceSwitcher,
  setUpdatedChip,
  showError,
} from './ui.js';
import { categoryCounts, resolveDance, parseDanceHash } from './logic.js';

const DANCE_STORAGE_KEY = 'bodymap.dance';

// --- theme: data-theme follows prefers-color-scheme, live ---------------------

function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
  };
  apply();
  media.addEventListener('change', apply);
}

// --- dance persistence ----------------------------------------------------------

function loadDance() {
  let stored = null;
  try {
    stored = localStorage.getItem(DANCE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); fall through.
  }
  return resolveDance(parseDanceHash(window.location.hash), stored);
}

function persistDance(dance) {
  try {
    localStorage.setItem(DANCE_STORAGE_KEY, dance);
  } catch {
    // Best effort only.
  }
  const hash = `#dance=${dance}`;
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

// --- boot -------------------------------------------------------------------------

async function boot() {
  initTheme();
  initMap('map');

  let entities = [];
  let dance = loadDance();

  const tabs = initTabs(document.getElementById('tabs'), {
    dance,
    onChange: () => refresh({ fit: false }),
  });

  const dateStrip = initDateStrip(
    document.getElementById('datestrip'),
    document.getElementById('today-pill'),
    { onChange: () => refresh({ fit: false }) }
  );

  const switcher = initDanceSwitcher(document.getElementById('dance-switcher'), {
    dance,
    onChange: (key) => {
      dance = key;
      persistDance(dance);
      switcher.setDance(dance);
      tabs.setDance(dance);
      refresh({ fit: false });
    },
  });

  persistDance(dance);

  function refresh({ fit = false } = {}) {
    const filter = {
      dance,
      categories: tabs.getSelected(),
      dates: dateStrip.getSelected(),
    };
    renderMarkers(entities, filter, { fit });
    tabs.updateCounts(categoryCounts(entities, filter));
  }

  const updatedChip = document.getElementById('updated-chip');
  try {
    const data = await loadEntities();
    entities = data.entities;
    setUpdatedChip(updatedChip, data.generated);
  } catch (err) {
    console.error(err);
    showError(updatedChip, 'Could not load data');
  }

  refresh({ fit: true });
}

boot();
