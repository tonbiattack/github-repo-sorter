# Chrome Web Store 掲載情報

ストア提出用の文案と画像の要件をまとめたもの。実際の提出・公開は所有者の承認後に行う。

最終更新: 2026-11-25

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
| ストアアイコン | 128×128 PNG | `icons/icon-128.png`（生成済み） |
| スクリーンショット | 1280×800 または 640×400、最大 5 枚 | `docs/screenshots/issue-10-after-light.png` / `-dark.png` を 1280×800 に切り出して使用 |
| プロモ画像（小） | 440×280 | 任意。未作成 |
| プロモ画像（大） | 1400×560 | 任意。未作成 |

スクリーンショットには公開リポジトリのみを写すこと。非公開リポジトリ名・
トークン・アカウント固有の情報を含めない。

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

- [ ] `npm run release` で `release/github-repo-sorter-<version>.zip` を生成
- [ ] ZIP に `manifest.json` がルートにあることを確認
- [ ] 不要ファイル（`node_modules`、`src`、テスト、スクリーンショット）が入っていないことを確認
- [ ] `manifest.json` の `version` を更新
- [ ] スクリーンショットを 1280×800 で用意（公開データのみ）
- [ ] プライバシーポリシー URL が公開されていることを確認
- [ ] 掲載文の英語・日本語を最終確認
- [ ] 所有者の承認を得てからアップロード

## 未解決事項

- ライセンスは未決定（所有者の承認が必要）。依存はすべて devDependencies で、
  実行時に同梱される第三者コードはない。
- プロモ画像（440×280 / 1400×560）は未作成。
- ストアの審査要件は変更されることがある。提出時に最新の公式要件を確認する。
