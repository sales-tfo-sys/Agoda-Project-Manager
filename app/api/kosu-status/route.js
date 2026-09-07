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
    // role は工数入力で管理者を除外するために使う。
    // 退職者も active=false 付きで返す：過去の工数を参照できるようにするため
    // （入力欄は出さない。画面側で active を見て出し分ける）。
    const rows = await sb(
      "kosu_person?order=active.desc,sort_order&select=id,name,role,active"
    );
    const persons =
      Array.isArray(rows) && rows.length
        ? rows.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role || "member",
            active: r.active !== false,
          }))
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
