import en from '../../_locales/en/messages.json';
import ja from '../../_locales/ja/messages.json';

/** Message catalogs. `en` is the fallback and the source of the key union. */
export const MESSAGES = { en, ja } as const;

export type MessageCatalog = typeof en;
export type MessageKey = keyof MessageCatalog;
export type Locale = keyof typeof MESSAGES;

export const LOCALES: readonly Locale[] = ['en', 'ja'] as const;

/** Chrome's display language; anything that is not Japanese falls back to English. */
export function resolveLocale(languageTag: string | null | undefined): Locale {
  if (typeof languageTag !== 'string') return 'en';
  return languageTag.trim().toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/**
 * The locale used for this document. `chrome.i18n.getUILanguage()` reflects the
 * browser's display language rather than the GitHub page language, which is what
 * the extension should follow.
 */
export function currentLocale(): Locale {
  try {
    const getUILanguage = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } })
      .chrome?.i18n?.getUILanguage;
    if (typeof getUILanguage === 'function') return resolveLocale(getUILanguage());
  } catch {
    // chrome.* can be unavailable while the service worker is starting.
  }
  const navigatorLanguage = (globalThis as { navigator?: { language?: string } }).navigator?.language;
  return resolveLocale(navigatorLanguage);
}

/** Placeholder substitution matching Chrome's `$1`-style positional messages. */
function substitute(template: string, substitutions: readonly (string | number)[]): string {
  if (substitutions.length === 0) return template;
  return template.replace(/\$(\d+)/g, (match, index: string) => {
    const value = substitutions[Number(index) - 1];
    return value === undefined ? match : String(value);
  });
}

/**
 * Pure translation used by tests and as the fallback when `chrome.i18n` is not
 * available (for example in unit tests). Unknown keys return the key itself so a
 * missing message is visible rather than silently empty.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  substitutions: readonly (string | number)[] = [],
): string {
  const entry = MESSAGES[locale][key] ?? MESSAGES.en[key];
  if (!entry) return key;
  return substitute(entry.message, substitutions);
}

/**
 * Runtime translation. Uses `chrome.i18n` so the browser's own locale files are
 * the single source of truth, and falls back to the bundled catalogs.
 */
export function t(key: MessageKey, ...substitutions: (string | number)[]): string {
  try {
    const getMessage = (globalThis as {
      chrome?: { i18n?: { getMessage?: (name: string, args?: (string | number)[]) => string } };
    }).chrome?.i18n?.getMessage;
    if (typeof getMessage === 'function') {
      const value = getMessage(key, substitutions.length > 0 ? substitutions : undefined);
      if (typeof value === 'string' && value !== '') return value;
    }
  } catch {
    // fall through to the bundled catalog
  }
  return translate(currentLocale(), key, substitutions);
}

const dateFormatters = new Map<Locale, Intl.DateTimeFormat>();
const timeFormatters = new Map<Locale, Intl.DateTimeFormat>();
const numberFormatters = new Map<Locale, Intl.NumberFormat>();

function intlLocale(locale: Locale): string {
  return locale === 'ja' ? 'ja-JP' : 'en-US';
}

/** Formats an epoch millisecond value in the browser's timezone for `locale`. */
export function formatDateTime(ms: number | null, locale: Locale = currentLocale()): string {
  if (ms === null || !Number.isFinite(ms)) return translate(locale, 'dateNone');
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(locale), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(ms));
}

/** Short clock time, used where only the time of day matters. */
export function formatTime(ms: number | null, locale: Locale = currentLocale()): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  let formatter = timeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit' });
    timeFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(ms));
}

/** Locale-aware number formatting for counts such as stars and forks. */
export function formatNumber(value: number, locale: Locale = currentLocale()): string {
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(intlLocale(locale));
    numberFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}

/** Relative label such as "3 min ago" / "3分前". */
export function formatRelativeTime(
  fromMs: number,
  nowMs: number,
  locale: Locale = currentLocale(),
): string {
  const minutes = Math.floor(Math.max(0, nowMs - fromMs) / 60_000);
  if (locale === 'ja') {
    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    return `${Math.floor(hours / 24)}日前`;
  }
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
