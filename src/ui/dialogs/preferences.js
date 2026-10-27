import { t as translateText, getLocale, saveLocale, LOCALES } from '../../i18n/index.js';
import './dialogs.css';
import { app } from '../../core/app.js';
import { el, clamp255 } from '../../core/util.js';
import { parseColor, toHex } from '../../core/color.js';
import { Dialog, buildForm } from '../dialog.js';
import { BRAND } from '../brand.js';

/**
 * Preferences. Values persist in `localStorage["pikado.prefs"]` and are pushed
 * onto the `app` singleton (and the root CSS variables) by
 * `applyStoredPreferences()`, which runs once when this module is imported.
 */

const STORAGE_KEY = 'pikado.prefs';

export const PREF_DEFAULTS = {
  /* General */
  units: 'px',
  recentLimit: 10,
  confirmBeforeClosing: true,
  resetColorsOnLaunch: false,
  /* Interface.
     These are written straight onto the root as --accent / --bg-canvas /
     --panel-w / --toolbar-w / --row-h / --radius by applyStoredPreferences(),
     so they must start out equal to the design-system tokens in
     src/styles.css — otherwise the stored defaults silently override the
     palette on every launch. */
  accent: BRAND.violet,
  canvasBg: '#121212', // --void: strictly neutral, so it never biases the image
  panelWidth: 304,
  toolbarWidth: 50,
  rowHeight: 28,
  cornerRadius: 6, // --r-sm
  /* Tools */
  brushCursor: 'normal',
  showToolTips: true,
  scrollZoom: false,
  showTransformValues: true,
  /* History */
  historyStates: 60,
  autoPurgeHistory: true,
  /* Performance */
  memoryLimitMB: 512,
  maxDocPixels: 80,
  previewQuality: 'accurate',
  /* AI.
     Hosts the user has agreed may receive their images. A list of hostnames is
     not a secret, so it belongs here — unlike the API key, which is deliberately
     kept out of this blob and lives in IndexedDB (see src/ai/credentials.js). */
  aiConsentHosts: [],
  /* Which model each AI provider should use, and how hard it should work:
     { openai: 'gpt-image-2' } and { 'openai:gpt-image-2': 'high' }. Same
     reasoning as the line above — a model id is a preference, not a secret. */
  aiModels: {},
  aiEfforts: {},
  /* Whether the Type tools may fetch a font from Google. A download, not an
     upload — nothing of the user's leaves the machine — so it is allowed by
     default and disclosed once, rather than gated behind a prompt in front of
     someone who has only picked a font from a list. See src/text/font-manager.js. */
  webfonts: 'auto',
  webfontNoticeSeen: false,
  /* Guides & Grid */
  showGuides: true,
  showRulers: true,
  showGrid: false,
  snap: true,
  gridSize: 20,
  gridSubdivisions: 20,
};

const CATEGORIES = [
  {
    id: 'general',
    label: translateText("General"),
    params: [
      {
        key: 'units', label: translateText("Default Units"), type: 'select',
        options: [
          { value: 'px', label: translateText("Pixels") }, { value: 'in', label: translateText("Inches") },
          { value: 'cm', label: translateText("Centimeters") }, { value: 'mm', label: translateText("Millimeters") },
          { value: 'pt', label: translateText("Points") }, { value: 'pica', label: translateText("Picas") },
        ],
        hint: 'Used by the rulers, the Info panel and the size dialogs.',
      },
      { key: 'recentLimit', label: translateText("Recent Documents"), type: 'slider', min: 0, max: 20, step: 1 },
      { key: 'confirmBeforeClosing', label: translateText("Ask before closing a document with unsaved changes"), type: 'checkbox' },
      { key: 'resetColorsOnLaunch', label: translateText("Reset foreground / background colours on launch"), type: 'checkbox' },
      {
        key: 'webfonts', label: translateText("Web Fonts"), type: 'select',
        options: [
          { value: 'auto', label: translateText("Download when needed") },
          { value: 'off', label: translateText("Never download") },
        ],
        hint: 'Fonts come from Google Fonts. Nothing of yours is sent — this is a '
          + 'download — and a family is kept once fetched, so it works offline afterwards. '
          + 'Turning it off leaves the built-in Google families showing a substitute face.',
      },
    ],
  },
  {
    id: 'interface',
    label: translateText("Interface"),
    params: [
      { key: 'accent', label: translateText("Accent Colour"), type: 'color' },
      { key: 'canvasBg', label: translateText("Canvas Surround"), type: 'color' },
      { key: 'panelWidth', label: translateText("Panel Dock Width"), type: 'slider', min: 240, max: 460, step: 10, unit: 'px' },
      { key: 'toolbarWidth', label: translateText("Toolbar Width"), type: 'slider', min: 40, max: 76, step: 2, unit: 'px' },
      { key: 'rowHeight', label: translateText("Control Height"), type: 'slider', min: 20, max: 34, step: 1, unit: 'px' },
      { key: 'cornerRadius', label: translateText("Corner Radius"), type: 'slider', min: 0, max: 10, step: 1, unit: 'px' },
    ],
  },
  {
    id: 'tools',
    label: translateText("Tools"),
    params: [
      {
        key: 'brushCursor', label: translateText("Painting Cursor"), type: 'radio',
        options: [
          { value: 'normal', label: translateText("Normal Brush Tip") },
          { value: 'full', label: translateText("Full Size Brush Tip") },
          { value: 'precise', label: translateText("Precise") },
        ],
      },
      { key: 'showToolTips', label: translateText("Show tool tips"), type: 'checkbox' },
      { key: 'scrollZoom', label: translateText("Zoom with scroll wheel"), type: 'checkbox' },
      { key: 'showTransformValues', label: translateText("Show transform values while dragging"), type: 'checkbox' },
    ],
  },
  {
    id: 'history',
    label: translateText("History"),
    params: [
      { key: 'historyStates', label: translateText("History States"), type: 'slider', min: 5, max: 200, step: 1 },
      {
        key: 'autoPurgeHistory', label: translateText("Purge the oldest states when memory runs high"), type: 'checkbox',
        hint: 'Uses the memory limit set under Performance.',
      },
    ],
  },
  {
    id: 'performance',
    label: translateText("Performance"),
    params: [
      { key: 'memoryLimitMB', label: translateText("Memory Budget"), type: 'slider', min: 64, max: 4096, step: 64, unit: 'MB' },
      { key: 'maxDocPixels', label: translateText("Warn above"), type: 'slider', min: 10, max: 500, step: 10, unit: 'MP' },
      {
        key: 'previewQuality', label: translateText("Dialog Preview Quality"), type: 'select',
        options: [{ value: 'accurate', label: translateText("Accurate") }, { value: 'fast', label: translateText("Fast (downsampled)") }],
      },
    ],
  },
  {
    id: 'guides',
    label: translateText("Guides & Grid"),
    params: [
      { key: 'showGuides', label: translateText("Show guides"), type: 'checkbox' },
      { key: 'showRulers', label: translateText("Show rulers"), type: 'checkbox' },
      { key: 'showGrid', label: translateText("Show grid"), type: 'checkbox' },
      { key: 'snap', label: translateText("Snap to guides and grid"), type: 'checkbox' },
      { key: 'gridSize', label: translateText("Gridline Every"), type: 'slider', min: 4, max: 200, step: 1, unit: 'px' },
      { key: 'gridSubdivisions', label: translateText("Subdivisions"), type: 'slider', min: 1, max: 20, step: 1 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let stored = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* Private browsing / quota — preferences just will not survive a reload. */
  }
}

/** Read one preference, falling back to the built-in default. */
export function getPref(key, fallback) {
  if (stored[key] !== undefined) return stored[key];
  if (PREF_DEFAULTS[key] !== undefined) return PREF_DEFAULTS[key];
  return fallback;
}

/** Every preference merged over the defaults. */
export function allPrefs() {
  return { ...PREF_DEFAULTS, ...stored };
}

/**
 * Commit the Preferences dialog's working copy.
 *
 * **Writes only what actually changed in the dialog, not the whole copy.** The
 * working copy is a snapshot taken when Preferences opened, so writing it back
 * wholesale reverts anything else that changed meanwhile — and things do change
 * meanwhile: agreeing to send an image to a host writes `aiConsentHosts`, and
 * the AI settings dialog writes `aiModels` and `aiEfforts`. Both are reachable
 * with Preferences open, and both used to be silently undone by clicking OK.
 *
 * A shallow merge is not enough, which is worth stating because it is the
 * obvious fix and it does not work: these preferences are objects, so a stale
 * `aiModels` merged over a fresh one replaces every provider's model at once.
 * Diffing against the state at open is what makes "only what this dialog
 * touched" true for nested values as well as flat ones.
 *
 * Split out from the dialog so the behaviour can be tested without driving one.
 *
 * @param {object} working what the controls have been editing
 * @param {object} opened  a pristine copy of the same thing, taken at open
 */
export function commitPrefs(working, opened = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(working || {})) {
    if (JSON.stringify(value) !== JSON.stringify(opened[key])) patch[key] = value;
  }
  Object.assign(stored, patch);
  persist();
  applyStoredPreferences();
  return patch;
}

/** Write a patch of preferences, persist it and apply it immediately. */
export function setPrefs(patch) {
  Object.assign(stored, patch);
  persist();
  applyStoredPreferences();
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

function shade(hex, amount) {
  const c = parseColor(hex);
  return toHex({
    r: clamp255(c.r + 255 * amount),
    g: clamp255(c.g + 255 * amount),
    b: clamp255(c.b + 255 * amount),
    a: 1,
  });
}

let firstApply = true;

/**
 * Push the stored preferences onto the app singleton and the document root.
 * Safe to call at any time; runs once automatically on import.
 */
export function applyStoredPreferences() {
  const p = allPrefs();

  app.units = p.units;
  app.showGuides = !!p.showGuides;
  app.showRulers = !!p.showRulers;
  app.showGrid = !!p.showGrid;
  app.snap = !!p.snap;
  app.gridSize = p.gridSize;
  app.gridSubdivisions = p.gridSubdivisions;

  app.brushCursor = p.brushCursor;
  app.showToolTips = !!p.showToolTips;
  app.scrollZoom = !!p.scrollZoom;
  app.showTransformValues = !!p.showTransformValues;
  app.previewQuality = p.previewQuality;
  app.historyLimit = p.historyStates;
  app.memoryLimitMB = p.memoryLimitMB;
  app.autoPurgeHistory = !!p.autoPurgeHistory;
  app.recentLimit = p.recentLimit;
  app.confirmBeforeClosing = !!p.confirmBeforeClosing;

  for (const doc of app.docs) doc.history.limit = p.historyStates;

  const root = document.documentElement;
  const accent = toHex(parseColor(p.accent));
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hi', shade(accent, 0.09));
  const a = parseColor(accent);
  root.style.setProperty('--accent-soft', `rgba(${a.r},${a.g},${a.b},0.24)`);
  root.style.setProperty('--bg-canvas', toHex(parseColor(p.canvasBg)));
  root.style.setProperty('--panel-w', `${p.panelWidth}px`);
  root.style.setProperty('--toolbar-w', `${p.toolbarWidth}px`);
  root.style.setProperty('--row-h', `${p.rowHeight}px`);
  root.style.setProperty('--radius', `${p.cornerRadius}px`);

  if (firstApply) {
    firstApply = false;
    if (p.resetColorsOnLaunch) app.resetColors();
  }
  app.emit('prefs-change', p);
  app.requestRender();
}

/* ------------------------------------------------------------------ */
/* History auto-purge                                                  */
/* ------------------------------------------------------------------ */

/** Rough footprint of every pixel buffer a document's history still pins. */
function historyBytes(doc) {
  const seen = new Set();
  let bytes = 0;
  const walk = (list) => {
    for (const s of list || []) {
      for (const cv of [s.canvas, s.tile?.canvas, s.mask, s.maskTile?.canvas]) {
        if (cv && !seen.has(cv)) {
          seen.add(cv);
          bytes += cv.width * cv.height * 4;
        }
      }
      if (s.children) walk(s.children);
    }
  };
  for (const entry of doc.history.states) walk(entry.state.layers);
  return bytes;
}

function purgeIfNeeded(doc) {
  if (!app.autoPurgeHistory) return;
  const budget = (app.memoryLimitMB || 512) * 1048576;
  let guard = 0;
  while (doc.history.states.length > 5 && doc.history.index > 1 && historyBytes(doc) > budget && guard++ < 40) {
    doc.history.states.shift();
    doc.history.index--;
  }
}

app.on('history-change', (doc) => {
  if (doc) purgeIfNeeded(doc);
});

app.on('docs-change', () => {
  for (const doc of app.docs) doc.history.limit = app.historyLimit || PREF_DEFAULTS.historyStates;
});

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

/**
 * Edit > Preferences.
 * @param {string} [categoryId] open straight onto a category
 */
export async function showPreferencesDialog(categoryId = 'general') {
  const working = allPrefs();
  let language = getLocale();
  // Kept pristine so the commit can tell what this dialog actually changed.
  const opened = JSON.parse(JSON.stringify(working));
  const dlg = new Dialog({ title: translateText("Preferences"), width: 620, className: 'pkd-prefs-dialog' });

  const nav = el('div.pkd-prefs-nav');
  const body = el('div.pkd-prefs-body');
  let current = CATEGORIES.find((c) => c.id === categoryId) || CATEGORIES[0];

  const renderBody = () => {
    const form = buildForm(current.params, working, (key, value) => {
      working[key] = value;
      form.refresh();
    });
    body.replaceChildren(el('div.pkd-section', { text: current.label }), form.node);
  };

  const renderNav = () => {
    nav.replaceChildren(
      ...CATEGORIES.map((c) =>
        el('button' + (c === current ? '.active' : ''), {
          type: 'button', text: c.label,
          onclick: () => { current = c; renderNav(); renderBody(); },
        })
      )
    );
  };

  renderNav();
  renderBody();
  const languageSelect = el('select.pk-select', { onchange: (event) => { language = event.target.value; } },
    ...Object.entries(LOCALES).map(([value, text]) => el('option', { value, text })));
  languageSelect.value = language;
  dlg.setBody(
    el('label.pk-field', {}, el('span', { text: translateText('Language') }), languageSelect),
    el('p.pkd-note', { text: translateText('Language applies after reloading. Save your work before reloading.') }),
    el('div.pkd-prefs', {}, nav, body));
  dlg.setButtons([
    {
      label: translateText("Reset Defaults"), subtle: true,
      onClick: () => {
        Object.assign(working, PREF_DEFAULTS);
        renderBody();
        return false;
      },
    },
    { label: translateText("Cancel"), value: null, subtle: true },
    { label: translateText("OK"), primary: true, onClick: (d) => { d.close({ ...working }); return false; } },
  ]);

  const result = await dlg.open();
  if (!result) return null;
  commitPrefs(result, opened);
  if (language !== getLocale()) {
    try {
      saveLocale(language);
      app.toast(translateText('Language saved. Save your work, then reload to apply it.'), 'ok', 8000);
    } catch (err) {
      app.toast(err.message, 'error');
    }
  } else {
    app.toast(translateText('Preferences saved.'), 'ok');
  }
  return result;
}

applyStoredPreferences();
