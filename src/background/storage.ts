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
/** Opt-in flag: when true the token is mirrored into `chrome.storage.local`. */
export const TOKEN_PERSIST_KEY = 'grs:pat-persist';

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
  write(token: string, options?: { readonly persist?: boolean }): Promise<void>;
  clear(): Promise<void>;
  /** True when the token is currently mirrored into persistent storage. */
  isPersistent(): Promise<boolean>;
}

/**
 * Token storage.
 *
 * Default: `chrome.storage.session` only. It survives service-worker restarts
 * but not a browser restart, and it is never handed to content scripts.
 *
 * Opt-in: when the user explicitly enables "remember across restarts", the
 * token is *also* written to `chrome.storage.local`. That area is plain-text on
 * disk (protected only by the OS user profile), so the options page explains
 * the trade-off before enabling it. `clear()` always removes both copies.
 */
export function createTokenStore(session: KeyValueArea, local?: KeyValueArea): TokenStore {
  async function readPersistFlag(): Promise<boolean> {
    if (!local) return false;
    const stored = await local.get(TOKEN_PERSIST_KEY);
    return stored[TOKEN_PERSIST_KEY] === true;
  }

  return {
    async read(): Promise<string | null> {
      const sessionStored = await session.get(TOKEN_KEY);
      const fromSession = sessionStored[TOKEN_KEY];
      if (typeof fromSession === 'string' && fromSession.trim() !== '') return fromSession;

      // A browser restart clears the session area; fall back to the opt-in copy.
      if (!local) return null;
      const localStored = await local.get(TOKEN_KEY);
      const fromLocal = localStored[TOKEN_KEY];
      if (typeof fromLocal !== 'string' || fromLocal.trim() === '') return null;
      // Promote it back into the session area so the fast path works again.
      await session.set({ [TOKEN_KEY]: fromLocal });
      return fromLocal;
    },

    async write(token: string, options: { readonly persist?: boolean } = {}): Promise<void> {
      await session.set({ [TOKEN_KEY]: token });
      if (!local) return;
      if (options.persist === true) {
        await local.set({ [TOKEN_KEY]: token, [TOKEN_PERSIST_KEY]: true });
        return;
      }
      // Writing without persistence must not leave an older copy behind.
      await local.remove([TOKEN_KEY, TOKEN_PERSIST_KEY]);
    },

    async clear(): Promise<void> {
      await session.remove(TOKEN_KEY);
      if (local) await local.remove([TOKEN_KEY, TOKEN_PERSIST_KEY]);
    },

    isPersistent: readPersistFlag,
  };
}
