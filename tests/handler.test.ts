import { describe, expect, it, vi } from 'vitest';
import { AbortError } from '../src/shared/api';
import type { FetchAllOptions, FetchAllResult } from '../src/shared/api';
import { TtlCache } from '../src/shared/cache';
import { createMessageHandler } from '../src/background/handler';
import type { HandlerDeps } from '../src/background/handler';
import { createSettingsStore, createTokenStore } from '../src/background/storage';
import { CHANNEL } from '../src/shared/protocol';
import type { FetchData, HandlerResponse, Request } from '../src/shared/protocol';
import { makeRepo, memoryArea } from './helpers';

const OWNER_PAGE = { tabId: 1, frameId: 0, url: 'https://github.com/owner?tab=repositories' };
const OTHER_PAGE = { tabId: 2, frameId: 0, url: 'https://github.com/other?tab=repositories' };
const EXTENSION_PAGE = { url: 'chrome-extension://ext/options.html' };
const TOKEN = 'ghp_token1234567890';

function expectResponse(response: HandlerResponse | null): HandlerResponse {
  if (response === null) throw new Error('expected a handler response');
  return response;
}

function fetchRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    channel: CHANNEL,
    type: 'fetch',
    requestId: 'req-1',
    owner: 'owner',
    force: false,
    ...overrides,
  } as Request;
}

function setup(options: {
  token?: string;
  fetchAll?: HandlerDeps['fetchAll'];
  fetchViewer?: HandlerDeps['fetchViewer'];
} = {}) {
  const clock = { now: 1_000_000 };
  const cache = new TtlCache<FetchData>(5 * 60_000, () => clock.now);
  const session = memoryArea(options.token ? { 'grs:pat': options.token } : {});
  const local = memoryArea();
  const repo = makeRepo(1);

  const fetchAll =
    options.fetchAll ??
    vi.fn(async (_options: FetchAllOptions): Promise<FetchAllResult> => ({
      repos: [repo],
      pagesFetched: 1,
      partial: false,
      error: null,
    }));
  const fetchViewer = options.fetchViewer ?? vi.fn(async () => ({ login: 'owner', id: 1 }));
  const notifyProgress = vi.fn();
  const openOptions = vi.fn();

  const deps: HandlerDeps = {
    fetchAll,
    fetchViewer,
    cache,
    settings: createSettingsStore(local),
    tokens: createTokenStore(session),
    now: () => clock.now,
    extensionUrlPrefix: 'chrome-extension://ext/',
    notifyProgress,
    openOptions,
  };

  return { handler: createMessageHandler(deps), cache, fetchAll, fetchViewer, session, local, clock, notifyProgress, openOptions, repo };
}

describe('sender validation', () => {
  it('rejects messages from pages that are not a repository list', async () => {
    const { handler, fetchAll } = setup();
    const response = expectResponse(
      await handler.handle(fetchRequest(), { tabId: 1, frameId: 0, url: 'https://github.com/owner?tab=stars' }),
    );
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('forbidden');
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('rejects a request whose owner does not match the page', async () => {
    const { handler, fetchAll } = setup();
    const response = expectResponse(await handler.handle(fetchRequest(), OTHER_PAGE));
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('forbidden');
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('rejects sub-frames', async () => {
    const { handler } = setup();
    const response = expectResponse(
      await handler.handle(fetchRequest(), { ...OWNER_PAGE, frameId: 1 }),
    );
    expect(response.ok).toBe(false);
  });
});

describe('public fetch', () => {
  it('returns normalised repositories and caches the result', async () => {
    const { handler, cache, fetchAll } = setup();
    const first = expectResponse(await handler.handle(fetchRequest(), OWNER_PAGE));
    expect(first).toMatchObject({ ok: true, kind: 'fetch' });
    if (first.ok && first.kind === 'fetch') {
      expect(first.data.authMode).toBe('public');
      expect(first.data.login).toBeNull();
      expect(first.data.fromCache).toBe(false);
      expect(first.data.repos).toHaveLength(1);
    }
    expect(fetchAll).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);

    const second = expectResponse(await handler.handle(fetchRequest(), OWNER_PAGE));
    if (second.ok && second.kind === 'fetch') expect(second.data.fromCache).toBe(true);
    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when force is set', async () => {
    const { handler, fetchAll } = setup();
    await handler.handle(fetchRequest(), OWNER_PAGE);
    const response = expectResponse(
      await handler.handle(fetchRequest({ force: true, requestId: 'req-2' }), OWNER_PAGE),
    );
    if (response.ok && response.kind === 'fetch') expect(response.data.fromCache).toBe(false);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('forwards page progress to the sender tab', async () => {
    const fetchAll = vi.fn(async (options: FetchAllOptions): Promise<FetchAllResult> => {
      options.onPage?.({ page: 1, received: 5, hasMore: true });
      return { repos: [makeRepo(1)], pagesFetched: 1, partial: false, error: null };
    });
    const { handler, notifyProgress } = setup({ fetchAll });
    await handler.handle(fetchRequest(), OWNER_PAGE);
    expect(notifyProgress).toHaveBeenCalledWith({
      tabId: 1,
      requestId: 'req-1',
      page: 1,
      received: 5,
    });
  });
});

describe('authenticated fetch', () => {
  it('uses the token and verifies the page owner', async () => {
    const { handler, fetchAll, fetchViewer } = setup({ token: TOKEN });
    const response = expectResponse(await handler.handle(fetchRequest(), OWNER_PAGE));

    expect(fetchViewer).toHaveBeenCalled();
    expect(fetchAll).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, owner: 'owner' }));
    if (response.ok && response.kind === 'fetch') {
      expect(response.data.authMode).toBe('authenticated');
      expect(response.data.login).toBe('owner');
    }
  });

  it('refuses to mix another account with the page owner', async () => {
    const { handler, fetchAll } = setup({
      token: TOKEN,
      fetchViewer: async () => ({ login: 'someone-else', id: 99 }),
    });
    const response = expectResponse(await handler.handle(fetchRequest(), OWNER_PAGE));
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('owner-mismatch');
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('reports a missing token when authentication is forced', async () => {
    const { handler, fetchAll } = setup();
    const response = expectResponse(
      await handler.handle(fetchRequest({ authMode: 'authenticated' }), OWNER_PAGE),
    );
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('auth');
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('falls back to the public listing when asked explicitly', async () => {
    const { handler, fetchAll } = setup();
    const response = expectResponse(
      await handler.handle(fetchRequest({ authMode: 'public', requestId: 'req-pub' }), OWNER_PAGE),
    );
    expect(fetchAll).toHaveBeenCalledWith(expect.objectContaining({ token: null }));
    if (response.ok && response.kind === 'fetch') expect(response.data.authMode).toBe('public');
  });
});

describe('failures and cancellation', () => {
  it('does not cache partial results', async () => {
    const fetchAll = vi.fn(async (): Promise<FetchAllResult> => ({
      repos: [makeRepo(1)],
      pagesFetched: 1,
      partial: true,
      error: { kind: 'http', message: 'page 2 failed' },
    }));
    const { handler, cache } = setup({ fetchAll });

    const response = expectResponse(await handler.handle(fetchRequest(), OWNER_PAGE));
    if (response.ok && response.kind === 'fetch') {
      expect(response.data.partial).toBe(true);
      expect(response.data.error?.kind).toBe('http');
    }
    expect(cache.size).toBe(0);
  });

  it('turns a total failure into an error response', async () => {
    const fetchAll = vi.fn(async (): Promise<FetchAllResult> => ({
      repos: [],
      pagesFetched: 0,
      partial: false,
      error: { kind: 'rate-limit', message: 'slow down' },
    }));
    const { handler } = setup({ fetchAll });
    const response = expectResponse(await handler.handle(fetchRequest(), OWNER_PAGE));
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('rate-limit');
  });

  it('aborts an in-flight fetch on cancel', async () => {
    let signalStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const fetchAll = vi.fn((options: FetchAllOptions) => {
      signalStarted?.();
      return new Promise<FetchAllResult>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new AbortError()));
      });
    });
    const { handler } = setup({ fetchAll });

    const pending = handler.handle(fetchRequest({ requestId: 'req-abort' }), OWNER_PAGE);
    await started;
    await handler.handle({ channel: CHANNEL, type: 'cancel', requestId: 'req-abort' }, OWNER_PAGE);

    const response = expectResponse(await pending);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('aborted');
  });
});

describe('settings', () => {
  it('stores and reads owner-scoped settings', async () => {
    const { handler, local } = setup();
    const set = expectResponse(
      await handler.handle(
        {
          channel: CHANNEL,
          type: 'settings-set',
          owner: 'owner',
          settings: { sort: 'created', scope: 'forks', injected: true },
        },
        OWNER_PAGE,
      ),
    );
    expect(set).toEqual({
      ok: true,
      kind: 'settings',
      data: { sort: 'created', scope: 'forks', view: 'sorter' },
    });
    expect(local.data['grs:settings:owner']).toEqual({ sort: 'created', scope: 'forks', view: 'sorter' });

    const get = expectResponse(
      await handler.handle(
        { channel: CHANNEL, type: 'settings-get', owner: 'OWNER' },
        OWNER_PAGE,
      ),
    );
    expect(get).toEqual({ ok: true, kind: 'settings', data: { sort: 'created', scope: 'forks', view: 'sorter' } });
  });

  it('rejects settings access from a different owner page', async () => {
    const { handler } = setup();
    const response = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'settings-get', owner: 'other' }, OWNER_PAGE),
    );
    expect(response.ok).toBe(false);
  });
});

describe('authentication management', () => {
  it('forbids auth operations from content scripts', async () => {
    const { handler } = setup();
    for (const request of [
      { channel: CHANNEL, type: 'auth-status' },
      { channel: CHANNEL, type: 'auth-set', token: TOKEN },
      { channel: CHANNEL, type: 'auth-clear' },
      { channel: CHANNEL, type: 'cache-clear' },
    ] as Request[]) {
      const response = expectResponse(await handler.handle(request, OWNER_PAGE));
      expect(response.ok).toBe(false);
    }
  });

  it('validates and stores a token from the options page', async () => {
    const { handler, session, cache, fetchViewer, fetchAll } = setup();
    await handler.handle(fetchRequest(), OWNER_PAGE);
    expect(cache.size).toBe(1);

    const response = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'auth-set', token: TOKEN }, EXTENSION_PAGE),
    );
    expect(response).toEqual({
      ok: true,
      kind: 'auth-status',
      data: { configured: true, login: 'owner' },
    });
    expect(session.data['grs:pat']).toBe(TOKEN);
    expect(cache.size).toBe(0);
    expect(fetchViewer).toHaveBeenCalledTimes(1);
    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid token without storing it', async () => {
    const { handler, session } = setup({
      fetchViewer: async () => {
        throw new AbortError();
      },
    });
    const response = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'auth-set', token: TOKEN }, EXTENSION_PAGE),
    );
    expect(response.ok).toBe(false);
    expect(session.data['grs:pat']).toBeUndefined();
  });

  it('reports auth status and clears the token', async () => {
    const { handler, session } = setup({ token: TOKEN });

    const status = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'auth-status' }, EXTENSION_PAGE),
    );
    expect(status).toEqual({
      ok: true,
      kind: 'auth-status',
      data: { configured: true, login: 'owner' },
    });

    await handler.handle({ channel: CHANNEL, type: 'auth-clear' }, EXTENSION_PAGE);
    expect(session.data['grs:pat']).toBeUndefined();

    const cleared = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'auth-status' }, EXTENSION_PAGE),
    );
    expect(cleared).toEqual({
      ok: true,
      kind: 'auth-status',
      data: { configured: false, login: null },
    });
  });

  it('notifies content tabs when authentication changes', async () => {
    const notify = vi.fn();
    const base = setup();
    const handler = createMessageHandler({
      fetchAll: base.fetchAll,
      fetchViewer: base.fetchViewer,
      cache: base.cache,
      settings: createSettingsStore(base.local),
      tokens: createTokenStore(base.session),
      now: () => base.clock.now,
      extensionUrlPrefix: 'chrome-extension://ext/',
      notifyAuthChanged: notify,
    });
    await handler.handle({ channel: CHANNEL, type: 'auth-set', token: TOKEN }, EXTENSION_PAGE);
    await handler.handle({ channel: CHANNEL, type: 'auth-clear' }, EXTENSION_PAGE);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not return or cache an in-flight private listing after token removal', async () => {
    let resolveFetch: ((value: FetchAllResult) => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const fetchAll = vi.fn(() => new Promise<FetchAllResult>((resolve) => { resolveFetch = resolve; started?.(); }));
    const { handler, cache } = setup({ token: TOKEN, fetchAll });
    const pending = handler.handle(fetchRequest(), OWNER_PAGE);
    await ready;
    await handler.handle({ channel: CHANNEL, type: 'auth-clear' }, EXTENSION_PAGE);
    resolveFetch?.({ repos: [makeRepo(1, { visibility: 'private' })], pagesFetched: 1, partial: false, error: null });
    const result = expectResponse(await pending);
    expect(result).toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(cache.size).toBe(0);
  });

  it('clears the cache without touching the token', async () => {
    const { handler, cache, session } = setup({ token: TOKEN });
    await handler.handle(fetchRequest(), OWNER_PAGE);
    expect(cache.size).toBe(1);
    await handler.handle({ channel: CHANNEL, type: 'cache-clear' }, EXTENSION_PAGE);
    expect(cache.size).toBe(0);
    expect(session.data['grs:pat']).toBe(TOKEN);
  });

  it('opens the options page only for content senders', async () => {
    const { handler, openOptions } = setup();
    const fromContent = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'open-options' }, OWNER_PAGE),
    );
    expect(fromContent.ok).toBe(true);
    expect(openOptions).toHaveBeenCalledTimes(1);

    const fromExtension = expectResponse(
      await handler.handle({ channel: CHANNEL, type: 'open-options' }, EXTENSION_PAGE),
    );
    expect(fromExtension.ok).toBe(false);
  });
});
