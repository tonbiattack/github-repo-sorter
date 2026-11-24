import type { ActivityKind, Scope, SortMode } from './types';

export const SORT_LABELS: Record<SortMode, string> = {
  activity: '作成・Fork・Push順',
  created: '作成順',
  forked: 'Fork順',
  pushed: 'Push順',
  updated: '情報更新順',
};

export const SORT_HINTS: Record<SortMode, string> = {
  activity: '作成日時とPush日時のうち新しい方で並べます',
  created: 'リポジトリの作成日時で並べます',
  forked: 'Forkした日時で並べます（Fork以外は末尾）',
  pushed: '最後にPushされた日時で並べます',
  updated: '説明の変更などを含む更新日時で並べます',
};

export const SCOPE_LABELS: Record<Scope, string> = {
  all: '全件',
  forks: 'Forkのみ',
  'non-forks': '非Forkのみ',
};

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  push: 'Push',
  fork: 'Fork',
  create: '作成',
  unknown: '日時なし',
};

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
});

/** Formats epoch milliseconds in the browser's local timezone. */
export function formatDateTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '日時なし';
  return dateFormatter.format(new Date(ms));
}

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  return timeFormatter.format(new Date(ms));
}

/** Relative label such as "3分前" for the last-fetch line. */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - fromMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}
