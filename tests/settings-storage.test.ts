import { describe, expect, it } from 'vitest';
import { createSettingsStore, createTokenStore, TOKEN_KEY, TOKEN_PERSIST_KEY } from '../src/background/storage';
import { DEFAULT_SETTINGS, sanitizeSettings, settingsKey } from '../src/shared/settings';
import { memoryArea } from './helpers';

describe('sanitizeSettings', () => {
  it('returns defaults for missing or malformed data', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ sort: 'nope', scope: 42 })).toEqual(DEFAULT_SETTINGS);
  });

  it('restores an explicit standard view', () => {
    expect(sanitizeSettings({ sort: 'activity', scope: 'all', view: 'standard' }).view).toBe('standard');
    expect(sanitizeSettings({ sort: 'activity', scope: 'all', view: 'bad' }).view).toBe('sorter');
  });

  it('keeps valid fields and replaces only invalid ones', () => {
    expect(sanitizeSettings({ sort: 'created' })).toEqual({
      sort: 'created', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all',
    });
    expect(sanitizeSettings({ scope: 'forks' })).toEqual({
      sort: 'activity', scope: 'forks', view: 'sorter', type: 'all', language: 'all', visibility: 'all',
    });
    expect(sanitizeSettings({ sort: 'pushed', scope: 'non-forks' })).toEqual({
      sort: 'pushed',
      scope: 'non-forks',
      view: 'sorter',
      type: 'all',
      language: 'all',
      visibility: 'all',
    });
  });

  it('validates the Type, Language and Visibility filters', () => {
    expect(sanitizeSettings({ type: 'archived', language: 'c++', visibility: 'private' })).toMatchObject({
      type: 'archived',
      language: 'c++',
      visibility: 'private',
    });
    expect(sanitizeSettings({ type: 'bogus', language: 'Not A Slug', visibility: 'secret' })).toMatchObject({
      type: 'all',
      language: 'all',
      visibility: 'all',
    });
  });
});

describe('settingsKey', () => {
  it('lowercases the owner', () => {
    expect(settingsKey('Owner')).toBe('grs:settings:owner');
  });
});

describe('createSettingsStore', () => {
  it('reads defaults when nothing is stored', async () => {
    const store = createSettingsStore(memoryArea());
    await expect(store.read('owner')).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('writes and reads owner-scoped settings', async () => {
    const area = memoryArea();
    const store = createSettingsStore(area);

    await store.write('Owner', { sort: 'created', scope: 'forks', view: 'sorter', type: 'all', language: 'all', visibility: 'all' });
    expect(area.data[settingsKey('owner')]).toEqual({ sort: 'created', scope: 'forks', view: 'sorter', type: 'all', language: 'all', visibility: 'all' });

    await expect(store.read('owner')).resolves.toEqual({ sort: 'created', scope: 'forks', view: 'sorter', type: 'all', language: 'all', visibility: 'all' });
    await expect(store.read('other')).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizes values written by an older version', async () => {
    const area = memoryArea({ [settingsKey('owner')]: { sort: 'removed-mode', scope: 'forks' } });
    const store = createSettingsStore(area);
    await expect(store.read('owner')).resolves.toEqual({ sort: 'activity', scope: 'forks', view: 'sorter', type: 'all', language: 'all', visibility: 'all' });
  });
});

describe('createTokenStore', () => {
  it('round-trips a token in the session area', async () => {
    const area = memoryArea();
    const store = createTokenStore(area);

    await expect(store.read()).resolves.toBeNull();
    await store.write('ghp_token1234567890');
    expect(area.data[TOKEN_KEY]).toBe('ghp_token1234567890');
    await expect(store.read()).resolves.toBe('ghp_token1234567890');
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
    expect(area.data[TOKEN_KEY]).toBeUndefined();
  });

  it('ignores blank stored values', async () => {
    const area = memoryArea({ [TOKEN_KEY]: '   ' });
    const store = createTokenStore(area);
    await expect(store.read()).resolves.toBeNull();
  });

  it('does not persist by default', async () => {
    const session = memoryArea();
    const local = memoryArea();
    const store = createTokenStore(session, local);

    await store.write('ghp_token1234567890');
    expect(session.data[TOKEN_KEY]).toBe('ghp_token1234567890');
    expect(local.data[TOKEN_KEY]).toBeUndefined();
    await expect(store.isPersistent()).resolves.toBe(false);
  });

  it('mirrors the token into local storage when persistence is requested', async () => {
    const session = memoryArea();
    const local = memoryArea();
    const store = createTokenStore(session, local);

    await store.write('ghp_token1234567890', { persist: true });
    expect(local.data[TOKEN_KEY]).toBe('ghp_token1234567890');
    expect(local.data[TOKEN_PERSIST_KEY]).toBe(true);
    await expect(store.isPersistent()).resolves.toBe(true);
  });

  it('restores a persisted token after the session area is cleared', async () => {
    const session = memoryArea();
    const local = memoryArea();
    const store = createTokenStore(session, local);
    await store.write('ghp_token1234567890', { persist: true });

    // Simulate a browser restart: the session area is empty.
    session.data[TOKEN_KEY] = undefined;
    delete session.data[TOKEN_KEY];

    await expect(store.read()).resolves.toBe('ghp_token1234567890');
    // The token is promoted back into the session area for the fast path.
    expect(session.data[TOKEN_KEY]).toBe('ghp_token1234567890');
  });

  it('removes both copies on clear', async () => {
    const session = memoryArea();
    const local = memoryArea();
    const store = createTokenStore(session, local);
    await store.write('ghp_token1234567890', { persist: true });

    await store.clear();
    expect(session.data[TOKEN_KEY]).toBeUndefined();
    expect(local.data[TOKEN_KEY]).toBeUndefined();
    expect(local.data[TOKEN_PERSIST_KEY]).toBeUndefined();
    await expect(store.isPersistent()).resolves.toBe(false);
  });

  it('drops an older persistent copy when saving without persistence', async () => {
    const session = memoryArea();
    const local = memoryArea();
    const store = createTokenStore(session, local);
    await store.write('ghp_token1234567890', { persist: true });

    await store.write('ghp_token1234567890');
    expect(local.data[TOKEN_KEY]).toBeUndefined();
    expect(local.data[TOKEN_PERSIST_KEY]).toBeUndefined();
  });
});
