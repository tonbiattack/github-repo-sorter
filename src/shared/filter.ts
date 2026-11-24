import type { Repo, Scope } from './types';

export interface FilterOptions {
  readonly scope: Scope;
  readonly query: string;
}

export interface Page<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  /** 1-based index of the first row on this page, or 0 for an empty result. */
  readonly start: number;
  /** 1-based index of the last row on this page. */
  readonly end: number;
}

export const DEFAULT_PAGE_SIZE = 30;

/**
 * True when every whitespace-separated term in `query` appears in the
 * repository name or description (case-insensitive partial match).
 * An empty query matches everything.
 */
export function matchesQuery(repo: Repo, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return true;
  const haystack = `${repo.name}\n${repo.description ?? ''}`.toLowerCase();
  return normalized.split(/\s+/).every((term) => haystack.includes(term));
}

export function matchesScope(repo: Repo, scope: Scope): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'forks':
      return repo.fork;
    case 'non-forks':
      return !repo.fork;
    default:
      return true;
  }
}

/** Applies scope and query filters. Filtering happens before pagination. */
export function filterRepos(repos: readonly Repo[], options: FilterOptions): Repo[] {
  return repos.filter((repo) => matchesScope(repo, options.scope) && matchesQuery(repo, options.query));
}

/** Clamps `page` into range and slices the visible page. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Page<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  const safePage = Math.min(Math.max(1, requested), totalPages);
  const offset = (safePage - 1) * safePageSize;
  const slice = items.slice(offset, offset + safePageSize);

  return {
    items: slice,
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    start: total === 0 ? 0 : offset + 1,
    end: offset + slice.length,
  };
}
