import { fetchAllRepos, fetchViewer } from '../shared/api';
import { TtlCache } from '../shared/cache';
import { CHANNEL, parseRequest } from '../shared/protocol';
import type { FetchData, ProgressMessage } from '../shared/protocol';
import { createMessageHandler } from './handler';
import type { SenderInfo } from './handler';
import { createSettingsStore, createTokenStore } from './storage';
import type { KeyValueArea } from './storage';

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Adapter so the stores only depend on the small KeyValueArea surface. */
function toArea(area: chrome.storage.StorageArea): KeyValueArea {
  return {
    get: (keys) => area.get(keys as string | string[] | Record<string, unknown> | null),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
  };
}

const cache = new TtlCache<FetchData>(CACHE_TTL_MS);
const localArea = toArea(chrome.storage.local);
const sessionArea = toArea(chrome.storage.session);

const handler = createMessageHandler({
  fetchAll: fetchAllRepos,
  fetchViewer: ({ token }) => fetchViewer({ token }),
  cache,
  settings: createSettingsStore(localArea),
  tokens: createTokenStore(sessionArea, localArea),
  now: Date.now,
  extensionUrlPrefix: chrome.runtime.getURL(''),
  notifyProgress: (progress) => {
    if (progress.tabId === undefined) return;
    const message: ProgressMessage = {
      channel: CHANNEL,
      type: 'fetch-progress',
      requestId: progress.requestId,
      page: progress.page,
      received: progress.received,
    };
    try {
      chrome.tabs.sendMessage(progress.tabId, message, () => {
        // The tab may have navigated away; there is nothing to recover here.
        void chrome.runtime.lastError;
      });
    } catch {
      // Same as above: a closed tab must not break the fetch.
    }
  },
  openOptions: () => {
    void chrome.runtime.openOptionsPage();
  },
  notifyAuthChanged: () => {
    void chrome.tabs.query({ url: 'https://github.com/*' }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          void chrome.tabs.sendMessage(tab.id, { channel: CHANNEL, type: 'auth-changed' }).catch(() => undefined);
        }
      }
    }).catch(() => undefined);
  },
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const request = parseRequest(message);
  if (request === null) return false;

  const senderInfo: SenderInfo = {
    ...(sender.tab?.id !== undefined ? { tabId: sender.tab.id } : {}),
    ...(sender.frameId !== undefined ? { frameId: sender.frameId } : {}),
    ...(sender.url ?? sender.tab?.url ? { url: sender.url ?? sender.tab?.url } : {}),
  };

  handler.handle(request, senderInfo).then(
    (response) => {
      if (response !== null) sendResponse(response);
    },
    () => {
      sendResponse({
        ok: false,
        error: { kind: 'unknown', message: 'メッセージの処理に失敗しました。' },
      });
    },
  );

  return true;
});

// Extension pages need the token; content scripts must never see it.
type StorageAreaWithAccess = chrome.storage.StorageArea & {
  setAccessLevel?: (options: {
    accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS';
  }) => Promise<void>;
};

for (const area of [chrome.storage.session, chrome.storage.local] as StorageAreaWithAccess[]) {
  try {
    void area.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => undefined);
  } catch {
    // Older Chrome versions do not expose setAccessLevel; the default is already
    // TRUSTED_CONTEXTS.
  }
}
