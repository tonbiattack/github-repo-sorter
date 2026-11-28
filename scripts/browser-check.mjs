/* Real Chromium smoke test of the unpacked extension on a public GitHub profile. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const index = process.argv.indexOf('--owner');
const owner = index >= 0 ? process.argv[index + 1] : 'tonbiattack';
if (!/^[A-Za-z0-9-]+$/.test(owner)) throw new Error('invalid owner');
const langIndex = process.argv.indexOf('--lang');
const uiLanguage = langIndex >= 0 ? process.argv[langIndex + 1] : 'en';
const probeOnly = process.argv.includes('--probe');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Expected UI phrases per display language (unsupported languages fall back to English). */
const L10N = {
  en: {
    sortLabel: 'Created · Forked · Pushed',
    fetched: (n) => `${n} fetched`,
    shown: (n) => `${n} shown`,
    loadFailed: 'Could not load repositories',
    mismatch: 'does not match',
    authenticated: 'Signed in as',
    publicOnly: 'Public only',
    standardList: "GitHub's standard list",
    loading: 'Loading repositories',
    configured: 'Configured:',
    cleared: 'Removed the token',
    clearFailed: 'Could not remove the token',
    pager31to60: /31.60 of/,
  },
  ja: {
    sortLabel: '作成・Fork・Push順',
    fetched: (n) => `取得${n}件`,
    shown: (n) => `表示${n}件`,
    loadFailed: '取得できませんでした',
    mismatch: '一致しません',
    authenticated: '認証済み',
    publicOnly: '公開のみ',
    standardList: 'GitHub標準一覧',
    loading: '取得中',
    configured: '設定済み',
    cleared: '解除しました',
    clearFailed: 'できませんでした',
    pager31to60: /31.60 \/ /,
  },
};
const resolveLang = (tag) => (String(tag).toLowerCase().startsWith('ja') ? 'ja' : 'en');
const L = L10N[resolveLang(uiLanguage)];


async function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const dirs = [path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'), path.join(process.env.HOME ?? '', '.cache', 'ms-playwright')];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const builds = (await readdir(dir)).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) for (const exe of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = path.join(dir, build, exe);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Set CHROME_PATH to Playwright Chromium or Chrome for Testing (branded Chrome 137+ ignores --load-extension).');
}

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP WebSocket error')), { once: true });
    });
    return new Cdp(socket);
  }
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const callback = this.pending.get(message.id);
      if (!callback) return;
      this.pending.delete(message.id);
      message.error ? callback.reject(new Error(`${message.error.code}: ${message.error.message}`)) : callback.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitFor(fn, description, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await fn();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out: ${description}; last=${JSON.stringify(value)}`);
}
function assert(condition, message) { if (!condition) throw new Error(message); }

const snapshotExpression = `(() => {
  const rows = [...document.querySelectorAll('[data-grs-list] .grs-repo')];
  return {
    url: location.href,
    count: document.querySelectorAll('[data-grs-mount]').length,
    menu: document.querySelectorAll('#sort-options [data-grs-sort]').length,
    sort: document.querySelector('#sort-options [data-grs-sort][aria-checked="true"]')?.dataset.grsSort ?? null,
    status: document.querySelector('[data-grs-status]')?.textContent ?? '',
    rows: rows.length,
    names: rows.map(row => row.querySelector('.grs-repo__name')?.textContent ?? ''),
    forks: rows.map(row => row.querySelector('.col-10 > .f6')?.textContent === 'Fork'),
    pager: document.querySelector('.grs-pager__status')?.textContent ?? '',
    nativeHidden: document.querySelector('#user-repositories-list')?.getAttribute('data-grs-hidden') === 'true',
    searchVisible: !!document.querySelector('#your-repos-filter') && !!document.querySelector('#your-repos-filter').getClientRects().length,
    hasLegacyPanel: !!document.querySelector('[data-grs-root]'),
    type: document.querySelector('#type-options input[name="type"]:checked')?.value ?? null,
    background: document.body ? getComputedStyle(document.body).backgroundColor : null,
    firstLanguage: document.querySelector('.grs-repo__language')?.textContent ?? null,
    sortLabel: document.querySelector('#sort-options [data-grs-sort-label]')?.textContent ?? '',
    statusText: document.querySelector('[data-grs-status]')?.textContent ?? '',
    localeHint: document.documentElement.lang || navigator.language,
  };
})()`;

async function clickSelector(cdp, selector) {
  const box = await cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('missing selector'); e.scrollIntoView({block:'center',behavior:'instant'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height, top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,250)}; })()`);
  assert(box.width > 0 && box.height > 0, `not visible: ${selector}`);
  if (!box.top) throw new Error(`target is outside viewport: ${selector} (${JSON.stringify(box)})`);
  if (!box.top.includes('button') && selector.includes('grs-page')) throw new Error(`pager button is obscured: ${box.top}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: box.x, y: box.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: box.x, y: box.y });
}

async function expectedRepos(authenticated = false) {
  let url = authenticated
    ? 'https://api.github.com/user/repos?affiliation=owner&visibility=all&per_page=100'
    : `https://api.github.com/users/${encodeURIComponent(owner)}/repos?type=owner&per_page=100`;
  const repos = new Map();
  while (url) {
    const headers = { 'User-Agent': 'github-repo-sorter-check', Accept: 'application/vnd.github+json' };
    if (process.env.GRS_VERIFY_TOKEN) headers.Authorization = `Bearer ${process.env.GRS_VERIFY_TOKEN}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Independent API request failed: ${response.status}`);
    for (const repo of await response.json()) if ((authenticated || !repo.private) && repo.owner.login.toLowerCase() === owner.toLowerCase()) repos.set(repo.id, repo);
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1] ?? null;
  }
  const time = (v) => { const ms = Date.parse(v ?? ''); return Number.isFinite(ms) ? ms : null; };
  const activity = (r) => { const a = time(r.created_at), b = time(r.pushed_at); return a === null ? b : b === null ? a : Math.max(a, b); };
  return [...repos.values()].sort((a, b) => {
    const x = activity(a), y = activity(b);
    if (x !== y) return x === null ? 1 : y === null ? -1 : y - x;
    const al = a.full_name.toLowerCase(), bl = b.full_name.toLowerCase();
    return (al < bl ? -1 : al > bl ? 1 : a.full_name < b.full_name ? -1 : a.full_name > b.full_name ? 1 : a.id - b.id);
  });
}

async function verifyOwnerMismatch(cdp, snapshot, baseUrl) {
  await cdp.send('Page.navigate', { url: 'https://github.com/octocat?tab=repositories' });
  await waitFor(async () => (await snapshot()).status.includes(L.mismatch), 'owner mismatch');
  const mismatch = await snapshot();
  assert(!mismatch.nativeHidden && mismatch.searchVisible, 'native list unavailable after owner mismatch');
  // Public retry may itself hit an unauthenticated rate limit; the recovery
  // action must remain present without hiding the native list in either case.
  assert(await cdp.evaluate(`!!document.querySelector('[data-grs-action="public-fallback"]')`), 'public fallback missing');
  await cdp.send('Page.navigate', { url: baseUrl });
  return true;
}

async function main() {
  assert(existsSync(path.join(dist, 'manifest.json')), 'Run npm run build before the browser test');
  const browser = await findBrowser();
  const profile = await mkdtemp(path.join(tmpdir(), 'grs-browser-check-'));
  const chrome = spawn(browser, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,1600', `--lang=${uiLanguage}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    const { readFile } = await import('node:fs/promises');
    const port = await waitFor(async () => {
      try { return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) || null; } catch { return null; }
    }, 'Chrome debug port');
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await Cdp.connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    // Optional test token is placed only in the extension's session storage.
    // It is never sent to the page, logged, or persisted to the repository.
    let authWorker = null;
    if (process.env.GRS_VERIFY_TOKEN && process.env.GRS_TEST_AUTH === '1') {
      authWorker = await waitFor(async () => {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        for (const target of list.filter((entry) => entry.type === 'service_worker' && entry.url.endsWith('/background.js'))) {
          const client = await Cdp.connect(target.webSocketDebuggerUrl);
          try {
            const name = await client.evaluate('chrome.runtime.getManifest().name');
            if (name === 'GitHub Repo Sorter') return client;
          } catch { /* Another extension's worker. */ }
          client.close();
        }
        return null;
      }, 'extension service worker');
      await authWorker.evaluate(`chrome.storage.session.set({ 'grs:pat': ${JSON.stringify(process.env.GRS_VERIFY_TOKEN)} })`);
    }
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `https://github.com/${encodeURIComponent(owner)}?tab=repositories` });
    const snapshot = () => cdp.evaluate(snapshotExpression);
    const loaded = await waitFor(async () => {
      const s = await snapshot();
      if (s.status.includes(L.loadFailed)) throw new Error(`Extension fetch failed: ${s.status}`);
      return s.rows && s.nativeHidden && s;
    }, 'extension list');
    assert(loaded.menu === 5 && loaded.count === 1 && !loaded.hasLegacyPanel && loaded.searchVisible, `integration failed: controls=${loaded.count}, menu=${loaded.menu}`);
    assert(loaded.sortLabel === L.sortLabel, `UI language mismatch: sort label is "${loaded.sortLabel}", expected "${L.sortLabel}"`);
    if (probeOnly) {
      let shots = [];
      if (process.env.GRS_STORE_SHOTS === '1') {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: 1280,
          height: 800,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const mode of ['light', 'dark']) {
          await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
          await cdp.evaluate('window.scrollTo(0, 0)');
          await delay(400);
          const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
          const file = path.join(root, 'docs', 'screenshots', `store-1280x800-${uiLanguage}-${mode}.png`);
          await writeFile(file, Buffer.from(image.data, 'base64'));
          shots.push(file);
        }
        await cdp.send('Emulation.clearDeviceMetricsOverride');
      }
      const report = {
        ok: true,
        mode: 'probe',
        requestedLanguage: uiLanguage,
        resolvedLocale: resolveLang(uiLanguage),
        sortLabel: loaded.sortLabel,
        status: loaded.status,
        menuItems: loaded.menu,
        background: loaded.background,
        screenshots: shots,
      };
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const expected = await expectedRepos(Boolean(authWorker));
    assert(expected.length > 100, `Use an owner with over 100 public repositories, got ${expected.length}`);
    assert(loaded.status.includes(L.fetched(expected.length)), `total mismatch: ${loaded.status}`);
    assert(JSON.stringify(loaded.names) === JSON.stringify(expected.slice(0, 30).map((repo) => repo.name)), 'first page activity order mismatch');
    await cdp.evaluate(`document.querySelector('[data-grs-page="next"]')?.scrollIntoView({block:'center'})`);
    await delay(500);
    await clickSelector(cdp, '[data-grs-page="next"]');
    const second = await waitFor(async () => { const s = await snapshot(); return L.pager31to60.test(s.pager) && s; }, 'page 2');
    assert(JSON.stringify(second.names) === JSON.stringify(expected.slice(30, 60).map((repo) => repo.name)), `page 2 mismatch: ${JSON.stringify(second.names.slice(0, 3))}`);

    const needle = expected[0].name.slice(0, 8).toLowerCase();
    await clickSelector(cdp, '#your-repos-filter');
    await cdp.send('Input.insertText', { text: needle });
    const expectedSearch = expected.filter((repo) => `${repo.name}\n${repo.description ?? ''}`.toLowerCase().includes(needle));
    await waitFor(async () => { const s = await snapshot(); return s.status.includes(L.shown(expectedSearch.length)) && s; }, 'global search');
    await cdp.evaluate(`(() => {const input=document.querySelector('#your-repos-filter');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(400);
    await clickSelector(cdp, '#type-options summary');
    await clickSelector(cdp, '#type-options label:has(input[name="type"][value="fork"])');
    const filtered = await waitFor(async () => { const s = await snapshot(); return s.type === 'fork' && s.status.includes(L.shown(expected.filter(r => r.fork).length)) && s; }, 'Fork filter');
    assert(filtered.forks.every(Boolean), 'Fork filter contains non-fork');
    await clickSelector(cdp, '#sort-options summary');
    await clickSelector(cdp, '[data-grs-sort="created"]');
    assert((await snapshot()).sort === 'created', 'custom sort did not change');
    await cdp.send('Page.reload');
    const restored = await waitFor(async () => { const s = await snapshot(); return s.rows && s.sort === 'created' && s.type === 'fork' && s; }, 'settings restoration');
    assert(restored.count === 1 && restored.menu === 5, 'duplicate controls after reload');

    // Native DOM replacement emulates a Turbo fragment update without navigating.
    await cdp.evaluate(`(() => {const old=document.querySelector('#user-repositories-list');const next=old.cloneNode(true);next.removeAttribute('data-grs-hidden');old.replaceWith(next);document.dispatchEvent(new Event('turbo:frame-load'));})()`);
    const replaced = await waitFor(async () => { const s = await snapshot(); return s.nativeHidden && s.rows && s; }, 'Turbo list replacement');
    assert(replaced.count === 1 && replaced.menu === 5, 'duplicate controls after DOM replacement');
    await clickSelector(cdp, '#sort-options summary');
    await clickSelector(cdp, '#sort-options label:has(input[name="sort"][value="name"])');
    const standard = await waitFor(async () => { const s = await snapshot(); return !s.nativeHidden && !s.rows && s.url.includes('sort=name') && s; }, 'GitHub standard sort');
    assert(standard.searchVisible && standard.menu === 5, 'native controls missing after standard sort');
    await clickSelector(cdp, '#sort-options summary');
    await clickSelector(cdp, '[data-grs-sort="activity"]');
    await waitFor(async () => { const s = await snapshot(); return s.nativeHidden && s.sort === 'activity' && s.rows && s; }, 'back to custom sort');
    await clickSelector(cdp, '#type-options summary');
    await clickSelector(cdp, '#type-options label:has(input[name="type"][value=""])');
    await waitFor(async () => { const s = await snapshot(); return s.type === '' && s.status.includes(L.shown(expected.length)) && s; }, 'clear Type');

    // Regression: GitHub reaches the repositories tab with a same-document
    // (Turbo) navigation, so Chrome still reports the URL that was committed for
    // the document (the profile page) as `sender.url`. Validating that URL
    // rejected the fetch right after a fork/repository visit and kept rejecting
    // every retry until a full reload. The live page URL must decide instead.
    await cdp.send('Page.navigate', { url: `https://github.com/${encodeURIComponent(owner)}` });
    await waitFor(async () => (await cdp.evaluate('location.pathname')) === `/${owner}`, 'profile overview');
    const tabSelector = `a[href="/${owner}?tab=repositories"]`;
    try {
      await waitFor(async () => cdp.evaluate(`!!document.querySelector(${JSON.stringify(tabSelector)})`), 'repositories tab link', 10000);
    } catch (error) {
      const diag = await cdp.evaluate(`({url: location.href, title: document.title, ready: document.readyState, navs: [...document.querySelectorAll('header nav a')].map(a => a.getAttribute('href')).slice(0, 10), text: document.body ? document.body.innerText.slice(0, 200) : null})`);
      throw new Error(`${error.message} ${JSON.stringify(diag)}`);
    }
    const committedAt = await cdp.evaluate('performance.timeOrigin');
    await clickSelector(cdp, tabSelector);
    const turbo = await waitFor(async () => {
      const s = await snapshot();
      if (s.status.includes(L.loadFailed)) throw new Error(`fetch rejected after a Turbo navigation: ${s.status}`);
      return s.url.includes('tab=repositories') && s.rows && s;
    }, 'repositories tab after Turbo navigation');
    assert(committedAt === (await cdp.evaluate('performance.timeOrigin')), 'the navigation created a new document; the Turbo regression was not exercised');
    assert(turbo.nativeHidden && turbo.menu === 5, `sorter did not take over after a Turbo navigation: ${JSON.stringify({ menu: turbo.menu, hidden: turbo.nativeHidden })}`);

    // Never retain authenticated screenshots under the public screenshot names.
    if (authWorker) for (const mode of ['light', 'dark']) await rm(path.join(dist, `browser-check-${mode}.png`), { force: true });
    let authenticatedVerified = false;
    let errorFallbackVerified = false;
    let publicCaptureError = null;
    let publicExpected = expected;
    if (authWorker) {
      assert(expected.some((repo) => repo.private), 'test account has no private repositories');
      assert((await snapshot()).status.includes('認証済み'), 'authenticated scope was not labelled');
      authenticatedVerified = true;
      errorFallbackVerified = await verifyOwnerMismatch(cdp, snapshot, `https://github.com/${encodeURIComponent(owner)}?tab=repositories`);
      await waitFor(async () => { const s = await snapshot(); return s.nativeHidden && s.status.includes(L.authenticated) && s; }, 'authenticated list after navigation');
      // Exercise the same trusted extension message used by the options page.
      const extensionId = await authWorker.evaluate('chrome.runtime.id');
      // Capture only public results; authenticated repository names never enter the screenshots.
      await cdp.send('Page.navigate', { url: `chrome-extension://${extensionId}/options.html` });
      await waitFor(async () => cdp.evaluate(`!!document.querySelector('#clear')`), 'options page');
      const readyStatus = await waitFor(async () => cdp.evaluate(`(() => {const text=document.querySelector('#status')?.textContent ?? ''; return text && !text.includes('…') ? text : null;})()`), 'options status');
      assert(readyStatus.includes(L.configured), `options status: ${readyStatus}`);
      await cdp.evaluate(`document.querySelector('#clear').click()`);
      const cleared = await waitFor(async () => cdp.evaluate(`(() => {const text=document.querySelector('#status')?.textContent ?? ''; return text.includes(L.cleared) ? 'cleared' : text.includes(L.clearFailed) ? text : null;})()`), 'clear token');
      assert(cleared === 'cleared', `clear failed: ${cleared}`);
      // Re-enter the owner page after the token was removed. The UI must not
      // display stale private data while the next public request is pending.
      await cdp.send('Page.navigate', { url: `https://github.com/${encodeURIComponent(owner)}?tab=repositories` });
      const afterClear = await waitFor(async () => {
        const s = await snapshot();
        return ((s.status.includes(L.publicOnly) && s.nativeHidden) || (s.status.includes(L.standardList) && !s.nativeHidden && !s.rows && !s.status.includes(L.loading))) && s;
      }, 'public list or rate-limit fallback after auth clear');
      assert(!afterClear.status.includes(L.authenticated) && !afterClear.names.some((name) => expected.some((repo) => repo.private && repo.name === name)), 'private context remained after clear');
      publicExpected = await expectedRepos(false);
      if (afterClear.nativeHidden) assert(afterClear.status.includes(L.fetched(publicExpected.length)), `public total after clear: ${afterClear.status}`);
      else publicCaptureError = 'Public API rate limited after token removal';
      authWorker.close();
    }
    const images = {};
    const canCaptureAfter = !authWorker || (await snapshot()).nativeHidden;
    for (const mode of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
      await cdp.evaluate('window.scrollTo(0, 0)');
      await delay(400);
      images[mode] = (await snapshot()).background;
      if (canCaptureAfter) {
        const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(dist, `browser-check-${mode}.png`), Buffer.from(image.data, 'base64'));
      }
    }

    // Store screenshots must be exactly 1280x800 (or 640x400) and show public
    // repositories only. A viewport override gives the required dimensions
    // without depending on the host window size.
    if (process.env.GRS_STORE_SHOTS === '1' && canCaptureAfter) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.evaluate('window.scrollTo(0, 0)');
      await delay(400);
      for (const mode of ['light', 'dark']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
        await delay(400);
        const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(
          path.join(root, 'docs', 'screenshots', `store-1280x800-${mode}.png`),
          Buffer.from(image.data, 'base64'),
        );
      }      await cdp.send('Emulation.clearDeviceMetricsOverride');
    }

    assert(images.light !== images.dark, `light/dark did not change: ${JSON.stringify(images)}`);
    console.log(JSON.stringify({ ok: true, browser: version.Browser, owner, total: expected.length, authenticatedVerified, errorFallbackVerified, publicTotal: publicExpected.length, multiPage: true, sortOrder: true, paging: true, search: true, forkFilter: true, standardSort: true, restore: true, turboReplacement: true, themes: images, screenshots: canCaptureAfter ? ['dist/browser-check-light.png', 'dist/browser-check-dark.png'] : [], screenshotNote: canCaptureAfter ? null : publicCaptureError }, null, 2));
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      else chrome.kill('SIGKILL');
    }
    await delay(500);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}
main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
