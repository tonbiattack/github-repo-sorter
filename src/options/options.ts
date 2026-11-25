import { CHANNEL } from '../shared/protocol';
import type { HandlerResponse } from '../shared/protocol';
import { currentLocale, t } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
}

const statusElement = byId<HTMLParagraphElement>('status');
const form = byId<HTMLFormElement>('token-form');
const tokenInput = byId<HTMLInputElement>('token');
const persistInput = byId<HTMLInputElement>('persist');
const persistWarning = byId<HTMLParagraphElement>('persist-warning');
const saveButton = byId<HTMLButtonElement>('save');
const clearButton = byId<HTMLButtonElement>('clear');
const clearCacheButton = byId<HTMLButtonElement>('clear-cache');

type Tone = 'ok' | 'error' | 'muted';

/** Applies the browser locale to the static markup before anything else. */
function localizeDocument(): void {
  document.documentElement.lang = currentLocale();
  document.title = t('optionsTitle');
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n as MessageKey | undefined;
    if (key) element.textContent = t(key);
  }
  for (const element of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = element.dataset.i18nPlaceholder as MessageKey | undefined;
    if (key) element.placeholder = t(key);
  }
}

function setStatus(text: string, tone: Tone = 'muted'): void {
  statusElement.textContent = text;
  statusElement.dataset.tone = tone;
}

async function send(message: unknown): Promise<HandlerResponse | null> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message);
    if (response === null || response === undefined) return null;
    return response as HandlerResponse;
  } catch {
    return null;
  }
}

function storageLabel(persistent: boolean): string {
  return persistent ? t('storagePersistent') : t('storageSession');
}

async function refreshStatus(): Promise<void> {
  setStatus(t('statusChecking'));
  const response = await send({ channel: CHANNEL, type: 'auth-status' });
  if (response === null) {
    setStatus(t('statusBackgroundUnavailable'), 'error');
    return;
  }
  if (!response.ok) {
    setStatus(t('statusUnavailable', response.error.message), 'error');
    return;
  }
  if (response.kind !== 'auth-status') {
    setStatus(t('statusUnavailable', ''), 'error');
    return;
  }
  const { configured, login, persistent } = response.data;
  persistInput.checked = persistent;
  persistWarning.hidden = !persistent;

  if (configured && login) {
    setStatus(t('statusConfigured', login, storageLabel(persistent)), 'ok');
    return;
  }
  if (configured) {
    setStatus(t('statusConfiguredNoUser'), 'error');
    return;
  }
  setStatus(t('statusNotConfigured'), 'muted');
}

persistInput.addEventListener('change', () => {
  persistWarning.hidden = !persistInput.checked;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (token === '') {
    setStatus(t('tokenRequired'), 'error');
    return;
  }

  saveButton.disabled = true;
  setStatus(t('validating'));
  const response = await send({
    channel: CHANNEL,
    type: 'auth-set',
    token,
    ...(persistInput.checked ? { persist: true } : {}),
  });
  saveButton.disabled = false;

  if (response === null) {
    setStatus(t('saveFailedBackground'), 'error');
    return;
  }
  if (!response.ok) {
    setStatus(t('saveFailed', response.error.message), 'error');
    return;
  }
  if (response.kind === 'auth-status' && response.data.login) {
    tokenInput.value = '';
    setStatus(t('savedConfigured', response.data.login, storageLabel(response.data.persistent)), 'ok');
    return;
  }
  await refreshStatus();
});

clearButton.addEventListener('click', async () => {
  clearButton.disabled = true;
  const response = await send({ channel: CHANNEL, type: 'auth-clear' });
  clearButton.disabled = false;
  if (response === null || !response.ok) {
    setStatus(t('clearFailed'), 'error');
    return;
  }
  await refreshStatus();
  setStatus(t('cleared'), 'muted');
});

clearCacheButton.addEventListener('click', async () => {
  clearCacheButton.disabled = true;
  const response = await send({ channel: CHANNEL, type: 'cache-clear' });
  clearCacheButton.disabled = false;
  if (response === null || !response.ok) {
    setStatus(t('cacheClearFailed'), 'error');
    return;
  }
  setStatus(t('cacheCleared'), 'ok');
});

localizeDocument();
void refreshStatus();
