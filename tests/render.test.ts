// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPanel } from '../src/content/dom';
import { createRepoRow, renderPanelContent } from '../src/content/render';
import type { UiState } from '../src/content/render';
import {
  NATIVE_HIDDEN_ATTR,
  locateNativeList,
  removeStalePanels,
  setNativeHidden,
} from '../src/content/native';
import type { FetchData } from '../src/shared/protocol';
import type { Repo } from '../src/shared/types';
import { makeRepo } from './helpers';

function makeData(overrides: Partial<FetchData> = {}): FetchData {
  return {
    owner: 'owner',
    authMode: 'public',
    login: null,
    repos: [makeRepo(1)],
    fetchedAt: Date.parse('2026-11-24T10:00:00Z'),
    fromCache: false,
    pagesFetched: 1,
    partial: false,
    error: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<UiState> = {}): UiState {
  return {
    owner: 'owner',
    view: 'sorter',
    sort: 'activity',
    scope: 'all',
    query: '',
    page: 1,
    data: makeData(),
    loading: false,
    progress: null,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createPanel', () => {
  it('builds the controls for every sort mode and scope', () => {
    const panel = createPanel('Some-Org');

    expect(panel.root.getAttribute('data-grs-owner')).toBe('Some-Org');
    expect(panel.sortSelect.options).toHaveLength(5);
    expect(panel.scopeSelect.options).toHaveLength(3);
    expect(panel.sortSelect.value).toBe('activity');
    expect(panel.searchInput.getAttribute('data-grs-control')).toBe('query');
    expect(panel.root.textContent).toContain('/Some-Org');
    expect(panel.authBadge.textContent).toBe('公開のみ');
  });

  it('keeps the search field and selects when the body re-renders', () => {
    const panel = createPanel('owner');
    document.body.append(panel.root);
    panel.searchInput.value = 'typed';

    const state = makeState({ data: null, loading: true });
    const content = renderPanelContent(state);
    panel.body.replaceChildren(content.body);

    expect(document.body.contains(panel.searchInput)).toBe(true);
    expect(panel.searchInput.value).toBe('typed');
  });
});

describe('createRepoRow', () => {
  it('renders the repository details, badges and activity date', () => {
    const repo = makeRepo(1, {
      name: 'api-client',
      description: 'HTTP client',
      fork: true,
      visibility: 'private',
      createdAt: '2026-11-20T00:00:00Z',
      pushedAt: '2026-11-01T00:00:00Z',
    });
    const row = createRepoRow(repo, 'activity');

    const link = row.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/owner/api-client');
    expect(link?.textContent).toBe('api-client');
    expect(row.textContent).toContain('Private');
    expect(row.textContent).toContain('Fork');
    expect(row.textContent).toContain('HTTP client');

    const time = row.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-11-20T00:00:00.000Z');
    expect(row.textContent).toContain('最終活動');
    expect(row.querySelector('.grs-kind')?.textContent).toBe('Fork');
  });

  it('never interprets repository text as HTML', () => {
    const repo = makeRepo(1, {
      name: '<img src=x onerror="window.__pwned=1">',
      description: '<script>window.__pwned = 2</script>',
    });
    const row = createRepoRow(repo, 'activity');

    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(row.textContent).toContain('<img src=x');
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('shows "日時なし" when the selected timestamp is missing', () => {
    const repo = makeRepo(1, { createdAt: 'invalid', pushedAt: null });
    const row = createRepoRow(repo, 'pushed');
    expect(row.textContent).toContain('Push: 日時なし');
    expect(row.querySelector('time')).toBeNull();
  });
});

describe('renderPanelContent', () => {
  it('lists repositories with counts and a pager', () => {
    const repos: Repo[] = Array.from({ length: 61 }, (_, index) =>
      makeRepo(index + 1, { name: `repo-${index + 1}` }),
    );
    const content = renderPanelContent(makeState({ data: makeData({ repos }) }));

    expect(content.statusText).toContain('全61件');
    expect(content.statusText).toContain('表示61件');
    expect(content.body.querySelectorAll('.grs-repo')).toHaveLength(30);
    expect(content.body.querySelector('.grs-pager__status')?.textContent).toContain('1–30 / 61件');
  });

  it('renders the requested page', () => {
    const repos: Repo[] = Array.from({ length: 61 }, (_, index) =>
      makeRepo(index + 1, { name: `repo-${index + 1}` }),
    );
    const content = renderPanelContent(makeState({ data: makeData({ repos }), page: 3 }));
    expect(content.body.querySelectorAll('.grs-repo')).toHaveLength(1);
    expect(content.body.querySelector('.grs-pager__status')?.textContent).toContain('61–61 / 61件');
  });

  it('applies the search query before paginating', () => {
    const repos: Repo[] = Array.from({ length: 61 }, (_, index) =>
      makeRepo(index + 1, { name: `repo-${index + 1}` }),
    );
    const content = renderPanelContent(makeState({ data: makeData({ repos }), query: 'repo-1' }));

    const rows = content.body.querySelectorAll('.grs-repo');
    expect(rows).toHaveLength(11); // repo-1, repo-10 ... repo-19
    expect(content.statusText).toContain('表示11件');
  });

  it('shows an empty state with an action', () => {
    const content = renderPanelContent(makeState({ data: makeData({ repos: [] }) }));
    expect(content.body.textContent).toContain('リポジトリがありません');
    expect(content.body.querySelector('[data-grs-action="retry"]')).not.toBeNull();
  });

  it('shows the filtered empty state when a query matches nothing', () => {
    const content = renderPanelContent(makeState({ query: 'zzz' }));
    expect(content.body.textContent).toContain('条件に一致するリポジトリがありません');
    expect(content.body.querySelector('[data-grs-action="clear"]')).not.toBeNull();
  });

  it('shows the standard view with a way back', () => {
    const content = renderPanelContent(makeState({ view: 'standard' }));
    expect(content.statusText).toContain('標準表示中');
    expect(content.body.querySelector('ul')).toBeNull();
    expect(content.body.querySelector('[data-grs-action="sorter"]')).not.toBeNull();
  });

  it('shows a retryable error state with a public fallback for auth failures', () => {
    const content = renderPanelContent(
      makeState({ data: null, error: { kind: 'auth', message: 'トークンが無効です' } }),
    );
    expect(content.statusText).toBe('取得に失敗しました');
    expect(content.body.textContent).toContain('トークンが無効です');
    expect(content.body.querySelector('[data-grs-action="retry"]')).not.toBeNull();
    expect(content.body.querySelector('[data-grs-action="public-fallback"]')).not.toBeNull();
    expect(content.body.querySelector('[data-grs-action="open-options"]')).not.toBeNull();
    expect(content.body.querySelector('[data-grs-action="standard"]')).not.toBeNull();
  });

  it('does not offer the public fallback for a network error', () => {
    const content = renderPanelContent(
      makeState({ data: null, error: { kind: 'network', message: 'offline' } }),
    );
    expect(content.body.querySelector('[data-grs-action="public-fallback"]')).toBeNull();
    expect(content.body.querySelector('[data-grs-action="retry"]')).not.toBeNull();
  });

  it('keeps the list visible for partial data and warns about it', () => {
    const content = renderPanelContent(
      makeState({
        data: makeData({
          partial: true,
          error: { kind: 'http', message: '2ページ目に失敗しました' },
        }),
      }),
    );
    expect(content.body.querySelectorAll('.grs-repo')).toHaveLength(1);
    expect(content.body.querySelector('.grs-banner--warning')?.textContent).toContain('一部のデータのみ取得しました');
    expect(content.statusText).toContain('一部のみ');
  });

  it('shows a loading state with progress', () => {
    const content = renderPanelContent(
      makeState({ data: null, loading: true, progress: { page: 2, received: 150 } }),
    );
    expect(content.statusText).toContain('150件');
    expect(content.body.querySelector('.grs-spinner')).not.toBeNull();
  });

  it('marks cached results in the status line', () => {
    const content = renderPanelContent(makeState({ data: makeData({ fromCache: true }) }));
    expect(content.statusText).toContain('キャッシュ');
  });
});

describe('native list integration', () => {
  it('finds the personal list and hides its search form together', () => {
    document.body.innerHTML = `
      <main>
        <div class="section">
          <div class="border-bottom"><form data-autosearch-results-container="user-repositories-list"><input></form></div>
          <div id="user-repositories-list"><ul><li itemprop="owns"></li></ul></div>
        </div>
      </main>
    `;

    const native = locateNativeList(document);
    expect(native).not.toBeNull();
    if (!native) return;

    expect(native.list.id).toBe('user-repositories-list');
    expect(native.anchor).toBe(native.hideTargets[0]);
    expect(native.hideTargets).toHaveLength(2);

    setNativeHidden(native.hideTargets, true);
    for (const target of native.hideTargets) {
      expect(target.getAttribute(NATIVE_HIDDEN_ATTR)).toBe('true');
    }

    setNativeHidden(native.hideTargets, false);
    for (const target of native.hideTargets) {
      expect(target.hasAttribute(NATIVE_HIDDEN_ATTR)).toBe(false);
    }
  });

  it('finds the organisation list', () => {
    document.body.innerHTML = `<main><div id="org-repositories"><ul><li itemprop="owns"></li></ul></div></main>`;
    const native = locateNativeList(document);
    expect(native?.list.id).toBe('org-repositories');
    expect(native?.hideTargets).toHaveLength(1);
  });

  it('falls back to the list that contains repository rows', () => {
    document.body.innerHTML = `<main><div class="custom"><ul><li itemprop="owns"></li></ul></div></main>`;
    const native = locateNativeList(document);
    expect(native?.list.tagName).toBe('DIV');
    expect(native?.anchor).toBe(native?.list);
  });

  it('returns null when the page has no repository list', () => {
    document.body.innerHTML = '<main><p>nothing here</p></main>';
    expect(locateNativeList(document)).toBeNull();
  });

  it('removes stale panels', () => {
    document.body.innerHTML = '<main><section data-grs-root></section><section data-grs-root></section></main>';
    removeStalePanels(document);
    expect(document.querySelectorAll('[data-grs-root]')).toHaveLength(0);
  });
});
