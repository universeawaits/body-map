// UI chrome: category tab bar, date strip, dance switcher, corner chip.
// All pure computation (month models, weekday math, labels) lives in logic.js.

import { CATEGORIES, DANCES } from './categories.js';
import {
  escapeHtml,
  formatDate,
  categoryLabel,
  danceLabel,
  buildMonthModel,
  monthKeyOf,
  addMonths,
  clampMonth,
  STRIP_START_MONTH,
  STRIP_END_MONTH,
} from './logic.js';
import { LANG_META, UI, DEFAULT_LANG } from './i18n.js';

// Inline-SVG Lucide-style line icons (static markup, no dynamic strings).
const ICON_CHECK =
  '<svg class="dance-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_X =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/* --- category tabs ---------------------------------------------------------- */

/**
 * Build the category tab bar. All categories start selected. Labels are
 * dance-aware: call setDance() after a dance switch to re-resolve them.
 * @param {HTMLElement} container
 * @param {{dance: string, onChange: () => void}} options
 */
export function initTabs(container, { dance, lang, onChange }) {
  const selected = new Set(CATEGORIES.map((c) => c.key));
  const countEls = {};
  const labelEls = {};
  let activeDance = dance;
  let activeLang = lang;

  for (const category of CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.dataset.key = category.key;
    button.setAttribute('aria-pressed', 'true');

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.style.background = `var(--cat-${category.key})`;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = categoryLabel(category.key, activeDance, activeLang);
    labelEls[category.key] = label;

    const count = document.createElement('span');
    count.className = 'tab-count';
    count.textContent = '0';
    countEls[category.key] = count;

    button.append(dot, label, count);
    button.addEventListener('click', () => {
      if (selected.has(category.key)) {
        selected.delete(category.key);
      } else {
        selected.add(category.key);
      }
      button.setAttribute('aria-pressed', String(selected.has(category.key)));
      onChange();
    });
    container.appendChild(button);
  }

  return {
    getSelected: () => new Set(selected),
    updateCounts(counts) {
      for (const category of CATEGORIES) {
        countEls[category.key].textContent = String(counts[category.key] ?? 0);
      }
    },
    setDance(danceKey) {
      activeDance = danceKey;
      for (const category of CATEGORIES) {
        labelEls[category.key].textContent = categoryLabel(
          category.key,
          activeDance,
          activeLang
        );
      }
    },
    setLang(langCode) {
      activeLang = langCode;
      for (const category of CATEGORIES) {
        labelEls[category.key].textContent = categoryLabel(
          category.key,
          activeDance,
          activeLang
        );
      }
    },
  };
}

/* --- date strip -------------------------------------------------------------- */

const SCROLL_EDGE = 300; // px from either edge that triggers lazy rendering

/** Local calendar date as 'YYYY-MM-DD' (the user's "today"). */
function localTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Horizontally scrollable strip of day chips spanning 2020-01 … 2028-12.
 * Months render lazily in both directions; today starts at the left edge.
 * Multi-select; a sticky "N dates" clear pill appears when any is selected.
 * @param {HTMLElement} container - the scrollable strip
 * @param {HTMLElement} todayButton - the "Today" pill next to the strip
 * @param {{lang: string, onChange: () => void}} options
 */
export function initDateStrip(container, todayButton, { lang, onChange }) {
  const GAP = 4; // --space-1 flex gap between strip items
  const selected = new Set();
  const todayIso = localTodayIso();
  const todayMonth = clampMonth(monthKeyOf(todayIso));
  let firstMonth = null;
  let lastMonth = null;
  let activeLang = lang;
  let activeLocale = (UI[lang] ?? UI.EN).locale;

  const clearPill = document.createElement('button');
  clearPill.type = 'button';
  clearPill.className = 'strip-clear';
  clearPill.hidden = true;
  clearPill.setAttribute('aria-label', (UI[activeLang] ?? UI.EN).clearDatesAria);
  container.appendChild(clearPill);
  clearPill.addEventListener('click', () => {
    selected.clear();
    for (const chip of container.querySelectorAll('.day-chip[aria-pressed="true"]')) {
      chip.setAttribute('aria-pressed', 'false');
    }
    updateClearPill();
    onChange();
  });

  function updateClearPill() {
    const ui = UI[activeLang] ?? UI.EN;
    clearPill.setAttribute('aria-label', ui.clearDatesAria);
    if (!selected.size) {
      clearPill.hidden = true;
      return;
    }
    const category = new Intl.PluralRules(activeLocale).select(selected.size);
    const template = ui.dateCount[category] ?? ui.dateCount.other;
    const text = template.replace('{n}', String(selected.size));
    clearPill.innerHTML = `${escapeHtml(text)} ${ICON_X}`;
    clearPill.hidden = false;
  }

  function monthElement(monthKey) {
    const model = buildMonthModel(monthKey, activeLocale);
    const monthEl = document.createElement('div');
    monthEl.className = 'strip-month';
    monthEl.dataset.month = model.key;

    const label = document.createElement('span');
    label.className = 'strip-month-label';
    label.textContent = model.label;
    monthEl.appendChild(label);

    for (const day of model.days) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'day-chip';
      chip.dataset.date = day.iso;
      chip.setAttribute('aria-pressed', String(selected.has(day.iso)));
      chip.setAttribute('aria-label', `${day.weekdayLabel} ${day.day} ${model.label}`);
      if (day.iso === todayIso) chip.classList.add('is-today');

      const wd = document.createElement('span');
      wd.className = 'day-wd';
      wd.textContent = day.weekdayLabel;
      const num = document.createElement('span');
      num.className = 'day-num';
      num.textContent = String(day.day);
      chip.append(wd, num);

      chip.addEventListener('click', () => {
        if (selected.has(day.iso)) {
          selected.delete(day.iso);
        } else {
          selected.add(day.iso);
        }
        chip.setAttribute('aria-pressed', String(selected.has(day.iso)));
        updateClearPill();
        onChange();
      });
      monthEl.appendChild(chip);
    }
    return monthEl;
  }

  function appendMonth() {
    const key = firstMonth === null ? todayMonth : addMonths(lastMonth, 1);
    if (key > STRIP_END_MONTH) return false;
    container.appendChild(monthElement(key));
    lastMonth = key;
    if (firstMonth === null) firstMonth = key;
    return true;
  }

  function prependMonth() {
    const key = addMonths(firstMonth, -1);
    if (key < STRIP_START_MONTH) return false;
    const monthEl = monthElement(key);
    const anchor = container.querySelector('.strip-month');
    container.insertBefore(monthEl, anchor);
    firstMonth = key;
    // Anchor the scroll position so the view does not jump.
    container.scrollLeft += monthEl.getBoundingClientRect().width + GAP;
    return true;
  }

  function resetAroundToday() {
    for (const el of container.querySelectorAll('.strip-month')) el.remove();
    firstMonth = null;
    lastMonth = null;
    appendMonth();
    appendMonth();
    appendMonth();
  }

  function scrollToToday(smooth) {
    const chip = container.querySelector(`.day-chip[data-date="${todayIso}"]`);
    if (!chip) return;
    // The month label (and the clear pill, when visible) is sticky at the
    // strip's left edge — land today's chip just right of that overlay so
    // the outlined chip is never hidden underneath it. Both pin at left: 0,
    // stacking on each other, so the occluded width is the wider of the two.
    const label = chip
      .closest('.strip-month')
      ?.querySelector('.strip-month-label');
    let overlay = label ? label.getBoundingClientRect().width : 0;
    if (!clearPill.hidden) {
      overlay = Math.max(overlay, clearPill.getBoundingClientRect().width);
    }
    const delta =
      chip.getBoundingClientRect().left -
      container.getBoundingClientRect().left -
      (overlay ? overlay + GAP : 0);
    container.scrollBy({ left: delta, behavior: smooth ? 'smooth' : 'auto' });
  }

  let filling = false;
  function fillAndExtend() {
    if (filling) return;
    filling = true;
    // Append while the right edge is near (also fills wide viewports).
    while (
      container.scrollLeft + container.clientWidth >
        container.scrollWidth - SCROLL_EDGE &&
      appendMonth()
    );
    // Prepend while the left edge is near (scroll position is anchored).
    while (container.scrollLeft < SCROLL_EDGE && prependMonth());
    filling = false;
  }

  container.addEventListener('scroll', fillAndExtend, { passive: true });

  todayButton.addEventListener('click', () => {
    if (todayMonth < firstMonth || todayMonth > lastMonth) {
      resetAroundToday();
      scrollToToday(false);
    } else {
      scrollToToday(true);
    }
  });

  resetAroundToday();
  scrollToToday(false);
  fillAndExtend();

  return {
    getSelected: () => new Set(selected),
    setLang(langCode) {
      activeLang = langCode;
      activeLocale = (UI[langCode] ?? UI.EN).locale;
      for (const monthEl of container.querySelectorAll('.strip-month')) {
        const model = buildMonthModel(monthEl.dataset.month, activeLocale);
        monthEl.querySelector('.strip-month-label').textContent = model.label;
        const dayByIso = new Map(model.days.map((d) => [d.iso, d]));
        for (const chip of monthEl.querySelectorAll('.day-chip')) {
          const day = dayByIso.get(chip.dataset.date);
          if (!day) continue;
          chip.querySelector('.day-wd').textContent = day.weekdayLabel;
          chip.setAttribute('aria-label', `${day.weekdayLabel} ${day.day} ${model.label}`);
        }
      }
      updateClearPill();
    },
  };
}

/* --- dance switcher ----------------------------------------------------------- */

/**
 * Floating circle button + single-select dropdown menu (role=menu).
 * Esc and click-outside close it; the selected row carries a check icon.
 * @param {HTMLElement} container
 * @param {{dance: string, lang: string, onChange: (key: string) => void}} options
 */
export function initDanceSwitcher(container, { dance, lang, onChange }) {
  let activeDance = dance;
  let activeLang = lang;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dance-btn';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'dance-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Dance');
  menu.hidden = true;

  const options = [];
  for (const d of DANCES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'dance-option';
    option.setAttribute('role', 'menuitemradio');
    option.dataset.key = d.key;
    option.innerHTML = `<span class="dance-name"></span>${ICON_CHECK}`;
    option.addEventListener('click', () => {
      close();
      if (d.key !== activeDance) onChange(d.key);
    });
    options.push(option);
    menu.appendChild(option);
  }

  function syncButton() {
    const label = danceLabel(activeDance, activeLang);
    button.textContent = [...label][0] ?? '';
    button.setAttribute('aria-label', `Switch dance — current: ${label}`);
    for (const option of options) {
      option.querySelector('.dance-name').textContent = danceLabel(
        option.dataset.key,
        activeLang
      );
      option.setAttribute(
        'aria-checked',
        String(option.dataset.key === activeDance)
      );
    }
  }

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const current = options.find((o) => o.dataset.key === activeDance);
    (current ?? options[0]).focus();
  }

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', () => {
    if (menu.hidden) {
      open();
    } else {
      close();
    }
  });

  menu.addEventListener('keydown', (event) => {
    const index = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[(index + 1) % options.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length].focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      button.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !container.contains(event.target)) close();
  });

  container.append(button, menu);
  syncButton();

  return {
    setDance(key) {
      activeDance = key;
      syncButton();
    },
    setLang(langCode) {
      activeLang = langCode;
      syncButton();
    },
  };
}

/* --- language switcher ----------------------------------------------------------- */

const ICON_GLOBE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

/**
 * Globe-icon button + single-select dropdown menu (role=menu) listing all
 * supported languages by native + English name. Same interaction pattern as
 * initDanceSwitcher (Esc/click-outside closes, aria-checked on the active row).
 * @param {HTMLElement} container
 * @param {{lang: string, onChange: (code: string) => void}} options
 */
export function initLangSwitcher(container, { lang, onChange }) {
  let activeLang = lang;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lang-btn';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'dance-menu lang-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Language');
  menu.hidden = true;

  const options = [];
  for (const l of LANG_META) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'dance-option';
    option.setAttribute('role', 'menuitemradio');
    option.dataset.code = l.code;
    option.innerHTML = `<span><span class="lang-native">${escapeHtml(l.native)}</span> <span class="lang-en">${escapeHtml(l.label)}</span></span>${ICON_CHECK}`;
    option.addEventListener('click', () => {
      close();
      if (l.code !== activeLang) onChange(l.code);
    });
    options.push(option);
    menu.appendChild(option);
  }

  function syncButton() {
    const current = LANG_META.find((l) => l.code === activeLang) ?? LANG_META[0];
    button.innerHTML = `${ICON_GLOBE}<span>${escapeHtml(current.code)}</span>`;
    button.setAttribute('aria-label', `Language — current: ${current.label}`);
    for (const option of options) {
      option.setAttribute('aria-checked', String(option.dataset.code === activeLang));
    }
  }

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const current = options.find((o) => o.dataset.code === activeLang);
    (current ?? options[0]).focus();
  }

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', () => {
    if (menu.hidden) {
      open();
    } else {
      close();
    }
  });

  menu.addEventListener('keydown', (event) => {
    const index = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[(index + 1) % options.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length].focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      button.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !container.contains(event.target)) close();
  });

  container.append(button, menu);
  syncButton();

  return {
    setLang(code) {
      activeLang = code;
      syncButton();
    },
  };
}

/* --- corner chip ---------------------------------------------------------------- */

/** Fill the corner chip with the dataset's `generated` timestamp. */
export function setUpdatedChip(element, generated, lang = DEFAULT_LANG) {
  if (!generated) {
    element.hidden = true;
    return;
  }
  const ui = UI[lang] ?? UI[DEFAULT_LANG];
  const text = ui.dataUpdated.replace('{date}', formatDate(generated, ui.locale));
  element.innerHTML = escapeHtml(text);
  element.hidden = false;
}

/** Small inline error notice (e.g. dataset failed to load). */
export function showError(element, message) {
  element.innerHTML = `<span class="error-chip">${escapeHtml(message)}</span>`;
  element.hidden = false;
}
