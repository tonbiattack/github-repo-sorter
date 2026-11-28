// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SorterApp } from '../src/content/app';
import type { FetchData } from '../src/shared/protocol';
import { makeRepo } from './helpers';

function markup(): string {
  return `<main><form data-autosearch-results-container="user-repositories-list">
    <input type="search" name="q" id="your-repos-filter">
    <details id="type-options"><summary>Type</summary><span data-menu-button>All</span>
      <label role="menuitemradio"><input type="radio" name="type" value="" checked><span data-menu-button-text>All</span></label>
      <label role="menuitemradio"><input type="radio" name="type" value="fork"><span data-menu-button-text>Forks</span></label>
      <label role="menuitemradio"><input type="radio" name="type" value="source"><span data-menu-button-text>Sources</span></label>
      <label role="menuitemradio"><input type="radio" name="type" value="archived"><span data-menu-button-text>Archived</span></label>
    </details>
    <details id="language-options"><summary>Language</summary><span data-menu-button>All</span>
      <label role="menuitemradio"><input type="radio" name="language" value="" checked><span data-menu-button-text>All</span></label>
      <label role="menuitemradio"><input type="radio" name="language" value="typescript"><span data-menu-button-text>TypeScript</span></label>
      <label role="menuitemradio"><input type="radio" name="language" value="python"><span data-menu-button-text>Python</span></label>
    </details>
    <details id="visibility-options"><summary>Visibility</summary><span data-menu-button>All</span>
      <label role="menuitemradio"><input type="radio" name="visibility" value="" checked><span data-menu-button-text>All</span></label>
      <label role="menuitemradio"><input type="radio" name="visibility" value="public"><span data-menu-button-text>Public</span></label>
      <label role="menuitemradio"><input type="radio" name="visibility" value="private"><span data-menu-button-text>Private</span></label>
    </details>
    <details id="sort-options"><summary>Sort</summary><div class="SelectMenu-list">
      <label role="menuitemradio"><input type="radio" name="sort" value="" checked>Updated</label>
      <label role="menuitemradio"><input type="radio" name="sort" value="name">Name</label>
    </div></details><a href="/new">New</a></form>
    <div id="user-repositories-list"><ul><li itemprop="owns">GitHub native</li></ul></div></main>`;
}
function response(repos = [makeRepo(1)]): { ok: true; kind: 'fetch'; data: FetchData } {
  return { ok: true, kind: 'fetch', data: { owner: 'owner', authMode: 'public', login: null, repos, fetchedAt: Date.now(), fromCache: false, pagesFetched: 1, partial: false, error: null } };
}
const settle = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 250)); };
let sendMessage: ReturnType<typeof vi.fn>;
let app: SorterApp;

beforeEach(() => {
  history.replaceState(null, '', 'https://github.com/owner?tab=repositories');
  document.body.innerHTML = markup();
  sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'settings-get') return { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all' } };
    if (message.type === 'fetch') return response();
    return { ok: true, kind: 'operation', data: { done: true } };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
  app = new SorterApp();
});
afterEach(() => {
  app.stop();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('GitHub form integration', () => {
  it('inserts only into Sort, preserves native search, then restores the native list on standard selection', async () => {
    app.start();
    await settle();
    expect(document.querySelectorAll('[data-grs-sort]')).toHaveLength(5);
    expect(document.querySelectorAll('[data-grs-mount]')).toHaveLength(1);
    expect(document.querySelector('[data-grs-root]')).toBeNull();
    expect(document.querySelector('#your-repos-filter')).not.toBeNull();
    expect(document.querySelector('#user-repositories-list')?.getAttribute('data-grs-hidden')).toBe('true');
    expect(document.querySelector('[data-grs-list]')).not.toBeNull();
    (document.querySelector('input[name="sort"][value="name"]') as HTMLInputElement).click();
    expect(document.querySelector('[data-grs-list]')).toBeNull();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings-set', settings: expect.objectContaining({ view: 'standard' }) }));
    (document.querySelector('[data-grs-sort="created"]') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('[data-grs-sort="created"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-grs-list]')).not.toBeNull();
  });

  it('intercepts supported Type selections and searches the whole fetched set', async () => {
    const repos = Array.from({ length: 101 }, (_, i) => makeRepo(i + 1, { name: `repo-${i + 1}`, fork: i === 100 }));
    sendMessage.mockImplementation(async (message: { type: string }) => message.type === 'settings-get'
      ? { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter' } }
      : message.type === 'fetch' ? response(repos) : { ok: true, kind: 'operation', data: { done: true } });
    app.start();
    await settle();
    const fork = document.querySelector('input[name="type"][value="fork"]') as HTMLInputElement;
    fork.click();
    expect(document.querySelectorAll('[data-grs-list] .grs-repo')).toHaveLength(1);
    expect(document.querySelector('[data-grs-list]')?.textContent).toContain('repo-101');
    const search = document.querySelector('#your-repos-filter') as HTMLInputElement;
    search.value = 'repo-101';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.querySelector('[data-grs-status]')?.textContent).toContain('1 shown');
    // Archived is now honoured from API data, so the extension keeps the list.
    (document.querySelector('input[name="type"][value="archived"]') as HTMLInputElement).click();
    await settle();
    expect(document.querySelector('[data-grs-list]')).not.toBeNull();
    expect(document.querySelector('[data-grs-status]')?.textContent).toContain('0 shown');
  });

  it('falls back to the standard listing for a Type the API cannot reproduce', async () => {
    document.body.innerHTML = document.body.innerHTML.replace(
      '<input type="radio" name="type" value="archived">',
      '<input type="radio" name="type" value="sponsorable">',
    );
    app.start();
    await settle();
    (document.querySelector('input[name="type"][value="sponsorable"]') as HTMLInputElement).click();
    await settle();
    expect(document.querySelector('[data-grs-list]')).toBeNull();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
  });

  it('remounts once after GitHub replaces its list and retains original form', async () => {
    app.start();
    await settle();
    const old = document.querySelector('#user-repositories-list')!;
    const replacement = old.cloneNode(true) as HTMLElement;
    replacement.removeAttribute('data-grs-hidden');
    old.replaceWith(replacement);
    await settle();
    expect(document.querySelectorAll('[data-grs-mount]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-grs-sort]')).toHaveLength(5);
    expect(replacement.getAttribute('data-grs-hidden')).toBe('true');
    expect(document.querySelector('#your-repos-filter')).not.toBeNull();
  });

  it('honours an explicitly selected GitHub Type on initial navigation', async () => {
    history.replaceState(null, '', 'https://github.com/owner?tab=repositories&type=fork');
    const fork = document.querySelector('input[name="type"][value="fork"]') as HTMLInputElement;
    fork.checked = true;
    app.start();
    await settle();
    expect(fork.checked).toBe(true);
    expect(document.querySelector('[data-grs-list]')).toBeNull();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
  });

  it('keeps native search usable after a fetch failure', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings-get') return { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all' } };
      if (message.type === 'fetch') return { ok: false, error: { kind: 'rate-limit', message: 'limited' } };
      return { ok: true, kind: 'operation', data: { done: true } };
    });
    app.start();
    await settle();
    const listener = vi.fn();
    document.querySelector('#your-repos-filter')!.addEventListener('input', listener);
    document.querySelector('#your-repos-filter')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(listener).toHaveBeenCalledOnce();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
    expect(document.querySelector('[data-grs-status]')?.textContent).toContain('limited');
  });

  it('applies search changes made while a request is loading', async () => {
    let finish: ((value: unknown) => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings-get') return { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all' } };
      if (message.type === 'fetch') return new Promise((resolve) => { finish = resolve; });
      return { ok: true, kind: 'operation', data: { done: true } };
    });
    app.start();
    await settle();
    const search = document.querySelector('#your-repos-filter') as HTMLInputElement;
    search.value = 'match';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    finish?.(response([makeRepo(1, { name: 'match' }), makeRepo(2, { name: 'other' })]));
    await settle();
    expect(document.querySelectorAll('[data-grs-list] .grs-repo')).toHaveLength(1);
    expect(document.querySelector('[data-grs-list]')?.textContent).toContain('match');
  });

  it('drops GitHub filter params when the extension takes over so reload keeps the custom view', async () => {
    history.replaceState(null, '', 'https://github.com/owner?tab=repositories&sort=name&type=fork');
    (document.querySelector('input[name="type"][value="fork"]') as HTMLInputElement).checked = true;
    app.start();
    await settle();
    (document.querySelector('[data-grs-sort="created"]') as HTMLButtonElement).click();
    await settle();
    const url = new URL(location.href);
    expect(url.searchParams.has('sort')).toBe(false);
    expect(url.searchParams.has('type')).toBe(false);
    expect(url.searchParams.get('tab')).toBe('repositories');
    expect(document.querySelector('[data-grs-list]')).not.toBeNull();
  });

  it('shows the active custom sort on the Sort button and restores GitHub markup', async () => {
    app.start();
    await settle();
    const summary = document.querySelector('#sort-options summary')!;
    expect(summary.querySelector('[data-grs-sort-label]')?.textContent).toBe('Created · Forked · Pushed');

    (document.querySelector('[data-grs-sort="pushed"]') as HTMLButtonElement).click();
    await settle();
    expect(summary.querySelector('[data-grs-sort-label]')?.textContent).toBe('Newest pushed');

    (document.querySelector('input[name="sort"][value="name"]') as HTMLInputElement).click();
    await settle();
    expect(summary.querySelector('[data-grs-sort-label]')).toBeNull();
    expect(summary.hasAttribute('data-grs-sort-active')).toBe(false);
  });

  it('applies Language and Visibility from GitHub menus to the fetched set', async () => {
    const repos = [
      makeRepo(1, { name: 'ts-app', language: 'TypeScript', visibility: 'public' }),
      makeRepo(2, { name: 'py-app', language: 'Python', visibility: 'public' }),
      makeRepo(3, { name: 'ts-secret', language: 'TypeScript', visibility: 'private' }),
    ];
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings-get') return { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all' } };
      if (message.type === 'fetch') return response(repos);
      return { ok: true, kind: 'operation', data: { done: true } };
    });
    app.start();
    await settle();

    (document.querySelector('input[name="language"][value="typescript"]') as HTMLInputElement).click();
    await settle();
    expect(document.querySelectorAll('[data-grs-list] .grs-repo')).toHaveLength(2);
    expect(document.querySelector('[data-grs-status]')?.textContent).toContain('2 shown');

    (document.querySelector('input[name="visibility"][value="private"]') as HTMLInputElement).click();
    await settle();
    expect(document.querySelectorAll('[data-grs-list] .grs-repo')).toHaveLength(1);
    expect(document.querySelector('[data-grs-list]')?.textContent).toContain('ts-secret');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'settings-set',
      settings: expect.objectContaining({ language: 'typescript', visibility: 'private' }),
    }));
  });

  it('purges private content immediately when trusted authentication changes', async () => {
    let onMessage: ((message: unknown, sender: { id: string }) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: {
      id: 'extension-id', sendMessage,
      onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; }, removeListener: vi.fn() },
    } });
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings-get') return { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all' } };
      if (message.type === 'fetch') return response([makeRepo(1, { name: 'private-test', visibility: 'private' })]);
      return { ok: true, kind: 'operation', data: { done: true } };
    });
    app.start();
    await settle();
    expect(document.querySelector('[data-grs-list]')?.textContent).toContain('private-test');
    onMessage?.({ channel: 'github-repo-sorter/1', type: 'auth-changed' }, { id: 'extension-id' });
    expect(document.querySelector('[data-grs-list]')).toBeNull();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
  });

  it('sends the live page URL and stops fetching once the tab has navigated away', async () => {
    app.start();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'fetch',
      pageUrl: 'https://github.com/owner?tab=repositories',
    }));

    // Turbo navigation to a repository page: same document, new URL.
    history.replaceState(null, '', 'https://github.com/owner/some-repo');
    sendMessage.mockClear();
    (document.querySelector('[data-grs-action="refresh"]') as HTMLButtonElement).click();
    await settle();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'fetch' }));
  });

  it('keeps native list accessible when fetch fails and ignores a superseded response', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings-get') return { ok: true, kind: 'settings', data: { sort: 'activity', scope: 'all', view: 'sorter', type: 'all', language: 'all', visibility: 'all' } };
      if (message.type === 'fetch') return new Promise((resolve) => { resolveFirst = resolve; });
      return { ok: true, kind: 'operation', data: { done: true } };
    });
    app.start();
    await settle();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
    (document.querySelector('input[name="sort"][value="name"]') as HTMLInputElement).click();
    resolveFirst?.(response());
    await settle();
    expect(document.querySelector('[data-grs-list]')).toBeNull();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute('data-grs-hidden')).toBe(false);
  });
});
