import { AbortError, ApiError } from '../shared/api';
import type { FetchAllOptions, FetchAllResult, Viewer } from '../shared/api';
import { repoCacheKey } from '../shared/cache';
import type { TtlCache } from '../shared/cache';
import { parseRepoListUrl } from '../shared/protocol';
import type {
  FetchData,
  FetchRequest,
  HandlerResponse,
  Request,
} from '../shared/protocol';
import { sanitizeSettings } from '../shared/settings';
import type { SorterSettings } from '../shared/settings';
import type { AuthMode, FetchErrorInfo } from '../shared/types';
import type { SettingsStore, TokenStore } from './storage';

/** Subset of `chrome.runtime.MessageSender` that the handler needs. */
export interface SenderInfo {
  readonly tabId?: number;
  readonly frameId?: number;
  readonly url?: string;
}

export interface ProgressEvent {
  readonly tabId?: number;
  readonly requestId: string;
  readonly page: number;
  readonly received: number;
}

export interface HandlerDeps {
  readonly fetchAll: (options: FetchAllOptions) => Promise<FetchAllResult>;
  readonly fetchViewer: (options: { token: string; signal?: AbortSignal }) => Promise<Viewer>;
  readonly cache: TtlCache<FetchData>;
  readonly settings: SettingsStore;
  readonly tokens: TokenStore;
  readonly now: () => number;
  readonly extensionUrlPrefix: string;
  readonly notifyProgress?: (progress: ProgressEvent) => void;
  readonly openOptions?: () => void;
  /** Notify live content scripts when token context changes. Never includes the token. */
  readonly notifyAuthChanged?: () => void;
}

export interface MessageHandler {
  handle(request: Request, sender: SenderInfo): Promise<HandlerResponse | null>;
  cancelAll(): void;
}

const IDENTITY_TTL_MS = 5 * 60 * 1000;

function fail(error: FetchErrorInfo): HandlerResponse {
  return { ok: false, error };
}

function operation(): HandlerResponse {
  return { ok: true, kind: 'operation', data: { done: true } };
}

export function toErrorInfo(error: unknown): FetchErrorInfo {
  if (error instanceof ApiError) return error.info;
  if (error instanceof AbortError) return { kind: 'aborted', message: '取得をキャンセルしました。' };
  return { kind: 'unknown', message: '予期しないエラーが発生しました。' };
}

/**
 * Validates that a message comes from the content script of the repository
 * list page for `owner`. Returns null when the sender is not acceptable.
 */
function contentSenderOwner(sender: SenderInfo): string | null {
  if (!sender.url) return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  const route = parseRepoListUrl(sender.url);
  return route ? route.owner : null;
}

function isExtensionSender(sender: SenderInfo, extensionUrlPrefix: string): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith(extensionUrlPrefix);
}

/**
 * Builds the request handler. All Chrome APIs are injected so the routing,
 * cache and auth rules can be unit tested with fakes.
 */
export function createMessageHandler(deps: HandlerDeps): MessageHandler {
  const controllers = new Map<string, AbortController>();
  const inFlight = new Map<string, Promise<FetchData>>();
  const identities = new Map<string, { viewer: Viewer; storedAt: number }>();
  let authRevision = 0;
  let authMutations: Promise<void> = Promise.resolve();

  function serializeAuth<T>(operation: () => Promise<T>): Promise<T> {
    const result = authMutations.then(operation);
    authMutations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function resolveIdentity(token: string): Promise<Viewer> {
    const cached = identities.get(token);
    if (cached && deps.now() - cached.storedAt < IDENTITY_TTL_MS) return cached.viewer;
    const revision = authRevision;
    const viewer = await deps.fetchViewer({ token });
    if (revision !== authRevision) throw new AbortError();
    identities.set(token, { viewer, storedAt: deps.now() });
    return viewer;
  }

  async function handleFetch(request: FetchRequest, sender: SenderInfo): Promise<HandlerResponse> {
    const senderOwner = contentSenderOwner(sender);
    if (senderOwner === null) {
      return fail({ kind: 'forbidden', message: '送信元のページを検証できませんでした。' });
    }
    if (senderOwner.toLowerCase() !== request.owner.toLowerCase()) {
      return fail({ kind: 'forbidden', message: 'リクエストのオーナーがページと一致しません。' });
    }

    await authMutations;
    const revision = authRevision;
    const token = await deps.tokens.read();
    if (revision !== authRevision) return fail({ kind: 'aborted', message: '認証状態が変更されました。' });
    const mode: AuthMode =
      request.authMode === 'public' ? 'public' : token === null ? 'public' : 'authenticated';

    if (request.authMode === 'authenticated' && token === null) {
      return fail({
        kind: 'auth',
        message: 'アクセストークンが設定されていません。拡張機能の設定から登録してください。',
      });
    }

    let login: string | null = null;
    if (mode === 'authenticated' && token !== null) {
      try {
        const viewer = await resolveIdentity(token);
        login = viewer.login;
      } catch (error) {
        return fail(toErrorInfo(error));
      }
      if (login.toLowerCase() !== request.owner.toLowerCase()) {
        return fail({
          kind: 'owner-mismatch',
          message: `認証中のアカウント（${login}）はこのページのオーナー（${request.owner}）と一致しません。公開一覧として取得するか、トークンを解除してください。`,
        });
      }
    }

    if (revision !== authRevision) return fail({ kind: 'aborted', message: '認証状態が変更されました。' });
    const key = repoCacheKey(request.owner, { mode, login });
    if (request.force) deps.cache.invalidate(key);

    if (!request.force) {
      const hit = deps.cache.get(key);
      if (hit) {
        return {
          ok: true,
          kind: 'fetch',
          data: { ...hit.value, fromCache: true, fetchedAt: hit.storedAt },
        };
      }
    }

    if (!request.force) {
      const shared = inFlight.get(key);
      if (shared) {
        try {
          const data = await shared;
          if (revision !== authRevision) throw new AbortError();
          return { ok: true, kind: 'fetch', data };
        } catch (error) {
          return fail(toErrorInfo(error));
        }
      }
    }

    const controller = new AbortController();
    controllers.set(request.requestId, controller);

    const task = (async (): Promise<FetchData> => {
      const result = await deps.fetchAll({
        owner: request.owner,
        token: mode === 'authenticated' ? token : null,
        signal: controller.signal,
        onPage: (progress) => {
          deps.notifyProgress?.({
            tabId: sender.tabId,
            requestId: request.requestId,
            page: progress.page,
            received: progress.received,
          });
        },
      });

      if (revision !== authRevision || controller.signal.aborted) throw new AbortError();
      const data: FetchData = {
        owner: request.owner,
        authMode: mode,
        login,
        repos: result.repos,
        fetchedAt: deps.now(),
        fromCache: false,
        pagesFetched: result.pagesFetched,
        partial: result.partial,
        error: result.error,
      };

      // Only complete listings are cached: partial data must not be served as
      // if it were the full result.
      if (!result.partial && result.error === null) deps.cache.set(key, data);
      return data;
    })();

    inFlight.set(key, task);

    try {
      const data = await task;
      if (revision !== authRevision) throw new AbortError();
      if (data.repos.length === 0 && data.error !== null) return fail(data.error);
      return { ok: true, kind: 'fetch', data };
    } catch (error) {
      return fail(toErrorInfo(error));
    } finally {
      controllers.delete(request.requestId);
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  }

  async function handleSettingsSet(owner: string, raw: unknown): Promise<HandlerResponse> {
    const settings: SorterSettings = sanitizeSettings(raw);
    await deps.settings.write(owner, settings);
    return { ok: true, kind: 'settings', data: settings };
  }

  async function handleAuthStatus(): Promise<HandlerResponse> {
    const token = await deps.tokens.read();
    const persistent = await deps.tokens.isPersistent();
    if (token === null) {
      return { ok: true, kind: 'auth-status', data: { configured: false, login: null, persistent } };
    }
    try {
      const viewer = await resolveIdentity(token);
      return {
        ok: true,
        kind: 'auth-status',
        data: { configured: true, login: viewer.login, persistent },
      };
    } catch (error) {
      return fail(toErrorInfo(error));
    }
  }

  async function handleAuthSet(token: string, persist: boolean): Promise<HandlerResponse> {
    const revision = authRevision;
    let viewer: Viewer;
    try {
      viewer = await deps.fetchViewer({ token });
    } catch (error) {
      return fail(toErrorInfo(error));
    }
    if (revision !== authRevision) return fail({ kind: 'aborted', message: '認証状態が変更されました。' });
    authRevision += 1;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    inFlight.clear();
    await deps.tokens.write(token, { persist });
    if (revision + 1 !== authRevision) return fail({ kind: 'aborted', message: '認証状態が変更されました。' });
    identities.clear();
    identities.set(token, { viewer, storedAt: deps.now() });
    deps.cache.clear();
    deps.notifyAuthChanged?.();
    return {
      ok: true,
      kind: 'auth-status',
      data: { configured: true, login: viewer.login, persistent: persist },
    };
  }

  async function handleAuthClear(): Promise<HandlerResponse> {
    authRevision += 1;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    inFlight.clear();
    await deps.tokens.clear();
    identities.clear();
    deps.cache.clear();
    deps.notifyAuthChanged?.();
    return operation();
  }

  async function handle(request: Request, sender: SenderInfo): Promise<HandlerResponse | null> {
    const fromExtension = isExtensionSender(sender, deps.extensionUrlPrefix);
    const senderOwner = contentSenderOwner(sender);

    const requireContentOwner = (owner: string): boolean =>
      senderOwner !== null && senderOwner.toLowerCase() === owner.toLowerCase();
    const requireExtension = (): boolean => fromExtension;

    switch (request.type) {
      case 'fetch':
        return handleFetch(request, sender);

      case 'cancel': {
        controllers.get(request.requestId)?.abort();
        return operation();
      }

      case 'settings-get': {
        if (!requireContentOwner(request.owner)) {
          return fail({ kind: 'forbidden', message: '設定の取得元を検証できませんでした。' });
        }
        const settings = await deps.settings.read(request.owner);
        return { ok: true, kind: 'settings', data: settings };
      }

      case 'settings-set': {
        if (!requireContentOwner(request.owner)) {
          return fail({ kind: 'forbidden', message: '設定の保存元を検証できませんでした。' });
        }
        return handleSettingsSet(request.owner, request.settings);
      }

      case 'auth-status': {
        if (!requireExtension()) {
          return fail({ kind: 'forbidden', message: '認証状態を取得する権限がありません。' });
        }
        return handleAuthStatus();
      }

      case 'auth-set': {
        if (!requireExtension()) {
          return fail({ kind: 'forbidden', message: '認証情報を設定する権限がありません。' });
        }
        return serializeAuth(() => handleAuthSet(request.token, request.persist === true));
      }

      case 'auth-clear': {
        if (!requireExtension()) {
          return fail({ kind: 'forbidden', message: '認証情報を解除する権限がありません。' });
        }
        return serializeAuth(handleAuthClear);
      }

      case 'cache-clear': {
        if (!requireExtension()) {
          return fail({ kind: 'forbidden', message: 'キャッシュを消去する権限がありません。' });
        }
        deps.cache.clear();
        return operation();
      }

      case 'open-options': {
        if (senderOwner === null) {
          return fail({ kind: 'forbidden', message: '送信元のページを検証できませんでした。' });
        }
        deps.openOptions?.();
        return operation();
      }

      default:
        return null;
    }
  }

  return {
    handle,
    cancelAll(): void {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      inFlight.clear();
    },
  };
}
