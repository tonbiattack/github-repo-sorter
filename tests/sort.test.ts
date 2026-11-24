import { describe, expect, it } from 'vitest';
import { activityOf, forkTimestampOf, sortRepos } from '../src/shared/sort';
import type { Repo } from '../src/shared/types';
import { makeRepo } from './helpers';

function names(repos: readonly Repo[]): string[] {
  return repos.map((repo) => repo.name);
}

describe('activityOf', () => {
  it('uses pushed_at when it is newer than created_at', () => {
    const activity = activityOf({
      createdAt: '2026-01-01T00:00:00Z',
      pushedAt: '2026-02-01T00:00:00Z',
      fork: false,
    });
    expect(activity.kind).toBe('push');
    expect(activity.ms).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('uses created_at for a fork whose pushed_at still points at upstream history', () => {
    const activity = activityOf({
      createdAt: '2026-11-24T09:00:00Z',
      pushedAt: '2026-10-01T00:00:00Z',
      fork: true,
    });
    expect(activity.kind).toBe('fork');
    expect(activity.ms).toBe(Date.parse('2026-11-24T09:00:00Z'));
  });

  it('reports create for a non-fork without pushes', () => {
    expect(
      activityOf({ createdAt: '2026-01-01T00:00:00Z', pushedAt: null, fork: false }),
    ).toEqual({ ms: Date.parse('2026-01-01T00:00:00Z'), kind: 'create' });
  });

  it('treats invalid and missing timestamps as absent', () => {
    expect(activityOf({ createdAt: 'not-a-date', pushedAt: null, fork: false })).toEqual({
      ms: null,
      kind: 'unknown',
    });
    expect(activityOf({ createdAt: '', pushedAt: '', fork: true })).toEqual({
      ms: null,
      kind: 'unknown',
    });
  });
});

describe('forkTimestampOf', () => {
  it('returns null for repositories that are not forks', () => {
    expect(
      forkTimestampOf({ createdAt: '2026-01-01T00:00:00Z', pushedAt: null, fork: false }),
    ).toBeNull();
  });
});

describe('sortRepos', () => {
  it('matches the acceptance scenario B, A, C', () => {
    const forkToday = makeRepo(3, {
      name: 'B',
      fork: true,
      createdAt: '2026-11-24T09:00:00Z',
      pushedAt: '2026-10-01T00:00:00Z',
    });
    const pushedYesterday = makeRepo(2, {
      name: 'A',
      createdAt: '2026-01-01T00:00:00Z',
      pushedAt: '2026-11-23T09:00:00Z',
    });
    const createdTwoDaysAgo = makeRepo(1, {
      name: 'C',
      createdAt: '2026-11-22T09:00:00Z',
      pushedAt: '2026-11-22T09:00:00Z',
    });

    const sorted = sortRepos([pushedYesterday, createdTwoDaysAgo, forkToday], 'activity');
    expect(names(sorted)).toEqual(['B', 'A', 'C']);
  });

  it('keeps missing dates last, ordered by full name', () => {
    const noDates = makeRepo(1, {
      name: 'zzz',
      fullName: 'owner/zzz',
      createdAt: 'invalid',
      pushedAt: null,
      updatedAt: null,
    });
    const withDate = makeRepo(2, {
      name: 'aaa',
      createdAt: '2026-01-01T00:00:00Z',
      pushedAt: '2026-01-01T00:00:00Z',
    });

    expect(names(sortRepos([noDates, withDate], 'activity'))).toEqual(['aaa', 'zzz']);
    expect(names(sortRepos([withDate, noDates], 'pushed'))).toEqual(['aaa', 'zzz']);
  });

  it('breaks ties by full_name ascending and then id', () => {
    const a = makeRepo(5, { name: 'beta', fullName: 'owner/beta' });
    const b = makeRepo(9, { name: 'alpha', fullName: 'owner/alpha' });
    const c = makeRepo(1, { name: 'gamma', fullName: 'owner/gamma' });

    expect(names(sortRepos([a, b, c], 'activity'))).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('sorts by fork date and pushes non-forks to the end for "forked"', () => {
    const olderFork = makeRepo(1, {
      name: 'fork-old',
      fork: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const newerFork = makeRepo(2, {
      name: 'fork-new',
      fork: true,
      createdAt: '2026-05-01T00:00:00Z',
    });
    const normal = makeRepo(3, { name: 'normal', createdAt: '2026-12-01T00:00:00Z' });

    expect(names(sortRepos([normal, olderFork, newerFork], 'forked'))).toEqual([
      'fork-new',
      'fork-old',
      'normal',
    ]);
  });

  it('sorts by created and updated timestamps', () => {
    const old = makeRepo(1, {
      name: 'old',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    });
    const recent = makeRepo(2, {
      name: 'recent',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    });

    expect(names(sortRepos([old, recent], 'created'))).toEqual(['recent', 'old']);
    expect(names(sortRepos([old, recent], 'updated'))).toEqual(['old', 'recent']);
  });

  it('does not mutate the input array', () => {
    const input = [makeRepo(1, { name: 'b' }), makeRepo(2, { name: 'a' })];
    const snapshot = [...input];
    sortRepos(input, 'activity');
    expect(input).toEqual(snapshot);
  });

  it('sorts 500 repositories in under 100ms', () => {
    const repos = Array.from({ length: 500 }, (_, index) =>
      makeRepo(index + 1, {
        name: `repo-${String(index).padStart(3, '0')}`,
        createdAt: new Date(Date.UTC(2024, 0, 1) + index * 60_000).toISOString(),
        pushedAt: new Date(Date.UTC(2025, 0, 1) + index * 90_000).toISOString(),
      }),
    );

    const started = performance.now();
    sortRepos(repos, 'activity');
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(100);
  });
});
