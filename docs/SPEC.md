# GitHub Repo Sorter 仕様書 v0.4

## 目的
GitHubのリポジトリ一覧で、新規作成・Fork・Pushを同じ活動として扱い、最近触ったリポジトリを素早く見つける。独立した軽量Chrome拡張とし、ローカルサーバー不要。

## 対象
Chrome/Edge (Manifest V3)。初期対象は github.com/{owner}?tab=repositories。ログイン中の自分の非公開リポジトリも、明示的に認証した場合に対象とする。組織一覧・ダッシュボードは将来対応。

## 機能
- GitHub標準のSortメニューに「作成・Fork・Push順」（初期値）、作成順、Fork順、Push順、情報更新順を追加。GitHub標準Sort項目を選べば元の一覧に戻す。独自パネルや重複する検索・フィルタ欄は設置しない。独自ソート中はSortボタンに選択中の並び順をコンパクトに表示し、標準復帰時に元の表示へ戻す。
- 標準TypeのAll/Forks/Sources/Archived/Mirrors/Templates、標準Language、標準Visibility、標準検索欄の名前・説明の部分一致を全取得済みデータに適用してからページ分割（30件/ページ）。APIで再現できない条件（例: Can be sponsored）を選んだときは標準表示へ安全に戻す。
- APIから取得可能な名前、リンク、説明、言語（GitHubの言語色）、Star・Fork数、公開範囲、Fork/Archived/Template/Mirror表示、選択した日時を表示。取得できないGitHub標準操作（Starボタン、Fork元リンク、グラフ）は偽装せず、標準表示への切替を案内する。GitHub標準の外観・ダークモードに馴染ませる。
- 設定（ソート・Type・Language・Visibility・標準表示）を owner 単位で chrome.storage.local に保存。標準表示への復帰、手動再取得、取得時刻・公開/認証済みの範囲を表示。
- 初回取得中・空・エラー・部分取得を明示。元のGitHub一覧は壊さず、取得中・失敗時は標準一覧を利用可能にする。DOM構造が合わない場合は拡張を挿入せず標準表示とする。
- UIはChrome標準の i18n（`_locales/en`、`_locales/ja`、`default_locale: en`）でブラウザの表示言語に追従し、日本語以外は英語へフォールバックする。日時・数値は表示言語のロケールで整形し、ソート比較はUTCのまま変更しない。リポジトリ名・説明・ユーザー入力は翻訳しない。権限追加と外部翻訳サービスは使わない。
- ストア公開前はソースからの手動導入を案内し、公開後に正式なストアURLへ差し替える。未公開リンクやバッジは載せない。

## 認証・トークン保存
既定は chrome.storage.session（ブラウザ終了で消去）。利用者が明示的にオプトインした場合のみ chrome.storage.local にも保存し、平文保存のリスクを設定画面で説明する。両領域とも TRUSTED_CONTEXTS に制限し、content script へは渡さない。解除時は両方のコピーを削除する。推奨は fine-grained の Metadata: Read で、クラシック `repo` スコープを読み取り専用と表現しない。

## ソート定義
REST API の created_at、pushed_at、updated_at、fork、id を使用。Fork日時はFork先の created_at とする。統合活動日時 = max(created_at, pushed_at)。updated_at は説明変更などを含むため統合には使わない。無効/欠損の日時は除外し、全欠損は末尾。同値は full_name の昇順、最後に id。日時はUTCで比較し表示はローカル時刻。Fork直後に pushed_at が過去でも created_at で上位に来る。pushed_at は本人のPushだけを保証しない（同期・他者によるPushも含み得る）。Fork日時とAPIの挙動は実データで確認する。

## API・取得
公開一覧は GET /users/{owner}/repos?type=owner&per_page=100、本人の非公開一覧は認証済み GET /user/repos?affiliation=owner&visibility=all&per_page=100 を使用し、owner を照合。Link の next を辿り全ページ取得後に統合ソートする。IDで重複排除。無限ループ防止、キャンセル、429/403のレート制限とRetry-After/リセット時刻への対応。部分データは全件と誤認させない。5分TTLのメモリキャッシュを owner・認証コンテキスト別に分離し、手動更新で無効化。非公開データは永続キャッシュしない。

## 構成・セキュリティ
TypeScript + MV3 content script + service worker + 素のDOM/CSSを初期案とする。github.com と api.github.com のみに権限を限定。通信はservice workerで行い、受信メッセージの送信元・owner・URLを検証。HTMLはtextContent等で安全に描画。外部サーバー・分析送信・GitHub Cookie流用・トークンのソース埋め込み禁止。非公開対応は利用者が設定する読み取り専用の最小権限PATを候補とし、実装前に対象APIの権限を確認。トークンはcontent scriptへ渡さず、原則セッション保存、解除時消去。認証失敗を公開一覧への黙った切替で隠さない。
GitHubのTurbo遷移やDOM差し替えを考慮し、冪等なUI挿入・解除と古い取得結果の破棄を実装する。

## 配布
Chrome Web Store で公開できる状態を目標とする。アイコン、プライバシーポリシー、掲載文案、再現可能なビルドと配布ZIP生成を用意する。実際の提出・公開は所有者の承認後に行う。GitHub 公式と誤認されない表記にする。ライセンスは MIT とし、`LICENSE`・`package.json`・README を一致させる。

## 受入基準
- 昨日PushしたA、今日ForkしたB（元のPush日時は先月）、一昨日作成したCの順がB,A,Cになる（Cに新しいPushがない場合）。
- 101件以上でも後続ページの新規Forkが正しい順位に出る。
- 同一日時・欠損・空一覧・通信失敗・レート制限をテスト。
- リロード、画面遷移、設定復元、標準一覧復帰、ライト/ダークを確認。
- 非公開対応後は別ユーザーへの混入、認証解除後のデータ残留、トークン漏洩がない。
- 500件のローカルソートは通常PCで100ms以内を目標（通信時間除外）。
- 独自ソート中も検索・Type・Language・Visibilityが全件に対して機能し、未対応条件では標準表示へ戻る。
- 配布ZIPに実行時不要なファイルが含まれない。
- 英語・日本語・未対応言語の3通りでUIを確認し、英語UIに日本語固定文言が残らない。ZIPに `_locales` が含まれる。

## 非対象
一括clone、Fork操作、リポジトリ変更、常駐サーバー、他者の活動の追跡。Star操作に必要な書込権限の追加、非公開API・Cookie流用。
