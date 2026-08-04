import { cached } from "../../../lib/cache";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { fetchSheetGrid } from "../../../lib/formSheet";

export const dynamic = "force-dynamic";

// 登録済み作業依頼シートの「件数」だけをまとめて返す（カード一覧用）。
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ counts: {} }, { status: 200 });
  try {
    const rows = await sb(`task_override?scope=eq.workreq&select=key,data`);
    const list = (rows || []).filter((r) => r?.data?.url);
    const results = await Promise.all(
      list.map(async (r) => {
        try {
          const data = await cached(`workreqgrid:${r.key}`, 60 * 1000, () =>
            fetchSheetGrid(r.data.url)
          );
          return [r.key, data?.error ? { error: data.error } : { total: data?.total ?? 0 }];
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
