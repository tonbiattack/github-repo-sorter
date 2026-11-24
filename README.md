# GitHub Repo Sorter

GitHub のリポジトリ一覧で「新規作成」「Fork」「Push」を同じ活動として扱い、
最近触ったリポジトリを素早く見つけられるようにする Chrome 拡張（Manifest V3）です。
ローカルサーバー不要、外部サーバーへの送信なしで動作します。

- 仕様書: [docs/SPEC.md](docs/SPEC.md)
- 実装メモ（仕様との差異・判断・検証結果）: [docs/IMPLEMENTATION-NOTES.md](docs/IMPLEMENTATION-NOTES.md)

## 主な機能

- GitHub 標準のリポジトリ一覧の上に、拡張専用の並び替えパネルを追加
- 並び替え: 作成・Fork・Push 統合順（初期値）、作成順、Fork順、Push順、情報更新順
- 絞り込み: 全件 / Forkのみ / 非Forkのみ、名前・説明の部分一致検索（空白区切りは AND）
- 検索・絞り込みは **全取得済みデータに適用してから** 30件ずつページ分割
- 各行に名前・リンク・説明・公開範囲（Public/Private）・Fork 表示・最新活動日時と種別を表示
- ライト / ダークモードは GitHub の CSS 変数に追従
- owner ごとに並び順・絞り込みを `chrome.storage.local` へ保存して復元
- 取得中・空・エラー・部分取得を明示。失敗時は GitHub 標準一覧に戻せる
- 任意で読み取り専用トークンを設定すると、自分の非公開リポジトリも一覧に含める

## 動作要件

- Chrome / Edge（Chromium 116 以上）。開発・検証は Chromium 159 で実施
- 権限: `storage` と `https://api.github.com/*` のみ

## セットアップ

```powershell
npm ci
npm run build
```

1. Chrome で `chrome://extensions` を開き「デベロッパーモード」を有効にする
2. 「パッケージ化されていない拡張機能を読み込む」で、このリポジトリの `dist/` を選択する
3. `https://github.com/<owner>?tab=repositories` を開く（例: `https://github.com/tonbiattack?tab=repositories`）

> `dist/` はビルド成果物です。ソースを変更したら `npm run build`（または `npm run watch`）で再生成し、
> `chrome://extensions` の再読み込みボタンを押してください。

## 使い方

- **並び替え**: パネル上部の「並び替え」で切り替えます。初期値は「作成・Fork・Push順」です。
- **対象**: 全件 / Forkのみ / 非Forkのみ。
- **検索**: 名前と説明の部分一致。複数語はすべて含むものに絞り込みます。
- **再取得**: 5分のメモリキャッシュを無視して取得し直します。
- **標準表示**: GitHub 標準の一覧に戻します。パネルは残るので「拡張ソートに戻す」で復帰できます。
- **取得時刻**: ステータス行に表示されます（キャッシュ時はその旨も表示）。

### 並び順の定義

- 統合活動日時 = `max(created_at, pushed_at)`
- Fork日時 = Fork 先リポジトリの `created_at`（GitHub API の実データで確認済み）
- `updated_at` は説明変更などを含むため統合順では使いません（「情報更新順」を選んだときだけ使用）
- 無効・欠損の日時は比較から除外し、全欠損は末尾
- 同値は `full_name` 昇順、最後に `id`
- 日時は UTC で比較し、表示はローカル時刻

## 非公開リポジトリ（任意）

1. GitHub の Settings → Developer settings で読み取り専用トークンを作成
   - クラシックトークン: `repo` スコープ
   - fine-grained トークン: 対象リポジトリの `Metadata: Read`
2. ツールバーの拡張アイコン、または `chrome://extensions` → 詳細 → 拡張機能のオプションを開く
3. トークンを入力して「保存して検証」を押す

トークンは `chrome.storage.session` にだけ保存し、content script には渡しません。
ブラウザを終了すると消えます。認証済みの一覧と公開一覧はキャッシュも分離しています。
認証に失敗しても勝手に公開一覧へ切り替えず、エラーと「公開一覧として取得」ボタンを表示します。

## 権限とプライバシー

- `permissions`: `storage` のみ
- `host_permissions`: `https://api.github.com/*` のみ
- content script: `https://github.com/*` に登録し、`/{owner}?tab=repositories` でのみ動作
- 通信先は `api.github.com` のみ。分析・外部サーバー送信・Cookie 流用は行いません
- リポジトリ一覧は service worker のメモリに5分間キャッシュするだけで、永続化しません
- HTML は `textContent` で描画し、API 由来の文字列を HTML として解釈しません

## 開発

| コマンド | 内容 |
| --- | --- |
| `npm run typecheck` | TypeScript の型検査 |
| `npm test` | Vitest（120 テスト） |
| `npm run build` | `dist/` に拡張をビルド |
| `npm run watch` | 変更を監視して再ビルド |
| `npm run verify` | 型検査 → テスト → ビルド |
| `npm run check:browser` | 実ブラウザで拡張を読み込み、DOM・ソート・ページ送り・検索・標準復帰・設定復元・ライト/ダークを検証 |

### 実ブラウザ検証について

`npm run check:browser` は Chrome DevTools Protocol で Chromium を操作します。
Chrome 137 以降のブランド版は `--load-extension` を無視するため、Playwright の Chromium か
Chrome for Testing が必要です。`CHROME_PATH` で実行ファイルを指定できます。

```powershell
# 例: Playwright の Chromium を使う
$env:CHROME_PATH = "$env:LOCALAPPDATA\ms-playwright\chromium-1255\chrome-win64\chrome.exe"
npm run check:browser -- --owner tonbiattack
```

検証結果（2026-11-25、Chromium 159 / headless）:

- 316 件・4 ページの実データで、独立実装した期待順と画面の並びが一致
- ページ送り（2ページ目 = 31–60件）、検索、Fork順、標準表示への復帰、リロード後の設定復元を確認
- ライト `rgb(255,255,255)` / ダーク `rgb(13,17,23)` でパネルの背景が切り替わることを確認
- 認証ありでは 699 件（非公開 383 件）を取得し、Private バッジを表示。トークン解除後は 316 件に戻る
- トークンがページの localStorage / sessionStorage に現れないことを確認

スクリーンショットは `dist/browser-check-light.png` と `dist/browser-check-dark.png` に出力されます。

### 構成

```
src/
  background/   service worker・メッセージ処理・保存領域
  content/      パネル挿入・描画・Turbo 遷移対応
  options/      トークン設定ページ
  shared/       API 取得・ソート・フィルタ・プロトコル・キャッシュ（DOM/Chrome 非依存）
tests/          ユニットテスト（jsdom による描画テストを含む）
docs/           仕様書・実装メモ
```

## 制約・既知の限界

- 対象は `github.com/{owner}?tab=repositories` のみ（ダッシュボードや検索結果は対象外）
- 組織プロフィールの一覧は DOM 構造を確認して対応済みだが、実ブラウザでの検証は未実施
- 最大 100 ページ（1万件）で打ち切り、部分取得として表示
- 5分のメモリキャッシュは service worker の停止で失われることがある（仕様どおり）
- 非公開リポジトリの取得はトークン設定時のみ。細かい権限要件は GitHub 側の仕様変更に依存
- アイコンは未設定。Chrome Web Store 公開準備（Issue #7）は対象外
- ライセンスは未定

## アンインストール

`chrome://extensions` でこの拡張を削除し、必要なら本リポジトリの `dist/` と `node_modules/` を削除します。
`chrome.storage` のデータは拡張の削除に伴って消えます。
