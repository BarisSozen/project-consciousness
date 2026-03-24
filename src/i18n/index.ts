/**
 * i18n Module — Locale Management
 *
 * Usage:
 *   import { t, setLocale } from './i18n/index.js';
 *   setLocale('tr');
 *   console.log(t().orchestratorStarting); // "🚀 Orkestrasyon başlıyor..."
 *
 * Auto-detect from env:
 *   PC_LOCALE=tr   → Türkçe
 *   PC_LOCALE=en   → English (default)
 */

import type { Locale, LocaleStrings } from './types.js';
import { en } from './en.js';
import { tr } from './tr.js';

export type { Locale, LocaleStrings } from './types.js';

const locales: Record<Locale, LocaleStrings> = { en, tr };

let currentLocale: Locale = (process.env['PC_LOCALE'] as Locale) ?? 'en';

/**
 * Set the active locale
 */
export function setLocale(locale: Locale): void {
  if (!locales[locale]) {
    throw new Error(`Unknown locale: ${locale}. Available: ${Object.keys(locales).join(', ')}`);
  }
  currentLocale = locale;
}

/**
 * Get current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get locale strings for the active locale
 */
export function t(): LocaleStrings {
  return locales[currentLocale];
}

/**
 * Get locale strings for a specific locale
 */
export function tFor(locale: Locale): LocaleStrings {
  return locales[locale];
}
