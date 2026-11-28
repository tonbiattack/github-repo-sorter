import { t } from '../shared/i18n';
import { CHANNEL, isProgressMessage, parseRepoListUrl } from '../shared/protocol';
import type { FetchData, FetchRequest, HandlerResponse, Request } from '../shared/protocol';
import { DEFAULT_SETTINGS, isSortMode, sanitizeSettings } from '../shared/settings';
import type { SorterSettings } from '../shared/settings';
import type { AuthMode, FetchErrorInfo, SortMode, TypeFilter, VisibilityFilter } from '../shared/types';
import {
  addSortItems,
  nativeTypeForFilter,
  sortButtonLabel,
  typeFilterFromNative,
} from './dom';
import { checkedValue, locateNativeList, removeStalePanels, selectValue, setNativeHidden } from './native';
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
    const changed =
      this.native?.form !== found.form ||
      this.native.list !== found.list ||
      this.native.sortList !== found.sortList ||
      this.native.type !== found.type ||
      this.native.search !== found.search ||
      this.native.language !== found.language ||
      this.native.visibility !== found.visibility ||
      !this.mountElement?.isConnected;

    if (changed) {
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
      if (formChanged) this.adoptNativeFilters(found);
      this.readNativeFilters(found);
      this.render();
      return;
    }

    if (!found.sortList.querySelector('[data-grs-sort]')) {
      addSortItems(found.sortList, state.settings.view === 'standard' ? null : state.settings.sort);
      this.updateMenu();
    }
    if (state.settings.view !== 'standard' && this.hasUnsupportedNativeFilter(found)) {
      this.selectStandard();
    }
  }

  /** After GitHub replaces its form, adopt whatever filters it now shows. */
  private adoptNativeFilters(native: NativeListRef): void {
    const state = this.state;
    if (!state) return;
    const type = typeFilterFromNative(checkedValue(native.type, 'type'));
    if (state.settings.view !== 'standard' && type === null) {
      state.settings = { ...state.settings, view: 'standard' };
      state.data = null;
      this.cancelRequest();
      state.loading = false;
      return;
    }
    if (type !== null) state.settings = { ...state.settings, type };
  }

  /**
   * True when GitHub shows a filter the extension cannot reproduce from API
   * data. The caller must fall back to the standard listing rather than
   * silently ignoring the user's choice.
   */
  private hasUnsupportedNativeFilter(native: NativeListRef): boolean {
    return typeFilterFromNative(checkedValue(native.type, 'type')) === null;
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
        return;
      }
      if (!this.isIntercepting()) return;

      if (input.name === 'type') {
        const type = typeFilterFromNative(input.value);
        if (type === null) {
          this.selectStandard();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        queueMicrotask(() => {
          if (this.native === native && this.isIntercepting()) this.syncNativeFilterMenus(native);
        });
        this.setType(type);
        native.type.open = false;
        return;
      }
      if (input.name === 'language' && native.language) {
        event.preventDefault();
        event.stopImmediatePropagation();
        queueMicrotask(() => {
          if (this.native === native && this.isIntercepting()) this.syncNativeFilterMenus(native);
        });
        this.setLanguage(input.value === '' ? 'all' : input.value);
        native.language.open = false;
        return;
      }
      if (input.name === 'visibility' && native.visibility) {
        event.preventDefault();
        event.stopImmediatePropagation();
        queueMicrotask(() => {
          if (this.native === native && this.isIntercepting()) this.syncNativeFilterMenus(native);
        });
        this.setVisibility(input.value === '' ? 'all' : (input.value as VisibilityFilter));
        native.visibility.open = false;
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
      else if (action === 'standard') this.selectStandard();
      else if (target.dataset.grsPage && this.state) {
        this.state.page = Math.max(1, this.state.page + (target.dataset.grsPage === 'next' ? 1 : -1));
        this.render();
      }
    }, { signal });
  }

  private isCustomActive(): boolean {
    return this.state !== null && this.state.settings.view !== 'standard';
  }

  /** True while the tab still shows `owner`'s repository list. */
  private matchesRoute(owner: string): boolean {
    const route = parseRepoListUrl(window.location.href);
    return route !== null && route.owner.toLowerCase() === owner.toLowerCase();
  }

  private isIntercepting(): boolean {
    return this.isCustomActive() && this.state?.data !== null && !this.state?.loading && !this.state?.error;
  }

  private readNativeFilters(native: NativeListRef): void {
    const state = this.state;
    if (!state) return;
    state.query = native.search.value;
    const type = typeFilterFromNative(checkedValue(native.type, 'type'));
    if (type === null) {
      state.settings = { ...state.settings, view: 'standard' };
      return;
    }
    if (this.settingsLoaded && state.settings.view !== 'standard') this.syncNativeFilterMenus(native);
  }

  /** Mirrors the extension's filters back into GitHub's own menus. */
  private syncNativeFilterMenus(native: NativeListRef): void {
    const settings = this.state?.settings;
    if (!settings) return;
    selectValue(native.type, 'type', nativeTypeForFilter(settings.type));
    if (native.language) selectValue(native.language, 'language', settings.language === 'all' ? '' : settings.language);
    if (native.visibility) selectValue(native.visibility, 'visibility', settings.visibility === 'all' ? '' : settings.visibility);
  }

  private selectSort(sort: SortMode): void {
    const state = this.state;
    const native = this.native;
    if (!state || !native) return;
    const type = typeFilterFromNative(checkedValue(native.type, 'type'));
    if (type === null) {
      state.error = { kind: 'unknown', message: t('errUnsupportedType') };
      state.settings = { ...state.settings, view: 'standard', sort };
      this.cancelRequest();
      state.loading = false;
      state.data = null;
      this.render();
      return;
    }
    state.settings = { ...state.settings, sort, type, view: 'sorter' };
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

  private setType(type: TypeFilter): void {
    this.applyFilter({ type });
  }

  private setLanguage(language: string): void {
    this.applyFilter({ language });
  }

  private setVisibility(visibility: VisibilityFilter): void {
    this.applyFilter({ visibility });
  }

  private applyFilter(partial: Partial<Pick<SorterSettings, 'type' | 'language' | 'visibility'>>): void {
    const state = this.state;
    const native = this.native;
    if (!state || !native) return;
    state.settings = sanitizeSettings({ ...state.settings, ...partial });
    state.page = 1;
    this.syncNativeFilterMenus(native);
    this.persistSettings();
    this.render();
  }

  private async loadSettings(generation: number): Promise<void> {
    const state = this.state;
    if (!state) return;
    const version = this.settingsVersion;
    const response = await this.send({
      channel: CHANNEL, type: 'settings-get', owner: state.owner, pageUrl: window.location.href,
    });
    if (generation !== this.generation || !this.state || version !== this.settingsVersion) return;
    if (response?.ok && response.kind === 'settings') this.state.settings = sanitizeSettings(response.data);
    this.settingsLoaded = true;
    const url = new URL(location.href);
    const explicitNativeFilter = ['sort', 'type', 'language', 'visibility'].some((name) => Boolean(url.searchParams.get(name)));
    if (explicitNativeFilter) this.state.settings = { ...this.state.settings, view: 'standard' };
    if (this.native) {
      if (this.hasUnsupportedNativeFilter(this.native)) {
        this.state.settings = { ...this.state.settings, view: 'standard' };
      } else if (this.state.settings.view !== 'standard') {
        this.syncNativeFilterMenus(this.native);
      }
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
    // The URL is captured with the write: the queued message still describes
    // this page even if the tab navigates before it is sent.
    const pageUrl = window.location.href;
    this.settingsWrites = this.settingsWrites.then(async () => {
      await this.send({ channel: CHANNEL, type: 'settings-set', owner, settings, pageUrl });
    });
  }

  private async fetch(options: { force?: boolean; authMode?: AuthMode } = {}): Promise<void> {
    const state = this.state;
    if (!state || state.settings.view === 'standard') return;
    // A queued fetch can outlive a Turbo navigation; never request data for a
    // page the tab no longer shows.
    if (!this.matchesRoute(state.owner)) return;
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
      force: options.force === true, pageUrl: window.location.href,
      ...(options.authMode ? { authMode: options.authMode } : {}),
    };
    const response = await this.send(request);
    if (generation !== this.generation || this.requestId !== requestId || !this.state || !this.isCustomActive()) return;
    this.requestId = null;
    this.state.loading = false;
    if (!response) this.state.error = { kind: 'unknown', message: t('errNoResponse') };
    else if (!response.ok) this.state.error = response.error;
    else if (response.kind === 'fetch') {
      this.state.data = response.data;
      this.state.page = 1;
    } else this.state.error = { kind: 'unknown', message: t('errUnexpectedResponse') };
    if (this.state.error) this.state.data = null;
    if (this.native && !this.state.error) {
      this.state.query = this.native.search.value;
      const type = typeFilterFromNative(checkedValue(this.native.type, 'type'));
      if (type === null) {
        this.selectStandard();
        return;
      }
      this.state.settings = { ...this.state.settings, type };
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
    native.sort.dataset.grsCustomActive = String(custom);
    this.updateSortButton(native, custom);
  }

  /**
   * GitHub hides its own selected value in the Sort button. While a custom
   * order is active, show it compactly there so the control reflects reality;
   * restore GitHub's own markup when the standard listing returns.
   */
  private updateSortButton(native: NativeListRef, custom: boolean): void {
    const state = this.state;
    if (!state) return;
    const summary = native.sort.querySelector<HTMLElement>('summary');
    if (!summary) return;

    let badge = summary.querySelector<HTMLElement>('[data-grs-sort-label]');
    if (!custom) {
      badge?.remove();
      summary.removeAttribute('data-grs-sort-active');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.grsSortLabel = '';
      badge.className = 'grs-sort-label';
      summary.append(badge);
    }
    const label = sortButtonLabel(state.settings.sort);
    if (badge.textContent !== label) badge.textContent = label;
    summary.setAttribute('data-grs-sort-active', 'true');
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
      sort: state.settings.sort,
      scope: state.settings.scope,
      query: state.query,
      page: state.page,
      data: state.data,
      loading: state.loading,
      progress: state.progress,
      error: state.error,
      type: state.settings.type,
      language: state.settings.language,
      visibility: state.settings.visibility,
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
      this.native.sort.querySelector('summary')?.removeAttribute('data-grs-sort-active');
      this.native.sort.querySelector('[data-grs-sort-label]')?.remove();
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
