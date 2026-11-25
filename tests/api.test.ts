import { describe, expect, it } from 'vitest';
import {
  AbortError,
  ApiError,
  buildRepoListUrl,
  fetchAllRepos,
  fetchViewer,
  normalizeRepo,
  parseLinkHeader,
  sleepWithSignal,
} from '../src/shared/api';
import { sortRepos } from '../src/shared/sort';
import { apiRepo, jsonResponse } from './helpers';

const noSleep = async (): Promise<void> => {};

function nextLink(url: string): string {
  return `<${url}>; rel="next"`;
}

describe('buildRepoListUrl', () => {
  it('targets the public listing for a public context', () => {
    expect(buildRepoListUrl('Some-User', 'public')).toBe(
      'https://api.github.com/users/Some-User/repos?type=owner&per_page=100',
    );
  });

  it('targets /user/repos for an authenticated context', () => {
    expect(buildRepoListUrl('owner', 'authenticated')).toBe(
      'https://api.github.com/user/repos?affiliation=owner&visibility=all&per_page=100',
    );
  });

  it('encodes owner names and normalises a trailing slash in the base URL', () => {
    const url = buildRepoListUrl('weird name', 'public', 'https://example.test/', 50);
    expect(url).toBe('https://example.test/users/weird%20name/repos?type=owner&per_page=50');
  });
});

describe('parseLinkHeader', () => {
  it('extracts every relation', () => {
    expect(
      parseLinkHeader(
        '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
      ),
    ).toEqual({
      next: 'https://api.github.com/x?page=2',
      last: 'https://api.github.com/x?page=9',
    });
  });

  it('returns no links for a missing header', () => {
    expect(parseLinkHeader(null)).toEqual({});
  });
});

describe('normalizeRepo', () => {
  it('normalises a complete API object', () => {
    const repo = normalizeRepo(apiRepo(7));
    expect(repo).toMatchObject({
      id: 7,
      name: 'repo-7',
      fullName: 'owner/repo-7',
      visibility: 'public',
      fork: false,
      owner: 'owner',
    });
  });

  it('rejects malformed or non-GitHub objects', () => {
    expect(normalizeRepo(null)).toBeNull();
    expect(normalizeRepo('text')).toBeNull();
    expect(normalizeRepo(apiRepo(7, { id: 'x' }))).toBeNull();
    expect(normalizeRepo(apiRepo(7, { html_url: 'https://evil.example/owner/repo-7' }))).toBeNull();
    expect(normalizeRepo(apiRepo(7, { name: undefined }))).toBeNull();
  });

  it('preserves valid API language and counts without inventing missing values', () => {
    const repo = normalizeRepo(apiRepo(7, { language: 'TypeScript', stargazers_count: 17, forks_count: 0 }));
    expect(repo).toMatchObject({ language: 'TypeScript', stars: 17, forks: 0 });
    const invalid = normalizeRepo(apiRepo(8, { language: 12, stargazers_count: -1, forks_count: '3' }));
    expect(invalid).toMatchObject({ language: null, stars: null, forks: null });
    expect(normalizeRepo(apiRepo(9))).toMatchObject({ language: null, stars: null, forks: null });
  });

  it('keeps null dates as null', () => {
    const repo = normalizeRepo(apiRepo(7, { created_at: 'nonsense', pushed_at: null }));
    expect(repo?.createdAt).toBeNull();
    expect(repo?.pushedAt).toBeNull();
  });
});

describe('fetchAllRepos', () => {
  it('follows Link rel=next and merges every page', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url);
      if (calls.length === 1) {
        return jsonResponse([apiRepo(1), apiRepo(2)], {
          headers: { link: nextLink('https://api.github.com/users/owner/repos?page=2') },
        });
      }
      return jsonResponse([apiRepo(3)]);
    };

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });

    expect(result.error).toBeNull();
    expect(result.partial).toBe(false);
    expect(result.pagesFetched).toBe(2);
    expect(result.repos.map((repo) => repo.id).sort()).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/users/owner/repos');
  });

  it('deduplicates repositories by id across pages', async () => {
    let page = 0;
    const fetchImpl = async (): Promise<Response> => {
      page += 1;
      if (page === 1) {
        return jsonResponse([apiRepo(1), apiRepo(2)], {
          headers: { link: nextLink('https://api.github.com/users/owner/repos?page=2') },
        });
      }
      return jsonResponse([apiRepo(2), apiRepo(3)]);
    };

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.repos.map((repo) => repo.id).sort()).toEqual([1, 2, 3]);
  });

  it('drops repositories owned by another account', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse([
        apiRepo(1),
        apiRepo(2, {
          full_name: 'other/repo-2',
          html_url: 'https://github.com/other/repo-2',
          owner: { login: 'other' },
        }),
      ]);

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.repos.map((repo) => repo.id)).toEqual([1]);
  });

  it('places a fork created today above older pushes even when it is on a later page', async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) =>
      apiRepo(index + 1, {
        created_at: '2026-01-01T00:00:00Z',
        pushed_at: '2026-11-23T10:00:00Z',
      }),
    );
    const newerFork = apiRepo(999, {
      fork: true,
      created_at: '2026-11-24T09:00:00Z',
      pushed_at: '2026-10-01T00:00:00Z',
    });

    let page = 0;
    const fetchImpl = async (): Promise<Response> => {
      page += 1;
      if (page === 1) {
        return jsonResponse(pageOne, {
          headers: { link: nextLink('https://api.github.com/users/owner/repos?page=2') },
        });
      }
      return jsonResponse([newerFork]);
    };

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.repos).toHaveLength(101);

    const sorted = sortRepos(result.repos, 'activity');
    expect(sorted[0].id).toBe(999);
  });

  it('returns the rows collected so far when a later page fails', async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse([apiRepo(1)], {
          headers: { link: nextLink('https://api.github.com/users/owner/repos?page=2') },
        });
      }
      return jsonResponse({ message: 'boom' }, { status: 500 });
    };

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });

    expect(result.repos.map((repo) => repo.id)).toEqual([1]);
    expect(result.partial).toBe(true);
    expect(result.pagesFetched).toBe(1);
    expect(result.error?.kind).toBe('http');
    // One request for page 1 plus three attempts for page 2 (initial + 2 retries).
    expect(calls).toBe(4);
  });

  it('reports an authentication failure for a 401 response', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ message: 'Bad credentials' }, { status: 401 });

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.repos).toEqual([]);
    expect(result.error?.kind).toBe('auth');
    expect(result.pagesFetched).toBe(0);
  });

  it('waits for Retry-After and retries a rate-limited request', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ message: 'rate limited' }, { status: 429, headers: { 'retry-after': '2' } });
      }
      return jsonResponse([apiRepo(1)]);
    };

    const result = await fetchAllRepos({
      owner: 'owner',
      fetchImpl,
      now: () => 1_000_000,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([2000]);
    expect(result.repos).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('does not wait when the rate limit resets far in the future', async () => {
    const now = 1_000_000;
    const resetAt = now + 3_600_000;
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      return jsonResponse(
        { message: 'rate limited' },
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetAt / 1000),
          },
        },
      );
    };

    const result = await fetchAllRepos({
      owner: 'owner',
      fetchImpl,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(calls).toBe(1);
    expect(waits).toEqual([]);
    expect(result.error?.kind).toBe('rate-limit');
    expect(result.error?.retryAt).toBe(resetAt);
  });

  it('retries a transient server error', async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, { status: 502 }) : jsonResponse([apiRepo(1)]);
    };

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(calls).toBe(2);
    expect(result.repos).toHaveLength(1);
  });

  it('stops at maxPages and marks the result as partial', async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      const current = Number(new URL(url).searchParams.get('page') ?? '1');
      return jsonResponse([apiRepo(current)], {
        headers: {
          link: nextLink(`https://api.github.com/users/owner/repos?per_page=100&page=${current + 1}`),
        },
      });
    };

    const result = await fetchAllRepos({
      owner: 'owner',
      fetchImpl,
      sleep: noSleep,
      maxPages: 3,
    });

    expect(result.pagesFetched).toBe(3);
    expect(result.partial).toBe(true);
    expect(result.error?.kind).toBe('max-pages');
    expect(result.repos).toHaveLength(3);
  });

  it('stops when GitHub repeats the same next URL', async () => {
    const fetchImpl = async (url: string): Promise<Response> =>
      jsonResponse([apiRepo(1)], { headers: { link: `<${url}>; rel="next"` } });

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.error?.kind).toBe('invalid-link');
    expect(result.partial).toBe(true);
  });

  it('refuses to follow a next URL on another host', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse([apiRepo(1)], { headers: { link: nextLink('https://evil.example/repos?page=2') } });

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.error?.kind).toBe('invalid-link');
    expect(result.pagesFetched).toBe(1);
  });

  it('rejects an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAllRepos({
        owner: 'owner',
        fetchImpl: async () => jsonResponse([]),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it('aborts between pages without returning partial data', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse([apiRepo(1)], {
          headers: { link: nextLink('https://api.github.com/users/owner/repos?page=2') },
        });
      }
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };

    await expect(
      fetchAllRepos({ owner: 'owner', fetchImpl, signal: controller.signal, sleep: noSleep }),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it('reports a network failure after retries are exhausted', async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      throw new TypeError('fetch failed');
    };

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(calls).toBe(3);
    expect(result.error?.kind).toBe('network');
    expect(result.repos).toEqual([]);
  });

  it('reports invalid JSON as an error', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await fetchAllRepos({ owner: 'owner', fetchImpl, sleep: noSleep });
    expect(result.error?.kind).toBe('invalid-response');
  });

  it('emits progress for each page', async () => {
    const progress: number[] = [];
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse([apiRepo(1)], {
          headers: { link: nextLink('https://api.github.com/users/owner/repos?page=2') },
        });
      }
      return jsonResponse([apiRepo(2)]);
    };

    await fetchAllRepos({
      owner: 'owner',
      fetchImpl,
      sleep: noSleep,
      onPage: (page) => progress.push(page.received),
    });

    expect(progress).toEqual([1, 2]);
  });
});

describe('fetchViewer', () => {
  it('returns the authenticated login', async () => {
    const viewer = await fetchViewer({
      token: 'ghp_token1234567890',
      fetchImpl: async () => jsonResponse({ login: 'owner', id: 42 }),
      sleep: noSleep,
    });
    expect(viewer).toEqual({ login: 'owner', id: 42 });
  });

  it('throws an ApiError for bad credentials', async () => {
    await expect(
      fetchViewer({
        token: 'ghp_token1234567890',
        fetchImpl: async () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ info: { kind: 'auth' } });
  });

  it('retries rate-limited identity requests', async () => {
    let calls = 0;
    const viewer = await fetchViewer({
      token: 'ghp_token1234567890',
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({}, { status: 429, headers: { 'retry-after': '1' } });
        return jsonResponse({ login: 'owner', id: 42 });
      },
      sleep: noSleep,
    });
    expect(viewer.login).toBe('owner');
  });

  it('throws for a malformed payload', async () => {
    await expect(
      fetchViewer({
        token: 'ghp_token1234567890',
        fetchImpl: async () => jsonResponse({ login: '' }),
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('sleepWithSignal', () => {
  it('resolves immediately for zero milliseconds', async () => {
    await expect(sleepWithSignal(0)).resolves.toBeUndefined();
  });

  it('rejects when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithSignal(1000, controller.signal)).rejects.toBeInstanceOf(AbortError);
  });

  it('rejects when aborted while waiting', async () => {
    const controller = new AbortController();
    const waiting = sleepWithSignal(5000, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(waiting).rejects.toBeInstanceOf(AbortError);
  });
});
