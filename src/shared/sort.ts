import { parseTimestamp } from './dates';
import type { ActivityKind, Repo, SortMode } from './types';

export interface Activity {
  /** max(created_at, pushed_at) in epoch milliseconds, or null when both are unusable. */
  readonly ms: number | null;
  readonly kind: ActivityKind;
}

export type RepoDateFields = Pick<Repo, 'createdAt' | 'pushedAt' | 'fork'>;

/**
 * Integrated activity date from the spec: max(created_at, pushed_at).
 *
 * - The newer of the two timestamps wins.
 * - `updated_at` is deliberately excluded (description edits are not activity).
 * - For a fork, `created_at` is the moment the fork was created, so a repository
 *   forked today outranks one pushed yesterday even when the fork's `pushed_at`
 *   still points at the upstream history.
 */
export function activityOf(repo: RepoDateFields): Activity {
  const created = parseTimestamp(repo.createdAt);
  const pushed = parseTimestamp(repo.pushedAt);

  if (created === null && pushed === null) {
    return { ms: null, kind: 'unknown' };
  }
  if (pushed !== null && (created === null || pushed >= created)) {
    return { ms: pushed, kind: 'push' };
  }
  return { ms: created, kind: repo.fork ? 'fork' : 'create' };
}

/** Fork-created timestamp; non-fork repositories have no fork date. */
export function forkTimestampOf(repo: RepoDateFields): number | null {
  if (!repo.fork) return null;
  return parseTimestamp(repo.createdAt);
}

function timestampForMode(repo: Repo, mode: SortMode): number | null {
  switch (mode) {
    case 'activity':
      return activityOf(repo).ms;
    case 'created':
      return parseTimestamp(repo.createdAt);
    case 'forked':
      return forkTimestampOf(repo);
    case 'pushed':
      return parseTimestamp(repo.pushedAt);
    case 'updated':
      return parseTimestamp(repo.updatedAt);
    default:
      return null;
  }
}

/** Deterministic, locale-independent string comparison. */
function compareText(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Descending by timestamp; missing values always sort last. */
function compareTimestampDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareTieBreak(a: Repo, b: Repo): number {
  return compareText(a.fullName, b.fullName) || a.id - b.id;
}

/**
 * Sorts a copy of `repos` for the given mode.
 *
 * Order: timestamp descending, then full_name ascending, then id ascending.
 * Dates are compared in UTC because the parsed epoch value is timezone free;
 * rendering converts to local time.
 */
export function sortRepos(repos: readonly Repo[], mode: SortMode): Repo[] {
  const decorated = repos.map((repo) => ({
    repo,
    value: timestampForMode(repo, mode),
  }));

  decorated.sort(
    (a, b) => compareTimestampDesc(a.value, b.value) || compareTieBreak(a.repo, b.repo),
  );

  return decorated.map((entry) => entry.repo);
}
