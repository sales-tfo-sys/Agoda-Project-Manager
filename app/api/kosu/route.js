import { supabaseConfigured, sb, sbAll } from "../../../lib/supabase";
import { holidayName, dowLabel } from "../../../lib/holidays";
import { cached } from "../../../lib/cache";

// 工数明細のデータ API。
// 以前は Google スプレッドシートを CSV で読んでいたが、工数はサイト上で手動入力
// （Supabase: kosu_entry）に完全移行したため、スプレッドシートには一切依存しない。
//   ・横軸（日付列/月）… コードで生成（入力開始月〜当月）
//   ・行（作業内容×担当）… kosu_task ＋ kosu_entry ＋ task_assign から生成
//   ・セルの値（daily）… kosu_entry の実値を軸に整列して格納
// 画面側（DetailTable）はこの形（months/isoDates/dateMonthIdx/rows）をそのまま使う。

export const dynamic = "force-dynamic";

const TTL = 60 * 1000; // 60秒メモリキャッシュ（値の鮮度は画面側の /api/kosu-entries が別途担保）

// サーバー時刻(UTC)を JST に寄せた「今」。当月判定に使う。
function jstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

// トータル作業時間（自動集計行）かどうか。
const isTotalContent = (s) => /トータル作業時間/.test(String(s || ""));

// 空データ時の返却形。
const emptyPayload = (extra = {}) => ({
  configured: supabaseConfigured(),
  source: "supabase",
  months: [],
  dates: [],
  isoDates: [],
  dateMonthIdx: [],
  holidayOf: [],
  dowOf: [],
  rows: [],
  ...extra,
});

// 作業内容の一覧（?list=1 用・軽量）。ダッシュボードの紐づけ先候補に使う。
async function buildContents() {
  const tasks = await sb(
    "kosu_task?active=eq.true&order=sort_order,created_at&select=task_type,content"
  );
  const seen = new Set();
  const contents = [];
  for (const t of tasks || []) {
    const key = `${t.task_type}|${t.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contents.push({ type: t.task_type, detail: t.content });
  }
  return contents;
}

// 明細表の全データを Supabase から組み立てる。
async function buildDetail() {
  // ① 表示範囲（入力開始月 〜 当月／入力最終月の遅い方）
  const [minRow, maxRow] = await Promise.all([
    sb("kosu_entry?select=entry_date&order=entry_date.asc&limit=1").catch(() => null),
    sb("kosu_entry?select=entry_date&order=entry_date.desc&limit=1").catch(() => null),
  ]);
  const now = jstNow();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;

  const minDate = Array.isArray(minRow) && minRow[0]?.entry_date;
  let sY = curY;
  let sM = curM;
  if (minDate) {
    sY = Number(minDate.slice(0, 4));
    sM = Number(minDate.slice(5, 7));
  }
  // 終端は当月。入力が当月より先の月まである場合はそこまで伸ばす。
  let eY = curY;
  let eM = curM;
  const maxDate = Array.isArray(maxRow) && maxRow[0]?.entry_date;
  if (maxDate) {
    const my = Number(maxDate.slice(0, 4));
    const mm = Number(maxDate.slice(5, 7));
    if (my > eY || (my === eY && mm > eM)) {
      eY = my;
      eM = mm;
    }
  }

  // ② 日次の軸を作る（月ごとに全日を列にする）
  const monthYMs = [];
  const dates = [];
  const isoDates = [];
  const dateMonthIdx = [];
  const holidayOf = [];
  const dowOf = [];
  const isoIndex = new Map();
  {
    let y = sY;
    let m = sM;
    while (y < eY || (y === eY && m <= eM)) {
      const mi = monthYMs.length;
      monthYMs.push({ y, m });
      const daysInMonth = new Date(y, m, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = ymd(y, m, d);
        isoIndex.set(iso, isoDates.length);
        dates.push(`${m}/${d}`);
        isoDates.push(iso);
        dateMonthIdx.push(mi);
        holidayOf.push(holidayName(y, m, d));
        dowOf.push(dowLabel(y, m, d));
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  // 月ラベル：同じ月番号が複数年に跨るときだけ「YYYY/M」で曖昧さを消す。
  const monthNumCount = {};
  monthYMs.forEach((o) => (monthNumCount[o.m] = (monthNumCount[o.m] || 0) + 1));
  const anyRepeat = Object.values(monthNumCount).some((c) => c > 1);
  const months = monthYMs.map((o) => (anyRepeat ? `${o.y}/${o.m}` : `${o.m}月`));

  // ③ マスタ・アサイン・入力値を取得
  const rangeStart = isoDates[0];
  const rangeEnd = isoDates[isoDates.length - 1];
  const [tasks, persons, assign, entries] = await Promise.all([
    sb(
      "kosu_task?active=eq.true&order=sort_order,created_at&select=id,content,task_type,unit"
    ),
    sb("kosu_person?select=id,name,role"),
    sb("task_assign?scope=eq.adhoc&select=key,person_id,role").catch(() => []),
    rangeStart && rangeEnd
      ? sbAll(
          `kosu_entry?entry_date=gte.${rangeStart}&entry_date=lte.${rangeEnd}` +
            `&select=task_id,person_id,entry_date,value&order=task_id`
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const nameById = new Map((persons || []).map((p) => [p.id, p.name]));
  const isWorker = (pid) => {
    const p = (persons || []).find((x) => x.id === pid);
    return p ? !["owner", "admin"].includes(p.role || "member") : true;
  };
  const taskMeta = new Map(
    (tasks || []).map((t) => [t.id, { type: t.task_type, unit: t.unit }])
  );

  // 入力値: (task_id, person_id) → { iso: value }、および担当者ごとの合計時間
  const byPair = new Map(); // `${task_id}::${person_id}` → Map(iso → value)
  const personsByTask = new Map(); // task_id → Set(person_id)
  const totalByPid = new Map(); // person_id → Map(iso → 合計時間)  ※トータル作業時間の自動集計
  for (const e of entries || []) {
    const iso = String(e.entry_date).slice(0, 10);
    const val = Number(e.value) || 0;
    const pk = `${e.task_id}::${e.person_id}`;
    if (!byPair.has(pk)) byPair.set(pk, new Map());
    byPair.get(pk).set(iso, val);
    if (!personsByTask.has(e.task_id)) personsByTask.set(e.task_id, new Set());
    personsByTask.get(e.task_id).add(e.person_id);

    // 合計時間＝ Regular(作業時間系) ＋ Ad Hoc の稼働時間（件数系は除外）
    const meta = taskMeta.get(e.task_id);
    if (meta) {
      const isReg = /regular/i.test(meta.type || "");
      const isAd = /ad\s*hoc/i.test(meta.type || "");
      if ((isReg && meta.unit === "time") || isAd) {
        if (!totalByPid.has(e.person_id)) totalByPid.set(e.person_id, new Map());
        const tm = totalByPid.get(e.person_id);
        tm.set(iso, (tm.get(iso) || 0) + val);
      }
    }
  }

  // アサイン（Ad Hoc）: 作業内容 → 担当者ID（主担当が先頭）。作業者のみ。
  const assignByContent = new Map();
  for (const a of assign || []) {
    if (!isWorker(a.person_id)) continue;
    if (!assignByContent.has(a.key)) assignByContent.set(a.key, []);
    if (a.role === "main") assignByContent.get(a.key).unshift(a.person_id);
    else assignByContent.get(a.key).push(a.person_id);
  }

  // 入力値を軸に整列した daily 配列にする。
  const toDaily = (isoValMap) => {
    const daily = new Array(isoDates.length).fill(0);
    if (isoValMap) {
      for (const [iso, v] of isoValMap) {
        const i = isoIndex.get(iso);
        if (i != null) daily[i] = v;
      }
    }
    return daily;
  };

  // ④ 行（作業内容×担当）を組み立て
  const rows = [];
  const personsWithAnyEntry = new Set(
    (entries || []).map((e) => e.person_id).filter((pid) => nameById.has(pid))
  );
  for (const t of tasks || []) {
    if (isTotalContent(t.content)) {
      // トータル作業時間: 入力実績のある担当者ぶんを、合計時間で表示
      for (const pid of personsWithAnyEntry) {
        const nm = nameById.get(pid);
        if (nm == null) continue;
        rows.push({
          type: t.task_type,
          detail: t.content,
          tanto: nm,
          unit: "time",
          daily: toDaily(totalByPid.get(pid)),
        });
      }
      continue;
    }
    // 通常タスク: 入力がある担当者 ＋ アサインされた担当者
    const pidSet = new Set(personsByTask.get(t.id) || []);
    for (const pid of assignByContent.get(t.content) || []) pidSet.add(pid);
    for (const pid of pidSet) {
      const nm = nameById.get(pid);
      if (nm == null) continue; // 名前が引けない担当者は出さない
      rows.push({
        type: t.task_type,
        detail: t.content,
        tanto: nm,
        unit: t.unit === "time" ? "time" : "count",
        daily: toDaily(byPair.get(`${t.id}::${pid}`)),
      });
    }
  }

  return {
    configured: true,
    source: "supabase",
    months,
    dates,
    isoDates,
    dateMonthIdx,
    holidayOf,
    dowOf,
    rows,
  };
}

export async function GET(req) {
  const listOnly = new URL(req.url).searchParams.get("list") === "1";

  if (!supabaseConfigured()) {
    return Response.json(listOnly ? { contents: [] } : emptyPayload());
  }

  try {
    if (listOnly) {
      const contents = await cached("kosu:contents", TTL, buildContents);
      return Response.json({ contents });
    }
    const payload = await cached("kosu:detail", TTL, buildDetail);
    return Response.json(payload);
  } catch (e) {
    return Response.json(
      listOnly
        ? { contents: [], error: String(e?.message || e) }
        : emptyPayload({ error: String(e?.message || e) })
    );
  }
}
