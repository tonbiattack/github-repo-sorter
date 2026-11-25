import { t } from './i18n';
import type { MessageKey } from './i18n';
import type { ActivityKind, SortMode } from './types';

const SORT_KEYS: Record<SortMode, MessageKey> = {
  activity: 'sortActivity',
  created: 'sortCreated',
  forked: 'sortForked',
  pushed: 'sortPushed',
  updated: 'sortUpdated',
};

const SORT_HINT_KEYS: Record<SortMode, MessageKey> = {
  activity: 'sortActivityHint',
  created: 'sortCreatedHint',
  forked: 'sortForkedHint',
  pushed: 'sortPushedHint',
  updated: 'sortUpdatedHint',
};

const ACTIVITY_KEYS: Record<ActivityKind, MessageKey> = {
  push: 'kindPush',
  fork: 'kindFork',
  create: 'kindCreate',
  unknown: 'dateNone',
};

const DATE_LABEL_KEYS: Record<SortMode, MessageKey> = {
  activity: 'dateUpdated',
  created: 'dateCreated',
  forked: 'dateForked',
  pushed: 'datePushed',
  updated: 'dateUpdated',
};

export function sortLabel(sort: SortMode): string {
  return t(SORT_KEYS[sort]);
}

export function sortHint(sort: SortMode): string {
  return t(SORT_HINT_KEYS[sort]);
}

export function activityLabel(kind: ActivityKind): string {
  return t(ACTIVITY_KEYS[kind]);
}

/** Label for the timestamp a row shows under the given sort mode. */
export function dateLabel(sort: SortMode, kind: ActivityKind): string {
  if (sort === 'activity') return activityLabel(kind);
  return t(DATE_LABEL_KEYS[sort]);
}

export { formatDateTime, formatNumber, formatRelativeTime, formatTime } from './i18n';
