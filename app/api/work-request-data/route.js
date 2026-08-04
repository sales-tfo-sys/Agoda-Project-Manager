import { cached } from "../../../lib/cache";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { fetchSheetGrid } from "../../../lib/formSheet";

export const dynamic = "force-dynamic";

// 各行のキー：先頭列（タイムスタンプ）。空なら行番号でフォールバック。
function rowKeyOf(row, idx) {
  const ts = String(row?.[0] ?? "").trim();
  return ts || `#${idx}`;
}

// 登録済み作業依頼シート（id）の中身＋手動入力3列（レコード作成/レコードNo/作業完了日）を返す。
export async function GET(req) {
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    const rows = await sb(
      `task_override?scope=eq.workreq&key=eq.${encodeURIComponent(id)}&select=data`
    );
    const url = rows?.[0]?.data?.url;
    if (!url) return Response.json({ error: "URLが未登録です" }, { status: 200 });

    const grid = await cached(`workreqgrid:${id}`, 60 * 1000, () => fetchSheetGrid(url));
    if (grid?.error) return Response.json(grid);

    // 手動入力の overlay を読み込む（scope=workreqcell, key=`<sheetId>::<rowKey>`）
    // key の前方一致で該当シート分だけ取得する（like の * は PostgREST のワイルドカード）。
    const prefix = `${id}::`;
    const cellRows = await sb(
      `task_override?scope=eq.workreqcell&key=like.${encodeURIComponent(id)}::*&select=key,data`
    );
    const overlay = {};
    for (const c of cellRows || []) {
      if (typeof c.key === "string" && c.key.startsWith(prefix)) {
        overlay[c.key.slice(prefix.length)] = c.data || {};
      }
    }

    const rowKeys = (grid.rows || []).map((r, i) => rowKeyOf(r, i));
    return Response.json({ ...grid, rowKeys, overlay });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
