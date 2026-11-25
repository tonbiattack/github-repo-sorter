import { DEFAULT_PAGE_SIZE, filterRepos, paginate } from './filter';
import { sortRepos } from './sort';
import type { Page } from './filter';
import type { Repo, Scope, SortMode, TypeFilter, VisibilityFilter } from './types';

export interface ViewOptions {
  readonly repos: readonly Repo[];
  readonly sort: SortMode;
  readonly scope: Scope;
  readonly query: string;
  readonly page: number;
  readonly pageSize?: number;
  readonly type?: TypeFilter;
  readonly language?: string;
  readonly visibility?: VisibilityFilter;
}

export interface View {
  /** The visible slice, after filtering, sorting and pagination. */
  readonly page: Page<Repo>;
  /** All rows after filtering and sorting. */
  readonly filtered: Repo[];
  readonly total: number;
  readonly totalFiltered: number;
}

/**
 * Full display pipeline: filter, sort, then paginate.
 * Filtering before pagination is required by the spec (30 rows per page).
 */
export function buildView(options: ViewOptions): View {
  const filtered = sortRepos(
    filterRepos(options.repos, {
      scope: options.scope,
      query: options.query,
      type: options.type,
      language: options.language,
      visibility: options.visibility,
    }),
    options.sort,
  );
  const page = paginate(filtered, options.page, options.pageSize ?? DEFAULT_PAGE_SIZE);
  return { page, filtered, total: options.repos.length, totalFiltered: filtered.length };
}
