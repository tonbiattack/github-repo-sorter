# Privacy Policy — GitHub Repo Sorter

Last updated: 2026-11-25

GitHub Repo Sorter is an unofficial browser extension that reorders the
repository list on a GitHub profile page. This policy describes exactly what
the extension does with data. It is written to match the shipped code.

## Summary

- The extension talks only to `api.github.com`.
- There is no analytics, telemetry, advertising, or third-party server.
- Repository data is cached in memory for 5 minutes and never written to disk.
- An access token is optional. It is stored only in your browser profile, and
  only if you choose to save one.

## What the extension reads

When you open `https://github.com/<owner>?tab=repositories`, the extension reads
the page's own repository list markup (the search box, the Type / Language /
Visibility / Sort menus, and the list container) so it can add its sort options
and show its own list. It does not read other pages, other tabs, or your GitHub
password.

## What the extension requests from GitHub

It calls the GitHub REST API to list repositories:

- Without a token: `GET /users/{owner}/repos?type=owner` — public repositories only.
- With a token you supplied: `GET /user/repos?affiliation=owner&visibility=all`
  — your own repositories, including private ones, plus `GET /user` to confirm
  which account the token belongs to.

The API returns repository metadata: name, description, primary language,
visibility, fork/archived/template/mirror flags, star and fork counts, and the
`created_at` / `pushed_at` / `updated_at` timestamps. The extension uses these
fields to sort and render the list.

## What is stored, and where

| Data | Where | Lifetime |
| --- | --- | --- |
| Repository list (from the API) | Service worker memory | 5 minutes, or until you press "再取得" / the worker stops |
| Sort order and filters, per owner | `chrome.storage.local` | Until you clear extension data |
| Access token (default) | `chrome.storage.session` | Until the browser closes |
| Access token (opt-in only) | `chrome.storage.local` | Until you remove it |

The token is never sent to a content script, never placed in the page, and
never included in any message to a web page. Both storage areas are restricted
to trusted extension contexts (`TRUSTED_CONTEXTS`), so page scripts cannot read
them.

### About the opt-in persistent token

By default the token lives only in `chrome.storage.session` and disappears when
the browser closes. If you tick "ブラウザを再起動しても保持する" on the options
page, the token is **also** written to `chrome.storage.local`. That area is
stored in your browser profile on disk in plain text, protected only by your
operating-system account. Anyone who can read your profile directory, or any
malware running as you, could read the token. Leave the option off on shared
machines. Removing the token on the options page deletes both copies.

## What is never done

- No data is sent to any server other than `api.github.com`.
- No GitHub cookies are read or reused; the extension never authenticates as you
  through the browser session.
- No repository data is written to disk, and no private repository data is
  persisted in any cache.
- No analytics, crash reporting, or advertising identifiers.
- No remote code is loaded; all code ships inside the extension package.
- No external translation service is used: the English and Japanese UI strings
  are bundled with the extension (`_locales`).

## Permissions and why they are needed

| Permission | Reason |
| --- | --- |
| `storage` | Save your sort/filter settings and, if you opt in, the token |
| `https://api.github.com/*` | Fetch the repository list from GitHub's API |
| Content script on `https://github.com/*` | Add sort options to the repository page and render the list |

The extension requests no other host permissions and no `tabs`, `cookies`,
`history`, or `webRequest` access.

## Removing your data

- Remove the token: options page → "トークンを解除". This deletes both the
  session and the persistent copy.
- Clear the in-memory cache: options page → "キャッシュを消去".
- Remove everything: uninstall the extension from `chrome://extensions`. Chrome
  deletes its `chrome.storage` data with it.

## Changes

Material changes to this policy will be noted in the repository's release notes
and in this file's "Last updated" date.

## Contact

Open an issue at <https://github.com/tonbiattack/github-repo-sorter/issues>.
