# Chrome Web Store 掲載情報

ストア提出用の文案と画像の要件をまとめたもの。実際の提出・公開は所有者の承認後に行う。

最終更新: 2026-11-28（公式要件の確認日: 2026-11-25）

## 名称

- 表示名（英語）: `GitHub Repo Sorter`
- 表示名（日本語）: `GitHub Repo Sorter`
- 補足: 名前に "GitHub" を含むが、GitHub 公式ではないことを説明文と README で明示する。

## 短い説明（132 文字以内）

英語（推奨）:

```
Sort GitHub repositories by recent activity — creation, forks, and pushes — right in GitHub's own list.
```

日本語:

```
GitHub のリポジトリ一覧を、作成・Fork・Push を統合した最近の活動順に並べ替えます。
```

## 詳細説明

英語:

```
GitHub Repo Sorter adds sort options to the repository list on a GitHub profile page.

GitHub's own Sort menu only offers Last updated, Name, and Stars. This extension
adds orders that treat creating, forking, and pushing as the same kind of
activity, so the repository you touched most recently is easy to find.

What it adds
- Sort by integrated activity: max(created_at, pushed_at)
- Sort by creation, fork date, push date, or metadata update
- Works with GitHub's own search box, Type, Language, and Visibility menus
- Filters and search apply to every fetched page before the list is paginated
- Follows GitHub's light and dark themes

How it works
- The extension reads the repository list from GitHub's REST API, so sorting
  covers all of your repositories, not just the 30 rows on the current page.
- It adds its options to GitHub's existing Sort menu and shows its own list in
  place of GitHub's, leaving the search box and filters in place.
- Choosing a standard GitHub sort restores GitHub's own list immediately.

Privacy
- Talks only to api.github.com. No analytics, no third-party servers.
- Repository data is cached in memory for 5 minutes and never written to disk.
- An access token is optional and only needed to include private repositories.
  By default it is kept for the browser session only.

This is an unofficial extension and is not affiliated with GitHub, Inc.
```

日本語:

```
GitHub のプロフィールのリポジトリ一覧に、並び替えの選択肢を追加します。

GitHub 標準の Sort は「Last updated / Name / Stars」のみです。この拡張は
「作成・Fork・Push を同じ活動として扱う」並び順を追加し、最近触った
リポジトリをすぐ見つけられるようにします。

追加される機能
- 統合活動順（max(created_at, pushed_at)）
- 作成順 / Fork順 / Push順 / 情報更新順
- GitHub 標準の検索欄・Type・Language・Visibility と併用
- 検索・絞り込みは全取得ページに適用してからページ分割
- ライト / ダークテーマに追従

仕組み
- GitHub REST API から一覧を取得するため、現在のページの 30 件だけでなく
  全リポジトリを対象に並び替えます。
- GitHub 標準の Sort メニューに項目を追加し、一覧部分だけを差し替えます。
  検索欄やフィルタはそのまま使えます。
- GitHub 標準の Sort を選ぶと、元の一覧にすぐ戻ります。

プライバシー
- 通信先は api.github.com のみ。分析・第三者サーバーへの送信はありません。
- リポジトリ情報はメモリに 5 分間キャッシュするだけで、ディスクに保存しません。
- アクセストークンは任意で、非公開リポジトリを含める場合のみ必要です。
  既定ではブラウザのセッション中のみ保持します。

本拡張は非公式であり、GitHub, Inc. とは関係ありません。
```

## カテゴリ

- 第一候補: `Developer Tools`
- 代替: `Productivity`

## 言語

- 英語（主）、日本語（副）

## 画像

| 種類 | 要件 | 状態 |
| --- | --- | --- |
| ストアアイコン | 128×128 PNG（実体 96×96＋16px の透明余白） | `icons/icon-128.png`（生成済み、実体 96×96・余白 16px を検証済み） |
| スクリーンショット（英語） | 1280×800 または 640×400、正方形の角、パディングなし | `docs/screenshots/store-1280x800-light.png` / `-dark.png`（1280×800 を検証済み） |
| スクリーンショット（日本語） | 同上 | `docs/screenshots/store-1280x800-ja-light.png` / `-dark.png` |
| プロモ画像（小） | 440×280 | 未作成（任意） |
| プロモ画像（大） | 1400×560 | 未作成（任意） |

スクリーンショットには公開リポジトリのみを写すこと。非公開リポジトリ名・
トークン・アカウント固有の情報を含めない。`GRS_STORE_SHOTS=1 npm run check:browser`
で英語の 1280×800 画像を、`node scripts/browser-check.mjs --lang ja --probe` と
`GRS_STORE_SHOTS=1` の組み合わせで日本語画像を再生成できる（認証付き実行時は保存しない）。

## 公式要件の確認記録（2026-11-25 確認）

| 項目 | 要件 | 根拠 URL |
| --- | --- | --- |
| アイコン | 128×128 PNG。実体は 96×96、残りは透明余白。ライト/ダーク両対応。ドロップシャドウを避ける | <https://developer.chrome.com/docs/webstore/images#icons> |
| スクリーンショット | 1280×800 または 640×400、正方形の角、パディングなし、最低 1 枚・最大 5 枚 | <https://developer.chrome.com/docs/webstore/images#screenshots> |
| プロモ画像 | small 440×280、marquee 1400×560。**ストアアイコンとスクリーンショット 1 枚以上が必須で、プロモ画像は任意** | <https://developer.chrome.com/docs/webstore/images> |
| 権限 | 機能に必要な最小の権限のみ。将来のための先行取得は不可 | <https://developer.chrome.com/docs/webstore/program-policies/permissions> |
| プライバシー | プライバシーポリシーの提示とデータ取扱いの申告 | <https://developer.chrome.com/docs/webstore/program-policies/privacy> |
| 単一目的 | 1 つの目的に限定した機能であること | <https://developer.chrome.com/docs/webstore/program-policies/> |

本拡張の適合状況:

- 権限は `storage` と `https://api.github.com/*` のみで、`tabs` / `cookies` /
  `history` / `webRequest` を要求しない。最小権限の原則に沿う。
- リモートコードを読み込まない（MV3 の CSP 既定に準拠、外部スクリプトなし）。
- データは外部送信せず、プライバシーポリシーと実装が一致している。
- 単一目的は「GitHub のリポジトリ一覧を最近の活動順に並べ替える」こと。
- GitHub 公式と誤認されないよう、README・説明文に非公式である旨を明記。
- 多言語対応は Chrome 標準の `_locales` で行い、外部翻訳サービスを使わない。

## データ取扱いの申告案（#19 で再検討）

「外部サーバーに送らないから申告不要」とはせず、**処理・保存するデータ**を
公式のデータ種別に沿って整理する。拡張は開発者のサーバーを持たず、送信は
`api.github.com` 宛てのみ。

| データ種別 | 本拡張の扱い | 端末外への送信 | 保存 |
| --- | --- | --- | --- |
| 認証情報（アクセストークン） | 利用者が任意で設定。GitHub API への `Authorization` ヘッダにのみ使用 | なし（`api.github.com` 以外へ送らない） | 既定はセッション領域、オプトイン時のみディスク（平文） |
| アカウント情報（login / id） | トークンの所有者確認と表示に使用 | なし | メモリ（最大 5 分） |
| 非公開リポジトリの情報 | 一覧表示に使用。永続キャッシュしない | なし | メモリのみ（5 分、認証コンテキスト別） |
| Web サイトのコンテンツ（公開リポジトリ情報） | 並び替え・表示に使用 | なし | メモリのみ（5 分） |
| ユーザー設定（並び順・絞り込み） | owner 単位で保存 | なし | `chrome.storage.local` |
| 閲覧履歴・位置情報・健康情報・財務情報 | 取得しない | なし | 保存しない |
| 分析・テレメトリ・広告 ID | 取得しない | なし | 保存しない |

ストアのデータ使用フォームでは、少なくとも次を「収集・保存する」として扱う
必要がある（実装と一致させる）:

- **認証情報**: トークンを任意で保存する。販売・第三者提供・広告目的利用は
  「しない」。利用目的は「拡張機能の提供（非公開リポジトリの表示）」。
- **ユーザー設定**: 並び順・絞り込みの保存。同上。

「収集」の定義は開発者のサーバーへの送信に限らないため、ブラウザ内保存も
プライバシーポリシーに明記する（[PRIVACY.md](PRIVACY.md) に記載済み）。

## ライセンス（MIT で確定、2026-11-25）

**MIT ライセンスを採用する**（所有者の承認済み）。`LICENSE` を追加し、
`package.json` の `license` フィールドと README を更新した。

| 候補 | 適合 | 採用 |
| --- | --- | --- |
| **MIT** | 拡張公開で一般的。依存（MIT / Apache-2.0）と矛盾しない | **採用** |
| Apache-2.0 | 特許条項と変更表示を含む | 不採用 |
| ISC | MIT とほぼ同等でより短い | 不採用 |

- ストア公開に OSS ライセンスは必須ではないが、利用者への権利付与を明確にするため MIT を付与する。
- 著作権者: `tonbiattack`、年: 2026。
- 依存ライセンス（2026-11-25 確認）: `esbuild` MIT、`typescript` Apache-2.0、
  `vitest` MIT、`jsdom` MIT、`@types/chrome` MIT、`@types/node` MIT。いずれも
  devDependencies で、配布 ZIP に同梱されない。実行時に同梱される第三者コードは
  ないため、追加の NOTICE は不要。
- `package.json` は `private: true` のまま（誤った npm publish を防ぐため）。
  これは MIT ライセンスと両立する。

## 秘密情報・個人情報の確認（2026-11-25）

- 追跡ファイル 59 件、コミット 8 件を対象に、`ghp_` / `github_pat_` / `gho_` /
  `sk-` / `AKIA` / 秘密鍵ヘッダのパターンを検索。**該当 0 件**。
- `.env` / `secret` / `credential` / `.pem` / `.key` 等のファイル名は無し。
- 追跡ファイルに `C:\Users\<name>` 形式の個人パスは無し。
- スクリーンショットは公開リポジトリのみで、トークン・非公開データを写していない。
- 値を露出させないよう、スキャン結果は件数のみを記録する。

## GitHub リポジトリの About（2026-11-25 設定済み）

- Description: `Sort GitHub repositories by recent activity, including creation, forks, and pushes, directly in GitHub.`
- Topics: `browser-extension`, `chrome`, `chrome-extension`, `github`,
  `github-api`, `manifest-v3`, `productivity`, `typescript`
- Website: 未設定（ストア URL が公開されるまで載せない）
- License: 未設定（所有者の承認後）


## 単一目的の説明（Single purpose）

```
Reorders the repository list on a GitHub profile page by recent activity,
treating creation, forks, and pushes as the same kind of activity.
```

## 権限の理由（Permission justification）

| 権限 | 理由 |
| --- | --- |
| `storage` | 並び順・絞り込み設定の保存と、任意のアクセストークン保存 |
| `host_permissions: https://api.github.com/*` | リポジトリ一覧の取得 |
| content script `https://github.com/*` | リポジトリ一覧ページへの並び替え項目の追加と一覧描画 |

`tabs` / `cookies` / `history` / `webRequest` は要求しない。

## データ使用の申告（Data usage）

申告フォームの各データ種別に対する回答案（実装と一致させる）:

| 種別 | 取得 | 送信 | 保存 | 目的 |
| --- | --- | --- | --- | --- |
| 認証情報 | 利用者が設定したトークンのみ | `api.github.com` 以外へ送らない | セッション（既定）／ローカル（オプトイン） | 非公開リポジトリの表示 |
| 個人を特定できる情報 | 取得しない（login は表示のみ、保存はメモリ 5 分） | なし | メモリのみ | 認証アカウントの確認 |
| Web サイトのコンテンツ | 公開リポジトリのメタデータ | なし | メモリのみ（5 分） | 並び替えと表示 |
| ユーザーの活動 | 並び順・絞り込みの設定 | なし | `chrome.storage.local` | 設定の復元 |
| 閲覧履歴・位置情報・健康・財務・通信 | 取得しない | なし | 保存しない | — |
| 分析・テレメトリ・広告 | 取得しない | なし | 保存しない | — |

共通の回答:

- 第三者への販売・転送: なし
- 信用調査・融資目的の利用: なし
- 広告目的の利用: なし
- リモートコード: なし（MV3 の CSP 既定に準拠）
- データはすべて利用者のブラウザ内で処理し、開発者のサーバーは存在しない

補足: トークンは利用者が明示的に設定した場合のみ扱う。未設定なら公開一覧のみを
取得し、認証情報は一切保存しない。

## プライバシーポリシー URL

`docs/PRIVACY.md` を公開リポジトリの URL で参照する
（例: `https://github.com/tonbiattack/github-repo-sorter/blob/main/docs/PRIVACY.md`）。
リポジトリは公開済みのため、この URL は現在も閲覧可能。

## 提出前チェックリスト（#19）

### 素材

- [x] アイコン 128×128（実体 96×96＋16px 余白）を生成・検証
- [x] スクリーンショット 1280×800（英語・日本語、ライト/ダーク）
- [x] 掲載文案（英語・日本語）、単一目的、権限理由、データ申告案
- [x] プライバシーポリシー（実装と一致、公開 URL あり）
- [x] プロモ画像は任意であることを確認（未作成でも提出可能）
- [x] MIT ライセンスを付与（`LICENSE` / `package.json` / README）

### ビルド・配布

- [x] `npm run release` で `release/github-repo-sorter-<version>.zip` を生成
- [x] ZIP 直下に `manifest.json`
- [x] `_locales/en` / `_locales/ja` とアイコン 4 サイズを同梱
- [x] 実行時不要なファイル（`src`、テスト、スクリーンショット、`node_modules`）が無い
- [x] `manifest.json` の `version` と `package.json` が一致（0.3.1）
- [x] `default_locale: en` と `__MSG_*__` が解決されることを実ブラウザで確認

### 審査リスク

- [x] 単一目的・最小権限・リモートコードなしを確認
- [x] 非公式であることを README と説明文に明記
- [x] 秘密情報・個人情報のスキャン（該当 0 件、件数のみ記録）
- [x] 英語・日本語・未対応言語（英語へフォールバック）で UI を確認

### 所有者が行う操作

- [x] ライセンスの採択（MIT で確定）
- [x] ストアの掲載文・画像の最終確認（2026-11-25）
- [x] ストアへのアップロード・審査提出・公開（0.3.0、2026-11-25）
- [x] 公開後のストア URL を README と About に追記（2026-11-28）

## 更新 0.3.1（2026-11-28）

- 対象: `release/github-repo-sorter-0.3.1.zip`
- 内容: GitHub のタブ切替（Turbo）後に「送信元のページを検証できませんでした」となり、再取得も失敗する問題の修正（#22）。権限・データ申告・プライバシーポリシーに変更なし。
- ストア URL: <https://chromewebstore.google.com/detail/github-repo-sorter/kdfckoloaojcpjpabbcjlbiekiafdmom>

「What's new」欄の文案:

日本語:

```
GitHub のタブ移動や Fork のあとに「送信元のページを検証できませんでした」と表示され、再取得も失敗する問題を修正しました。
```

英語:

```
Fixed an error after GitHub's in-page tab navigation or a fork: "Could not verify the page that sent the request", including the Retry button.
```

## 未解決事項

- プロモ画像（440×280 / 1400×560）は未作成。任意だが、マーキー枠への掲載には必要。
- プライバシーポリシーはリポジトリ内の `docs/PRIVACY.md` にあり、ストアには
  その公開 URL を登録する。
- ストアの審査要件は変更されることがある。提出時に最新の公式要件を再確認する。
- 実際の提出・公開、リポジトリの公開範囲変更は所有者の明示承認後に行う。
