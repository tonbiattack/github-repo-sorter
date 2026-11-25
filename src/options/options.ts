import { CHANNEL } from '../shared/protocol';
import type { HandlerResponse } from '../shared/protocol';

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
  return persistent ? 'ブラウザ再起動後も保持' : 'セッション中のみ保持';
}

async function refreshStatus(): Promise<void> {
  setStatus('確認中…');
  const response = await send({ channel: CHANNEL, type: 'auth-status' });
  if (response === null) {
    setStatus('バックグラウンドと通信できませんでした。拡張機能を読み込み直してください。', 'error');
    return;
  }
  if (!response.ok) {
    setStatus(`認証状態を確認できませんでした: ${response.error.message}`, 'error');
    return;
  }
  if (response.kind !== 'auth-status') {
    setStatus('認証状態を確認できませんでした。', 'error');
    return;
  }
  const { configured, login, persistent } = response.data;
  persistInput.checked = persistent;
  persistWarning.hidden = !persistent;

  if (configured && login) {
    setStatus(`設定済み: ${login} として認証されています（${storageLabel(persistent)}）。`, 'ok');
    return;
  }
  if (configured) {
    setStatus('トークンは設定されていますが、ユーザー情報を取得できませんでした。', 'error');
    return;
  }
  setStatus('未設定: 公開リポジトリのみ取得します。', 'muted');
}

persistInput.addEventListener('change', () => {
  persistWarning.hidden = !persistInput.checked;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (token === '') {
    setStatus('トークンを入力してください。', 'error');
    return;
  }

  saveButton.disabled = true;
  setStatus('トークンを検証しています…');
  const response = await send({
    channel: CHANNEL,
    type: 'auth-set',
    token,
    ...(persistInput.checked ? { persist: true } : {}),
  });
  saveButton.disabled = false;

  if (response === null) {
    setStatus('保存できませんでした。拡張機能を読み込み直してください。', 'error');
    return;
  }
  if (!response.ok) {
    setStatus(`保存に失敗しました: ${response.error.message}`, 'error');
    return;
  }
  if (response.kind === 'auth-status' && response.data.login) {
    tokenInput.value = '';
    setStatus(
      `保存しました: ${response.data.login} として認証されています（${storageLabel(response.data.persistent)}）。`,
      'ok',
    );
    return;
  }
  await refreshStatus();
});

clearButton.addEventListener('click', async () => {
  clearButton.disabled = true;
  const response = await send({ channel: CHANNEL, type: 'auth-clear' });
  clearButton.disabled = false;
  if (response === null || !response.ok) {
    setStatus('トークンを解除できませんでした。', 'error');
    return;
  }
  await refreshStatus();
  setStatus('トークンを解除しました（保存済みのコピーも削除）。公開リポジトリのみ取得します。', 'muted');
});

clearCacheButton.addEventListener('click', async () => {
  clearCacheButton.disabled = true;
  const response = await send({ channel: CHANNEL, type: 'cache-clear' });
  clearCacheButton.disabled = false;
  if (response === null || !response.ok) {
    setStatus('キャッシュを消去できませんでした。', 'error');
    return;
  }
  setStatus('メモリ上のキャッシュを消去しました。', 'ok');
});

void refreshStatus();
