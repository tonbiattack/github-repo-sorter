import { describe, expect, it } from 'vitest';
import { TtlCache, repoCacheKey } from '../src/shared/cache';

describe('TtlCache', () => {
  it('returns a value inside the TTL and expires after it', () => {
    let now = 1_000;
    const cache = new TtlCache<string>(5 * 60_000, () => now);

    cache.set('a', 'value');
    expect(cache.get('a')).toEqual({ value: 'value', storedAt: 1_000 });

    now += 5 * 60_000 - 1;
    expect(cache.get('a')).not.toBeNull();

    now += 1;
    expect(cache.get('a')).toBeNull();
  });

  it('invalidates individual keys and clears everything', () => {
    const cache = new TtlCache<number>(1_000, () => 0);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).not.toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entry beyond the capacity', () => {
    let now = 0;
    const cache = new TtlCache<number>(10_000, () => now, 2);
    cache.set('a', 1);
    now += 10;
    cache.set('b', 2);
    now += 10;
    cache.set('c', 3);

    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
  });

  it('overwriting a key does not evict anything', () => {
    const cache = new TtlCache<number>(10_000, () => 0, 1);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')?.value).toBe(2);
  });
});

describe('repoCacheKey', () => {
  it('separates owners and auth contexts', () => {
    const publicOwner = repoCacheKey('Owner', { mode: 'public', login: null });
    const authedOwner = repoCacheKey('owner', { mode: 'authenticated', login: 'Owner' });
    const otherAccount = repoCacheKey('owner', { mode: 'authenticated', login: 'other' });

    expect(publicOwner).not.toBe(authedOwner);
    expect(authedOwner).not.toBe(otherAccount);
    expect(repoCacheKey('OWNER', { mode: 'public', login: null })).toBe(publicOwner);
  });
});
