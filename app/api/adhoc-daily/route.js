import { readSnapshot } from "@/lib/kintoneSnapshot";
import { sb, supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Ad Hoc Task の日ごとの受注数・完了数。
//
// Regular と違い、Ad Hoc の件数は連携先のスプレッドシートの「今の値」しか読めない。
// 過去に遡って数え直すことができないので、画面を開いたときにその日の値を記録していく。
//   保存先は task_override（scope="adaily", key="YYYY-MM-DD"）。
//   data = { "<タスク名>": { t: 受注数, d: 完了数, g: 目標 } }
// 記録より前のぶんは、担当が付けていた記録を取り込んで入れてある。
//
// 例外は IHM_Room / IHM_Plan / IHM_CM で、これは Kintone に元データがあるので
// Regular と同じやり方で過去に遡って数え直せる（記録が無くても線が出る）。

const SCOPE = "adaily";
const TYPE_CODE = "ドロップダウン_13"; // 案件名
const WORK_TYPE_CODE = "ドロップダウン_8"; // ★作業区分（IHM用）
const STAGE_CODE = "ドロップダウン"; // Stage
const STAGE_DATE = "日付"; // ★Stage変更日
const IHM_SUBTASKS = { IHM_Room: "Room", IHM_Plan: "Plan", IHM_CM: "CM" };

const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function toIso(v) {
  const s = typeof v === "object" && v ? v.value : v;
  const m = String(s || "").match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : null;
}

// 土日を除いた日付の並び（対象年の1/1から、今日か年末の早い方まで）
function businessDays(year) {
  const out = [];
  const now = new Date();
  const last = now.getFullYear() > year ? new Date(year, 11, 31) : now;
  for (const d = new Date(year, 0, 1); d <= last; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w === 0 || w === 6) continue;
    out.push(iso(d));
  }
  return out;
}

// IHM の3タスクを Kintone から日ごとに数え直す。
//   受注数 = 事前登録・失注・対応不要を除いた件数（その日までに入ったもの）
//   完了数 = Stage が「完了」で、★Stage変更日がその日まで
function fromKintone(records, dateCode, days) {
  const rows = {};
  for (const key of Object.keys(IHM_SUBTASKS)) rows[key] = [];
  for (const r of records) {
    const type = String(r?.[TYPE_CODE]?.value || "").trim();
    if (type !== "IHM") continue;
    const sub = String(r?.[WORK_TYPE_CODE]?.value || "").trim();
    const key = Object.keys(IHM_SUBTASKS).find((k) => IHM_SUBTASKS[k] === sub);
    if (!key) continue;
    // 「いつ入ったか」は選んでいる基準日。無ければ作成日時で代用する
    const base = toIso(r?.[dateCode]) || toIso(r?.["作成日時"]);
    if (!base) continue;
    const stage = r?.[STAGE_CODE]?.value || "";
    const excluded =
      stage.includes("事前登録") || stage.includes("失注") || stage.includes("対応不要");
    const doneOn = stage === "完了" ? toIso(r?.[STAGE_DATE]) || base : null;
    rows[key].push({ base, excluded, doneOn });
  }

  const out = {};
  for (const key of Object.keys(IHM_SUBTASKS)) {
    const list = rows[key];
    if (!list.length) continue;
    out[key] = days.map((day) => {
      let t = 0;
      let d = 0;
      for (const r of list) {
        if (r.base > day) continue;
        if (!r.excluded) t += 1;
        if (r.doneOn && r.doneOn <= day) d += 1;
      }
      return { total: t, done: d };
    });
  }
  return out;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const dateCode = searchParams.get("date") || "作成日時";
  try {
    const days = businessDays(year);
    const series = {};

    // ① 記録済みの日を並べる。記録が無い日は直前の値を引き継ぐ（線を切らさない）
    if (supabaseConfigured()) {
      const saved =
        (await sb(`task_override?scope=eq.${SCOPE}&select=key,data&order=key`).catch(() => [])) ||
        [];
      const byDay = new Map();
      for (const row of saved) byDay.set(row.key, row.data || {});
      const carry = {}; // タスク → 直前の値
      days.forEach((day, i) => {
        const rec = byDay.get(day);
        if (rec) {
          for (const [task, v] of Object.entries(rec)) {
            // 目標は画面からの記録には入らないので、無ければ前の日の値を引き継ぐ
            const g = v?.g ?? carry[task]?.target ?? null;
            carry[task] = { total: v?.t ?? 0, done: v?.d ?? 0, target: g };
          }
        }
        for (const [task, v] of Object.entries(carry)) {
          if (!series[task]) series[task] = days.map(() => null);
          series[task][i] = v;
        }
      });
    }

    // ② IHM は Kintone から数え直す（記録より前も線が出る）
    const snap = await readSnapshot().catch(() => null);
    const records = snap?.data?.records || [];
    const kintone = []; // Kintone から数え直したタスク（画面で年を付けて出す）
    if (records.length) {
      const ihm = fromKintone(records, dateCode, days);
      for (const [task, list] of Object.entries(ihm)) {
        series[task] = list;
        kintone.push(task);
      }
    }

    return Response.json({ days, series, kintone });
  } catch (e) {
    return Response.json({ days: [], series: {}, error: String(e?.message || e) }, { status: 200 });
  }
}

// 数値化（"1,234" → 1234／数値でなければ null）
function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

// その日の値を記録する。
//   { items: { "<タスク名>": { total, done, target } } }        … 今日ぶん（画面から）
//   { rows: [{ date, task, total, done, target }, ...] }        … 過去ぶんのまとめ取り込み
export async function POST(req) {
  if (!supabaseConfigured()) return Response.json({ ok: false, error: "Supabase 未設定" });
  try {
    const body = await req.json();
    const byDay = new Map(); // 日付 → { タスク: {t,d,g} }
    const put = (date, task, v) => {
      const t = toNum(v.total);
      const d = toNum(v.done);
      if (t == null && d == null) return;
      if (!byDay.has(date)) byDay.set(date, {});
      const rec = { t: t ?? 0, d: d ?? 0 };
      const g = toNum(v.target);
      if (g != null) rec.g = g;
      byDay.get(date)[task] = rec;
    };

    if (body?.items) {
      const date = toIso(body.date) || iso(new Date());
      for (const [task, v] of Object.entries(body.items)) put(date, task, v || {});
    }
    for (const r of body?.rows || []) {
      const date = toIso(r?.date);
      if (date && r?.task) put(date, r.task, r);
    }
    if (!byDay.size) return Response.json({ ok: true, days: 0 });

    // 同じ日の記録が既にあるときは、消さずに混ぜる（タスクごとに上書き）
    const keys = [...byDay.keys()];
    const existing =
      (await sb(
        `task_override?scope=eq.${SCOPE}&key=in.(${keys
          .map((k) => `"${k}"`)
          .join(",")})&select=key,data`
      ).catch(() => [])) || [];
    const prev = new Map(existing.map((r) => [r.key, r.data || {}]));

    const now = new Date().toISOString();
    const rows = keys.map((k) => ({
      scope: SCOPE,
      key: k,
      data: { ...(prev.get(k) || {}), ...byDay.get(k) },
      updated_at: now,
    }));
    // 一度に投げると大きくなりすぎるので分けて送る
    for (let i = 0; i < rows.length; i += 100) {
      await sb("task_override?on_conflict=scope,key", {
        method: "POST",
        body: rows.slice(i, i + 100),
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    }
    return Response.json({ ok: true, days: rows.length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
