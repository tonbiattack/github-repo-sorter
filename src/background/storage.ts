import type { SorterSettings } from '../shared/settings';
import { sanitizeSettings } from '../shared/settings';

/**
 * Minimal promise-based storage surface, injected so the stores can be tested
 * without the `chrome.storage` implementation.
 */
export interface KeyValueArea {
  get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const TOKEN_KEY = 'grs:pat';

export interface SettingsStore {
  read(owner: string): Promise<SorterSettings>;
  write(owner: string, settings: SorterSettings): Promise<void>;
}

export function createSettingsStore(area: KeyValueArea): SettingsStore {
  return {
    async read(owner: string): Promise<SorterSettings> {
      const key = settingsStorageKey(owner);
      const stored = await area.get(key);
      return sanitizeSettings(stored[key]);
    },
    async write(owner: string, settings: SorterSettings): Promise<void> {
      await area.set({ [settingsStorageKey(owner)]: settings });
    },
  };
}

function settingsStorageKey(owner: string): string {
  return `grs:settings:${owner.toLowerCase()}`;
}

export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The access token lives in `chrome.storage.session`: it survives service
 * worker restarts but not a browser restart, and it is never handed to content
 * scripts or persisted to disk.
 */
export function createTokenStore(area: KeyValueArea): TokenStore {
  return {
    async read(): Promise<string | null> {
      const stored = await area.get(TOKEN_KEY);
      const token = stored[TOKEN_KEY];
      return typeof token === 'string' && token.trim() !== '' ? token : null;
    },
    async write(token: string): Promise<void> {
      await area.set({ [TOKEN_KEY]: token });
    },
    async clear(): Promise<void> {
      await area.remove(TOKEN_KEY);
    },
  };
}
