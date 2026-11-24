import type { AuthMode } from './types';

export interface CacheHit<V> {
  readonly value: V;
  /** Epoch milliseconds at which the entry was stored. */
  readonly storedAt: number;
}

/** Small TTL cache. Values live in the service worker's memory only. */
export class TtlCache<V> {
  private readonly entries = new Map<string, CacheHit<V>>();

  constructor(
    readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries: number = 64,
  ) {}

  get(key: string): CacheHit<V> | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (this.now() - hit.storedAt >= this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return hit;
  }

  set(key: string, value: V): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.entries.set(key, { value, storedAt: this.now() });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, hit] of this.entries) {
      if (hit.storedAt < oldestAt) {
        oldestAt = hit.storedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) this.entries.delete(oldestKey);
  }
}

export interface CacheContext {
  readonly mode: AuthMode;
  readonly login: string | null;
}

/**
 * Cache key separated by owner and authentication context, so a public listing
 * and an authenticated listing (and different accounts) never mix.
 */
export function repoCacheKey(owner: string, context: CacheContext): string {
  const identity =
    context.mode === 'public' ? 'public' : `auth:${(context.login ?? 'unknown').toLowerCase()}`;
  return `${identity}:${owner.toLowerCase()}`;
}
