import { sb, supabaseConfigured } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

// ダッシュボードの表・グラフに付ける「更新」バッジ用の、データごとの最後に動いた時刻。
// どれも updated_at の最新値を1件だけ見る（重い集計はしない）。
//
// ★ 表名・scope はクエリに埋め込むため、必ずこの固定の許可リストのみ。ユーザー入力は通さない。
const SOURCES = {
  // 進捗・期日・対応者・優先の変更（プロジェクト管理での編集）
  edits: ["task_override?scope=in.(adhoc,regular,pending)", "task_assign?", "task_priority?"],
  // スケジュール：タスクの期間と、スケジュールに入れた予定
  schedule: ["task_override?scope=in.(adhoc,regular,pending,event)"],
  // 作業工数の入力
  kosu: ["kosu_entry?"],
};

async function latest(q) {
  const sep = q.endsWith("?") ? "" : "&";
  const rows = await sb(`${q}${sep}select=updated_at&order=updated_at.desc.nullslast&limit=1`);
  return rows?.[0]?.updated_at || null;
}

export async function GET() {
  if (!supabaseConfigured()) return Response.json({ times: {} });
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([key, queries]) => {
      const times = await Promise.all(queries.map((q) => latest(q).catch(() => null)));
      return [key, times.filter(Boolean).sort().pop() || null];
    })
  );
  return Response.json({ times: Object.fromEntries(entries) });
}
