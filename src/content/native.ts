export const NATIVE_HIDDEN_ATTR = 'data-grs-hidden';

export interface NativeListRef {
  readonly list: HTMLElement;
  readonly form: HTMLFormElement;
  readonly search: HTMLInputElement;
  readonly sort: HTMLDetailsElement;
  readonly sortList: HTMLElement;
  readonly type: HTMLDetailsElement;
  /** Present on personal profiles; organisation pages omit it. */
  readonly language: HTMLDetailsElement | null;
  /** Present only when the signed-in viewer can see private repositories. */
  readonly visibility: HTMLDetailsElement | null;
}

/**
 * Integrate only when the complete, known GitHub user-profile structure is
 * present. On changed/organisation markup, leave GitHub untouched rather than
 * guessing at a container and hiding unrelated content.
 */
export function locateNativeList(doc: Document = document): NativeListRef | null {
  const list = doc.querySelector<HTMLElement>('#user-repositories-list');
  const form = doc.querySelector<HTMLFormElement>('form[data-autosearch-results-container="user-repositories-list"]');
  const search = form?.querySelector<HTMLInputElement>('input[type="search"][name="q"]');
  const sort = form?.querySelector<HTMLDetailsElement>('details#sort-options');
  const sortList = sort?.querySelector<HTMLElement>('.SelectMenu-list');
  const type = form?.querySelector<HTMLDetailsElement>('details#type-options');
  if (!list || !form || !search || !sort || !sortList || !type || !list.parentElement || !form.isConnected || !list.isConnected) return null;
  if (!sort.querySelector('summary') || !sortList.querySelector('input[name="sort"]') || !type.querySelector('input[name="type"]')) return null;

  const language = form.querySelector<HTMLDetailsElement>('details#language-options');
  const visibility = form.querySelector<HTMLDetailsElement>('details#visibility-options');
  return {
    list,
    form,
    search,
    sort,
    sortList,
    type,
    language: language?.querySelector('input[name="language"]') ? language : null,
    visibility: visibility?.querySelector('input[name="visibility"]') ? visibility : null,
  };
}

/** GitHub's own list, including its pager, stays attached and is only hidden. */
export function setNativeHidden(list: HTMLElement, hidden: boolean): void {
  if (hidden) list.setAttribute(NATIVE_HIDDEN_ATTR, 'true');
  else list.removeAttribute(NATIVE_HIDDEN_ATTR);
}

export function removeStalePanels(doc: Document = document): void {
  for (const stale of doc.querySelectorAll<HTMLElement>('[data-grs-mount], [data-grs-menu], [data-grs-sort], [data-grs-root]')) {
    stale.remove();
  }
  for (const list of doc.querySelectorAll<HTMLElement>(`[${NATIVE_HIDDEN_ATTR}]`)) {
    list.removeAttribute(NATIVE_HIDDEN_ATTR);
  }
}

/** Reads the checked radio value of a GitHub filter menu, or `all` when absent. */
export function checkedValue(menu: HTMLDetailsElement | null, name: string): string {
  const input = menu?.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return input?.value ?? 'all';
}

/** Selects a radio value inside a GitHub filter menu and syncs its label. */
export function selectValue(menu: HTMLDetailsElement | null, name: string, value: string): void {
  if (!menu) return;
  const inputs = [...menu.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
  const target = inputs.find((input) => input.value === value) ?? inputs.find((input) => input.value === '');
  if (!target) return;
  for (const input of inputs) {
    const selected = input === target;
    input.checked = selected;
    input.closest('[role="menuitemradio"]')?.setAttribute('aria-checked', String(selected));
  }
  const label = target.closest('label')?.querySelector('[data-menu-button-text]')?.textContent?.trim();
  const display = menu.querySelector<HTMLElement>('[data-menu-button]');
  if (display && label) display.textContent = label;
}
