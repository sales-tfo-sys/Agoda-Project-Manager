import { cached } from "../../../lib/cache";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { fetchSheetGrid } from "../../../lib/formSheet";

export const dynamic = "force-dynamic";

// 各行の先頭列（タイムスタンプ）を Date 化する。"2024/06/07 21:19:01" 等を想定。
function parseTs(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s.replace(/-/g, "/"));
  return isNaN(d.getTime()) ? null : d;
}

// 登録済みフォームシートの「件数・今月分・最終回答日時」をまとめて返す（カード一覧＋集計バー用）。
// 各シートは form-sheet-data と同じキャッシュを共有する（60秒）。
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ counts: {} }, { status: 200 });
  try {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth();
    const rows = await sb(`task_override?scope=eq.form&select=key,data`);
    const list = (rows || []).filter((r) => r?.data?.url);
    const results = await Promise.all(
      list.map(async (r) => {
        try {
          const data = await cached(`formgrid:${r.key}`, 60 * 1000, () =>
            fetchSheetGrid(r.data.url)
          );
          if (data?.error) return [r.key, { error: data.error }];
          let month = 0;
          let latest = 0;
          for (const row of data.rows || []) {
            const d = parseTs(row?.[0]);
            if (!d) continue;
            if (d.getFullYear() === cy && d.getMonth() === cm) month++;
            const t = d.getTime();
            if (t > latest) latest = t;
          }
          return [r.key, { total: data?.total ?? 0, month, latest: latest || null }];
        } catch (e) {
          return [r.key, { error: String(e?.message || e) }];
        }
      })
    );
    return Response.json({ counts: Object.fromEntries(results) });
  } catch (e) {
    return Response.json({ counts: {}, error: String(e?.message || e) }, { status: 200 });
  }
}
