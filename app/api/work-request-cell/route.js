import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// 作業依頼シートの1行に対する手動入力（レコード作成/レコードNo/作業完了日）を保存する。
//   scope=workreqcell, key=`<sheetId>::<rowKey>`, data={ created, recordNo, doneDate }
export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const sheetId = String(b?.sheetId || "").trim();
    const rowKey = String(b?.rowKey ?? "").trim();
    if (!sheetId || !rowKey) return Response.json({ error: "sheetId と rowKey が必要です" }, { status: 200 });
    const data = {
      created: !!b?.created,
      recordNo: String(b?.recordNo ?? "").trim(),
      doneDate: String(b?.doneDate ?? "").trim(),
    };
    const key = `${sheetId}::${rowKey}`;
    const enc = encodeURIComponent(key);
    const exist = await sb(`task_override?scope=eq.workreqcell&key=eq.${enc}&select=key`);
    if (exist && exist.length) {
      await sb(`task_override?scope=eq.workreqcell&key=eq.${enc}`, {
        method: "PATCH",
        body: { data },
        prefer: "return=minimal",
      });
    } else {
      await sb("task_override", {
        method: "POST",
        body: { scope: "workreqcell", key, data },
        prefer: "return=minimal",
      });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
