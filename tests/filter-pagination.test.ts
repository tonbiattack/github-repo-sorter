import { describe, expect, it } from 'vitest';
import { filterRepos, matchesQuery, paginate } from '../src/shared/filter';
import { buildView } from '../src/shared/view';
import { makeRepo } from './helpers';

describe('query filtering', () => {
  const apiRepo = makeRepo(1, { name: 'api-client', description: 'HTTP client for APIs' });
  const docsRepo = makeRepo(2, { name: 'docs', description: 'Documentation site' });

  it('matches names and descriptions case-insensitively', () => {
    expect(matchesQuery(apiRepo, 'API')).toBe(true);
    expect(matchesQuery(apiRepo, 'http CLIENT')).toBe(true);
    expect(matchesQuery(docsRepo, 'api')).toBe(false);
  });

  it('matches an empty query', () => {
    expect(matchesQuery(docsRepo, '   ')).toBe(true);
  });

  it('requires every term to appear', () => {
    expect(matchesQuery(apiRepo, 'api client')).toBe(true);
    expect(matchesQuery(apiRepo, 'api docs')).toBe(false);
  });
});

describe('scope filtering', () => {
  const repos = [
    makeRepo(1, { name: 'a', fork: false }),
    makeRepo(2, { name: 'b', fork: true }),
  ];

  it('filters forks and non-forks', () => {
    expect(filterRepos(repos, { scope: 'all', query: '' })).toHaveLength(2);
    expect(filterRepos(repos, { scope: 'forks', query: '' }).map((r) => r.name)).toEqual(['b']);
    expect(filterRepos(repos, { scope: 'non-forks', query: '' }).map((r) => r.name)).toEqual(['a']);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 61 }, (_, index) => index);

  it('slices 30 rows per page', () => {
    const first = paginate(items, 1, 30);
    expect(first.items[0]).toBe(0);
    expect(first.items).toHaveLength(30);
    expect(first.totalPages).toBe(3);
    expect(first.start).toBe(1);
    expect(first.end).toBe(30);

    const last = paginate(items, 3, 30);
    expect(last.items).toHaveLength(1);
    expect(last.start).toBe(61);
    expect(last.end).toBe(61);
  });

  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99, 30).page).toBe(3);
    expect(paginate(items, -4, 30).page).toBe(1);
    expect(paginate(items, 0, 30).page).toBe(1);
  });

  it('handles an empty result', () => {
    const page = paginate([], 2, 30);
    expect(page).toMatchObject({ page: 1, total: 0, totalPages: 1, start: 0, end: 0, items: [] });
  });
});

describe('buildView', () => {
  const repos = Array.from({ length: 61 }, (_, index) =>
    makeRepo(index + 1, {
      name: index % 2 === 0 ? `matching-${index}` : `other-${index}`,
      description: index % 2 === 0 ? 'like this' : 'nope',
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
      pushedAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    }),
  );

  it('filters before paginating', () => {
    const view = buildView({
      repos,
      sort: 'activity',
      scope: 'all',
      query: 'matching',
      page: 1,
      pageSize: 30,
    });
    expect(view.total).toBe(61);
    expect(view.totalFiltered).toBe(31);
    expect(view.page.items).toHaveLength(30);
    expect(view.page.totalPages).toBe(2);

    const second = buildView({
      repos,
      sort: 'activity',
      scope: 'all',
      query: 'matching',
      page: 2,
      pageSize: 30,
    });
    expect(second.page.items).toHaveLength(1);
    expect(second.page.start).toBe(31);
  });

  it('applies the requested sort order', () => {
    const view = buildView({
      repos: repos.slice(0, 5),
      sort: 'created',
      scope: 'all',
      query: '',
      page: 1,
    });
    const sortedIds = view.page.items.map((repo) => repo.id);
    expect(sortedIds).toEqual([...sortedIds].sort((a, b) => b - a));
  });
});
