import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// 編集した内容（上書き）を取得
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ configured: false, items: [] });
  const items = await sb("task_override?select=scope,key,data,updated_at").catch(() => null);
  return Response.json({
    configured: true,
    items: items || [],
    ready: items !== null, // false = task_override テーブル未作成
  });
}

// 上書きの保存。data は「編集後の全項目」を丸ごと受け取る（部分マージはしない）。
// 空文字・null の項目は削除して、元データの値に戻す。
export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  try {
    const b = await req.json();
    const scope = String(b?.scope || "").trim();
    const key = String(b?.key || "").trim();
    if (!scope || !key) {
      return Response.json({ error: "scope と key が必要です" }, { status: 200 });
    }
    const src = b?.data && typeof b.data === "object" ? b.data : {};
    const data = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === undefined || v === "") continue; // 未入力は保存しない
      data[k] = typeof v === "string" ? v.slice(0, 2000) : v;
    }

    if (Object.keys(data).length === 0) {
      // 全項目が空 → 上書き自体を削除して元データに戻す
      await sb(
        `task_override?scope=eq.${encodeURIComponent(scope)}&key=eq.${encodeURIComponent(key)}`,
        { method: "DELETE", prefer: "return=minimal" }
      );
      return Response.json({ ok: true, cleared: true });
    }

    await sb("task_override?on_conflict=scope,key", {
      method: "POST",
      body: [{ scope, key, data, updated_at: new Date().toISOString() }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
