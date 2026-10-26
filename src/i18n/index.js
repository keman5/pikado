import en from './locales/en.js';
import zhCN from './locales/zh-CN.js';

export const LOCALES = { 'zh-CN': zhCN['Simplified Chinese'], en: 'English' };
const STORAGE_KEY = 'pikado.locale';
const catalogs = { en, 'zh-CN': zhCN };

export function normalizeLocale(value) {
  return Object.hasOwn(catalogs, value) ? value : 'zh-CN';
}

function storedLocale() {
  try { return normalizeLocale(globalThis.localStorage?.getItem(STORAGE_KEY)); }
  catch { return 'zh-CN'; }
}

// Registry labels are created at module load, so a saved language applies on reload.
const locale = storedLocale();
export const getLocale = () => locale;
export function saveLocale(value) {
  if (!Object.hasOwn(catalogs, value)) throw new Error('Unsupported language');
  globalThis.localStorage.setItem(STORAGE_KEY, value);
}

export function translate(language, value, ...args) {
  if (typeof value !== 'string') return value;
  const messages = catalogs[normalizeLocale(language)];
  let result = Object.hasOwn(messages, value) ? messages[value] : value;
  if (result === value && Object.hasOwn(messages, `${value}...`)) {
    result = messages[`${value}...`].replace(/(?:\.\.\.|…)$/, '');
  }
  return result.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < args.length ? String(args[Number(index)]) : placeholder);
}

export const t = (value, ...args) => translate(locale, value, ...args);

export function applyPageLocale() {
  document.documentElement.lang = locale;
  document.title = t('Pikado — Image Studio');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t(
    'Free online image editor with layers, masks, PSD, filters and offline editing. Images are processed on your device.'));
  document.querySelector('link[rel="manifest"]')?.setAttribute('href',
    locale === 'en' ? './manifest.webmanifest' : './manifest.zh-CN.webmanifest');
}
