export const NATIVE_HIDDEN_ATTR = 'data-grs-hidden';

export interface NativeListRef {
  readonly list: HTMLElement;
  readonly form: HTMLFormElement;
  readonly search: HTMLInputElement;
  readonly sort: HTMLDetailsElement;
  readonly sortList: HTMLElement;
  readonly type: HTMLDetailsElement;
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
  return { list, form, search, sort, sortList, type };
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
