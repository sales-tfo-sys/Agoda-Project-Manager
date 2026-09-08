import { readSnapshot } from "@/lib/kintoneSnapshot";
import { sb, supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 進捗グラフ（Regular Task）の日ごとの推移。
//
// 日ごとの実績はどこにも残っていなかったので、次の2本立てで用意する。
//   ① 過去分：Kintone の「基準日」と「★Stage変更日」から、その日時点の数を推定する。
//   ② 今日ぶん：計算した値を保存しておき、以降はその保存値を正とする。
//      （失注・対応不要は「今の状態」でしか分からず、過去に遡ると実際より少なく出るため。
//        保存を続ければ、記録した日から先は正確な値になる。）
//
// 保存先は task_override（scope="pdaily", key="YYYY-MM-DD"）。
// 時系列のためだけにテーブルを増やさずに済む。

const TYPE_CODE = "ドロップダウン_13"; // 案件名（空欄は Hotel）
const STAGE_CODE = "ドロップダウン"; // Stage
const STAGE_DATE = "日付"; // ★Stage変更日
const SCOPE = "pdaily";

// 案件タイプ → Stage の体系（A: 1〜7の番号つき／B: 完了で終わる）
const TYPE_GROUP = { Hotel: "A", Temairazu: "A", ACQ: "B", Liberty: "B", IHM: "B" };
const caseType = (r) => {
  const v = r?.[TYPE_CODE]?.value;
  return v && String(v).trim() ? String(v).trim() : "Hotel";
};

const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// 日付っぽい値 → "YYYY-MM-DD"（取れなければ null）
function toIso(v) {
  const s = typeof v === "object" && v ? v.value : v;
  const m = String(s || "").match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : null;
}

// 土日を除いた日付の並び（対象年の1/1から、今日か年末の早い方まで）
function businessDays(year) {
  const out = [];
  const end = new Date();
  const last = end.getFullYear() > year ? new Date(year, 11, 31) : end;
  for (let d = new Date(year, 0, 1); d <= last; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w === 0 || w === 6) continue; // 日・土は出さない
    out.push(iso(d));
  }
  return out;
}

// その日時点の受注数・完了数を、案件タイプごとに数える
function reconstruct(records, dateCode, year, days) {
  // 案件タイプ → { 受注に数える日, 完了になった日 }
  const rows = [];
  const types = new Set();
  for (const r of records) {
    const base = toIso(r?.[dateCode]);
    if (!base || Number(base.slice(0, 4)) !== year) continue;
    const t = caseType(r);
    types.add(t);
    const stage = r?.[STAGE_CODE]?.value || "";
    // 進捗表と同じ数え方：事前登録・失注・対応不要は受注数に入れない
    const excluded =
      stage.includes("事前登録") || stage.includes("失注") || stage.includes("対応不要");
    const doneStage = TYPE_GROUP[t] === "A" ? "7.販売開始確認（完了）" : "完了";
    const isDone = stage === doneStage;
    // 完了になった日は「★Stage変更日」を使う。無ければ基準日で代用する。
    const doneOn = isDone ? toIso(r?.[STAGE_DATE]) || base : null;
    rows.push({ t, base, excluded, doneOn });
  }

  const out = {};
  for (const t of types) out[t] = [];
  for (const day of days) {
    const acc = {};
    for (const t of types) acc[t] = { total: 0, done: 0 };
    for (const r of rows) {
      if (r.base > day) continue; // その日より後に入った案件はまだ数えない
      if (!r.excluded) acc[r.t].total += 1;
      if (r.doneOn && r.doneOn <= day) acc[r.t].done += 1;
    }
    for (const t of types) out[t].push(acc[t]);
  }
  return { types: [...types], series: out };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const dateCode = searchParams.get("date") || "作成日時";
  try {
    const snap = await readSnapshot();
    const records = snap?.data?.records || [];
    if (!records.length) return Response.json({ days: [], types: [], series: {} });

    const days = businessDays(year);
    const built = cachedKey(year, dateCode, records, days);

    // 保存済みの日は、そちらを正として上書きする
    let saved = [];
    if (supabaseConfigured()) {
      saved = await sb(
        `task_override?scope=eq.${SCOPE}&select=key,data&order=key`
      ).catch(() => []);
    }
    const savedMap = {};
    for (const row of saved || []) savedMap[row.key] = row.data || {};
    days.forEach((day, i) => {
      const rec = savedMap[day];
      if (!rec) return;
      for (const t of built.types) {
        if (rec[t]) built.series[t][i] = { total: rec[t].t ?? 0, done: rec[t].d ?? 0 };
      }
    });

    // 今日ぶんを保存しておく（次からはこの値が正になる）
    const today = iso(new Date());
    if (supabaseConfigured() && days[days.length - 1] === today) {
      const i = days.length - 1;
      const data = {};
      for (const t of built.types) {
        const v = built.series[t][i];
        data[t] = { t: v.total, d: v.done };
      }
      sb("task_override?on_conflict=scope,key", {
        method: "POST",
        body: [{ scope: SCOPE, key: today, data, updated_at: new Date().toISOString() }],
        prefer: "resolution=merge-duplicates,return=minimal",
      }).catch(() => {});
    }

    return Response.json({ days, types: built.types, series: built.series });
  } catch (e) {
    return Response.json(
      { days: [], types: [], series: {}, error: String(e?.message || e) },
      { status: 200 }
    );
  }
}

// 同じ年・同じ基準日なら計算し直さない（全レコード×日数のループなので重い）
function cachedKey(year, dateCode, records, days) {
  return cachedSync(`pdaily:${year}:${dateCode}:${records.length}:${days.length}`, () =>
    reconstruct(records, dateCode, year, days)
  );
}
const memo = new Map();
function cachedSync(key, make) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.v;
  const v = make();
  memo.set(key, { at: Date.now(), v });
  return v;
}
