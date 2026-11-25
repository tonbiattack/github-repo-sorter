import { parseTimestamp } from './dates';
import type { AuthMode, FetchErrorInfo, Repo } from './types';

export const DEFAULT_API_BASE = 'https://api.github.com';
export const DEFAULT_PER_PAGE = 100;
export const DEFAULT_MAX_PAGES = 100;
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export class ApiError extends Error {
  readonly info: FetchErrorInfo;

  constructor(info: FetchErrorInfo) {
    super(info.message);
    this.name = 'ApiError';
    this.info = info;
  }
}

export interface PageProgress {
  readonly page: number;
  readonly received: number;
  readonly hasMore: boolean;
}

export interface FetchAllOptions {
  readonly owner: string;
  /** When set, the authenticated `/user/repos` endpoint is used. */
  readonly token?: string | null;
  readonly baseUrl?: string;
  readonly perPage?: number;
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: FetchLike;
  readonly sleep?: SleepFn;
  readonly now?: () => number;
  readonly maxRetries?: number;
  readonly maxWaitMs?: number;
  readonly onPage?: (progress: PageProgress) => void;
}

export interface FetchAllResult {
  readonly repos: Repo[];
  readonly pagesFetched: number;
  readonly partial: boolean;
  readonly error: FetchErrorInfo | null;
}

export interface Viewer {
  readonly login: string;
  readonly id: number;
}

interface RequestOptions {
  readonly url: string;
  readonly token: string | null;
  readonly fetchImpl: FetchLike;
  readonly sleep: SleepFn;
  readonly now: () => number;
  readonly signal?: AbortSignal;
  readonly maxRetries: number;
  readonly maxWaitMs: number;
}

interface Failure {
  readonly info: FetchErrorInfo;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortError());
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new AbortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

function buildHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Builds the first page URL for either the public or authenticated listing. */
export function buildRepoListUrl(
  owner: string,
  mode: AuthMode,
  baseUrl: string = DEFAULT_API_BASE,
  perPage: number = DEFAULT_PER_PAGE,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (mode === 'authenticated') {
    return `${base}/user/repos?affiliation=owner&visibility=all&per_page=${perPage}`;
  }
  return `${base}/users/${encodeURIComponent(owner)}/repos?type=owner&per_page=${perPage}`;
}

export type ParsedLinks = Partial<Record<'next' | 'prev' | 'first' | 'last', string>>;

/** Parses RFC 5988 `Link` headers into a relation -> URL map. */
export function parseLinkHeader(header: string | null): ParsedLinks {
  const links: ParsedLinks = {};
  if (!header) return links;

  const pattern = /<([^>]*)>\s*;\s*([^,<]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header)) !== null) {
    const url = match[1];
    const params = match[2] ?? '';
    const relation = /rel\s*=\s*"?([^";]+)"?/.exec(params);
    if (!url || !relation) continue;
    for (const rel of relation[1].split(/\s+/)) {
      if (rel === 'next' || rel === 'prev' || rel === 'first' || rel === 'last') {
        links[rel] = url;
      }
    }
  }
  return links;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asTimestamp(value: unknown): string | null {
  const text = asString(value);
  if (text === null) return null;
  return parseTimestamp(text) === null ? null : text;
}

/** Keeps only non-negative integers, so a malformed count cannot reach the UI. */
function asCount(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Normalises one API repository object.
 *
 * Returns null for objects missing mandatory fields or pointing at a
 * non-github.com host, so malformed payloads are skipped instead of rendered.
 */
export function normalizeRepo(raw: unknown): Repo | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === 'number' ? record.id : Number.NaN;
  if (!Number.isFinite(id) || id <= 0) return null;

  const name = asString(record.name);
  const fullName = asString(record.full_name);
  const htmlUrl = asString(record.html_url);
  if (!name || !fullName || !htmlUrl) return null;
  if (!htmlUrl.startsWith('https://github.com/')) return null;

  const ownerRecord =
    record.owner !== null && typeof record.owner === 'object'
      ? (record.owner as Record<string, unknown>)
      : null;
  const owner = asString(ownerRecord?.login) ?? fullName.split('/')[0];
  if (!owner) return null;

  return {
    id,
    name,
    fullName,
    htmlUrl,
    description: asString(record.description),
    language: asString(record.language),
    visibility: record.private === true ? 'private' : 'public',
    fork: record.fork === true,
    stars: asCount(record.stargazers_count),
    forks: asCount(record.forks_count),
    createdAt: asTimestamp(record.created_at),
    pushedAt: asTimestamp(record.pushed_at),
    updatedAt: asTimestamp(record.updated_at),
    owner,
  };
}

function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

function formatLocalTime(ms: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

async function classifyResponse(
  response: Response,
  nowMs: number,
  maxWaitMs: number,
): Promise<Failure> {
  const status = response.status;

  if (status === 401) {
    return {
      info: {
        kind: 'auth',
        message: 'GitHub の認証に失敗しました。アクセストークンを確認してください。',
        status,
      },
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      info: {
        kind: 'not-found',
        message:
          'リポジトリ一覧を取得できませんでした（ユーザー名の誤り、または表示権限がありません）。',
        status,
      },
      retryable: false,
    };
  }

  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), nowMs);
  const rateLimited = status === 429 || (status === 403 && (remaining === '0' || retryAfterMs !== null));

  if (rateLimited) {
    const resetAt = Number.isFinite(resetSeconds) && resetSeconds > 0 ? resetSeconds * 1000 : null;
    const retryAt = retryAfterMs !== null ? nowMs + retryAfterMs : resetAt;
    const message = retryAt
      ? `GitHub API のレート制限に達しました。${formatLocalTime(retryAt)} ごろ再取得してください。`
      : 'GitHub API のレート制限に達しました。しばらく待ってから再取得してください。';
    const info: FetchErrorInfo =
      retryAt === null
        ? { kind: 'rate-limit', message, status }
        : { kind: 'rate-limit', message, status, retryAt };

    const waitMs = retryAt === null ? null : Math.max(0, retryAt - nowMs);
    if (waitMs !== null && waitMs <= maxWaitMs) {
      return { info, retryable: true, retryAfterMs: waitMs };
    }
    return { info, retryable: false };
  }

  if (status === 403) {
    return {
      info: {
        kind: 'forbidden',
        message: 'GitHub API へのアクセスが拒否されました（権限不足の可能性があります）。',
        status,
      },
      retryable: false,
    };
  }

  if (status >= 500) {
    return {
      info: {
        kind: 'http',
        message: `GitHub API が一時的なエラー（${status}）を返しました。`,
        status,
      },
      retryable: true,
    };
  }

  return {
    info: { kind: 'http', message: `GitHub API が ${status} を返しました。`, status },
    retryable: false,
  };
}

function backoffMs(attempt: number): number {
  return Math.min(4_000, 500 * 2 ** Math.max(0, attempt - 1));
}

async function requestWithRetry(options: RequestOptions): Promise<Response> {
  let attempt = 0;

  for (;;) {
    throwIfAborted(options.signal);

    let response: Response;
    try {
      response = await options.fetchImpl(options.url, {
        method: 'GET',
        headers: buildHeaders(options.token),
        signal: options.signal,
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch (error) {
      if (isAbortLike(error) || options.signal?.aborted) throw new AbortError();
      if (attempt >= options.maxRetries) {
        throw new ApiError({
          kind: 'network',
          message: 'GitHub API へ接続できませんでした。ネットワーク接続を確認してください。',
        });
      }
      attempt += 1;
      await options.sleep(backoffMs(attempt), options.signal);
      continue;
    }

    if (response.ok) return response;

    const failure = await classifyResponse(response, options.now(), options.maxWaitMs);
    if (failure.retryable && attempt < options.maxRetries) {
      attempt += 1;
      await options.sleep(failure.retryAfterMs ?? backoffMs(attempt), options.signal);
      continue;
    }
    throw new ApiError(failure.info);
  }
}

function isSameOriginUrl(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function toFetchError(error: unknown): FetchErrorInfo {
  if (error instanceof ApiError) return error.info;
  return { kind: 'unknown', message: '予期しないエラーが発生しました。' };
}

/**
 * Fetches every page of the repository listing.
 *
 * The function resolves even for API failures so the caller can distinguish
 * "nothing fetched" from "some pages fetched": a failure after the first page
 * returns `partial: true` with the rows collected so far. Only cancellation
 * throws (an `AbortError`).
 */
export async function fetchAllRepos(options: FetchAllOptions): Promise<FetchAllResult> {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepWithSignal;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxWaitMs = options.maxWaitMs ?? MAX_RATE_LIMIT_WAIT_MS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const token = options.token ?? null;
  const mode: AuthMode = token ? 'authenticated' : 'public';

  let nextUrl: string | undefined = buildRepoListUrl(options.owner, mode, baseUrl, perPage);
  const seen = new Map<number, Repo>();
  let pagesFetched = 0;

  while (nextUrl !== undefined) {
    if (pagesFetched >= maxPages) {
      return {
        repos: [...seen.values()],
        pagesFetched,
        partial: true,
        error: {
          kind: 'max-pages',
          message: `取得ページ数の上限（${maxPages} ページ）に達しました。表示は一部のみです。`,
        },
      };
    }

    throwIfAborted(options.signal);

    const currentUrl: string = nextUrl;
    let response: Response;
    try {
      response = await requestWithRetry({
        url: currentUrl,
        token,
        fetchImpl,
        sleep,
        now,
        signal: options.signal,
        maxRetries,
        maxWaitMs,
      });
    } catch (error) {
      if (error instanceof AbortError) throw error;
      const info = toFetchError(error);
      if (pagesFetched > 0) {
        return { repos: [...seen.values()], pagesFetched, partial: true, error: info };
      }
      return { repos: [], pagesFetched, partial: false, error: info };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const info: FetchErrorInfo = {
        kind: 'invalid-response',
        message: 'GitHub API の応答を読み取れませんでした。',
      };
      if (pagesFetched > 0) {
        return { repos: [...seen.values()], pagesFetched, partial: true, error: info };
      }
      return { repos: [], pagesFetched, partial: false, error: info };
    }

    if (!Array.isArray(payload)) {
      const info: FetchErrorInfo = {
        kind: 'invalid-response',
        message: 'GitHub API が想定外の形式を返しました。',
      };
      if (pagesFetched > 0) {
        return { repos: [...seen.values()], pagesFetched, partial: true, error: info };
      }
      return { repos: [], pagesFetched, partial: false, error: info };
    }

    pagesFetched += 1;
    const ownerLower = options.owner.toLowerCase();
    for (const raw of payload) {
      const repo = normalizeRepo(raw);
      if (!repo) continue;
      if (repo.owner.toLowerCase() !== ownerLower) continue;
      if (!seen.has(repo.id)) seen.set(repo.id, repo);
    }

    const links = parseLinkHeader(response.headers.get('link'));
    const next = links.next;
    const hasMore = typeof next === 'string' && next !== currentUrl;
    options.onPage?.({ page: pagesFetched, received: seen.size, hasMore });

    if (!hasMore) {
      if (typeof next === 'string' && next === currentUrl) {
        return {
          repos: [...seen.values()],
          pagesFetched,
          partial: true,
          error: {
            kind: 'invalid-link',
            message: 'GitHub API が同じページURLを繰り返し返したため、取得を停止しました。',
          },
        };
      }
      nextUrl = undefined;
      break;
    }

    if (!isSameOriginUrl(next, baseUrl)) {
      return {
        repos: [...seen.values()],
        pagesFetched,
        partial: true,
        error: {
          kind: 'invalid-link',
          message: 'GitHub API が想定外のホストのページURLを返したため、取得を停止しました。',
        },
      };
    }
    nextUrl = next;
  }

  return { repos: [...seen.values()], pagesFetched, partial: false, error: null };
}

export interface FetchViewerOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly sleep?: SleepFn;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  readonly maxRetries?: number;
  readonly maxWaitMs?: number;
}

/** Resolves the login of the token owner; used to verify the page owner. */
export async function fetchViewer(options: FetchViewerOptions): Promise<Viewer> {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const response = await requestWithRetry({
    url: `${baseUrl}/user`,
    token: options.token,
    fetchImpl,
    sleep: options.sleep ?? sleepWithSignal,
    now: options.now ?? Date.now,
    signal: options.signal,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    maxWaitMs: options.maxWaitMs ?? MAX_RATE_LIMIT_WAIT_MS,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      kind: 'invalid-response',
      message: '認証済みユーザー情報を読み取れませんでした。',
    });
  }

  const record = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const login = asString(record?.login);
  const id = typeof record?.id === 'number' ? record.id : Number.NaN;

  if (!login || !Number.isFinite(id)) {
    throw new ApiError({
      kind: 'invalid-response',
      message: '認証済みユーザー情報を取得できませんでした。',
    });
  }

  return { login, id };
}
