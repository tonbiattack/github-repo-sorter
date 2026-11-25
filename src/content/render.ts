import { ACTIVITY_LABELS, SORT_LABELS, formatDateTime } from '../shared/labels';
import { parseTimestamp } from '../shared/dates';
import { activityOf, forkTimestampOf } from '../shared/sort';
import { buildView } from '../shared/view';
import type { View } from '../shared/view';
import type { FetchData } from '../shared/protocol';
import type { FetchErrorInfo, Repo, Scope, SortMode, TypeFilter, VisibilityFilter } from '../shared/types';
import { actionButton, h, pageButton } from './dom';

export interface UiState {
  readonly sort: SortMode;
  readonly scope: Scope;
  readonly query: string;
  readonly page: number;
  readonly data: FetchData | null;
  readonly loading: boolean;
  readonly progress: { readonly page: number; readonly received: number } | null;
  readonly error: FetchErrorInfo | null;
  readonly type: TypeFilter;
  readonly language: string;
  readonly visibility: VisibilityFilter;
}

export interface ListContent {
  readonly status: HTMLElement;
  readonly body: HTMLElement | null;
}

/**
 * GitHub's language colours. Only well-known languages are coloured; unknown
 * languages fall back to a neutral dot instead of inventing a colour.
 */
const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  'c': '#555555',
  'c#': '#178600',
  'c++': '#f34b7d',
  'css': '#663399',
  'dart': '#00B4AB',
  'dockerfile': '#384d54',
  'elixir': '#6e4a7e',
  'go': '#00ADD8',
  'haskell': '#5e5086',
  'html': '#e34c26',
  'java': '#b07219',
  'javascript': '#f1e05a',
  'jupyter notebook': '#DA5B0B',
  'kotlin': '#A97BFF',
  'lua': '#000080',
  'php': '#4F5D95',
  'python': '#3572A5',
  'ruby': '#701516',
  'rust': '#dea584',
  'scala': '#c22d40',
  'shell': '#89e051',
  'swift': '#F05138',
  'typescript': '#3178c6',
  'vue': '#41b883',
  'zig': '#ec915c',
};

export function languageColor(language: string): string | null {
  return LANGUAGE_COLORS[language.trim().toLowerCase()] ?? null;
}

/** Status remains visible above GitHub's own list while loading or on failure. */
export function renderListContent(state: UiState): ListContent {
  const status = h('div', {
    className: 'grs-status color-fg-muted f6',
    attrs: { role: 'status', 'aria-live': 'polite', 'data-grs-status': '' },
  });
  if (state.loading) {
    const progress = state.progress ? ` ${state.progress.received}件（${state.progress.page}ページ）` : '';
    status.append(`リポジトリ取得中…${progress} GitHub標準一覧を表示中。`);
    return { status, body: null };
  }
  if (state.error) {
    status.classList.add('grs-status--error');
    status.append(`取得できませんでした: ${state.error.message} GitHub標準一覧を表示中。 `);
    status.append(actionButton('再取得', 'retry'));
    if (state.error.kind === 'auth' || state.error.kind === 'owner-mismatch') {
      status.append(' ', actionButton('公開一覧として取得', 'public-fallback'), ' ', actionButton('設定', 'open-options'));
    }
    return { status, body: null };
  }
  if (!state.data) return { status, body: null };

  const data = state.data;
  const view = buildView({
    repos: data.repos,
    sort: state.sort,
    scope: state.scope,
    query: state.query,
    page: state.page,
    type: state.type,
    language: state.language,
    visibility: state.visibility,
  });
  const scopeLabel = data.authMode === 'authenticated' ? `認証済み ${data.login ?? ''}（非公開含む）` : '公開のみ';
  const fetched = formatDateTime(data.fetchedAt);
  status.append(`${scopeLabel} / ${SORT_LABELS[state.sort]} / 取得${data.repos.length}件 / 表示${view.totalFiltered}件${data.partial ? ' / 一部のみ' : ''} / 取得 ${fetched}${data.fromCache ? '（キャッシュ）' : ''} `);
  status.append(actionButton('再取得', 'refresh'));
  if (data.error || data.partial) {
    status.classList.add('grs-status--warning');
    status.append(` 一部のみ表示: ${data.error?.message ?? '全件を取得できませんでした。'}`);
  }

  const body = h('div', { attrs: { 'data-grs-list': '', 'aria-label': 'Repo Sorter リポジトリ一覧' } });
  if (view.page.total === 0) {
    body.append(h('div', { className: 'blankslate grs-empty', text: '条件に一致するリポジトリがありません。' }));
  } else {
    body.append(h('ul', { className: 'grs-list' }, view.page.items.map((repo) => createRepoRow(repo, state.sort))));
    body.append(createPager(view));
  }
  body.append(createStandardHint());
  return { status, body };
}

/**
 * GitHub's own rows offer Star buttons, fork parents and contribution graphs.
 * Those need write access or per-repository requests, so the extension does not
 * fake them; it points at the standard listing instead.
 */
function createStandardHint(): HTMLElement {
  return h('p', { className: 'grs-hint color-fg-muted f6' }, [
    'Star ボタン・Fork 元リンク・コントリビューション グラフは GitHub 標準表示でのみ利用できます。',
    ' ',
    actionButton('標準表示に切り替え', 'standard'),
  ]);
}

function selectedDate(repo: Repo, mode: SortMode): { label: string; ms: number | null } {
  switch (mode) {
    case 'activity': {
      const activity = activityOf(repo);
      return { label: ACTIVITY_LABELS[activity.kind], ms: activity.ms };
    }
    case 'created': return { label: '作成', ms: parseTimestamp(repo.createdAt) };
    case 'forked': return { label: 'Fork', ms: forkTimestampOf(repo) };
    case 'pushed': return { label: 'Push', ms: parseTimestamp(repo.pushedAt) };
    case 'updated': return { label: '更新', ms: parseTimestamp(repo.updatedAt) };
  }
}

function languageDot(language: string): HTMLElement {
  const color = languageColor(language);
  const dot = h('span', {
    className: 'repo-language-color grs-language-dot',
    attrs: { 'aria-hidden': 'true' },
  });
  // GitHub uses an inline background colour for its own dots; mirror that.
  if (color) dot.style.backgroundColor = color;
  else dot.classList.add('grs-language-dot--unknown');
  return dot;
}

export function createRepoRow(repo: Repo, mode: SortMode): HTMLLIElement {
  const name = h('a', {
    className: 'grs-repo__name',
    text: repo.name,
    attrs: { href: repo.htmlUrl, itemprop: 'name codeRepository' },
  });
  const labels = h('span', { className: 'grs-repo__labels' }, [
    h('span', {
      className: 'Label Label--secondary v-align-middle ml-1',
      text: repo.visibility === 'private' ? 'Private' : 'Public',
    }),
    repo.archived ? h('span', { className: 'Label Label--secondary v-align-middle ml-1', text: 'Archived' }) : null,
    repo.template ? h('span', { className: 'Label Label--secondary v-align-middle ml-1', text: 'Template' }) : null,
    repo.mirror ? h('span', { className: 'Label Label--secondary v-align-middle ml-1', text: 'Mirror' }) : null,
  ]);
  const title = h('h3', { className: 'wb-break-all' }, [name, ' ', labels]);

  const metadata = h('div', { className: 'f6 color-fg-muted mt-2 grs-repo__meta' });
  if (repo.language) {
    metadata.append(h('span', { className: 'mr-3 grs-repo__language' }, [languageDot(repo.language), repo.language]));
  }
  if (repo.stars !== null) {
    metadata.append(h('a', {
      className: 'Link--muted mr-3 grs-repo__stars',
      text: `★ ${repo.stars.toLocaleString()}`,
      attrs: { href: `${repo.htmlUrl}/stargazers`, 'aria-label': `Stars: ${repo.stars}` },
    }));
  }
  if (repo.forks !== null) {
    metadata.append(h('a', {
      className: 'Link--muted mr-3 grs-repo__forks',
      text: `Forks ${repo.forks.toLocaleString()}`,
      attrs: { href: `${repo.htmlUrl}/forks` },
    }));
  }
  const date = selectedDate(repo, mode);
  metadata.append(date.ms === null
    ? h('span', { text: `${date.label}: 日時なし` })
    : h('time', { text: `${date.label}: ${formatDateTime(date.ms)}`, attrs: { datetime: new Date(date.ms).toISOString() } }));

  const main = h('div', { className: 'col-10 col-lg-9 d-inline-block' }, [
    title,
    repo.fork ? h('div', { className: 'f6 color-fg-muted', text: 'Fork' }) : null,
    repo.description ? h('p', { className: 'col-9 d-inline-block color-fg-muted mb-2 tmp-pr-4 grs-repo__desc', text: repo.description }) : null,
    metadata,
  ]);
  return h('li', {
    className: 'col-12 d-flex flex-justify-between width-full tmp-py-4 border-bottom color-border-muted grs-repo',
    attrs: { itemprop: 'owns' },
  }, [main]);
}

export function createPager(view: View): HTMLElement {
  const page = view.page;
  return h('nav', { className: 'grs-pager paginate-container', attrs: { 'aria-label': 'ページ送り' } }, [
    pageButton('前へ', 'prev', page.page <= 1),
    h('span', { className: 'grs-pager__status', text: `${page.start}–${page.end} / ${page.total}件（${page.page}/${page.totalPages}ページ）` }),
    pageButton('次へ', 'next', page.page >= page.totalPages),
  ]);
}
