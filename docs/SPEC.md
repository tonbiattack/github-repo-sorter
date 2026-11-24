# GitHub Repo Sorter 仕様書 v0.1

## 目的
GitHubのリポジトリ一覧で、新規作成・Fork・Pushを同じ活動として扱い、最近触ったリポジトリを素早く見つける。独立した軽量Chrome拡張とし、ローカルサーバー不要。

## 対象
Chrome/Edge (Manifest V3)。初期対象は github.com/{owner}?tab=repositories。ログイン中の自分の非公開リポジトリも、明示的に認証した場合に対象とする。組織一覧・ダッシュボードは将来対応。

## 機能
- GitHub標準一覧に隣接する拡張専用ソートUI。「作成・Fork・Push順」を初期値とし、作成順、Fork順（Forkのみ）、Push順、情報更新順、標準表示に切替。
- 全件/Forkのみ/非Forkのみ、名前・説明の部分一致検索。検索・フィルタは全取得済みデータに適用してからページ分割（30件/ページ）。
- 各行に名前、リンク、説明、公開範囲、Fork表示、最新活動日時と種別を表示。GitHub標準の外観・ダークモードに馴染ませる。
- 設定を owner 単位で chrome.storage.local に保存。標準表示への復帰、手動再取得、取得時刻表示。
- 初回取得中・空・エラー・部分取得を明示。元のGitHub一覧は壊さず、失敗時に戻せる。

## ソート定義
REST API の created_at、pushed_at、updated_at、fork、id を使用。Fork日時はFork先の created_at とする。統合活動日時 = max(created_at, pushed_at)。updated_at は説明変更などを含むため統合には使わない。無効/欠損の日時は除外し、全欠損は末尾。同値は full_name の昇順、最後に id。日時はUTCで比較し表示はローカル時刻。Fork直後に pushed_at が過去でも created_at で上位に来る。pushed_at は本人のPushだけを保証しない（同期・他者によるPushも含み得る）。Fork日時とAPIの挙動は実データで確認する。

## API・取得
公開一覧は GET /users/{owner}/repos?type=owner&per_page=100、本人の非公開一覧は認証済み GET /user/repos?affiliation=owner&visibility=all&per_page=100 を使用し、owner を照合。Link の next を辿り全ページ取得後に統合ソートする。IDで重複排除。無限ループ防止、キャンセル、429/403のレート制限とRetry-After/リセット時刻への対応。部分データは全件と誤認させない。5分TTLのメモリキャッシュを owner・認証コンテキスト別に分離し、手動更新で無効化。非公開データは永続キャッシュしない。認証なしの公開一覧を初期MVPとし、本人の非公開一覧は別Issueで実装する。

## 構成・セキュリティ
TypeScript + MV3 content script + service worker + 素のDOM/CSSを初期案とする。github.com と api.github.com のみに権限を限定。通信はservice workerで行い、受信メッセージの送信元・owner・URLを検証。HTMLはtextContent等で安全に描画。外部サーバー・分析送信・GitHub Cookie流用・トークンのソース埋め込み禁止。非公開対応は利用者が設定する読み取り専用の最小権限PATを候補とし、実装前に対象APIの権限を確認。トークンはcontent scriptへ渡さず、原則セッション保存、解除時消去。認証失敗を公開一覧への黙った切替で隠さない。
GitHubのTurbo遷移やDOM差し替えを考慮し、冪等なUI挿入・解除と古い取得結果の破棄を実装する。

## 受入基準
- 昨日PushしたA、今日ForkしたB（元のPush日時は先月）、一昨日作成したCの順がB,A,Cになる（Cに新しいPushがない場合）。
- 101件以上でも後続ページの新規Forkが正しい順位に出る。
- 同一日時・欠損・空一覧・通信失敗・レート制限をテスト。
- リロード、画面遷移、設定復元、標準一覧復帰、ライト/ダークを確認。
- 非公開対応後は別ユーザーへの混入、認証解除後のデータ残留、トークン漏洩がない。
- 500件のローカルソートは通常PCで100ms以内を目標（通信時間除外）。

## 非対象
一括clone、Fork操作、リポジトリ変更、常駐サーバー、他者の活動の追跡。Chrome Web Store公開はMVP完成後に検討。
