# 実装メモ — 仕様との差異・判断・検証

対象仕様: [SPEC.md](SPEC.md)（v0.2）
対象 Issue: #1〜#6、#10（#7 Chrome Web Store 公開準備は対象外）

## Issue #10: GitHub 標準UIへの統合

ユーザープロフィールの実DOMでは、検索フォーム `data-autosearch-results-container="user-repositories-list"` 内に `#type-options`、`#sort-options .SelectMenu-list` があり、一覧・GitHubのページャは兄弟の `#user-repositories-list` に収まっていた。Sort メニュー内にフォーム送信しない button を追加し、独自一覧の表示中だけ一覧要素を非表示にする。検索欄、Type、Sort、New 等の標準DOMは維持する。既知のDOMが揃わなければ推測せず標準表示のままにする。

- 独自ソート中の Type は All / Forks / Sources に対応。Archived 等、Language、Visibility は GitHub 標準表示に切り替える。その他標準操作（Star ボタン、グラフ、Fork 元リンク）は独自一覧には再現せず、標準Sortの選択で使える。
- GitHub の検索欄は拡張一覧表示中のみ名前・説明の AND 検索として扱う。ロード中・エラー時は GitHub のイベントを妨げない。
- GitHub 標準 Sort の明示的な選択と独自ソート設定は owner 単位で保存する。GitHub 標準フィルタが URL で明示されている場合、その操作を尊重し標準一覧で開始する。
- 言語、Star数、Fork数はAPIから得られた場合のみ表示し、不明な値・未提供の操作を偽装しない。
- 以下の表・検証記録は Issue #10 より前の MVP の履歴。パネル、組織対応、設定保存等に関してはこの節と v0.2 を優先する。
- 変更前スクリーンショット: [ライト](screenshots/issue-10-before-light.png) / [ダーク](screenshots/issue-10-before-dark.png)。
- 変更後スクリーンショット: [ライト](screenshots/issue-10-after-light.png) / [ダーク](screenshots/issue-10-after-dark.png)。
- 2026-11-25 の Chromium 159 実ブラウザ検証（公開 316 件）: 全件順、ページング、Sort・Type の実クリック、検索、リロード、Turbo 相当のDOM差し替え、標準Sort復帰、ライト/ダークを確認。
- 同検証（認証済み 699 件）: 全件順、owner不一致エラー、認証解除を確認。トークン解除後は未認証APIのレート制限で標準一覧にフォールバックした。非公開情報を含む認証済みスクリーンショットは保存しない。
- Sort/Type ボタンには GitHub 自身が選択値を表示しない（`d-none`）ため、ボタンを広げる独自表示はせず、現在の並び順はステータス行に表示する。

## 仕様との差異・明示した判断

| # | 項目 | 仕様 | 実装 | 理由 |
| --- | --- | --- | --- | --- |
| 1 | 標準表示への復帰 | 「標準表示に切替」「標準表示への復帰」 | パネルは残し、GitHub 標準の一覧だけを再表示する。パネルには「拡張ソートに戻す」を残す | 完全に消すと戻る導線が失われるため。GitHub の DOM は削除せず `data-grs-hidden` 属性で CSS 非表示にしている |
| 2 | 検索 | 「名前・説明の部分一致」 | 空白区切りの複数語は AND。対象は名前と説明のみ（owner 名は含めない） | 「api client」のような入力を直感的に扱うため。owner を含めると全件一致に近づき使いにくい |
| 3 | Fork順 | 「Fork順（Forkのみ）」 | Fork順は Fork の `created_at` 降順、非 Fork は末尾。絞り込み（全件/Fork/非Fork）とは独立 | 「Forkのみ」を絞り込みと二重に強制すると、ユーザーの選択を上書きするため |
| 4 | 設定の保存 | owner 単位で保存 | 並び順と絞り込みを保存。検索語・ページ番号・標準表示状態は保存しない | 一時的な状態を復元すると、再訪時に「なぜか絞り込まれている」混乱を招くため |
| 5 | 組織ページ | 「初期対象は github.com/{owner}?tab=repositories」（組織は将来対応） | 同じ URL 形式なので `#org-repositories` も対象にした（DOM 構造は確認済み、実ブラウザ検証は未実施） | 追加コストが小さく、同じ操作で使えるため |
| 6 | 認証の扱い | 「認証なしの公開一覧を初期 MVP とし、非公開は別 Issue」 | Issue #5 として実装済み。トークン設定時は自動的に認証済み一覧、未設定なら公開一覧 | 実装範囲の統合 |
| 7 | 認証失敗時 | 「公開一覧への黙った切替で隠さない」 | エラーを表示し、「公開一覧として取得」を明示的に押したときだけ公開へ切替 | 意図どおり |
| 8 | 部分取得 | 「部分データは全件と誤認させない」 | 1ページ目の失敗はエラー画面。2ページ目以降の失敗は取得済み行を表示し、警告バナーと「一部のみ」を表示。部分データはキャッシュしない | 全件と誤認させない一方で、取得済みデータは捨てない |
| 9 | ページ上限 | 明記なし | 100ページ（1万件）で打ち切り、部分取得として表示 | 無限ループ・過剰取得の防止 |
| 10 | レート制限 | Retry-After / リセット時刻への対応 | `Retry-After` または `X-RateLimit-Reset` を尊重。待ち時間が60秒以内なら再試行し、それ以上はリセット時刻を添えてエラー表示 | 長時間のブロックを避けつつ、短時間の制限は自動回復する |
| 11 | キャッシュ | 5分TTLのメモリキャッシュを owner・認証コンテキスト別 | `public:{owner}` / `auth:{login}:{owner}` のキーで分離。手動更新で該当キーを無効化。認証変更で全消去 | アカウント混入の防止 |
| 12 | トークン保存 | 「原則セッション保存」 | `chrome.storage.session`（`TRUSTED_CONTEXTS`）。content script には渡さない | ブラウザ終了で消え、ページから読めない |
| 13 | 重複取得の抑止 | 明記なし | 同一キャッシュキーの同時リクエストは進行中の Promise を共有（強制更新時を除く） | 連打時のAPI消費を抑える |
| 14 | 取得失敗時の標準一覧 | 「失敗時に戻せる」 | 初回取得中・失敗時は GitHub 標準一覧を表示したまま。データ取得後に拡張一覧へ切り替える | 真っ白な画面を避ける |

## 仕様で「実データで確認する」とされた点

- **Fork 日時**: REST API の Fork リポジトリは `created_at` が Fork 作成時刻、`pushed_at` は上流由来の過去日時になり得る。
  実データ（`tonbiattack/balatro-ai` など）で `created_at` が新しく `pushed_at` が古いことを確認した。
  そのため統合日時 `max(created_at, pushed_at)` で Fork が上位に来る。
- **公開一覧のリダイレクト**: `GET /users/{owner}/repos?type=owner` は `GET /user/{id}/repos?...` へリダイレクトされる。
  `Link` ヘッダの `next` をそのまま辿るため、このリダイレクトでも全ページ取得できる。
- **認証済み一覧**: `GET /user/repos?affiliation=owner&visibility=all` が本人所有のリポジトリ（非公開含む）を返すことを確認した。
  認証なしの 316 件に対し、認証ありでは 699 件（非公開 383 件）を取得できた。

## セキュリティ上の判断

- メッセージは `channel` 定数を持たないものを無視。`type` ごとにフィールドを検証し、新しいオブジェクトを組み立て直す。
- 送信元は `sender.url` が `https://github.com/{owner}?tab=repositories` と一致し、`frameId === 0` の場合のみ許可。
  オーナー名はリクエストとページの双方で照合する。
- 認証操作（`auth-set` / `auth-clear` / `cache-clear` / `auth-status`）は拡張ページからのみ許可。
- API の `next` URL は `api.github.com` と同一オリジンのみ追跡。それ以外は取得を停止して部分取得扱いにする。
- `html_url` が `https://github.com/` で始まらないオブジェクトは描画しない。
- 描画は `textContent` のみ。リポジトリ名・説明に HTML が含まれても解釈しない（テストあり）。
- ページへのトークン露出がないことを実ブラウザで確認（localStorage / sessionStorage に現れない）。

## 検証結果（2026-11-25）

### ユニットテスト

`npm test` — 120 テスト / 8 ファイル。

- ソート: 受入シナリオ（B, A, C）、欠損・同値・Fork順・各ソートモード、入力非破壊、500件 < 100ms
- フィルタ・ページング: 全件/Fork/非Fork、名前・説明の部分一致、AND、30件/ページ、範囲クランプ
- API: Link 追跡、ID 重複排除、101件以上での Fork 順位、部分取得、401/403/429/5xx、Retry-After、リセット時刻、中止、ページ上限、不正ホスト
- キャッシュ: TTL、キー分離、LRU 的追い出し
- 設定・トークン: owner 別保存、sanitize、セッション保存、解除
- プロトコル: URL 判定、owner 検証、メッセージ検証、進捗メッセージ検証
- メッセージ処理: 送信元検証、owner 照合、キャッシュ利用/強制更新、認証 owner 不一致、認証操作の権限、中止、部分取得の非キャッシュ
- 描画（jsdom）: パネル、行、バッジ、日時、ページャ、空・エラー・読込・部分取得、HTML 非解釈、標準表示、ネイティブ一覧の特定と非表示・復元

### 実ブラウザ検証

`npm run check:browser` — Chromium 159（headless）で `dist/` を読み込み、`https://github.com/tonbiattack?tab=repositories` を検証。

- 316 件・4 ページを取得し、Node 側で独立に計算した期待順と画面の 30 件が一致
- 2ページ目が 31–60 件、検索が全件に対して適用され、Fork順・標準表示・復帰が動作
- リロード後も owner 別設定が復元される
- ライト `rgb(255, 255, 255)` / ダーク `rgb(13, 17, 23)` でパネル背景が切り替わる
- 認証あり: 699 件（Private バッジあり）、解除後 316 件。トークンはページのストレージに現れない

### 未検証・制約

- 組織プロフィールの実ブラウザ検証（DOM 構造のみ確認）
- Edge での動作（Chromium ベースのため動作する見込みだが未確認）
- Chrome Web Store の審査要件・掲載情報・アイコン（Issue #7）
- 複数タブで同時に開いた場合の設定競合（owner 単位の保存が最後の操作で上書きされる）
- fine-grained トークンでの実取得（クラシックトークンの `repo` スコープで確認）

## 開発上の注意

- `src/shared/` は DOM と `chrome.*` に依存しない。テストはここを中心に書く。
- service worker は Chrome API を注入して組み立てる（`createMessageHandler`）。ロジックは `src/background/handler.ts` に集約。
- ブランド版 Chrome 137+ は `--load-extension` を無視するため、CLI での実ブラウザ検証は Playwright Chromium か Chrome for Testing を使う。
- 手動での拡張読み込み（`chrome://extensions`）はこの制限の対象外。
