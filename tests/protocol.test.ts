import { describe, expect, it } from 'vitest';
import {
  CHANNEL,
  isProgressMessage,
  isValidOwner,
  parseRepoListUrl,
  parseRequest,
} from '../src/shared/protocol';

describe('parseRepoListUrl', () => {
  it('accepts the repositories tab URL', () => {
    expect(parseRepoListUrl('https://github.com/tonbiattack?tab=repositories')).toEqual({
      owner: 'tonbiattack',
    });
    expect(parseRepoListUrl('https://github.com/tonbiattack/?tab=repositories')).toEqual({
      owner: 'tonbiattack',
    });
    expect(parseRepoListUrl('https://github.com/Some-Org?ref=main&tab=repositories')).toEqual({
      owner: 'Some-Org',
    });
  });

  it('rejects every other page', () => {
    expect(parseRepoListUrl('https://github.com/tonbiattack')).toBeNull();
    expect(parseRepoListUrl('https://github.com/tonbiattack?tab=stars')).toBeNull();
    expect(parseRepoListUrl('https://github.com/tonbiattack/repo?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('https://github.com/settings?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('http://github.com/tonbiattack?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('https://www.github.com/tonbiattack?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('https://gist.github.com/tonbiattack?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('not a url')).toBeNull();
  });

  it('rejects names that cannot be GitHub owners', () => {
    expect(parseRepoListUrl('https://github.com/owner_name?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('https://github.com/-owner?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('https://github.com/owner-?tab=repositories')).toBeNull();
    expect(parseRepoListUrl('https://github.com/own--er?tab=repositories')).toBeNull();
    expect(parseRepoListUrl(`https://github.com/${'a'.repeat(40)}?tab=repositories`)).toBeNull();
  });
});

describe('isValidOwner', () => {
  it('accepts ordinary user and organisation names', () => {
    expect(isValidOwner('octocat')).toBe(true);
    expect(isValidOwner('Some-Org')).toBe(true);
    expect(isValidOwner('a')).toBe(true);
    expect(isValidOwner('a'.repeat(39))).toBe(true);
  });

  it('rejects reserved paths and malformed names', () => {
    expect(isValidOwner('settings')).toBe(false);
    expect(isValidOwner('explore')).toBe(false);
    expect(isValidOwner('')).toBe(false);
    expect(isValidOwner('a b')).toBe(false);
  });
});

describe('parseRequest', () => {
  it('accepts a well-formed fetch request', () => {
    const request = parseRequest({
      channel: CHANNEL,
      type: 'fetch',
      requestId: 'req-1',
      owner: 'owner',
      force: false,
    });
    expect(request).toEqual({
      channel: CHANNEL,
      type: 'fetch',
      requestId: 'req-1',
      owner: 'owner',
      force: false,
    });
  });

  it('keeps a valid authMode override only', () => {
    const withOverride = parseRequest({
      channel: CHANNEL,
      type: 'fetch',
      requestId: 'req-1',
      owner: 'owner',
      force: true,
      authMode: 'public',
    });
    expect(withOverride).toMatchObject({ authMode: 'public', force: true });

    const withJunk = parseRequest({
      channel: CHANNEL,
      type: 'fetch',
      requestId: 'req-1',
      owner: 'owner',
      force: false,
      authMode: 'root',
    });
    expect(withJunk).not.toHaveProperty('authMode');
  });

  it('rejects foreign channels, bad owners and malformed fields', () => {
    expect(parseRequest({ channel: 'other', type: 'fetch', requestId: 'r', owner: 'owner', force: false })).toBeNull();
    expect(parseRequest({ channel: CHANNEL, type: 'fetch', requestId: 'r', owner: 'bad owner', force: false })).toBeNull();
    expect(parseRequest({ channel: CHANNEL, type: 'fetch', owner: 'owner', force: false })).toBeNull();
    expect(parseRequest({ channel: CHANNEL, type: 'fetch', requestId: 'r', owner: 'owner', force: 'yes' })).toBeNull();
    expect(parseRequest({ channel: CHANNEL, type: 'cancel' })).toBeNull();
    expect(parseRequest(null)).toBeNull();
    expect(parseRequest('hello')).toBeNull();
    expect(parseRequest({ channel: CHANNEL, type: 'unknown' })).toBeNull();
  });

  it('validates settings payloads without copying extra keys', () => {
    const request = parseRequest({
      channel: CHANNEL,
      type: 'settings-set',
      owner: 'owner',
      settings: { sort: 'created', scope: 'forks', injected: 'x' },
    });
    expect(request).toEqual({
      channel: CHANNEL,
      type: 'settings-set',
      owner: 'owner',
      settings: { sort: 'created', scope: 'forks' },
    });
    expect(parseRequest({ channel: CHANNEL, type: 'settings-set', owner: 'owner', settings: 'x' })).toBeNull();
  });

  it('validates token length for auth-set', () => {
    expect(parseRequest({ channel: CHANNEL, type: 'auth-set', token: 'short' })).toBeNull();
    expect(
      parseRequest({ channel: CHANNEL, type: 'auth-set', token: `ghp_${'x'.repeat(30)}` }),
    ).toMatchObject({ type: 'auth-set' });
  });
});

describe('isProgressMessage', () => {
  it('accepts a well-formed progress message', () => {
    expect(
      isProgressMessage({
        channel: CHANNEL,
        type: 'fetch-progress',
        requestId: 'req-1',
        page: 2,
        received: 200,
      }),
    ).toBe(true);
  });

  it('rejects malformed progress messages', () => {
    expect(isProgressMessage({ channel: 'other', type: 'fetch-progress' })).toBe(false);
    expect(
      isProgressMessage({
        channel: CHANNEL,
        type: 'fetch-progress',
        requestId: 'req-1',
        page: 'two',
        received: 1,
      }),
    ).toBe(false);
    expect(isProgressMessage(null)).toBe(false);
  });
});
