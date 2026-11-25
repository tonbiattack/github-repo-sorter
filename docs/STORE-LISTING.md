# Chrome Web Store 掲載情報

ストア提出用の文案と画像の要件をまとめたもの。実際の提出・公開は所有者の承認後に行う。

最終更新: 2026-11-25（公式要件の確認日: 2026-11-25）

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
| スクリーンショット | 1280×800 または 640×400、正方形の角、パディングなし | `docs/screenshots/store-1280x800-light.png` / `-dark.png`（1280×800 を検証済み） |
| プロモ画像（小） | 440×280 | 未作成（任意） |
| プロモ画像（大） | 1400×560 | 未作成（任意） |

スクリーンショットには公開リポジトリのみを写すこと。非公開リポジトリ名・
トークン・アカウント固有の情報を含めない。`GRS_STORE_SHOTS=1 npm run check:browser`
で 1280×800 の画像を再生成できる（認証付き実行時は保存しない）。

## 公式要件の確認記録（2026-11-25 確認）

| 項目 | 要件 | 根拠 URL |
| --- | --- | --- |
| アイコン | 128×128 PNG。実体は 96×96、残りは透明余白。ライト/ダーク両対応。ドロップシャドウを避ける | <https://developer.chrome.com/docs/webstore/images#icons> |
| スクリーンショット | 1280×800 または 640×400、正方形の角、パディングなし、最低 1 枚・最大 5 枚 | <https://developer.chrome.com/docs/webstore/images#screenshots> |
| プロモ画像 | small 440×280、marquee 1400×560（いずれも任意） | <https://developer.chrome.com/docs/webstore/images#promo> |
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

## ライセンス

未決定。所有者の承認なしに付与しない。候補と依存の整理:

| 候補 | 特徴 | 注意 |
| --- | --- | --- |
| MIT | 最短・寛容。拡張公開の一般的な選択 | 無保証の明示が必要 |
| Apache-2.0 | 特許条項と変更表示を含む | NOTICE の運用が必要 |
| ISC | MIT とほぼ同等でより短い | 認知度は MIT より低い |

依存ライセンス:

- 実行時に同梱される第三者コードは **なし**（`dist/` は自前コードのみ）。
- 開発依存（`esbuild` / `typescript` / `vitest` / `jsdom` / `@types/*`）は
  ビルド時のみ使用し、配布 ZIP には含まれない。各ライセンスは
  MIT または Apache-2.0 系で、いずれも再配布時の制約は緩い。
- 採択時は `LICENSE` ファイルを追加し、README と `package.json` の
  `license` フィールドを同時に更新する。

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

- 収集するデータ: なし（外部送信なし）
- 認証情報: 任意のアクセストークンを利用者のブラウザ内にのみ保存
- 第三者への販売・転送: なし
- 広告目的の利用: なし
- リモートコード: なし

## プライバシーポリシー URL

`docs/PRIVACY.md` を公開リポジトリの URL で参照する
（例: `https://github.com/tonbiattack/github-repo-sorter/blob/main/docs/PRIVACY.md`）。

## 提出前チェックリスト

- [x] `npm run release` で `release/github-repo-sorter-<version>.zip` を生成
- [x] ZIP に `manifest.json` がルートにあることを確認
- [x] 不要ファイル（`node_modules`、`src`、テスト、スクリーンショット）が入っていないことを確認
- [x] `manifest.json` の `version` を更新（0.2.0）
- [x] アイコンを 128×128（実体 96×96）で用意
- [x] スクリーンショットを 1280×800 で用意（公開データのみ）
- [x] GitHub の About（Description / Topics）を設定
- [ ] プライバシーポリシー URL が公開されていることを確認
- [ ] 掲載文の英語・日本語を最終確認
- [ ] 所有者の承認を得てからアップロード

## 未解決事項

- ライセンスは未決定（所有者の承認が必要）。依存はすべて devDependencies で、
  実行時に同梱される第三者コードはない。
- プロモ画像（440×280 / 1400×560）は未作成。任意だが、マーキー枠への掲載には必要。
- プライバシーポリシーはリポジトリ内の `docs/PRIVACY.md` にあり、ストアには
  その公開 URL を登録する。
- ストアの審査要件は変更されることがある。提出時に最新の公式要件を再確認する。
