// Bootstrap: theme, dance resolution (hash → localStorage → default),
// map + tabs + date strip + dance switcher, load data, first fitBounds.

import { initMap, renderMarkers } from './map.js';
import { loadEntities } from './data.js';
import {
  initTabs,
  initDateStrip,
  initDanceSwitcher,
  initLangSwitcher,
  setUpdatedChip,
  showError,
} from './ui.js';
import { categoryCounts, resolveDance, parseDanceHash } from './logic.js';
import { resolveLang, parseLangHash, UI } from './i18n.js';

const DANCE_STORAGE_KEY = 'bodymap.dance';
const LANG_STORAGE_KEY = 'bodymap.lang';

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

// --- language persistence ---------------------------------------------------------

function loadLang() {
  let stored = null;
  try {
    stored = localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); fall through.
  }
  return resolveLang(parseLangHash(window.location.hash), stored);
}

function persistLang(lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Best effort only.
  }
}

// --- boot -------------------------------------------------------------------------

async function boot() {
  initTheme();
  initMap('map');

  let entities = [];
  let dance = loadDance();
  let lang = loadLang();
  let generatedAt = null;

  const todayPill = document.getElementById('today-pill');
  const updatedChip = document.getElementById('updated-chip');

  const tabs = initTabs(document.getElementById('tabs'), {
    dance,
    lang,
    onChange: () => refresh({ fit: false }),
  });

  const dateStrip = initDateStrip(document.getElementById('datestrip'), todayPill, {
    lang,
    onChange: () => refresh({ fit: false }),
  });

  const switcher = initDanceSwitcher(document.getElementById('dance-switcher'), {
    dance,
    lang,
    onChange: (key) => {
      dance = key;
      persistDance(dance);
      switcher.setDance(dance);
      tabs.setDance(dance);
      refresh({ fit: false });
    },
  });

  const langSwitcher = initLangSwitcher(document.getElementById('lang-switcher'), {
    lang,
    onChange: (code) => {
      lang = code;
      persistLang(lang);
      langSwitcher.setLang(lang);
      switcher.setLang(lang);
      tabs.setLang(lang);
      dateStrip.setLang(lang);
      applyLangChrome();
      refresh({ fit: false });
    },
  });

  function applyLangChrome() {
    todayPill.textContent = (UI[lang] ?? UI.EN).today;
    if (generatedAt) setUpdatedChip(updatedChip, generatedAt, lang);
  }

  persistDance(dance);
  applyLangChrome();

  function refresh({ fit = false } = {}) {
    const filter = {
      dance,
      lang,
      categories: tabs.getSelected(),
      dates: dateStrip.getSelected(),
    };
    renderMarkers(entities, filter, { fit });
    tabs.updateCounts(categoryCounts(entities, filter));
  }

  try {
    const data = await loadEntities();
    entities = data.entities;
    generatedAt = data.generated;
    setUpdatedChip(updatedChip, generatedAt, lang);
  } catch (err) {
    console.error(err);
    showError(updatedChip, 'Could not load data');
  }

  refresh({ fit: true });
}

boot();
