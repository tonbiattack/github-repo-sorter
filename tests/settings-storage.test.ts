import { describe, expect, it } from 'vitest';
import { createSettingsStore, createTokenStore, TOKEN_KEY } from '../src/background/storage';
import { DEFAULT_SETTINGS, sanitizeSettings, settingsKey } from '../src/shared/settings';
import { memoryArea } from './helpers';

describe('sanitizeSettings', () => {
  it('returns defaults for missing or malformed data', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ sort: 'nope', scope: 42 })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and replaces only invalid ones', () => {
    expect(sanitizeSettings({ sort: 'created' })).toEqual({ sort: 'created', scope: 'all' });
    expect(sanitizeSettings({ scope: 'forks' })).toEqual({ sort: 'activity', scope: 'forks' });
    expect(sanitizeSettings({ sort: 'pushed', scope: 'non-forks' })).toEqual({
      sort: 'pushed',
      scope: 'non-forks',
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

    await store.write('Owner', { sort: 'created', scope: 'forks' });
    expect(area.data[settingsKey('owner')]).toEqual({ sort: 'created', scope: 'forks' });

    await expect(store.read('owner')).resolves.toEqual({ sort: 'created', scope: 'forks' });
    await expect(store.read('other')).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizes values written by an older version', async () => {
    const area = memoryArea({ [settingsKey('owner')]: { sort: 'removed-mode', scope: 'forks' } });
    const store = createSettingsStore(area);
    await expect(store.read('owner')).resolves.toEqual({ sort: 'activity', scope: 'forks' });
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
});
