import { SCOPE_LABELS, SORT_HINTS, SORT_LABELS } from '../shared/labels';
import { SCOPES, SORT_MODES } from '../shared/types';

export type Child = Node | string | null | undefined | false;

export interface ElementProps {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

/** Small `document.createElement` wrapper; the only place elements are created. */
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
  appendChildren(element, children);
  return element;
}

export function appendChildren(parent: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
}

export interface ButtonOptions {
  readonly variant?: 'primary' | 'subtle';
  readonly disabled?: boolean;
}

/** Action button recognised by the panel's delegated click handler. */
export function actionButton(
  label: string,
  action: string,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const className =
    options.variant === 'primary'
      ? 'grs-button grs-button--primary'
      : options.variant === 'subtle'
        ? 'grs-button grs-button--subtle'
        : 'grs-button';
  const element = h('button', {
    className,
    text: label,
    attrs: { type: 'button', 'data-grs-action': action },
  });
  element.disabled = options.disabled === true;
  return element;
}

export function pageButton(label: string, page: 'prev' | 'next', disabled: boolean): HTMLButtonElement {
  const element = h('button', {
    className: 'grs-button',
    text: label,
    attrs: { type: 'button', 'data-grs-page': page },
  });
  element.disabled = disabled;
  return element;
}

export interface PanelRefs {
  readonly root: HTMLElement;
  readonly status: HTMLElement;
  readonly body: HTMLElement;
  readonly sortSelect: HTMLSelectElement;
  readonly scopeSelect: HTMLSelectElement;
  readonly searchInput: HTMLInputElement;
  readonly refreshButton: HTMLButtonElement;
  readonly modeButton: HTMLButtonElement;
  readonly authBadge: HTMLElement;
}

/**
 * Builds the persistent panel shell. Re-rendering only replaces the body and
 * status text, so the search input keeps focus and caret position while typing.
 */
export function createPanel(owner: string): PanelRefs {
  const authBadge = h('span', {
    className: 'grs-badge grs-badge--auth',
    text: '公開のみ',
  });

  const refreshButton = actionButton('再取得', 'refresh', { variant: 'primary' });
  const modeButton = actionButton('標準表示', 'standard', { variant: 'subtle' });

  const sortSelect = h('select', {
    className: 'grs-select',
    attrs: { 'data-grs-control': 'sort', 'aria-label': '並び替え' },
  });
  for (const mode of SORT_MODES) {
    sortSelect.append(
      h('option', { text: SORT_LABELS[mode], attrs: { value: mode, title: SORT_HINTS[mode] } }),
    );
  }

  const scopeSelect = h('select', {
    className: 'grs-select',
    attrs: { 'data-grs-control': 'scope', 'aria-label': '対象' },
  });
  for (const scope of SCOPES) {
    scopeSelect.append(h('option', { text: SCOPE_LABELS[scope], attrs: { value: scope } }));
  }

  const searchInput = h('input', {
    className: 'grs-input',
    attrs: {
      type: 'search',
      'data-grs-control': 'query',
      placeholder: '名前・説明で検索',
      'aria-label': '名前・説明で検索',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });

  const head = h('div', { className: 'grs-panel__head' }, [
    h('div', { className: 'grs-panel__title' }, [
      h('span', { className: 'grs-panel__logo', text: '⇅', attrs: { 'aria-hidden': 'true' } }),
      h('span', { className: 'grs-panel__name', text: 'Repo Sorter' }),
      h('span', { className: 'grs-panel__owner', text: `/${owner}` }),
      authBadge,
    ]),
    h('div', { className: 'grs-panel__actions' }, [refreshButton, modeButton]),
  ]);

  const controls = h('div', { className: 'grs-panel__controls' }, [
    h('label', { className: 'grs-field' }, [
      h('span', { className: 'grs-field__label', text: '並び替え' }),
      sortSelect,
    ]),
    h('label', { className: 'grs-field' }, [
      h('span', { className: 'grs-field__label', text: '対象' }),
      scopeSelect,
    ]),
    h('label', { className: 'grs-field grs-field--search' }, [
      h('span', { className: 'grs-field__label', text: '検索' }),
      searchInput,
    ]),
  ]);

  const status = h('div', {
    className: 'grs-status',
    attrs: { role: 'status', 'aria-live': 'polite', 'data-grs-status': '' },
  });

  const body = h('div', { className: 'grs-body', attrs: { 'data-grs-body': '' } });

  const root = h(
    'section',
    {
      className: 'grs-panel',
      attrs: {
        'data-grs-root': '',
        'data-grs-owner': owner,
        'aria-label': 'GitHub Repo Sorter',
      },
    },
    [head, controls, status, body],
  );

  return {
    root,
    status,
    body,
    sortSelect,
    scopeSelect,
    searchInput,
    refreshButton,
    modeButton,
    authBadge,
  };
}
