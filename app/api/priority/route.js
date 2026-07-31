import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// 作業優先順の取得
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ configured: false, items: [] });
  try {
    const items = await sb("task_priority?select=scope,key,priority");
    return Response.json({ configured: true, items: items || [] });
  } catch (e) {
    return Response.json({ configured: true, items: [], error: String(e?.message || e) });
  }
}

// 作業優先順の設定（空にすると解除）
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
    const p = b.priority;
    const priority = p === null || p === "" || p === undefined ? null : Number(p);
    if (priority !== null && !Number.isFinite(priority)) {
      return Response.json({ error: "優先順は数値で指定してください" }, { status: 200 });
    }
    await sb("task_priority?on_conflict=scope,key", {
      method: "POST",
      body: [{ scope, key, priority, updated_at: new Date().toISOString() }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
