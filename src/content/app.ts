import { CHANNEL, isProgressMessage, parseRepoListUrl } from '../shared/protocol';
import type { FetchData, FetchRequest, HandlerResponse, Request } from '../shared/protocol';
import { DEFAULT_SETTINGS, isSortMode, sanitizeSettings } from '../shared/settings';
import type { SorterSettings } from '../shared/settings';
import type { AuthMode, FetchErrorInfo, Scope, SortMode } from '../shared/types';
import { addSortItems, nativeTypeForScope, scopeFromNative } from './dom';
import { locateNativeList, removeStalePanels, setNativeHidden } from './native';
import type { NativeListRef } from './native';
import { renderListContent } from './render';

interface AppState {
  readonly owner: string;
  settings: SorterSettings;
  query: string;
  page: number;
  data: FetchData | null;
  loading: boolean;
  progress: { page: number; received: number } | null;
  error: FetchErrorInfo | null;
}

function hasUnsupportedFilters(native: NativeListRef): boolean {
  return [...native.form.querySelectorAll<HTMLInputElement>('input[name="language"]:checked, input[name="visibility"]:checked')]
    .some((input) => input.value !== '');
}

const SEARCH_DEBOUNCE_MS = 120;
const ROUTE_DEBOUNCE_MS = 120;

/** Integrates with the known GitHub profile form; fails open on unknown markup. */
export class SorterApp {
  private state: AppState | null = null;
  private native: NativeListRef | null = null;
  private mountElement: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private listenerAbort: AbortController | null = null;
  private requestId: string | null = null;
  private generation = 0;
  private settingsVersion = 0;
  private settingsWrites: Promise<void> = Promise.resolve();
  private routeTimer: number | null = null;
  private searchTimer: number | null = null;
  private started = false;
  private settingsLoaded = false;
  private runtimeListening = false;
  private readonly lifetime = new AbortController();
  private readonly runtimeListener = (message: unknown, sender: chrome.runtime.MessageSender): void => {
    if (sender.id !== chrome.runtime.id || !this.state) return;
    if (typeof message === 'object' && message !== null &&
      (message as { channel?: unknown }).channel === CHANNEL &&
      (message as { type?: unknown }).type === 'auth-changed') {
      this.cancelRequest();
      this.state.data = null;
      this.state.error = null;
      this.state.loading = false;
      this.render();
      if (this.isCustomActive()) void this.fetch({ force: true });
      return;
    }
    if (!isProgressMessage(message) || message.requestId !== this.requestId) return;
    this.state.progress = { page: message.page, received: message.received };
    this.render();
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    const boot = (): void => {
      chrome.runtime.onMessage.addListener(this.runtimeListener);
      this.runtimeListening = true;
      this.syncRoute();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true, signal: this.lifetime.signal });
    else boot();
    for (const event of ['turbo:load', 'turbo:render', 'turbo:frame-load']) {
      document.addEventListener(event, () => this.syncRoute(), { signal: this.lifetime.signal });
    }
    window.addEventListener('popstate', () => this.syncRoute(), { signal: this.lifetime.signal });
  }

  /** Disconnect all DOM listeners and observers, for extension reloads and tests. */
  stop(): void {
    this.lifetime.abort();
    if (this.runtimeListening) chrome.runtime.onMessage.removeListener(this.runtimeListener);
    this.runtimeListening = false;
    this.teardown();
  }

  private syncRoute(): void {
    const route = parseRepoListUrl(window.location.href);
    if (!route) {
      this.teardown();
      return;
    }
    if (!this.state || this.state.owner.toLowerCase() !== route.owner.toLowerCase()) {
      this.teardown();
      this.state = {
        owner: route.owner, settings: { ...DEFAULT_SETTINGS }, query: '', page: 1,
        data: null, loading: false, progress: null, error: null,
      };
      this.generation += 1;
      this.settingsLoaded = false;
      const generation = this.generation;
      this.installObserver();
      this.syncNative();
      void this.loadSettings(generation);
      return;
    }
    this.syncNative();
  }

  private installObserver(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => {
      // Ignore our own render updates; detect GitHub's replacement of the form/list.
      const external = records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest('[data-grs-mount], [data-grs-sort], [data-grs-menu]');
      });
      if (!external) return;
      if (this.routeTimer !== null) window.clearTimeout(this.routeTimer);
      this.routeTimer = window.setTimeout(() => {
        this.routeTimer = null;
        this.syncRoute();
      }, ROUTE_DEBOUNCE_MS);
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  private syncNative(): void {
    const state = this.state;
    if (!state) return;
    const found = locateNativeList(document);
    if (!found) {
      this.detachNative();
      return;
    }
    if (this.native?.form !== found.form || this.native.list !== found.list || this.native.sortList !== found.sortList || this.native.type !== found.type || this.native.search !== found.search || !this.mountElement?.isConnected) {
      const replacingExisting = this.native !== null;
      const formChanged = replacingExisting && this.native?.form !== found.form;
      this.detachNative();
      this.native = found;
      const mount = document.createElement('div');
      mount.dataset.grsMount = '';
      mount.dataset.grsOwner = state.owner;
      found.list.before(mount);
      this.mountElement = mount;
      addSortItems(found.sortList, state.settings.view === 'standard' ? null : state.settings.sort);
      this.bindNative(found, mount);
      if (formChanged) {
        const selectedType = found.type.querySelector<HTMLInputElement>('input[name="type"]:checked');
        const incomingScope = scopeFromNative(selectedType?.value ?? '');
        if (state.settings.view !== 'standard' && (incomingScope === null || hasUnsupportedFilters(found))) {
          state.settings = { ...state.settings, view: 'standard' };
          state.data = null;
          this.cancelRequest();
          state.loading = false;
        } else if (incomingScope !== null) {
          state.settings = { ...state.settings, scope: incomingScope };
        }
      }
      this.readNativeFilters(found);
      this.render();
    } else if (!found.sortList.querySelector('[data-grs-sort]')) {
      addSortItems(found.sortList, state.settings.view === 'standard' ? null : state.settings.sort);
      this.updateMenu();
    } else if (state.settings.view !== 'standard') {
      const checked = found.type.querySelector<HTMLInputElement>('input[name="type"]:checked');
      if (scopeFromNative(checked?.value ?? '') === null || hasUnsupportedFilters(found)) {
        this.selectStandard();
      }
    }
  }

  private bindNative(native: NativeListRef, mount: HTMLElement): void {
    const controller = new AbortController();
    this.listenerAbort = controller;
    const signal = controller.signal;
    native.form.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest<HTMLElement>('[data-grs-sort]');
      if (item && native.sort.contains(item)) {
        const value = item.dataset.grsSort;
        if (!isSortMode(value)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.selectSort(value);
        native.sort.open = false;
        native.sort.querySelector<HTMLElement>('summary')?.focus();
        return;
      }
      const label = target?.closest('label');
      const input = target instanceof HTMLInputElement ? target : label?.querySelector<HTMLInputElement>('input');
      if (!input || input.type !== 'radio') return;
      if (input.name === 'sort') {
        // Restore native content before GitHub handles its own sort selection.
        this.selectStandard();
      } else if (input.name === 'type' && this.isIntercepting()) {
        const scope = scopeFromNative(input.value);
        if (scope === null) {
          this.selectStandard();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        // Label activation may dispatch a second click directly at the input.
        // Prevent its default first, then synchronize after activation completes.
        queueMicrotask(() => { if (this.native === native && this.isIntercepting()) this.updateNativeType(native, scope); });
        this.setScope(scope);
        native.type.open = false;
      } else if (this.isIntercepting() && (input.name === 'language' || input.name === 'visibility')) {
        // Unsupported native filters are never silently ignored.
        this.selectStandard();
      }
    }, { capture: true, signal });
    native.sort.addEventListener('keydown', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.dataset.grsSort) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopImmediatePropagation();
        target.click();
      }
    }, { capture: true, signal });
    native.search.addEventListener('keydown', (event) => {
      if (this.isIntercepting() && event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal });
    native.search.addEventListener('search', (event) => {
      if (!this.isIntercepting()) return;
      event.stopImmediatePropagation();
      if (!this.state) return;
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.state.query = native.search.value;
      this.state.page = 1;
      this.render();
    }, { capture: true, signal });
    native.search.addEventListener('input', (event) => {
      if (!this.isIntercepting()) return;
      event.stopImmediatePropagation();
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = null;
        if (!this.state || this.native !== native) return;
        this.state.query = native.search.value;
        this.state.page = 1;
        this.render();
      }, SEARCH_DEBOUNCE_MS);
    }, { capture: true, signal });
    native.form.addEventListener('submit', (event) => {
      if (this.isIntercepting()) event.preventDefault();
    }, { capture: true, signal });
    mount.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-grs-action], [data-grs-page]') : null;
      if (!target) return;
      const action = target.dataset.grsAction;
      if (action === 'refresh' || action === 'retry') void this.fetch({ force: true });
      else if (action === 'public-fallback') void this.fetch({ force: true, authMode: 'public' });
      else if (action === 'open-options') void this.send({ channel: CHANNEL, type: 'open-options' });
      else if (target.dataset.grsPage && this.state) {
        this.state.page = Math.max(1, this.state.page + (target.dataset.grsPage === 'next' ? 1 : -1));
        this.render();
      }
    }, { signal });
  }

  private isCustomActive(): boolean {
    return this.state !== null && this.state.settings.view !== 'standard';
  }

  private isIntercepting(): boolean {
    return this.isCustomActive() && this.state?.data !== null && !this.state?.loading && !this.state?.error;
  }

  private readNativeFilters(native: NativeListRef): void {
    if (!this.state) return;
    this.state.query = native.search.value;
    const selected = native.type.querySelector<HTMLInputElement>('input[name="type"]:checked');
    if (selected && scopeFromNative(selected.value) === null) {
      this.state.settings = { ...this.state.settings, view: 'standard' };
    } else if (this.settingsLoaded && this.state.settings.view !== 'standard') {
      this.updateNativeType(native, this.state.settings.scope);
    }
    if (hasUnsupportedFilters(native)) this.state.settings = { ...this.state.settings, view: 'standard' };
  }

  private selectSort(sort: SortMode): void {
    const state = this.state;
    const native = this.native;
    if (!state || !native) return;
    const type = native.type.querySelector<HTMLInputElement>('input[name="type"]:checked');
    const scope = scopeFromNative(type?.value ?? '');
    if (scope === null || hasUnsupportedFilters(native)) {
      state.error = { kind: 'unknown', message: 'このType・Language・Visibilityは独自ソートで使えません。Allに戻してから選択してください。' };
      state.settings = { ...state.settings, view: 'standard', sort };
      this.cancelRequest();
      state.loading = false;
      state.data = null;
      this.render();
      return;
    }
    state.settings = { ...state.settings, sort, scope, view: 'sorter' };
    this.settingsLoaded = true;
    state.query = native.search.value;
    state.page = 1;
    state.error = null;
    this.clearNativeFilterParams();
    this.persistSettings();
    if (state.data) this.render();
    else void this.fetch();
  }

  /**
   * GitHub's own `sort`/`type`/`language`/`visibility` query parameters mean
   * "use the standard listing". Leaving them in the URL would force the
   * standard view on the next reload, so drop them when the extension takes over.
   */
  private clearNativeFilterParams(): void {
    const url = new URL(location.href);
    let changed = false;
    for (const name of ['sort', 'type', 'language', 'visibility']) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) history.replaceState(history.state, '', url.toString());
  }

  private selectStandard(): void {
    const state = this.state;
    if (!state) return;
    this.cancelRequest();
    state.settings = { ...state.settings, view: 'standard' };
    state.data = null;
    state.error = null;
    state.loading = false;
    this.persistSettings();
    this.render();
  }

  private setScope(scope: Scope): void {
    const state = this.state;
    const native = this.native;
    if (!state || !native) return;
    state.settings = { ...state.settings, scope };
    state.page = 1;
    this.updateNativeType(native, scope);
    this.persistSettings();
    this.render();
  }

  private updateNativeType(native: NativeListRef, scope: Scope): void {
    const value = nativeTypeForScope(scope);
    for (const input of native.type.querySelectorAll<HTMLInputElement>('input[name="type"]')) {
      const selected = input.value === value;
      input.checked = selected;
      input.closest('[role="menuitemradio"]')?.setAttribute('aria-checked', String(selected));
    }
    const selected = [...native.type.querySelectorAll<HTMLInputElement>('input[name="type"]')].find((input) => input.value === value);
    const label = selected?.closest('label')?.querySelector('[data-menu-button-text]')?.textContent?.trim();
    const display = native.type.querySelector<HTMLElement>('[data-menu-button]');
    if (display && label) display.textContent = label;
  }

  private async loadSettings(generation: number): Promise<void> {
    const state = this.state;
    if (!state) return;
    const version = this.settingsVersion;
    const response = await this.send({ channel: CHANNEL, type: 'settings-get', owner: state.owner });
    if (generation !== this.generation || !this.state || version !== this.settingsVersion) return;
    if (response?.ok && response.kind === 'settings') this.state.settings = sanitizeSettings(response.data);
    this.settingsLoaded = true;
    const url = new URL(location.href);
    const explicitNativeFilter = ['sort', 'type', 'language', 'visibility'].some((name) => Boolean(url.searchParams.get(name)));
    if (explicitNativeFilter) this.state.settings = { ...this.state.settings, view: 'standard' };
    if (this.native) {
      const checked = this.native.type.querySelector<HTMLInputElement>('input[name="type"]:checked');
      if (scopeFromNative(checked?.value ?? '') === null || hasUnsupportedFilters(this.native)) this.state.settings = { ...this.state.settings, view: 'standard' };
      if (this.state.settings.view !== 'standard') this.updateNativeType(this.native, this.state.settings.scope);
      this.state.query = this.native.search.value;
    }
    this.render();
    if (this.state.settings.view !== 'standard') void this.fetch();
  }

  private persistSettings(): void {
    const state = this.state;
    if (!state) return;
    this.settingsVersion += 1;
    const settings = { ...state.settings };
    const owner = state.owner;
    this.settingsWrites = this.settingsWrites.then(async () => {
      await this.send({ channel: CHANNEL, type: 'settings-set', owner, settings });
    });
  }

  private async fetch(options: { force?: boolean; authMode?: AuthMode } = {}): Promise<void> {
    const state = this.state;
    if (!state || state.settings.view === 'standard') return;
    this.cancelRequest();
    const requestId = crypto.randomUUID();
    this.requestId = requestId;
    const generation = this.generation;
    state.loading = true;
    state.error = null;
    state.progress = null;
    this.render();
    const request: FetchRequest = {
      channel: CHANNEL, type: 'fetch', requestId, owner: state.owner,
      force: options.force === true, ...(options.authMode ? { authMode: options.authMode } : {}),
    };
    const response = await this.send(request);
    if (generation !== this.generation || this.requestId !== requestId || !this.state || !this.isCustomActive()) return;
    this.requestId = null;
    this.state.loading = false;
    if (!response) this.state.error = { kind: 'unknown', message: '拡張機能から応答がありません。拡張機能を再読み込みしてください。' };
    else if (!response.ok) this.state.error = response.error;
    else if (response.kind === 'fetch') {
      this.state.data = response.data;
      this.state.page = 1;
    } else this.state.error = { kind: 'unknown', message: '予期しない応答を受け取りました。' };
    if (this.state.error) this.state.data = null;
    if (this.native && !this.state.error) {
      this.state.query = this.native.search.value;
      const type = this.native.type.querySelector<HTMLInputElement>('input[name="type"]:checked');
      const scope = scopeFromNative(type?.value ?? '');
      if (scope === null || hasUnsupportedFilters(this.native)) {
        this.selectStandard();
        return;
      }
      this.state.settings = { ...this.state.settings, scope };
    }
    this.render();
  }

  private cancelRequest(): void {
    if (this.requestId) void this.send({ channel: CHANNEL, type: 'cancel', requestId: this.requestId });
    this.requestId = null;
  }

  private updateMenu(): void {
    const state = this.state;
    const native = this.native;
    if (!state || !native) return;
    const custom = state.settings.view !== 'standard';
    for (const item of native.sortList.querySelectorAll<HTMLElement>('[data-grs-sort]')) {
      item.setAttribute('aria-checked', String(custom && item.dataset.grsSort === state.settings.sort));
    }
    for (const item of native.sortList.querySelectorAll<HTMLElement>('label[role="menuitemradio"]')) {
      const input = item.querySelector<HTMLInputElement>('input[name="sort"]');
      if (input) item.setAttribute('aria-checked', String(!custom && input.checked));
    }
    // GitHub keeps its own selected value hidden in the button; do not widen it.
    native.sort.dataset.grsCustomActive = String(custom);
  }

  private render(): void {
    const state = this.state;
    const native = this.native;
    const mount = this.mountElement;
    if (!state || !native || !mount) return;
    this.updateMenu();
    mount.dataset.grsView = state.settings.view;
    if (state.settings.view === 'standard' && !state.error && !state.loading) {
      mount.replaceChildren();
      setNativeHidden(native.list, false);
      return;
    }
    const content = renderListContent({
      sort: state.settings.sort, scope: state.settings.scope, query: state.query, page: state.page,
      data: state.data, loading: state.loading, progress: state.progress, error: state.error,
    });
    mount.replaceChildren(...(content.body ? [content.status, content.body] : [content.status]));
    setNativeHidden(native.list, content.body !== null);
  }

  private detachNative(): void {
    this.listenerAbort?.abort();
    this.listenerAbort = null;
    if (this.native) {
      setNativeHidden(this.native.list, false);
      this.native.sort.removeAttribute('data-grs-custom-active');
      for (const label of this.native.sortList.querySelectorAll<HTMLElement>('label[role="menuitemradio"]')) {
        const input = label.querySelector<HTMLInputElement>('input[name="sort"]');
        if (input) label.setAttribute('aria-checked', String(input.checked));
      }
      for (const item of this.native.sortList.querySelectorAll('[data-grs-sort], [data-grs-menu]')) item.remove();
    }
    this.mountElement?.remove();
    this.mountElement = null;
    this.native = null;
  }

  private teardown(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.cancelRequest();
    this.detachNative();
    this.state = null;
    this.generation += 1;
    if (this.routeTimer !== null) window.clearTimeout(this.routeTimer);
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.routeTimer = null;
    this.searchTimer = null;
    removeStalePanels(document);
  }

  private async send(request: Request): Promise<HandlerResponse | null> {
    try {
      const response: unknown = await chrome.runtime.sendMessage(request);
      return response === null || response === undefined ? null : response as HandlerResponse;
    } catch {
      return null;
    }
  }
}
