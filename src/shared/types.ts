/**
 * Shared domain types for GitHub Repo Sorter.
 *
 * `Repo` is the normalised subset of the GitHub REST API repository object that
 * the sorter needs. Everything else is discarded so that the values cached in
 * the service worker stay small.
 */

export interface Repo {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly visibility: 'public' | 'private';
  readonly fork: boolean;
  readonly createdAt: string | null;
  readonly pushedAt: string | null;
  readonly updatedAt: string | null;
  readonly owner: string;
}

/** Sort modes offered in the UI. `standard` is a view, not a sort order. */
export type SortMode = 'activity' | 'created' | 'forked' | 'pushed' | 'updated';

export type Scope = 'all' | 'forks' | 'non-forks';

/** Which timestamp produced the integrated activity date. */
export type ActivityKind = 'push' | 'create' | 'fork' | 'unknown';

export type AuthMode = 'public' | 'authenticated';

export type FetchErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'http'
  | 'owner-mismatch'
  | 'invalid-link'
  | 'max-pages'
  | 'invalid-response'
  | 'aborted'
  | 'unknown';

export interface FetchErrorInfo {
  readonly kind: FetchErrorKind;
  readonly message: string;
  readonly status?: number;
  /** Epoch milliseconds at which the rate limit is expected to reset. */
  readonly retryAt?: number;
}

export const SORT_MODES: readonly SortMode[] = [
  'activity',
  'created',
  'forked',
  'pushed',
  'updated',
] as const;

export const SCOPES: readonly Scope[] = ['all', 'forks', 'non-forks'] as const;
