// Ad Hoc タスクの Supabase 保存（adhoc_item）を扱うヘルパー。
//   通常表示は保存済みデータを読む（シートは取込ボタンのときだけ読む）。
import { sb, supabaseConfigured } from "./supabase";
import { fetchAdhocFromSheet } from "./adhocSheet";

// 保存済みの Ad Hoc タスクを読む。未取込なら null（空配列ではなく null）。
export async function readAdhocItems() {
  if (!supabaseConfigured()) return null;
  // 並びはダッシュボード側で優先順に並べ替えるため、ここは task 名順で十分。
  const rows = await sb("adhoc_item?select=task,data,updated_at&order=task").catch(() => null);
  if (!Array.isArray(rows)) return null; // テーブル未作成など
  if (rows.length === 0) return null; // 未取込
  // data に task 名も入れて返す（シートの GET と同じ形）
  return rows.map((r) => ({ ...(r.data || {}), task: r.task, updated_at: r.updated_at }));
}

// シートから取得して adhoc_item に upsert する（手動取込）。取り込んだ件数を返す。
export async function importAdhocFromSheet() {
  if (!supabaseConfigured()) throw new Error("Supabase が未設定です");
  const tasks = await fetchAdhocFromSheet();
  if (!tasks.length) return 0;
  const now = new Date().toISOString();
  const rows = tasks.map((t) => ({ task: t.task, data: t, updated_at: now }));
  await sb("adhoc_item?on_conflict=task", {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  return rows.length;
}
