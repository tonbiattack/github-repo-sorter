import { SORT_LABELS } from '../shared/labels';
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
  const separator = h('div', { className: 'grs-menu-heading', text: 'Repo Sorter' });
  separator.dataset.grsMenu = '';
  list.append(separator);
  for (const sort of SORT_MODES) {
    const button = h('button', {
      className: 'SelectMenu-item grs-menu-item',
      attrs: {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(sort === selected),
        tabindex: '0',
        'data-grs-sort': sort,
      },
    }, [
      h('span', { className: 'grs-menu-check', text: '✓', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: SORT_LABELS[sort] }),
    ]);
    list.append(button);
  }
}

/** Returns null if GitHub's current Type value is not supported by the extension. */
export function scopeFromNative(value: string): Scope | null {
  if (value === '') return 'all';
  if (value === 'fork') return 'forks';
  if (value === 'source') return 'non-forks';
  return null;
}

export function nativeTypeForScope(scope: Scope): string {
  if (scope === 'forks') return 'fork';
  if (scope === 'non-forks') return 'source';
  return '';
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

/** Compact label shown on the Sort button while a custom order is active. */
export function sortButtonLabel(sort: SortMode): string {
  return SORT_LABELS[sort];
}
