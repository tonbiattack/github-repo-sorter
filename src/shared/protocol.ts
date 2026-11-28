import type { SorterSettings } from './settings';
import type { AuthMode, FetchErrorInfo, Repo } from './types';

/** Marker shared by every message so foreign senders are ignored. */
export const CHANNEL = 'github-repo-sorter/1';

export interface FetchData {
  readonly owner: string;
  readonly authMode: AuthMode;
  readonly login: string | null;
  readonly repos: Repo[];
  readonly fetchedAt: number;
  readonly fromCache: boolean;
  readonly pagesFetched: number;
  readonly partial: boolean;
  readonly error: FetchErrorInfo | null;
}

export interface AuthStatusData {
  readonly configured: boolean;
  readonly login: string | null;
  /** True when the token is mirrored into persistent storage (opt-in). */
  readonly persistent: boolean;
}

export interface OperationData {
  readonly done: true;
}

export type HandlerResponse =
  | { readonly ok: true; readonly kind: 'fetch'; readonly data: FetchData }
  | { readonly ok: true; readonly kind: 'auth-status'; readonly data: AuthStatusData }
  | { readonly ok: true; readonly kind: 'settings'; readonly data: SorterSettings }
  | { readonly ok: true; readonly kind: 'operation'; readonly data: OperationData }
  | { readonly ok: false; readonly error: FetchErrorInfo };

/**
 * Page URL reported by the content script for the document it is running in.
 *
 * Chrome resolves `sender.url` from the URL that was *committed* for the
 * document. GitHub navigates with Turbo (same-document history updates), so
 * after moving from a repository page to the repositories tab that URL still
 * names the previous page. The live URL therefore travels in the message and
 * is what the background validates.
 */
export interface PageLocation {
  readonly pageUrl: string;
}

export interface FetchRequest extends PageLocation {
  readonly channel: typeof CHANNEL;
  readonly type: 'fetch';
  readonly requestId: string;
  readonly owner: string;
  readonly force: boolean;
  /** Forces the public endpoint even when a token is configured. */
  readonly authMode?: AuthMode;
}

export interface CancelRequest {
  readonly channel: typeof CHANNEL;
  readonly type: 'cancel';
  readonly requestId: string;
}

export interface SettingsGetRequest extends PageLocation {
  readonly channel: typeof CHANNEL;
  readonly type: 'settings-get';
  readonly owner: string;
}

export interface SettingsSetRequest extends PageLocation {
  readonly channel: typeof CHANNEL;
  readonly type: 'settings-set';
  readonly owner: string;
  readonly settings: unknown;
}

export interface AuthStatusRequest {
  readonly channel: typeof CHANNEL;
  readonly type: 'auth-status';
}

export interface AuthSetRequest {
  readonly channel: typeof CHANNEL;
  readonly type: 'auth-set';
  readonly token: string;
  /** Opt-in: also store the token in `chrome.storage.local` across restarts. */
  readonly persist?: boolean;
}

export interface AuthClearRequest {
  readonly channel: typeof CHANNEL;
  readonly type: 'auth-clear';
}

export interface CacheClearRequest {
  readonly channel: typeof CHANNEL;
  readonly type: 'cache-clear';
}

export interface OpenOptionsRequest {
  readonly channel: typeof CHANNEL;
  readonly type: 'open-options';
}

export type Request =
  | FetchRequest
  | CancelRequest
  | SettingsGetRequest
  | SettingsSetRequest
  | AuthStatusRequest
  | AuthSetRequest
  | AuthClearRequest
  | CacheClearRequest
  | OpenOptionsRequest;

export interface ProgressMessage {
  readonly channel: typeof CHANNEL;
  readonly type: 'fetch-progress';
  readonly requestId: string;
  readonly page: number;
  readonly received: number;
}

/** GitHub path segments that never denote a repository owner. */
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'copilot',
  'dashboard',
  'enterprise',
  'enterprises',
  'events',
  'explore',
  'features',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'sessions',
  'settings',
  'signup',
  'site',
  'sponsors',
  'stars',
  'team',
  'topics',
  'trending',
  'users',
  'watching',
]);

/**
 * Validates a GitHub owner name (user or organisation).
 * Mirrors GitHub's rules: 1-39 chars, alphanumeric + single hyphens.
 */
export function isValidOwner(owner: string): boolean {
  if (owner.length < 1 || owner.length > 39) return false;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return false;
  if (owner.includes('--')) return false;
  return !RESERVED_OWNERS.has(owner.toLowerCase());
}

export interface RepoListRoute {
  readonly owner: string;
}

/**
 * Recognises `https://github.com/{owner}?tab=repositories` and nothing else.
 * Query order does not matter.
 */
export function parseRepoListUrl(rawUrl: string): RepoListRoute | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'github.com') return null;

  const pathMatch = /^\/([^/]+)\/?$/.exec(url.pathname);
  if (!pathMatch) return null;

  const owner = pathMatch[1];
  if (!isValidOwner(owner)) return null;
  if (url.searchParams.get('tab') !== 'repositories') return null;
  return { owner };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;

function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === 'public' || value === 'authenticated';
}

const MAX_PAGE_URL_LENGTH = 2048;

/** True for the live repository list URL a content script is allowed to report. */
function isRepoListPageUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PAGE_URL_LENGTH &&
    parseRepoListUrl(value) !== null
  );
}

/**
 * Validates an untrusted runtime message.
 * Returns a freshly built object (no caller-owned references are reused).
 */
export function parseRequest(input: unknown): Request | null {
  if (!isRecord(input)) return null;
  if (input.channel !== CHANNEL) return null;

  switch (input.type) {
    case 'fetch': {
      const owner = input.owner;
      if (typeof owner !== 'string' || !isValidOwner(owner)) return null;
      if (!isValidRequestId(input.requestId)) return null;
      if (typeof input.force !== 'boolean') return null;
      if (!isRepoListPageUrl(input.pageUrl)) return null;
      const authMode = isAuthMode(input.authMode) ? input.authMode : undefined;
      return {
        channel: CHANNEL,
        type: 'fetch',
        requestId: input.requestId,
        owner,
        force: input.force,
        pageUrl: input.pageUrl,
        ...(authMode ? { authMode } : {}),
      };
    }
    case 'cancel': {
      if (!isValidRequestId(input.requestId)) return null;
      return { channel: CHANNEL, type: 'cancel', requestId: input.requestId };
    }
    case 'settings-get': {
      const owner = input.owner;
      if (typeof owner !== 'string' || !isValidOwner(owner)) return null;
      if (!isRepoListPageUrl(input.pageUrl)) return null;
      return { channel: CHANNEL, type: 'settings-get', owner, pageUrl: input.pageUrl };
    }
    case 'settings-set': {
      const owner = input.owner;
      if (typeof owner !== 'string' || !isValidOwner(owner)) return null;
      if (!isRecord(input.settings)) return null;
      if (!isRepoListPageUrl(input.pageUrl)) return null;
      return {
        channel: CHANNEL,
        type: 'settings-set',
        owner,
        pageUrl: input.pageUrl,
        settings: {
          sort: input.settings.sort,
          scope: input.settings.scope,
          ...(input.settings.view === undefined ? {} : { view: input.settings.view }),
          ...(input.settings.type === undefined ? {} : { type: input.settings.type }),
          ...(input.settings.language === undefined ? {} : { language: input.settings.language }),
          ...(input.settings.visibility === undefined ? {} : { visibility: input.settings.visibility }),
        },
      };
    }
    case 'auth-status':
      return { channel: CHANNEL, type: 'auth-status' };
    case 'auth-set': {
      if (!isValidToken(input.token)) return null;
      return {
        channel: CHANNEL,
        type: 'auth-set',
        token: input.token,
        ...(input.persist === true ? { persist: true } : {}),
      };
    }
    case 'auth-clear':
      return { channel: CHANNEL, type: 'auth-clear' };
    case 'cache-clear':
      return { channel: CHANNEL, type: 'cache-clear' };
    case 'open-options':
      return { channel: CHANNEL, type: 'open-options' };
    default:
      return null;
  }
}

export function isProgressMessage(input: unknown): input is ProgressMessage {
  if (!isRecord(input)) return false;
  if (input.channel !== CHANNEL || input.type !== 'fetch-progress') return false;
  return (
    isValidRequestId(input.requestId) &&
    typeof input.page === 'number' &&
    Number.isFinite(input.page) &&
    typeof input.received === 'number' &&
    Number.isFinite(input.received)
  );
}
