import { supabaseConfigured, sb } from "../../../lib/supabase";

// 未接続（デモ）時の仮メンバー
const DEMO_PERSONS = [
  { id: "demo-p0", name: "田中" },
  { id: "demo-p1", name: "長内" },
  { id: "demo-p2", name: "原" },
];

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = supabaseConfigured();
  if (!configured) {
    return Response.json({ configured: false, persons: DEMO_PERSONS });
  }
  try {
    // role は工数入力で管理者を除外するために使う
    const rows = await sb(
      "kosu_person?active=eq.true&order=sort_order&select=id,name,role"
    );
    const persons =
      Array.isArray(rows) && rows.length
        ? rows.map((r) => ({ id: r.id, name: r.name, role: r.role || "member" }))
        : [];
    return Response.json({ configured: true, persons });
  } catch (e) {
    return Response.json({
      configured: true,
      persons: [],
      error: String(e?.message || e),
    });
  }
}
