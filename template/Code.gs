/**
 * カレンダー相互同期 — テンプレート
 *
 * 複数のGoogleアカウント（2つ以上、上限なし）のカレンダーを相互に同期する仕組み。
 * このファイルは「1アカウントにつき1つ」設置する。同期したい各アカウントに
 * 同じ仕組みのGoogle Apps Scriptプロジェクトを作り、このファイルをベースに
 * SOURCES（自分以外の全アカウント）だけを差し替えて設置する。
 *
 * 【2層構成】各ソース（他アカウント）由来の予定を、以下2箇所に書き込む:
 *   (1) 詳細層: 専用の同期カレンダー（例「AccountA同期」、初回自動作成）へ …
 *       タイトル・説明・場所そのまま、公開設定「非公開」固定。
 *       本人が自分のカレンダーで詳細を確認するため。
 *   (2) ブロック層: 自分のプライマリカレンダーへ … タイトル「予定あり」固定の
 *       最小ブロック。★このブロックは非公開にしない（visibility=DEFAULT）。
 *       他メンバーが自分のプライマリを見るだけで予定の埋まりを確認できるようにするため。
 *
 * 【ループ防止】書き込む予定の description には必ず同期マーカー `[calsync:` が入る。
 *   ソース読込時にこのマーカーを含む予定を最優先で除外するため、
 *   (2) のブロック層を他アカウントが読んでも再転記（エコー）しない。
 *   ※ (2) を非公開にしないのはこのマーカーを他アカウントに読ませるため。
 *      非公開にすると共有先から色も説明も見えず「予定あり」としか判別できず、
 *      マーカー除外が効かなくなって無限エコーが再発する（過去の実運用で確認済みのバグパターン）。
 *
 * 事前準備: filterWorkspaceStyle=true のソースを1つでも含む場合、
 *           エディタの「サービス」から Google Calendar API (Advanced Service) を有効化すること
 */

// ★このファイルを設置するアカウント自身はSOURCESに含めない（自分以外の全アカウントを列挙する）

// === このアカウント固有の設定 ===
const SOURCES = [
  {
    // 識別子。ログ・同期タグ・専用カレンダー名の生成に使う（任意の英数字）
    key: 'accountA',
    // 読み取り元カレンダーIDの配列。プライマリはメールアドレスそのもの
    calendarIds: ['account-a@example.com'],
    // true=Google Workspace（業務）アカウント向けフィルタを適用する
    //   （eventType/declined/除外タイトルでフィルタ。Advanced API 経由で読み込む）
    // false=個人Gmail等、フィルタ不要でそのまま転記する
    filterWorkspaceStyle: true,
    // filterWorkspaceStyle: true の場合、declined（不参加）判定に使う自分のメールアドレス
    selfEmail: 'account-a@example.com',
    // 詳細層の書き込み先の専用カレンダー名。存在しなければ自動作成
    targetCalendarName: 'AccountA同期',
    // 転記した予定に付ける色（CalendarApp.EventColor）。アカウントごとに固定で割り当てる
    color: CalendarApp.EventColor.PALE_GREEN,
    // 詳細層タグのバージョン番号。ロジックを変えて再構築したい時に上げる
    tagVersion: 1,
    // 自動削除対象にする旧バージョンの詳細層タグ一覧（初回導入時は空でよい）
    legacyTags: [],
    // true=プライマリに「予定あり」ブロック（ブロック層）を出す
    broadcastBusyOnPrimary: true,
    // ブロック層タグのバージョン番号
    placeholderTagVersion: 1,
    // 自動削除対象にする旧バージョンのブロック層タグ一覧（初回導入時は空でよい）
    legacyPlaceholderTags: [],
  },
  {
    key: 'accountB',
    calendarIds: ['account-b@example.com'],
    filterWorkspaceStyle: false,
    selfEmail: null,
    targetCalendarName: 'AccountB同期',
    color: CalendarApp.EventColor.YELLOW,
    tagVersion: 1,
    legacyTags: [],
    broadcastBusyOnPrimary: true,
    placeholderTagVersion: 1,
    legacyPlaceholderTags: [],
  },
];

// ==== COMMON ENGINE (keep identical across all account files) ====

const EXCLUDED_TITLES = new Set(['移動', '予定あり']);
const ALLOWED_EVENT_TYPES = new Set(['default', 'focusTime']);

const PAST_DAYS = 0;
const FUTURE_DAYS = 60;

const MAX_OPERATIONS_PER_RUN = 30;
const SLEEP_MS_BETWEEN_OPS = 200;

// プライマリに書く「予定あり」ブロックの固定タイトル
const PLACEHOLDER_TITLE = '予定あり';
// 本システムが生成した予定の普遍マーカー（前方一致）。ソース読込時にこれを含む予定は必ず除外
const GLOBAL_SYNC_MARKER = '[calsync:';

// 書き込みモード記述子。セカンダリ（フル詳細・非公開）とプライマリ（プレースホルダー・非公開なし）で切替
const MODE_FULL = {
  name: 'full',
  visibility: CalendarApp.Visibility.PRIVATE,
  titleOf: function (it) { return it.title; },
  locationOf: function (it) { return it.location; },
  descriptionOf: function (srcDesc, srcId, tag) { return buildDescription(srcDesc, srcId, tag); },
  comparesContent: true,
};
const MODE_PLACEHOLDER = {
  name: 'placeholder',
  visibility: CalendarApp.Visibility.DEFAULT, // ★非公開にしない（マーカーを読ませるため）
  titleOf: function (it) { return PLACEHOLDER_TITLE; },
  locationOf: function (it) { return ''; },
  descriptionOf: function (srcDesc, srcId, tag) { return buildDescription('', srcId, tag); },
  comparesContent: false,
};

let opCount = 0;

// === エントリポイント ===
function syncCalendar() {
  opCount = 0;
  for (const source of SOURCES) {
    if (opCount >= MAX_OPERATIONS_PER_RUN) {
      console.log(`[sync] budget reached before source=${source.key}, deferring to next run`);
      break;
    }
    syncFromSource(source);
  }
}

function syncFromSource(source) {
  const now = new Date();
  const startRange = new Date(now.getTime() - PAST_DAYS * 24 * 60 * 60 * 1000);
  const endRange = new Date(now.getTime() + FUTURE_DAYS * 24 * 60 * 60 * 1000);

  const secondaryTag = `[calsync:${source.key}-v${source.tagVersion}]`;
  const primaryTag = `[calsync:${source.key}-primary-v${source.placeholderTagVersion}]`;

  // --- セカンダリの legacy 掃除（旧タグ形式の予定を削除） ---
  const secondaryCal = getOrCreateCalendar(source.targetCalendarName);
  const legacyDeleted = cleanupLegacy(secondaryCal, startRange, endRange, secondaryTag, source.legacyTags || []);
  if (opCount >= MAX_OPERATIONS_PER_RUN) {
    console.log(`[${source.key}] legacy cleanup deferred more work to next run. deletedThisRun=${legacyDeleted}`);
    return;
  }

  // --- ソース読込 ---
  let items = source.filterWorkspaceStyle
    ? loadViaAdvancedApi(source, startRange, endRange)
    : loadViaCalendarApp(source, startRange, endRange);

  // ★普遍マーカー除外: 本システム生成物を全経路・全モード共通で除外（passesWorkspaceFilter より前段）
  items = items.filter(it => !(it.description || '').includes(GLOBAL_SYNC_MARKER));

  // 直近の予定から優先処理するために時系列ソート
  items.sort((a, b) => a.start.getTime() - b.start.getTime());

  // workspace 系のみ従来フィルタ（eventType / declined / 除外タイトル）
  if (source.filterWorkspaceStyle) {
    items = items.filter(it => passesWorkspaceFilter(it, source.selfEmail));
  }

  // --- (1) セカンダリ reconcile（フル詳細・非公開） ---
  const r1 = reconcileTarget(secondaryCal, items, {
    tag: secondaryTag, mode: MODE_FULL, color: source.color, startRange, endRange,
  });
  logReconcile(source.key, 'secondary', legacyDeleted, r1);
  if (r1.stopped) return;

  // --- (2) プライマリ reconcile（「予定あり」ブロック・非公開なし） ---
  if (source.broadcastBusyOnPrimary && opCount < MAX_OPERATIONS_PER_RUN) {
    const primaryCal = CalendarApp.getDefaultCalendar();
    const r2 = reconcileTarget(primaryCal, items, {
      tag: primaryTag, mode: MODE_PLACEHOLDER, color: source.color, startRange, endRange,
    });
    logReconcile(source.key, 'primary', 0, r2);
  }
}

function logReconcile(key, layer, legacyDeleted, r) {
  console.log(
    `[${key}/${layer}] legacyDeleted=${legacyDeleted}, created=${r.created}, updated=${r.updated}, ` +
    `deleted=${r.deleted}, dupDeleted=${r.dupDeleted}, skipped=${r.skipped}, ops=${opCount}` +
    (r.stopped ? ' (deferred to next run)' : '')
  );
}

/**
 * 指定カレンダー上の「tag付き同期予定」を items に一致させる（create/update/delete/dup解消）。
 * mode で書き込み挙動（フル詳細・非公開 or プレースホルダー・非公開なし）を切り替える。
 */
function reconcileTarget(targetCal, items, opts) {
  const { tag, mode, color, startRange, endRange } = opts;

  const targetEvents = targetCal.getEvents(startRange, endRange);
  const synced = new Map();
  const dups = []; // 同じ source_id を持つ重複target → 削除候補
  for (const t of targetEvents) {
    const desc = t.getDescription() || '';
    if (!desc.includes(tag)) continue;
    const m = desc.match(/source_id:(\S+)/);
    if (!m) continue;
    if (synced.has(m[1])) dups.push(t);
    else synced.set(m[1], t);
  }

  const seen = new Set();
  let created = 0, updated = 0, deleted = 0, dupDeleted = 0, skipped = 0, stopped = false;

  for (const it of items) {
    if (stopped) break;
    seen.add(it.id);
    const desc = mode.descriptionOf(it.description, it.id, tag);
    const existing = synced.get(it.id);
    if (existing) {
      if (!needsUpdate(existing, it, mode, tag)) { skipped++; continue; }
      const r = performOp(() => updateEvent(existing, it, desc, color, mode, targetCal));
      if (r === 'ok') updated++;
      else { stopped = true; break; }
    } else {
      const r = performOp(() => writeEvent(targetCal, it, desc, color, mode));
      if (r === 'ok') created++;
      else { stopped = true; break; }
    }
  }

  // 重複target（同じ source_id を持つ余分なtarget）を削除
  if (!stopped) {
    for (const t of dups) {
      const r = performOp(() => t.deleteEvent());
      if (r === 'ok') dupDeleted++;
      else { stopped = true; break; }
    }
  }

  // 孤立target（source 側に存在しない source_id）を削除
  if (!stopped) {
    for (const [srcId, tgt] of synced.entries()) {
      if (seen.has(srcId)) continue;
      const r = performOp(() => tgt.deleteEvent());
      if (r === 'ok') deleted++;
      else { stopped = true; break; }
    }
  }

  return { created, updated, deleted, dupDeleted, skipped, stopped };
}

// mode に応じて「更新が必要か」を判定
function needsUpdate(existing, it, mode, tag) {
  if (existing.isAllDayEvent() !== it.isAllDay) return true;
  if (existing.getStartTime().getTime() !== it.start.getTime()) return true;
  if (existing.getEndTime().getTime() !== it.end.getTime()) return true;
  if (mode.comparesContent) {
    // フル詳細モードのみ: title / description / location も比較
    if (existing.getTitle() !== it.title) return true;
    const orig = stripSyncTag(existing.getDescription() || '', tag);
    if (orig !== it.description) return true;
    if ((existing.getLocation() || '') !== it.location) return true;
  }
  return false;
}

function writeEvent(targetCal, it, description, color, mode) {
  const title = mode.titleOf(it);
  const ev = it.isAllDay
    ? targetCal.createAllDayEvent(title, it.start, it.end)
    : targetCal.createEvent(title, it.start, it.end);
  ev.setDescription(description);
  const loc = mode.locationOf(it);
  if (loc) ev.setLocation(loc);
  ev.setVisibility(mode.visibility); // ★FULL=PRIVATE, PLACEHOLDER=DEFAULT
  ev.setColor(color);
  return ev;
}

function updateEvent(existing, it, description, color, mode, targetCal) {
  if (existing.isAllDayEvent() !== it.isAllDay) {
    existing.deleteEvent();
    writeEvent(targetCal, it, description, color, mode);
    return;
  }
  if (it.isAllDay) existing.setAllDayDates(it.start, it.end);
  else existing.setTime(it.start, it.end);
  existing.setTitle(mode.titleOf(it));
  existing.setDescription(description);
  existing.setLocation(mode.locationOf(it) || '');
  existing.setVisibility(mode.visibility);
  existing.setColor(color);
}

// eventType / タイトル / 不参加 でフィルタ（業務アカウント向けソースのみ適用）
function passesWorkspaceFilter(it, selfEmail) {
  const title = (it.title || '').trim();
  if (EXCLUDED_TITLES.has(title)) return false;
  const et = it.eventType || 'default';
  if (!ALLOWED_EVENT_TYPES.has(et)) return false;
  const attendees = it.attendees || [];
  const me = attendees.find(a => a.email === selfEmail || a.self === true);
  if (me && me.responseStatus === 'declined') return false;
  return true;
}

// Calendar Advanced Service 経由で取得（eventType/attendees が必要な業務アカウント向け）
function loadViaAdvancedApi(source, startRange, endRange) {
  const items = [];
  for (const calId of source.calendarIds) {
    try {
      const response = Calendar.Events.list(calId, {
        timeMin: startRange.toISOString(),
        timeMax: endRange.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
      });
      const raw = response.items || [];
      console.log(`[${source.key}] loaded ${raw.length} events from ${calId}`);
      for (const item of raw) {
        if (item.status === 'cancelled') continue;
        const isAllDay = !!item.start.date;
        const { start, end } = parseApiTimes(item, isAllDay);
        items.push({
          id: item.id,
          title: item.summary || '(無題)',
          description: item.description || '',
          location: item.location || '',
          isAllDay, start, end,
          eventType: item.eventType || 'default',
          attendees: item.attendees || [],
        });
      }
    } catch (e) {
      console.warn(`[${source.key}] cannot access ${calId}: ${e.message}`);
    }
  }
  return items;
}

// CalendarApp 経由で取得（個人アカウント向け、フィルタ不要なソース用）
function loadViaCalendarApp(source, startRange, endRange) {
  const items = [];
  for (const calId of source.calendarIds) {
    try {
      const cal = CalendarApp.getCalendarById(calId);
      if (!cal) {
        console.warn(`[${source.key}] cannot access ${calId}`);
        continue;
      }
      const events = cal.getEvents(startRange, endRange);
      console.log(`[${source.key}] loaded ${events.length} events from ${calId}`);
      for (const e of events) {
        // 再帰イベントのインスタンスを区別するため、id + 開始時刻の複合キーを使う
        items.push({
          id: `${e.getId()}__${e.getStartTime().getTime()}`,
          title: e.getTitle() || '(無題)',
          description: e.getDescription() || '',
          location: e.getLocation() || '',
          isAllDay: e.isAllDayEvent(),
          start: e.getStartTime(),
          end: e.getEndTime(),
        });
      }
    } catch (e) {
      console.warn(`[${source.key}] cannot access ${calId}: ${e.message}`);
    }
  }
  return items;
}

function parseApiTimes(apiEvent, isAllDay) {
  if (isAllDay) {
    const [sy, sm, sd] = apiEvent.start.date.split('-').map(Number);
    const [ey, em, ed] = apiEvent.end.date.split('-').map(Number);
    return { start: new Date(sy, sm - 1, sd), end: new Date(ey, em - 1, ed) };
  }
  return { start: new Date(apiEvent.start.dateTime), end: new Date(apiEvent.end.dateTime) };
}

// 専用の同期カレンダーを取得（無ければ作成）。プライマリを汚さないための分離先
function getOrCreateCalendar(name) {
  const existing = CalendarApp.getCalendarsByName(name);
  if (existing.length > 0) return existing[0];
  console.log(`creating dedicated calendar: ${name}`);
  return CalendarApp.createCalendar(name);
}

function cleanupLegacy(targetCal, startRange, endRange, syncTag, legacyTags) {
  if (!legacyTags.length) return 0;
  const events = targetCal.getEvents(startRange, endRange);
  let n = 0;
  for (const e of events) {
    if (opCount >= MAX_OPERATIONS_PER_RUN) break;
    const desc = e.getDescription() || '';
    if (!containsAny(desc, legacyTags)) continue;
    if (desc.includes(syncTag)) continue;
    const r = performOp(() => e.deleteEvent());
    if (r === 'ok') n++;
    else break;
  }
  return n;
}

function containsAny(text, tags) {
  for (const tag of tags) {
    if (text.includes(tag)) return true;
  }
  return false;
}

function buildDescription(srcDesc, srcId, syncTag) {
  const tag = `${syncTag}\nsource_id:${srcId}`;
  return srcDesc ? `${srcDesc}\n\n${tag}` : tag;
}

function stripSyncTag(desc, syncTag) {
  const idx = desc.lastIndexOf(syncTag);
  if (idx === -1) return desc;
  return desc.substring(0, idx).replace(/\n+$/, '');
}

function performOp(fn) {
  if (opCount >= MAX_OPERATIONS_PER_RUN) {
    console.log('budget reached, deferring to next run');
    return 'budget';
  }
  try {
    fn();
    opCount++;
    Utilities.sleep(SLEEP_MS_BETWEEN_OPS);
    return 'ok';
  } catch (e) {
    const msg = String((e && e.message) || e).toLowerCase();
    if (msg.includes('too many') || msg.includes('rate') || msg.includes('quota')) {
      console.warn(`rate limit hit, deferring to next run: ${e.message}`);
      return 'rate_limited';
    }
    throw e;
  }
}

// 手動リセット用: 各ソースの専用カレンダー＋プライマリから同期予定（現行・旧版）を全削除
function purgeSyncedEvents() {
  opCount = 0;
  for (const source of SOURCES) {
    const secondaryTag = `[calsync:${source.key}-v${source.tagVersion}]`;
    const primaryTag = `[calsync:${source.key}-primary-v${source.placeholderTagVersion}]`;
    const allTags = [secondaryTag, primaryTag]
      .concat(source.legacyTags || [])
      .concat(source.legacyPlaceholderTags || []);
    const now = new Date();
    const start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const cals = [getOrCreateCalendar(source.targetCalendarName)];
    if (source.broadcastBusyOnPrimary) cals.push(CalendarApp.getDefaultCalendar());
    let n = 0;
    for (const cal of cals) {
      const events = cal.getEvents(start, end);
      for (const e of events) {
        const desc = e.getDescription() || '';
        if (!containsAny(desc, allTags)) continue;
        const r = performOp(() => e.deleteEvent());
        if (r === 'ok') n++;
        else break;
      }
    }
    console.log(`[${source.key}] purged ${n} events`);
  }
}

// 緊急一括削除用: プライマリ＋専用カレンダーの両方から、期間・件数上限なしで
// 同期タグ（現行・旧版すべて）付きの予定を削除する。purgeSyncedEvents で
// 消しきれない時（30件上限超え）に使う。
function purgeAllHistory() {
  for (const source of SOURCES) {
    const secondaryTag = `[calsync:${source.key}-v${source.tagVersion}]`;
    const primaryTag = `[calsync:${source.key}-primary-v${source.placeholderTagVersion}]`;
    const allTags = [secondaryTag, primaryTag]
      .concat(source.legacyTags || [])
      .concat(source.legacyPlaceholderTags || []);
    const start = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000); // 過去3年
    const end = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000);   // 未来3年
    const cals = [CalendarApp.getDefaultCalendar(), getOrCreateCalendar(source.targetCalendarName)];
    let total = 0;
    for (const cal of cals) {
      const events = cal.getEvents(start, end);
      for (const e of events) {
        const desc = e.getDescription() || '';
        if (!containsAny(desc, allTags)) continue;
        try {
          e.deleteEvent();
          total++;
          Utilities.sleep(SLEEP_MS_BETWEEN_OPS);
        } catch (err) {
          console.warn(`delete failed, stopping: ${err.message}`);
          console.log(`[${source.key}] purgeAllHistory: deleted ${total} events so far (stopped early)`);
          return;
        }
      }
    }
    console.log(`[${source.key}] purgeAllHistory: deleted ${total} events total`);
  }
}

function installTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'syncCalendar') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('syncCalendar').timeBased().everyMinutes(15).create();
  console.log('trigger installed: every 15 minutes');
}
