# 手作業セットアップ手順（Claude Code なし・2アカウント版）

「会社のアカウント（Google Workspace）」と「個人の Gmail」の2つを同期する場合の手順です。
コードを書く必要はなく、コピー＆ペーストと、メールアドレスの書き換えだけで完了します。

3アカウント以上を同期したい場合や、途中でうまくいかない場合は、共有してくれた人に相談してください。

## 全体の流れ

| STEP | やること | どのアカウントで |
|---|---|---|
| 1 | カレンダーをお互いに共有する | 会社・Gmail の両方 |
| 2 | 会社アカウントにスクリプトを設置する | 会社 |
| 3 | Gmail アカウントにスクリプトを設置する | Gmail |
| 4 | 動作確認 | どちらでも |

以下、会社のメールアドレスを **会社アドレス**、Gmail のアドレスを **Gmailアドレス** と書きます。

---

## STEP 1：カレンダーをお互いに共有する

### 1-1. 会社のカレンダーを Gmail に共有する

1. 会社アカウントで https://calendar.google.com を開く
2. 左側の「マイカレンダー」にある自分の名前のカレンダーにマウスを乗せ、「︙」→「設定と共有」
3. 「特定のユーザーまたはグループと共有する」→「ユーザーやグループを追加」
4. **Gmailアドレス** を入力
5. 権限で **「予定の表示（すべての予定の詳細）」** を選んで「送信」

> 権限の選択肢がグレーになっていて選べない場合は、会社の管理者設定で制限されています。この状態では進められないので、共有してくれた人に連絡してください。

### 1-2. Gmail のカレンダーを会社アカウントに共有する

Gmail アカウントで同じ操作をします。入力するのは **会社アドレス**、権限は同じく「予定の表示（すべての予定の詳細）」です。

---

## STEP 2：会社アカウントにスクリプトを設置する

### 2-1. プロジェクトを作ってテンプレートを貼る

1. 会社アカウントで https://script.google.com を開く
2. 「新しいプロジェクト」をクリック
3. 左上の「無題のプロジェクト」をクリックし、名前を `calendar-sync` に変更
4. エディタに最初から入っている数行をすべて消し、[template/Code.gs](../template/Code.gs) の中身をすべて貼り付ける
   - GitHub の画面右上にある「Copy raw file」ボタン（四角が2つ重なったアイコン）を押すと、全文をコピーできます

### 2-2. 設定部分を書き換える

貼り付けたコードの先頭に、サンプルの設定が入っています。ここを自分用に置き換えます。

1. エディタで **1行目から、`// ==== COMMON ENGINE` と書かれた行の直前まで**（90行ほど）を選択する
   - 1行目の先頭をクリック → `// ==== COMMON ENGINE` の行の先頭を Shift を押しながらクリック、で選択できます
2. 選択した部分を、下のブロックで置き換える（貼り付ければ上書きされます）
3. `★Gmailアドレス★` を自分の Gmail アドレスに書き換える（`'` は消さない）

```javascript
// === 会社アカウントに設置する設定（Gmail の予定を読み込む） ===
const SOURCES = [
  {
    key: 'gmail',
    calendarIds: ['★Gmailアドレス★'],
    filterWorkspaceStyle: false,
    selfEmail: null,
    targetCalendarName: 'Gmail同期',
    color: CalendarApp.EventColor.YELLOW,
    tagVersion: 1,
    legacyTags: [],
    broadcastBusyOnPrimary: true,
    placeholderTagVersion: 1,
    legacyPlaceholderTags: [],
  },
];

const SELF_MIRROR = null;

```

書き換え後の例: `calendarIds: ['taro.yamada@gmail.com'],`

### 2-3. 設定ファイル（appsscript.json）を置き換える

1. 左端の歯車アイコン「プロジェクトの設定」をクリック
2. 「"appsscript.json" マニフェスト ファイルをエディタで表示する」にチェックを入れる
3. 左端の「<>」アイコン「エディタ」に戻ると、ファイル一覧に `appsscript.json` が出ているのでクリック
4. 中身をすべて消し、下の内容を貼り付ける

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Calendar",
        "version": "v3",
        "serviceId": "calendar"
      }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

5. 保存する（Mac は `⌘S`、Windows は `Ctrl+S`）

### 2-4. 初回実行と権限の許可

1. ファイル一覧で `Code.gs` をクリック
2. 画面上部の関数選択（「実行」ボタンの右にあるプルダウン）で `syncCalendar` を選び、「実行」をクリック
3. 「承認が必要です」と出たら、次の順に進める
   1. 「権限を確認」→ 会社アカウントを選択
   2. 「このアプリは Google で確認されていません」と出た場合は、左下の「詳細」→「calendar-sync（安全ではないページ）に移動」をクリック
      - 自分で作ったスクリプトなので、この警告は気にしなくて大丈夫です
   3. 「許可」をクリック
4. 画面下の「実行ログ」に、次のような行が出ていれば成功です
   - `[gmail] loaded 〇 events from （Gmailアドレス）`
   - `[gmail/secondary] ... created=〇 ...`
5. `cannot access` と出た場合は、STEP 1-2 の共有がまだ反映されていません。数分待ってからもう一度「実行」してください

### 2-5. 自動実行（15分おき）を設定する

1. 関数選択で `installTrigger` を選び、「実行」
2. 実行ログに `trigger installed: every 15 minutes` と出れば完了です

---

## STEP 3：Gmail アカウントにスクリプトを設置する

**Gmail アカウントで**、STEP 2 と同じ操作をします。違うのは 2-2 で貼り付けるブロックだけです。

- 2-2 では、下のブロックで置き換えます
- `★会社アドレス★` は2か所あるので、両方とも書き換えてください

```javascript
// === Gmail アカウントに設置する設定（会社の予定を読み込む） ===
const SOURCES = [
  {
    key: 'work',
    calendarIds: ['★会社アドレス★'],
    filterWorkspaceStyle: true,
    selfEmail: '★会社アドレス★',
    targetCalendarName: '会社同期',
    color: CalendarApp.EventColor.PALE_GREEN,
    tagVersion: 1,
    legacyTags: [],
    broadcastBusyOnPrimary: true,
    placeholderTagVersion: 1,
    legacyPlaceholderTags: [],
  },
];

const SELF_MIRROR = null;

```

- 2-4 の実行ログは `[work] loaded 〇 events from （会社アドレス）` になります
- 2-3（appsscript.json の置き換え）は、Gmail 側では特に飛ばさないでください。これがないと会社の予定を読み込めません

---

## STEP 4：動作確認

1. 会社のカレンダーにテスト用の予定を1件入れる
2. 15分ほど待つ（すぐ確認したいときは、Gmail 側のスクリプトで `syncCalendar` を手動で「実行」）
3. Gmail のカレンダーに次の2つが出ていれば成功です
   - 左側に新しくできた「会社同期」カレンダーに、同じタイトルの予定（自分にだけ見える）
   - メインのカレンダーに「予定あり」というブロック（他の人には、この時間が埋まって見える）
4. テスト用の予定を消すと、15分ほどで両方とも消えます

初回は予定の数によって、全部反映されるまで1〜2時間かかることがあります（一度に処理する件数を絞っているため）。

---

## 困ったとき

| 症状 | 対処 |
|---|---|
| 実行ログに `cannot access`（上記以外） | STEP 1 の共有が未完了か、反映待ち。共有先のアドレスと権限「すべての予定の詳細」を確認 |
| 実行ログに `cannot access 〜 Calendar is not defined` | STEP 2-3（appsscript.json）が反映されていない。置き換えて保存し直す |
| `too many calendars or calendar events` | Google 側の回数制限。1〜2時間待てば、15分おきの自動実行で続きが処理される |
| 予定が何重にも増えていく | 別のカレンダー同期ツールと併用している可能性。両方のスクリプトの自動実行を止めて（左端の時計アイコン「トリガー」から削除）、共有してくれた人に連絡 |

もっと詳しい仕組みやトラブル対応は [README.md](../README.md) を参照してください。
