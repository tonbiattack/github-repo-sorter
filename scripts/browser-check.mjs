/**
 * Real-browser check for GitHub Repo Sorter.
 *
 * Launches Chrome (headless first, visible as a fallback) with the built
 * extension from `dist/`, opens a real GitHub repositories page, and verifies
 * the injected UI, fetch/merge/sort behaviour and the standard/dark modes via
 * the Chrome DevTools Protocol. Screenshots are written to `dist/`.
 *
 * Usage: npm run check:browser [-- --owner <login>]
 * Requires Chrome; no extra dependencies (CDP over Node's built-in WebSocket).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const extensionDir = path.join(projectRoot, 'dist');
const ownerArgIndex = process.argv.indexOf('--owner');
const owner = ownerArgIndex >= 0 ? process.argv[ownerArgIndex + 1] : 'tonbiattack';
const port = 9333;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Branded Chrome 137+ ignores `--load-extension`, so prefer Chromium builds
 * that still support unpacked extensions (Playwright's Chromium, Chrome for
 * Testing) and fall back to the installed browser with a warning.
 */
async function findBrowser() {
  if (process.env.CHROME_PATH) {
    return { path: process.env.CHROME_PATH, label: 'CHROME_PATH' };
  }

  const localAppData = process.env.LOCALAPPDATA ?? '';
  const playwrightRoot = path.join(localAppData, 'ms-playwright');
  if (playwrightRoot && existsSync(playwrightRoot)) {
    const builds = (await readdir(playwrightRoot))
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      const candidates = [
        path.join(playwrightRoot, build, 'chrome-win64', 'chrome.exe'),
        path.join(playwrightRoot, build, 'chrome-win', 'chrome.exe'),
        path.join(playwrightRoot, build, 'chrome-linux', 'chrome'),
        path.join(playwrightRoot, build, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return { path: candidate, label: `playwright-${build}`, extensionsSupported: true };
        }
      }
    }
  }

  const branded = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of branded) {
    if (existsSync(candidate)) {
      return { path: candidate, label: 'installed-browser', extensionsSupported: false };
    }
  }
  throw new Error('no Chromium/Chrome found; set CHROME_PATH to a build that supports --load-extension');
}

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.method ?? 'CDP'}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      const handlers = this.listeners.get(message.method);
      if (handlers) for (const handler of [...handlers]) handler(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  once(method, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const handler = (params) => {
        cleanup();
        resolve(params);
      };
      const cleanup = () => {
        this.listeners.get(method)?.delete(handler);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      if (!this.listeners.has(method)) this.listeners.set(method, new Set());
      this.listeners.get(method).add(handler);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description ?? 'unknown'}`);
    }
    return result.result.value;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // already closed
    }
  }
}

async function waitForEndpoint(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // not ready yet
    }
    await delay(150);
  }
  throw new Error(`endpoint not ready: ${url}`);
}

function killChrome(chrome) {
  if (!chrome || chrome.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  chrome.kill('SIGKILL');
}

function normaliseRepo(raw) {
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description ?? '',
    fork: raw.fork === true,
    createdAt: raw.created_at ?? null,
    pushedAt: raw.pushed_at ?? null,
  };
}

function activityMs(repo) {
  const created = repo.createdAt ? Date.parse(repo.createdAt) : null;
  const pushed = repo.pushedAt ? Date.parse(repo.pushedAt) : null;
  if (created === null && pushed === null) return null;
  if (pushed !== null && (created === null || pushed >= created)) return pushed;
  return created;
}

function compareExpected(a, b) {
  const aMs = activityMs(a);
  const bMs = activityMs(b);
  if (aMs === null && bMs === null) return a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0;
  if (aMs === null) return 1;
  if (bMs === null) return -1;
  if (aMs !== bMs) return bMs - aMs;
  const aName = a.fullName.toLowerCase();
  const bName = b.fullName.toLowerCase();
  if (aName !== bName) return aName < bName ? -1 : 1;
  return a.id - b.id;
}

/** Independent implementation of the spec order, used to cross-check the UI. */
async function fetchExpectedOrder(owner) {
  const repos = [];
  let url = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?type=owner&per_page=100`;
  while (url) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'github-repo-sorter-check', Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} while verifying`);
    const page = await response.json();
    repos.push(...page.map(normaliseRepo));
    const link = response.headers.get('link') ?? '';
    const match = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = match ? match[1] : null;
  }
  return repos.sort(compareExpected);
}

const PAGE_EXPRESSION = `(() => {
  const root = document.querySelector('[data-grs-root]');
  if (!root) return null;
  const rows = [...root.querySelectorAll('.grs-repo')];
  return {
    owner: root.getAttribute('data-grs-owner'),
    view: root.dataset.grsView ?? '',
    status: root.querySelector('[data-grs-status]')?.textContent ?? '',
    rows: rows.length,
    names: rows.map((row) => row.querySelector('.grs-repo__name')?.textContent ?? ''),
    badges: rows.map((row) => [...row.querySelectorAll('.grs-badge')].map((badge) => badge.textContent)),
    kinds: rows.map((row) => row.querySelector('.grs-kind')?.textContent ?? ''),
    pager: root.querySelector('.grs-pager__status')?.textContent ?? '',
    authBadge: root.querySelector('.grs-badge--auth')?.textContent ?? '',
    nativeHidden: document.querySelector('#user-repositories-list')?.getAttribute('data-grs-hidden') === 'true',
    restoreButton: root.querySelector('[data-grs-action="sorter"]')?.textContent ?? '',
    standardButton: root.querySelector('[data-grs-action="standard"]')?.textContent ?? '',
    sortValue: root.querySelector('[data-grs-control="sort"]')?.value ?? '',
    scopeValue: root.querySelector('[data-grs-control="scope"]')?.value ?? '',
    queryValue: root.querySelector('[data-grs-control="query"]')?.value ?? '',
    panelBackground: getComputedStyle(root).backgroundColor,
  };
})()`;

async function runCheck({ headless, browser }) {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'grs-chrome-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1280,1600',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ];

  const chrome = spawn(browser.path, args, { stdio: 'ignore' });
  let cdp = null;
  try {
    const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`, 30_000);
    const targets = await waitForEndpoint(`http://127.0.0.1:${port}/json/list`, 10_000);
    const pageTarget = targets.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('no page target');

    cdp = await Cdp.connect(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const loaded = cdp.once('Page.loadEventFired', 90_000);
    await cdp.send('Page.navigate', {
      url: `https://github.com/${encodeURIComponent(owner)}?tab=repositories`,
    });
    await loaded;

    const deadline = Date.now() + 45_000;
    let snapshot = null;
    while (Date.now() < deadline) {
      snapshot = await cdp.evaluate(PAGE_EXPRESSION);
      if (snapshot && snapshot.rows > 0 && !snapshot.status.startsWith('取得中')) break;
      await delay(250);
    }
    if (!snapshot) throw new Error('extension panel did not appear');

    const expected = await fetchExpectedOrder(owner);
    const expectedFirstPage = expected.slice(0, 30).map((repo) => repo.name);
    const totalMatches = new RegExp(`全${expected.length}件`).test(snapshot.status);
    const orderMatches = JSON.stringify(snapshot.names) === JSON.stringify(expectedFirstPage);
    const multiPage = expected.length > 100 && /全\d{3,}件/.test(snapshot.status);

    if (!orderMatches) {
      throw new Error(
        `order mismatch:\n  ui: ${snapshot.names.slice(0, 8).join(', ')}\n  expected: ${expectedFirstPage.slice(0, 8).join(', ')}`,
      );
    }
    if (!totalMatches) throw new Error(`total mismatch: ${snapshot.status} vs ${expected.length}`);
    if (snapshot.owner !== owner) throw new Error(`owner mismatch: ${snapshot.owner}`);
    if (!snapshot.nativeHidden) throw new Error('native list was not hidden');
    if (snapshot.view !== 'sorter') throw new Error(`unexpected view: ${snapshot.view}`);

    // Pagination.
    await cdp.evaluate(`document.querySelector('[data-grs-page="next"]')?.click()`);
    await delay(300);
    const pageTwo = await cdp.evaluate(PAGE_EXPRESSION);
    if (!pageTwo) throw new Error('panel disappeared after paging');
    if (pageTwo.rows !== 30 || !/^31–60 \//.test(pageTwo.pager)) {
      throw new Error(`pagination mismatch: rows=${pageTwo.rows} pager=${pageTwo.pager}`);
    }
    const expectedPageTwo = expected.slice(30, 60).map((repo) => repo.name);
    if (JSON.stringify(pageTwo.names) !== JSON.stringify(expectedPageTwo)) {
      throw new Error('page 2 order mismatch');
    }

    // Search narrows the whole dataset before paginating.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('[data-grs-control="query"]');
      input.value = ${JSON.stringify(expected[0].name.slice(0, Math.min(8, expected[0].name.length)))};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(500);
    const searched = await cdp.evaluate(PAGE_EXPRESSION);
    if (!searched) throw new Error('panel disappeared after search');
    const needle = expected[0].name.slice(0, Math.min(8, expected[0].name.length)).toLowerCase();
    const expectedMatches = expected.filter((repo) =>
      `${repo.name}\n${repo.description}`.toLowerCase().includes(needle),
    ).length;
    if (searched.rows > 30) throw new Error('search did not paginate');
    if (!new RegExp(`表示${expectedMatches}件`).test(searched.status)) {
      throw new Error(`search count mismatch: ${searched.status} vs ${expectedMatches}`);
    }

    await cdp.evaluate(`document.querySelector('[data-grs-action="clear"]')?.click()`);
    await delay(400);

    // Fork sorting keeps non-forks at the end of the list.
    await cdp.evaluate(`(() => {
      const select = document.querySelector('[data-grs-control="sort"]');
      select.value = 'forked';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(400);
    const forked = await cdp.evaluate(PAGE_EXPRESSION);
    if (!forked) throw new Error('panel disappeared after sort change');
    if (forked.sortValue !== 'forked') throw new Error(`sort select not applied: ${forked.sortValue}`);

    // Standard view restores GitHub's list.
    await cdp.evaluate(`document.querySelector('[data-grs-action="standard"]')?.click()`);
    await delay(400);
    const standard = await cdp.evaluate(PAGE_EXPRESSION);
    if (!standard) throw new Error('panel disappeared in standard view');
    if (standard.view !== 'standard' || standard.nativeHidden) {
      throw new Error(`standard view mismatch: view=${standard.view} nativeHidden=${standard.nativeHidden}`);
    }
    if (!standard.restoreButton) throw new Error('restore button missing in standard view');

    await cdp.evaluate(`document.querySelector('[data-grs-action="sorter"]')?.click()`);
    await delay(400);
    const restored = await cdp.evaluate(PAGE_EXPRESSION);
    if (!restored || restored.nativeHidden !== true || restored.rows === 0) {
      throw new Error('could not return to the extension list');
    }

    // Settings are restored after a reload (owner-scoped storage).
    await cdp.evaluate(`(() => {
      const select = document.querySelector('[data-grs-control="scope"]');
      select.value = 'forks';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(500);
    const reloaded = cdp.once('Page.loadEventFired', 90_000);
    await cdp.send('Page.reload', { ignoreCache: false });
    await reloaded;
    const restoreDeadline = Date.now() + 45_000;
    let afterReload = null;
    while (Date.now() < restoreDeadline) {
      afterReload = await cdp.evaluate(PAGE_EXPRESSION);
      if (afterReload && afterReload.rows > 0) break;
      await delay(300);
    }
    if (!afterReload) throw new Error('panel did not come back after reload');
    if (afterReload.scopeValue !== 'forks') {
      throw new Error(`settings were not restored: scope=${afterReload.scopeValue}`);
    }
    if (!afterReload.badges.every((badges) => badges.includes('Fork'))) {
      throw new Error('scope=forks shows a non-fork repository');
    }

    // Reset to the default view before the screenshots.
    await cdp.evaluate(`(() => {
      const scope = document.querySelector('[data-grs-control="scope"]');
      if (scope) {
        scope.value = 'all';
        scope.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const sort = document.querySelector('[data-grs-control="sort"]');
      if (sort) {
        sort.value = 'activity';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await delay(600);

    // Light and dark screenshots (force the colour scheme explicitly, because
    // headless Chromium's default preference depends on the host).
    await cdp.evaluate(`window.scrollTo(0, 0)`);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
    await delay(500);
    const lightSnapshot = await cdp.evaluate(PAGE_EXPRESSION);
    const lightShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const lightPath = path.join(projectRoot, 'dist', 'browser-check-light.png');
    await writeFile(lightPath, Buffer.from(lightShot.data, 'base64'));

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    await delay(500);
    const darkSnapshot = await cdp.evaluate(PAGE_EXPRESSION);
    const darkShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const darkPath = path.join(projectRoot, 'dist', 'browser-check-dark.png');
    await writeFile(darkPath, Buffer.from(darkShot.data, 'base64'));

    if (lightSnapshot?.panelBackground === darkSnapshot?.panelBackground) {
      throw new Error(
        `colour scheme did not change the panel background: ${lightSnapshot?.panelBackground}`,
      );
    }

    const report = {
      ok: true,
      headless,
      browser: version.Browser,
      browserPath: browser.path,
      browserLabel: browser.label,
      owner,
      totalFromApi: expected.length,
      totalMultiPageVerified: multiPage,
      firstPageOrderMatches: orderMatches,
      paginationVerified: true,
      searchVerified: true,
      forkSortVerified: true,
      standardViewVerified: true,
      settingsRestoredAfterReload: true,
      darkModeBackground: darkSnapshot?.panelBackground ?? null,
      lightModeBackground: lightSnapshot?.panelBackground ?? null,
      screenshots: { lightPath, darkPath },
    };
    return report;
  } finally {
    cdp?.close();
    killChrome(chrome);
    await delay(400);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  if (!existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('dist/manifest.json is missing; run `npm run build` first');
  }
  const browser = await findBrowser();
  console.log(`browser: ${browser.label} (${browser.path})`);
  if (browser.extensionsSupported === false) {
    console.warn(
      'warning: Chrome/Edge 137+ ignores --load-extension; set CHROME_PATH to Playwright Chromium or Chrome for Testing',
    );
  }

  let report;
  try {
    report = await runCheck({ headless: true, browser });
  } catch (error) {
    console.warn(`headless check failed (${error.message}); retrying with a visible window`);
    report = await runCheck({ headless: false, browser });
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`browser check failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
