// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { addSortItems, scopeFromNative } from '../src/content/dom';
import { createRepoRow, renderListContent } from '../src/content/render';
import type { UiState } from '../src/content/render';
import { NATIVE_HIDDEN_ATTR, locateNativeList, removeStalePanels, setNativeHidden } from '../src/content/native';
import type { FetchData } from '../src/shared/protocol';
import { makeRepo } from './helpers';

function makeData(overrides: Partial<FetchData> = {}): FetchData {
  return {
    owner: 'owner', authMode: 'public', login: null, repos: [makeRepo(1)],
    fetchedAt: Date.parse('2026-11-24T10:00:00Z'), fromCache: false,
    pagesFetched: 1, partial: false, error: null, ...overrides,
  };
}
function makeState(overrides: Partial<UiState> = {}): UiState {
  return { sort: 'activity', scope: 'all', query: '', page: 1, data: makeData(), loading: false, progress: null, error: null, ...overrides };
}
function nativeMarkup(): string {
  return `<main><form data-autosearch-results-container="user-repositories-list">
    <input type="search" name="q" id="your-repos-filter">
    <details id="type-options"><summary>Type</summary><input name="type" value="" type="radio" checked></details>
    <details id="sort-options"><summary>Sort</summary><div class="SelectMenu-list"><label><input name="sort" type="radio"></label></div></details>
    <a href="/new">New</a></form>
    <div id="user-repositories-list"><ul><li itemprop="owns">native</li></ul></div></main>`;
}
beforeEach(() => { document.body.innerHTML = ''; });

describe('menu integration', () => {
  it('adds five idempotent menu items without radio inputs or replacing GitHub controls', () => {
    document.body.innerHTML = nativeMarkup();
    const native = locateNativeList(document)!;
    const original = native.sortList.querySelector('input[name="sort"]');
    addSortItems(native.sortList, 'activity');
    addSortItems(native.sortList, 'activity');
    expect(native.sortList.querySelectorAll('[data-grs-sort]')).toHaveLength(5);
    expect(native.sortList.querySelectorAll('[data-grs-menu]')).toHaveLength(1);
    expect(native.sortList.querySelector('[data-grs-sort="activity"]')?.getAttribute('aria-checked')).toBe('true');
    expect(native.sortList.querySelector('input[name="sort"]')).toBe(original);
    expect(native.sortList.querySelectorAll('input')).toHaveLength(1);
    expect(document.querySelector('a[href="/new"]')).not.toBeNull();
  });
  it('maps only supported GitHub Type values', () => {
    expect(scopeFromNative('')).toBe('all');
    expect(scopeFromNative('fork')).toBe('forks');
    expect(scopeFromNative('source')).toBe('non-forks');
    expect(scopeFromNative('archived')).toBeNull();
  });
});

describe('repository rows', () => {
  it('renders API-backed metadata and safe GitHub links', () => {
    const repo = makeRepo(1, { name: 'api-client', description: 'HTTP client', fork: true, visibility: 'private', language: 'TypeScript', stars: 23, forks: 4, createdAt: '2026-11-20T00:00:00Z', pushedAt: '2026-11-01T00:00:00Z' });
    const row = createRepoRow(repo, 'activity');
    expect(row.querySelector('.grs-repo__name')?.getAttribute('href')).toBe('https://github.com/owner/api-client');
    expect(row.textContent).toContain('Private');
    expect(row.textContent).toContain('Fork');
    expect(row.textContent).toContain('TypeScript');
    expect(row.textContent).toContain('23');
    expect(row.textContent).toContain('4');
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-20T00:00:00.000Z');
  });
  it('does not invent missing metadata or interpret HTML', () => {
    const row = createRepoRow(makeRepo(1, { name: '<img src=x>', description: '<script>bad()</script>', stars: null, forks: null, language: null }), 'activity');
    expect(row.querySelector('script, img, .grs-repo__stars, .grs-repo__forks, .grs-repo__language')).toBeNull();
    expect(row.textContent).toContain('<img src=x>');
  });
  it('shows missing timestamps explicitly', () => {
    const row = createRepoRow(makeRepo(1, { pushedAt: null }), 'pushed');
    expect(row.textContent).toContain('Push: 日時なし');
  });
});

describe('list rendering', () => {
  it('filters all results before paginating and reports the access context', () => {
    const repos = Array.from({ length: 101 }, (_, index) => makeRepo(index + 1, { name: `repo-${index + 1}` }));
    const content = renderListContent(makeState({ data: makeData({ repos }), query: 'repo-1' }));
    expect(content.status.textContent).toContain('公開のみ');
    expect(content.status.textContent).toContain('表示13件');
    expect(content.body?.querySelectorAll('.grs-repo')).toHaveLength(13);
  });
  it('keeps native list visible on loading or error', () => {
    expect(renderListContent(makeState({ loading: true, progress: { page: 2, received: 150 } })).body).toBeNull();
    const error = renderListContent(makeState({ error: { kind: 'auth', message: 'bad token' } }));
    expect(error.body).toBeNull();
    expect(error.status.textContent).toContain('GitHub標準一覧');
    expect(error.status.querySelector('[data-grs-action="public-fallback"]')).not.toBeNull();
  });
  it('warns even when partial results have no matching rows', () => {
    const content = renderListContent(makeState({ query: 'missing', data: makeData({ partial: true, error: { kind: 'http', message: 'page failed' } }) }));
    expect(content.status.textContent).toContain('一部のみ');
    expect(content.body?.textContent).toContain('条件に一致');
  });
  it('renders 30 rows and a pager after complete fetch', () => {
    const repos = Array.from({ length: 61 }, (_, index) => makeRepo(index + 1));
    const content = renderListContent(makeState({ data: makeData({ repos }), page: 2 }));
    expect(content.body?.querySelectorAll('.grs-repo')).toHaveLength(30);
    expect(content.body?.querySelector('.grs-pager__status')?.textContent).toContain('31–60 / 61件');
  });
});

describe('native list integration', () => {
  it('only hides the list, never the search and other controls', () => {
    document.body.innerHTML = nativeMarkup();
    const native = locateNativeList(document)!;
    setNativeHidden(native.list, true);
    expect(native.list.getAttribute(NATIVE_HIDDEN_ATTR)).toBe('true');
    expect(native.search.closest(`[${NATIVE_HIDDEN_ATTR}]`)).toBeNull();
    expect(native.form.querySelector('a[href="/new"]')).not.toBeNull();
    setNativeHidden(native.list, false);
    expect(native.list.hasAttribute(NATIVE_HIDDEN_ATTR)).toBe(false);
  });
  it('fails open for unknown DOM and organisation layouts', () => {
    document.body.innerHTML = '<main><div id="org-repositories"><li itemprop="owns"></li></div></main>';
    expect(locateNativeList(document)).toBeNull();
  });
  it('removes stale extension nodes and unhides native content', () => {
    document.body.innerHTML = '<main><div data-grs-mount></div><div data-grs-menu></div><div data-grs-sort></div><div id="user-repositories-list" data-grs-hidden="true"></div></main>';
    removeStalePanels(document);
    expect(document.querySelector('[data-grs-mount], [data-grs-menu], [data-grs-sort]')).toBeNull();
    expect(document.querySelector('#user-repositories-list')?.hasAttribute(NATIVE_HIDDEN_ATTR)).toBe(false);
  });
});
