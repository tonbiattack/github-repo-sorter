import type { KeyValueArea } from '../src/background/storage';
import type { Repo } from '../src/shared/types';

/** Builds a normalised Repo for pure-logic tests. */
export function makeRepo(id: number, overrides: Partial<Omit<Repo, 'id'>> = {}): Repo {
  const name = overrides.name ?? `repo-${id}`;
  const base: Repo = {
    id,
    name,
    fullName: `owner/${name}`,
    htmlUrl: `https://github.com/owner/${name}`,
    description: null,
    language: null,
    visibility: 'public',
    fork: false,
    stars: null,
    forks: null,
    createdAt: '2026-01-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    owner: 'owner',
  };
  // `undefined` means "not supplied", while an explicit null (no date) is kept.
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  );
  return { ...base, ...defined, id };
}

/** Builds a raw GitHub API repository object (as returned by REST). */
export function apiRepo(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    html_url: `https://github.com/owner/repo-${id}`,
    description: `description ${id}`,
    private: false,
    fork: false,
    created_at: '2026-01-01T00:00:00Z',
    pushed_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    owner: { login: 'owner' },
    ...overrides,
  };
}

export function jsonResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
}

/** In-memory KeyValueArea used instead of chrome.storage. */
export function memoryArea(
  initial: Record<string, unknown> = {},
): KeyValueArea & { readonly data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result: Record<string, unknown> = {};
      for (const key of list) {
        if (key in data) result[key] = data[key];
      }
      return result;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      for (const key of list) delete data[key];
    },
  };
}
