import { SCOPES, SORT_MODES, TYPE_FILTERS, VISIBILITY_FILTERS } from './types';
import type { Scope, SortMode, TypeFilter, VisibilityFilter } from './types';

/** Settings persisted per owner. Transient view state (page, query) is not saved. */
export interface SorterSettings {
  readonly sort: SortMode;
  readonly scope: Scope;
  /** Explicit standard selection survives reload; older settings default to the extension. */
  readonly view: 'sorter' | 'standard';
  /** GitHub Type menu value; `all` when unset. */
  readonly type: TypeFilter;
  /** GitHub Language menu slug; `all` when unset. */
  readonly language: string;
  /** GitHub Visibility menu value; `all` when unset. */
  readonly visibility: VisibilityFilter;
}

export const DEFAULT_SETTINGS: SorterSettings = Object.freeze({
  sort: 'activity',
  scope: 'all',
  view: 'sorter',
  type: 'all',
  language: 'all',
  visibility: 'all',
});

export const SETTINGS_KEY_PREFIX = 'grs:settings:';

export function settingsKey(owner: string): string {
  return `${SETTINGS_KEY_PREFIX}${owner.toLowerCase()}`;
}

export function isSortMode(value: unknown): value is SortMode {
  return typeof value === 'string' && (SORT_MODES as readonly string[]).includes(value);
}

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

export function isTypeFilter(value: unknown): value is TypeFilter {
  return typeof value === 'string' && (TYPE_FILTERS as readonly string[]).includes(value);
}

export function isVisibilityFilter(value: unknown): value is VisibilityFilter {
  return typeof value === 'string' && (VISIBILITY_FILTERS as readonly string[]).includes(value);
}

/** Language slugs are GitHub's own lower-case menu values. */
export function isLanguageSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9+#.-]{1,40}$/.test(value);
}

/** Coerces unknown stored data into valid settings, falling back per field. */
export function sanitizeSettings(raw: unknown): SorterSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  return {
    sort: isSortMode(record.sort) ? record.sort : DEFAULT_SETTINGS.sort,
    scope: isScope(record.scope) ? record.scope : DEFAULT_SETTINGS.scope,
    view: record.view === 'standard' ? 'standard' : 'sorter',
    type: isTypeFilter(record.type) ? record.type : DEFAULT_SETTINGS.type,
    language: isLanguageSlug(record.language) ? record.language : DEFAULT_SETTINGS.language,
    visibility: isVisibilityFilter(record.visibility)
      ? record.visibility
      : DEFAULT_SETTINGS.visibility,
  };
}
