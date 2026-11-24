export const NATIVE_LIST_SELECTORS = ['#user-repositories-list', '#org-repositories'] as const;
export const NATIVE_HIDDEN_ATTR = 'data-grs-hidden';

export interface NativeListRef {
  readonly list: HTMLElement;
  /** Element the extension panel is inserted before. */
  readonly anchor: HTMLElement;
  /** Elements hidden (CSS only) while the extension list is displayed. */
  readonly hideTargets: readonly HTMLElement[];
}

/**
 * Locates GitHub's own repository list.
 *
 * - Personal profile: `#user-repositories-list`
 * - Organisation profile: `#org-repositories`
 * - Fallback: the list that owns repository rows (`[itemprop="owns"]`)
 *
 * The native DOM is never removed, only hidden with an attribute, so it can be
 * restored on demand or after a failure.
 */
export function locateNativeList(doc: Document = document): NativeListRef | null {
  let list: HTMLElement | null = null;
  for (const selector of NATIVE_LIST_SELECTORS) {
    list = doc.querySelector<HTMLElement>(selector);
    if (list) break;
  }
  if (!list) list = findListFromRows(doc);
  if (!list) return null;

  const filterBlock = findFilterBlock(list);
  const hideTargets = filterBlock ? [filterBlock, list] : [list];
  return { list, anchor: filterBlock ?? list, hideTargets };
}

function findListFromRows(doc: Document): HTMLElement | null {
  for (const row of doc.querySelectorAll('[itemprop="owns"]')) {
    const list = row.closest('ul');
    if (list) {
      const container = list.parentElement;
      return container instanceof HTMLElement ? container : list;
    }
  }
  return null;
}

/**
 * Finds the "Find a repository" form block that sits next to the list, so the
 * native search box is not shown alongside the extension's own search box.
 * Returns null when no clear sibling block can be identified.
 */
function findFilterBlock(list: HTMLElement): HTMLElement | null {
  const parent = list.parentElement;
  if (!parent) return null;

  const form = parent.querySelector<HTMLFormElement>('form[data-autosearch-results-container]');
  if (!form) return null;

  let block: HTMLElement = form;
  while (block.parentElement && block.parentElement !== parent) {
    block = block.parentElement;
  }
  if (block.parentElement !== parent) return null;
  if (block.contains(list)) return null;
  return block;
}

/** Hides or restores the native elements without detaching them. */
export function setNativeHidden(targets: readonly HTMLElement[], hidden: boolean): void {
  for (const target of targets) {
    if (hidden) target.setAttribute(NATIVE_HIDDEN_ATTR, 'true');
    else target.removeAttribute(NATIVE_HIDDEN_ATTR);
  }
}

/** Removes stale panels left behind by a previous document instance. */
export function removeStalePanels(doc: Document = document): void {
  for (const stale of doc.querySelectorAll<HTMLElement>('[data-grs-root]')) {
    stale.remove();
  }
}

export function applyPanelAttribute(root: HTMLElement, view: 'sorter' | 'standard'): void {
  root.dataset.grsView = view;
}

export function ensurePanelMounted(root: HTMLElement, native: NativeListRef | null, doc: Document = document): void {
  if (root.isConnected) return;
  if (native?.anchor.parentElement) {
    native.anchor.parentElement.insertBefore(root, native.anchor);
    return;
  }
  const main = doc.querySelector('main');
  if (main) main.prepend(root);
  else doc.body.prepend(root);
}
