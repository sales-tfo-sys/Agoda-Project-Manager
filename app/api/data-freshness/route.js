import { sb, supabaseConfigured } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

// ダッシュボードの「最終更新日時」に出す、データごとの最後に動いた時刻。
// どれもデータベースの updated_at の最新値を1件だけ見る（重い集計はしない）。
//
// ★ 表名・scope はクエリに埋め込むため、必ずこの固定の許可リストのみ。ユーザー入力は通さない。
const SOURCES = [
  {
    key: "edits",
    label: "タスクの編集（プロジェクト管理）",
    note: "進捗・期日・対応者・優先の変更",
    queries: [
      "task_override?scope=in.(adhoc,regular,pending)",
      "task_assign?",
      "task_priority?",
    ],
  },
  {
    key: "kosu",
    label: "作業工数の入力",
    note: "作業工数入力ページ",
    queries: ["kosu_entry?"],
  },
  {
    key: "daily",
    label: "進捗グラフ（日次の記録）",
    note: "グラフを開いた日に自動で記録",
    queries: ["task_override?scope=in.(pdaily,adaily)"],
  },
];

async function latest(q) {
  const sep = q.endsWith("?") ? "" : "&";
  const rows = await sb(`${q}${sep}select=updated_at&order=updated_at.desc.nullslast&limit=1`);
  return rows?.[0]?.updated_at || null;
}

export async function GET() {
  if (!supabaseConfigured()) return Response.json({ rows: [] });
  const rows = await Promise.all(
    SOURCES.map(async (s) => {
      const times = await Promise.all(s.queries.map((q) => latest(q).catch(() => null)));
      const at = times.filter(Boolean).sort().pop() || null;
      // 利用者の操作で動くものなので、古くても「異常」ではない（注意の判定には使わない）
      return { key: s.key, label: s.label, note: s.note, at, watch: false };
    })
  );
  return Response.json({ rows });
}
