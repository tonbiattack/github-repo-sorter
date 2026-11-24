import { CHANNEL, isProgressMessage, parseRepoListUrl } from '../shared/protocol';
import type {
  FetchData,
  FetchRequest,
  HandlerResponse,
  Request,
  SettingsGetRequest,
  SettingsSetRequest,
} from '../shared/protocol';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../shared/settings';
import type { SorterSettings } from '../shared/settings';
import type { AuthMode, FetchErrorInfo, Scope, SortMode } from '../shared/types';
import { buildView } from '../shared/view';
import { createPanel } from './dom';
import type { PanelRefs } from './dom';
import { ensurePanelMounted, locateNativeList, removeStalePanels, setNativeHidden } from './native';
import type { NativeListRef } from './native';
import { renderPanelContent } from './render';
import type { UiState } from './render';

interface AppState {
  readonly owner: string;
  view: 'sorter' | 'standard';
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

/**
 * Owns the injected panel for one document.
 *
 * The app is idempotent: it reacts to Turbo navigations by tearing down and
 * remounting, and discards results from older generations (`generation`).
 */
export class SorterApp {
  private state: AppState | null = null;
  private refs: PanelRefs | null = null;
  private native: NativeListRef | null = null;
  private generation = 0;
  private requestId: string | null = null;
  private observer: MutationObserver | null = null;
  private mountedAsFallback = false;
  private routeTimer: number | null = null;
  private searchTimer: number | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    const boot = (): void => {
      this.installRuntimeListener();
      this.syncRoute();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }

    // GitHub uses Turbo for navigation; these events fire without a full load.
    document.addEventListener('turbo:load', () => this.syncRoute());
    document.addEventListener('turbo:render', () => this.syncRoute());
    document.addEventListener('turbo:frame-load', () => this.syncRoute());
    window.addEventListener('popstate', () => this.syncRoute());
  }

  private installObserver(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => this.scheduleRouteSync());
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  private installRuntimeListener(): void {
    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (!isProgressMessage(message)) return;
      if (!this.state || message.requestId !== this.requestId) return;
      this.state.progress = { page: message.page, received: message.received };
      this.render();
    });
  }

  private scheduleRouteSync(): void {
    if (this.routeTimer !== null) window.clearTimeout(this.routeTimer);
    this.routeTimer = window.setTimeout(() => {
      this.routeTimer = null;
      this.syncRoute();
    }, ROUTE_DEBOUNCE_MS);
  }

  private syncRoute(): void {
    const route = parseRepoListUrl(window.location.href);
    if (!route) {
      this.teardown();
      return;
    }

    const sameOwner =
      this.state !== null && this.state.owner.toLowerCase() === route.owner.toLowerCase();

    if (sameOwner) {
      // Turbo may have replaced the native list while keeping the URL.
      if (!this.native || !this.native.list.isConnected) {
        this.native = locateNativeList(document);
      }
      if (this.native && this.refs && this.mountedAsFallback && this.refs.root.isConnected) {
        const parent = this.native.anchor.parentElement;
        if (parent) {
          parent.insertBefore(this.refs.root, this.native.anchor);
          this.mountedAsFallback = false;
        }
      }
      if (this.refs && !this.refs.root.isConnected) {
        ensurePanelMounted(this.refs.root, this.native);
        this.mountedAsFallback = this.native === null;
      }
      this.updateNativeVisibility();
      return;
    }

    this.mount(route.owner);
  }

  private mount(owner: string): void {
    this.teardown();

    const generation = ++this.generation;
    this.state = {
      owner,
      view: 'sorter',
      settings: { ...DEFAULT_SETTINGS },
      query: '',
      page: 1,
      data: null,
      loading: false,
      progress: null,
      error: null,
    };

    const native = locateNativeList(document);
    const panel = createPanel(owner);
    this.native = native;
    this.refs = panel;
    this.mountedAsFallback = native === null;
    ensurePanelMounted(panel.root, native);
    this.installObserver();
    this.bindEvents(panel);
    this.render();

    void this.loadSettings(generation);
    void this.fetch(generation);
  }

  private bindEvents(panel: PanelRefs): void {
    panel.root.addEventListener('click', (event) => this.handleClick(event));

    panel.sortSelect.addEventListener('change', () => {
      this.updateSettings({ sort: panel.sortSelect.value as SortMode });
    });

    panel.scopeSelect.addEventListener('change', () => {
      this.updateSettings({ scope: panel.scopeSelect.value as Scope });
    });

    panel.searchInput.addEventListener('input', () => {
      const value = panel.searchInput.value;
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = null;
        if (!this.state) return;
        this.state.query = value;
        this.state.page = 1;
        this.render();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-grs-action], [data-grs-page]') : null;
    if (!target) return;

    const action = target.dataset.grsAction;
    if (action) {
      event.preventDefault();
      this.runAction(action);
      return;
    }

    const direction = target.dataset.grsPage;
    if (direction === 'prev') this.changePage(-1);
    else if (direction === 'next') this.changePage(1);
  }

  private runAction(action: string): void {
    const generation = this.generation;
    switch (action) {
      case 'refresh':
        void this.fetch(generation, { force: true });
        return;
      case 'retry':
        void this.fetch(generation, { force: true });
        return;
      case 'public-fallback':
        void this.fetch(generation, { force: true, authMode: 'public' });
        return;
      case 'standard':
        this.setView('standard');
        return;
      case 'sorter':
        this.setView('sorter');
        return;
      case 'open-options':
        void this.send({ channel: CHANNEL, type: 'open-options' });
        return;
      case 'clear':
        this.clearFilters();
        return;
      default:
        return;
    }
  }

  private setView(view: 'sorter' | 'standard'): void {
    if (!this.state) return;
    this.state.view = view;
    this.render();
  }

  private clearFilters(): void {
    if (!this.state || !this.refs) return;
    this.state.query = '';
    this.state.page = 1;
    this.refs.searchInput.value = '';
    this.updateSettings({ scope: 'all' });
  }

  private changePage(delta: number): void {
    const state = this.state;
    if (!state || !state.data) return;

    const view = buildView({
      repos: state.data.repos,
      sort: state.settings.sort,
      scope: state.settings.scope,
      query: state.query,
      page: state.page,
    });

    const next = Math.min(Math.max(1, view.page.page + delta), view.page.totalPages);
    if (next === state.page) return;
    state.page = next;
    this.render();
  }

  private updateSettings(partial: { sort?: SortMode; scope?: Scope }): void {
    const state = this.state;
    if (!state) return;

    const next = sanitizeSettings({ ...state.settings, ...partial });
    state.settings = next;
    state.page = 1;
    this.render();
    void this.saveSettings(next);
  }

  private async loadSettings(generation: number): Promise<void> {
    const state = this.state;
    if (!state) return;

    const request: SettingsGetRequest = {
      channel: CHANNEL,
      type: 'settings-get',
      owner: state.owner,
    };
    const response = await this.send(request);
    if (this.generation !== generation || !this.state) return;
    if (response !== null && response.ok && response.kind === 'settings') {
      this.state.settings = response.data;
      this.state.page = 1;
      this.render();
    }
  }

  private async saveSettings(settings: SorterSettings): Promise<void> {
    const state = this.state;
    if (!state) return;

    const request: SettingsSetRequest = {
      channel: CHANNEL,
      type: 'settings-set',
      owner: state.owner,
      settings: { sort: settings.sort, scope: settings.scope },
    };
    await this.send(request);
  }

  private async fetch(
    generation: number,
    options: { force?: boolean; authMode?: AuthMode } = {},
  ): Promise<void> {
    const state = this.state;
    if (!state) return;

    if (this.requestId !== null) {
      void this.send({ channel: CHANNEL, type: 'cancel', requestId: this.requestId });
    }

    const requestId = crypto.randomUUID();
    this.requestId = requestId;

    state.loading = true;
    state.error = null;
    state.progress = null;
    this.render();

    const request: FetchRequest = {
      channel: CHANNEL,
      type: 'fetch',
      requestId,
      owner: state.owner,
      force: options.force === true,
      ...(options.authMode ? { authMode: options.authMode } : {}),
    };

    const response = await this.send(request);
    if (this.generation !== generation || !this.state) return;

    this.state.loading = false;

    if (response === null) {
      this.state.error = {
        kind: 'unknown',
        message:
          '拡張機能のサービスワーカーから応答がありませんでした。拡張機能を読み込み直してください。',
      };
      this.render();
      return;
    }

    if (!response.ok) {
      if (response.error.kind === 'aborted') {
        this.render();
        return;
      }
      this.state.error = response.error;
      this.render();
      return;
    }

    if (response.kind !== 'fetch') {
      this.state.error = { kind: 'unknown', message: '予期しない応答を受け取りました。' };
      this.render();
      return;
    }

    this.state.data = response.data;
    this.state.error = null;
    this.state.page = 1;
    this.render();
  }

  private render(): void {
    const state = this.state;
    const refs = this.refs;
    if (!state || !refs) return;

    const ui: UiState = {
      owner: state.owner,
      view: state.view,
      sort: state.settings.sort,
      scope: state.settings.scope,
      query: state.query,
      page: state.page,
      data: state.data,
      loading: state.loading,
      progress: state.progress,
      error: state.error,
    };

    const content = renderPanelContent(ui);
    refs.status.textContent = content.statusText;
    refs.body.replaceChildren(content.body);

    if (refs.sortSelect.value !== state.settings.sort) refs.sortSelect.value = state.settings.sort;
    if (refs.scopeSelect.value !== state.settings.scope) {
      refs.scopeSelect.value = state.settings.scope;
    }

    refs.authBadge.textContent =
      state.data?.authMode === 'authenticated' && state.data.login !== null
        ? `認証中: ${state.data.login}`
        : '公開のみ';
    refs.refreshButton.textContent = state.loading ? '取得中…' : '再取得';
    refs.refreshButton.disabled = state.loading;
    refs.modeButton.textContent = state.view === 'standard' ? '拡張ソートに戻す' : '標準表示';
    refs.root.dataset.grsView = state.view;

    this.updateNativeVisibility();
  }

  private updateNativeVisibility(): void {
    const native = this.native;
    const state = this.state;
    if (!native || !state) return;
    // Keep GitHub's list visible until we actually have data, and restore it for
    // the standard view. Partial data still counts as data (the list is shown
    // with a warning).
    const hideNative = state.view === 'sorter' && state.data !== null;
    setNativeHidden(native.hideTargets, hideNative);
  }

  private teardown(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.requestId !== null) {
      void this.send({ channel: CHANNEL, type: 'cancel', requestId: this.requestId });
      this.requestId = null;
    }
    if (this.native) setNativeHidden(this.native.hideTargets, false);
    if (this.refs) this.refs.root.remove();

    this.refs = null;
    this.native = null;
    this.state = null;
    this.generation += 1;

    if (this.routeTimer !== null) {
      window.clearTimeout(this.routeTimer);
      this.routeTimer = null;
    }
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    removeStalePanels(document);
  }

  private async send(request: Request): Promise<HandlerResponse | null> {
    try {
      const response: unknown = await chrome.runtime.sendMessage(request);
      if (response === null || response === undefined) return null;
      return response as HandlerResponse;
    } catch {
      // The extension context can be invalidated by a reload; report it as an
      // empty response so the UI shows a reload hint.
      return null;
    }
  }
}
