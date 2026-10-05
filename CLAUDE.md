# calendar-sync — Claude Code 向けエージェント指示書

## このリポジトリの目的

複数のGoogleアカウント（2つ以上、上限なし）のカレンダーを相互に同期するGoogle Apps Script (GAS) テンプレート。各アカウントに1つずつGASプロジェクトを設置し、他アカウントの予定を「詳細層（専用同期カレンダー・非公開）」と「ブロック層（自分のプライマリに『予定あり』・非公開にしない）」の2箇所へ書き込む。設計・トラブルシュートの詳細は `README.md` を参照。

## セットアップを依頼されたときの手順

ユーザーから「カレンダー同期をセットアップして」等の依頼があった場合、以下の順で進める。

### 1. ユーザーへの質問

以下を確認する（複数質問はまとめて一度に聞いてよい）:

1. 同期したいアカウント数と、それぞれのメールアドレス
2. 各アカウントが Google Workspace（業務用）か、個人の Gmail か
   - Workspace → `filterWorkspaceStyle: true` にし、Advanced API 経由で読み込む（eventType・declined・除外タイトルのフィルタが効く）
   - 個人Gmail → `filterWorkspaceStyle: false`（フィルタなしでそのまま転記）
3. プライマリ以外に読み取りたいカレンダーがあるか（あれば、そのカレンダーID）
4. 転記を除外したいタイトルがあるか（既定は除外なし。他のカレンダー同期ツールと併用している場合は、そのツールが書くタイトルを入れるよう勧める）

### 2. 各アカウント用ファイルの生成

`local/<アカウント識別名>/Code.gs` と `appsscript.json` を、アカウント数ぶん生成する。

- `template/Code.gs` の **`==== COMMON ENGINE ====` 以降のエンジン部分は一切改変せず、そのままコピーする**
- `SOURCES` 配列だけを、「そのアカウント以外の全アカウント」で埋める（自分自身は含めない）
- 色（`CalendarApp.EventColor`）はアカウントごとに固定で割り当てる。例: `PALE_GREEN` / `YELLOW` / `MAUVE` / `CYAN` など、アカウントが増えても衝突しないように選ぶ
- `appsscript.json` は `template/appsscript.json` をそのままコピーする（Workspace / 個人を問わず、いずれかのソースで `filterWorkspaceStyle: true` を使うなら Advanced Service の有効化が必要）
- 生成したファイルは `local/`（gitignore済み）配下にのみ置く。他のパスに実メールアドレス・実カレンダーIDを書き込まない

### 3. カレンダー共有の案内

ユーザーのアカウント名を使って、相互に「予定の表示（すべての予定の詳細）」で共有する手順を具体的に列挙する（README.md の「A. カレンダー共有」参照）。Workspace アカウントで共有オプションがグレーアウトする場合は管理者への依頼が必要になる旨も伝える。

### 4. GASへの設置案内

README.md の「B. 各アカウントへのスクリプト設置」の手順（`template/Code.gs` を貼る → SOURCES を埋める → appsscript.json 反映 → `syncCalendar` 実行 → `installTrigger` 実行）を案内する。

## 絶対に守るべきルール

- **エンジン部分の完全同一性**: `==== COMMON ENGINE ====` 以降は全アカウントのファイルで完全同一に保つ。変更が必要な場合は全ファイルに同じ差分を適用し、`diff` で一致を検証してから完了とする
- **ブロック層の visibility を PRIVATE に変えない**: `MODE_PLACEHOLDER` の `visibility` は必ず `CalendarApp.Visibility.DEFAULT`。非公開にすると他アカウントがマーカーを読めなくなり、無限エコーが再発する
- **`GLOBAL_SYNC_MARKER`（`[calsync:`）除外フィルタを外さない**: 全ての読込経路（`loadViaAdvancedApi` / `loadViaCalendarApp`）で適用されている必要がある
- **実メールアドレス・実カレンダーIDは `local/` 以外に書かない**: `local/` は `.gitignore` 済み。コミット前に `git status` / `git diff` で機密情報が混入していないか必ず確認する
- **全アカウントのスクリプトは同時に導入・更新する**: マーカー除外のない旧版が一部アカウントに残っているとエコーが発生する
- **Workspace アカウントは詳細共有の確認後にソースへ追加する**: 「すべての予定の詳細」共有が有効になっていることを確認してから、そのアカウントを他アカウントの `SOURCES` に加える。時間枠のみの共有だとマーカーが読めずエコーのリスクがある
- **中継モードのタグプレフィックス `[calrelay:` を `[calsync:` に変えてはならない**（逆も同様）: `[calrelay:` は他アカウントの `GLOBAL_SYNC_MARKER`（`[calsync:`）除外に引っかからないことで、中継カレンダーがソースとして正しく読まれる設計になっている。`[calrelay:` を `[calsync:` に変えると、中継予定ごと他アカウントのマーカー除外で弾かれ、同期が全停止する。逆に通常タグ（詳細層・ブロック層）を `[calrelay:` にしてもエコー防止が効かなくなるため変えてはならない
