import { cached } from "../../../lib/cache";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { extractSheetId, extractGid, fetchSheetCell } from "../../../lib/sheetCell";

export const dynamic = "force-dynamic";

// 数値化（"1,234" → 1234／数値でなければ null）
function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

// Ad Hoc タスクごとに登録したシート（URL＋シート名＋セル）から
// 受注数・完了数を取得して { items: { [taskKey]: { total, done } } } を返す。
// 設定は task_override.data（scope=adhoc）に保存されている。
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ items: {} });
  try {
    const rows = await sb("task_override?scope=eq.adhoc&select=key,data");
    const items = {};
    const cell = (id, gid, ref) =>
      ref
        ? cached(`sheetcell:${id}:${gid || ""}:${ref}`, 60 * 1000, () =>
            fetchSheetCell(id, gid, ref)
          ).catch(() => null)
        : Promise.resolve(null);

    await Promise.all(
      (rows || []).map(async (row) => {
        const d = row.data || {};
        const id = extractSheetId(d.sheetUrl);
        // タブは URL の gid で特定する（受注数・完了数は同じタブ前提）
        const gid = extractGid(d.sheetUrl);
        if (!id || (!d.orderCell && !d.doneCell)) return;
        const [order, done] = await Promise.all([
          cell(id, gid, d.orderCell),
          cell(id, gid, d.doneCell),
        ]);
        items[row.key] = { total: toNum(order), done: toNum(done) };
      })
    );

    return Response.json({ items });
  } catch (e) {
    return Response.json({ items: {}, error: String(e?.message || e) }, { status: 200 });
  }
}
