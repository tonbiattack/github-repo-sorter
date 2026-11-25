import { sortHint, sortLabel } from '../shared/labels';
import { t } from '../shared/i18n';
import { SORT_MODES } from '../shared/types';
import type { Scope, SortMode, TypeFilter } from '../shared/types';

export type Child = Node | string | null | undefined | false;

export interface ElementProps {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

/** Create DOM using textContent; API values must never be interpreted as markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
  return element;
}

export function actionButton(label: string, action: string): HTMLButtonElement {
  return h('button', {
    className: 'btn-link grs-action',
    text: label,
    attrs: { type: 'button', 'data-grs-action': action },
  });
}

export function pageButton(label: string, page: 'prev' | 'next', disabled: boolean): HTMLButtonElement {
  const button = h('button', {
    className: 'btn btn-sm',
    text: label,
    attrs: { type: 'button', 'data-grs-page': page },
  });
  button.disabled = disabled;
  return button;
}

/** Append buttons, not radio inputs/labels: GitHub's autosubmit must not see them. */
export function addSortItems(list: HTMLElement, selected: SortMode | null): void {
  if (list.querySelector('[data-grs-sort]')) return;
  const separator = h('div', { className: 'grs-menu-heading', text: t('menuHeading') });
  separator.dataset.grsMenu = '';
  list.append(separator);
  for (const sort of SORT_MODES) {
    const button = h('button', {
      className: 'SelectMenu-item grs-menu-item',
      attrs: {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(sort === selected),
        title: sortHint(sort),
        tabindex: '0',
        'data-grs-sort': sort,
      },
    }, [
      h('span', { className: 'grs-menu-check', text: '✓', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: sortLabel(sort) }),
    ]);
    list.append(button);
  }
}

/**
 * Maps GitHub's Type radio value to the extension's Type filter.
 * Returns null for values the extension cannot honour from API data.
 */
export function typeFilterFromNative(value: string): TypeFilter | null {
  switch (value) {
    case '':
      return 'all';
    case 'fork':
      return 'forks';
    case 'source':
      return 'non-forks';
    case 'archived':
      return 'archived';
    case 'mirror':
      return 'mirror';
    case 'template':
      return 'template';
    default:
      return null;
  }
}

export function nativeTypeForFilter(type: TypeFilter): string {
  switch (type) {
    case 'forks':
      return 'fork';
    case 'non-forks':
      return 'source';
    case 'archived':
      return 'archived';
    case 'mirror':
      return 'mirror';
    case 'template':
      return 'template';
    default:
      return '';
  }
}

/** Short label shown on the Sort button while a custom order is active. */
export function sortButtonLabel(sort: SortMode): string {
  return sortLabel(sort);
}

/**
 * Scope is kept for settings compatibility; it is derived from the Type filter
 * so the two can never disagree.
 */
export function scopeForType(type: TypeFilter): Scope {
  if (type === 'forks') return 'forks';
  if (type === 'non-forks') return 'non-forks';
  return 'all';
}
