import { ACTIVITY_LABELS, formatDateTime } from '../shared/labels';
import { parseTimestamp } from '../shared/dates';
import { activityOf, forkTimestampOf } from '../shared/sort';
import type { View } from '../shared/view';
import { buildView } from '../shared/view';
import type { FetchData } from '../shared/protocol';
import type { ActivityKind, FetchErrorInfo, Repo, Scope, SortMode } from '../shared/types';
import { actionButton, h, pageButton } from './dom';
import type { Child } from './dom';

export interface UiState {
  readonly owner: string;
  readonly view: 'sorter' | 'standard';
  readonly sort: SortMode;
  readonly scope: Scope;
  readonly query: string;
  readonly page: number;
  readonly data: FetchData | null;
  readonly loading: boolean;
  readonly progress: { readonly page: number; readonly received: number } | null;
  readonly error: FetchErrorInfo | null;
}

export interface PanelContent {
  readonly statusText: string;
  readonly body: HTMLElement;
}

/**
 * Builds the status line and body for the current state.
 * Rendering uses textContent exclusively, so repository names and descriptions
 * from the API are never interpreted as HTML.
 */
export function renderPanelContent(state: UiState): PanelContent {
  if (state.view === 'standard') {
    return { statusText: '標準表示中です。GitHub 標準の一覧を表示しています。', body: standardState() };
  }
  if (state.error && !state.data) {
    return { statusText: '取得に失敗しました', body: errorState(state.error) };
  }
  if (!state.data) {
    return state.loading
      ? { statusText: loadingText(state.progress), body: loadingState(state.progress) }
      : { statusText: '', body: startingState() };
  }

  const data = state.data;
  const view = buildView({
    repos: data.repos,
    sort: state.sort,
    scope: state.scope,
    query: state.query,
    page: state.page,
  });

  return { statusText: statusText(state, data, view), body: dataBody(state, data, view) };
}

function loadingText(progress: UiState['progress']): string {
  if (!progress) return '取得中…';
  return `取得中… ${progress.received}件（${progress.page}ページ）`;
}

function statusText(state: UiState, data: FetchData, view: View): string {
  const parts: string[] = [];
  if (state.loading) parts.push('更新中…');
  parts.push(`全${data.repos.length}件`, `表示${view.totalFiltered}件`);
  if (data.fromCache) parts.push('キャッシュ');
  if (data.partial) parts.push('一部のみ');
  parts.push(`取得 ${formatDateTime(data.fetchedAt)}`);
  return parts.join(' / ');
}

function dataBody(state: UiState, data: FetchData, view: View): HTMLElement {
  const container = h('div', { className: 'grs-body__inner' });

  if (view.totalFiltered === 0) {
    container.append(emptyState(state, data));
    return container;
  }

  if (data.error) container.append(partialBanner(data.error));

  const list = h('ul', { className: 'grs-list' }, view.page.items.map((repo) => createRepoRow(repo, state.sort)));
  list.setAttribute('aria-label', 'リポジトリ一覧');
  container.append(list);
  container.append(createPager(view));
  return container;
}

function startingState(): HTMLElement {
  return h('div', { className: 'grs-state' }, [
    h('p', { className: 'grs-state__detail', text: 'まもなく取得を開始します。' }),
  ]);
}

function loadingState(progress: UiState['progress']): HTMLElement {
  return h('div', { className: 'grs-state' }, [
    h('div', { className: 'grs-spinner', attrs: { 'aria-hidden': 'true' } }),
    h('p', { className: 'grs-state__title', text: 'リポジトリを取得しています…' }),
    progress
      ? h('p', {
          className: 'grs-state__detail',
          text: `${progress.page}ページ目まで受信、${progress.received}件`,
        })
      : null,
  ]);
}

function emptyState(state: UiState, data: FetchData): HTMLElement {
  const filtered = state.query.trim() !== '' || state.scope !== 'all';
  if (filtered) {
    return h('div', { className: 'grs-state' }, [
      h('p', { className: 'grs-state__title', text: '条件に一致するリポジトリがありません' }),
      h('p', {
        className: 'grs-state__detail',
        text: '検索語や「対象」の絞り込みを変えてください。',
      }),
      h('div', { className: 'grs-state__actions' }, [actionButton('条件をクリア', 'clear')]),
    ]);
  }

  const detail =
    data.authMode === 'authenticated'
      ? 'このアカウントで取得できるリポジトリがありません。'
      : 'このアカウントの公開リポジトリが見つかりませんでした。';

  return h('div', { className: 'grs-state' }, [
    h('p', { className: 'grs-state__title', text: 'リポジトリがありません' }),
    h('p', { className: 'grs-state__detail', text: detail }),
    h('div', { className: 'grs-state__actions' }, [actionButton('再取得', 'retry')]),
  ]);
}

function errorState(error: FetchErrorInfo): HTMLElement {
  const actions: Child[] = [actionButton('再取得', 'retry', { variant: 'primary' })];
  if (error.kind === 'auth' || error.kind === 'owner-mismatch') {
    actions.push(actionButton('公開一覧として取得', 'public-fallback'));
    actions.push(actionButton('設定を開く', 'open-options'));
  }
  actions.push(actionButton('標準表示に戻す', 'standard', { variant: 'subtle' }));

  return h('div', { className: 'grs-state grs-state--error', attrs: { role: 'alert' } }, [
    h('p', { className: 'grs-state__title', text: 'リポジトリ一覧を取得できませんでした' }),
    h('p', { className: 'grs-state__detail', text: error.message }),
    h('div', { className: 'grs-state__actions' }, actions),
  ]);
}

function partialBanner(error: FetchErrorInfo): HTMLElement {
  return h('div', { className: 'grs-banner grs-banner--warning', attrs: { role: 'status' } }, [
    h('span', { className: 'grs-banner__text', text: `一部のデータのみ取得しました: ${error.message}` }),
    actionButton('再取得', 'retry'),
  ]);
}

function standardState(): HTMLElement {
  return h('div', { className: 'grs-state' }, [
    h('p', { className: 'grs-state__title', text: 'GitHub 標準の一覧を表示しています' }),
    h('p', {
      className: 'grs-state__detail',
      text: '拡張の並び替えを使うには、下のボタンで戻してください。',
    }),
    h('div', { className: 'grs-state__actions' }, [
      actionButton('拡張ソートに戻す', 'sorter', { variant: 'primary' }),
    ]),
  ]);
}

interface PrimaryTimestamp {
  readonly label: string;
  readonly ms: number | null;
  readonly kind: ActivityKind | null;
}

function primaryTimestamp(repo: Repo, mode: SortMode): PrimaryTimestamp {
  switch (mode) {
    case 'activity': {
      const activity = activityOf(repo);
      return { label: '最終活動', ms: activity.ms, kind: activity.kind };
    }
    case 'created':
      return { label: '作成', ms: parseTimestamp(repo.createdAt), kind: null };
    case 'forked':
      return { label: 'Fork', ms: forkTimestampOf(repo), kind: null };
    case 'pushed':
      return { label: 'Push', ms: parseTimestamp(repo.pushedAt), kind: null };
    case 'updated':
      return { label: '更新', ms: parseTimestamp(repo.updatedAt), kind: null };
    default:
      return { label: '日時', ms: null, kind: null };
  }
}

export function createRepoRow(repo: Repo, mode: SortMode): HTMLLIElement {
  const badges = h('span', { className: 'grs-badges' }, [
    repo.visibility === 'private'
      ? h('span', { className: 'grs-badge grs-badge--private', text: 'Private' })
      : h('span', { className: 'grs-badge', text: 'Public' }),
    repo.fork ? h('span', { className: 'grs-badge grs-badge--fork', text: 'Fork' }) : null,
  ]);

  const head = h('div', { className: 'grs-repo__head' }, [
    h('a', {
      className: 'grs-repo__name',
      text: repo.name,
      attrs: { href: repo.htmlUrl, title: repo.fullName },
    }),
    badges,
  ]);

  const primary = primaryTimestamp(repo, mode);
  const date =
    primary.ms === null
      ? h('span', { className: 'grs-repo__date', text: `${primary.label}: 日時なし` })
      : h('time', {
          className: 'grs-repo__date',
          text: `${primary.label}: ${formatDateTime(primary.ms)}`,
          attrs: { datetime: new Date(primary.ms).toISOString() },
        });

  const meta = h('div', { className: 'grs-repo__meta' }, [
    h('span', { className: 'grs-repo__fullname', text: repo.fullName }),
    h('span', { className: 'grs-repo__activity' }, [
      date,
      primary.kind && primary.ms !== null
        ? h('span', { className: `grs-kind grs-kind--${primary.kind}`, text: ACTIVITY_LABELS[primary.kind] })
        : null,
    ]),
  ]);

  return h('li', { className: 'grs-repo' }, [
    h('div', { className: 'grs-repo__main' }, [
      head,
      repo.description ? h('p', { className: 'grs-repo__desc', text: repo.description }) : null,
    ]),
    meta,
  ]);
}

export function createPager(view: View): HTMLElement {
  const page = view.page;
  return h('nav', { className: 'grs-pager', attrs: { 'aria-label': 'ページ送り' } }, [
    pageButton('前へ', 'prev', page.page <= 1),
    h('span', {
      className: 'grs-pager__status',
      text: `${page.start}–${page.end} / ${page.total}件（${page.page}/${page.totalPages}ページ）`,
    }),
    pageButton('次へ', 'next', page.page >= page.totalPages),
  ]);
}
