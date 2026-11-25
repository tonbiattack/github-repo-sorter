import { SCOPES, SORT_MODES } from './types';
import type { Scope, SortMode } from './types';

/** Settings persisted per owner. Transient view state (page, query) is not saved. */
export interface SorterSettings {
  readonly sort: SortMode;
  readonly scope: Scope;
  /** Explicit standard selection survives reload; older settings default to the extension. */
  readonly view: 'sorter' | 'standard';
}

export const DEFAULT_SETTINGS: SorterSettings = Object.freeze({
  sort: 'activity',
  scope: 'all',
  view: 'sorter',
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

/** Coerces unknown stored data into valid settings, falling back per field. */
export function sanitizeSettings(raw: unknown): SorterSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  return {
    sort: isSortMode(record.sort) ? record.sort : DEFAULT_SETTINGS.sort,
    scope: isScope(record.scope) ? record.scope : DEFAULT_SETTINGS.scope,
    view: record.view === 'standard' ? 'standard' : 'sorter',
  };
}
