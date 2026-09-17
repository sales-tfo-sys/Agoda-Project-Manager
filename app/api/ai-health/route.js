import { NextResponse } from "next/server";
import { sb, supabaseConfigured } from "@/lib/supabase";
import { denyUnlessPerm, getPerms } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 月1回の「AI健康診断」の記録。
//   Supabase の Security / Performance の点検は Supabase の管理画面で行うものなので、
//   このサイトでは「いつ・誰が・何を見つけたか」を残して、やり忘れを防ぐ役割を持つ。
//
//   GET                       … 直近の記録と、今月やったかどうか
//   POST { month, kind, note} … 実施した記録を残す（kind: security | performance）
//
// 置き場所は task_override（scope="aihealth", key="YYYY-MM"）。

const SCOPE = "aihealth";
const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Supabase のプロジェクト参照（管理画面へのリンクを作るのに使う）
function projectRef() {
  const m = String(process.env.SUPABASE_URL || "").match(/^https?:\/\/([a-z0-9-]+)\.supabase\./i);
  return m ? m[1] : null;
}

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ items: [], ref: null });
  try {
    const rows = await sb(`task_override?scope=eq.${SCOPE}&select=key,data&order=key.desc&limit=12`).catch(
      () => []
    );
    const items = (rows || []).map((r) => ({ month: r.key, ...(r.data || {}) }));
    return NextResponse.json({ items, month: monthKey(), ref: projectRef() });
  } catch (e) {
    return NextResponse.json({ items: [], error: String(e?.message || e) });
  }
}

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase 未設定です" });
  try {
    const b = await req.json();
    const month = /^\d{4}-\d{2}$/.test(String(b?.month || "")) ? String(b.month) : monthKey();
    const kind = b?.kind === "performance" ? "performance" : "security";
    const note = String(b?.note ?? "").slice(0, 2000);
    const { session } = await getPerms(req);
    const who = session?.name || session?.email || "";

    const cur = await sb(
      `task_override?scope=eq.${SCOPE}&key=eq.${encodeURIComponent(month)}&select=data`
    ).catch(() => []);
    const data = { ...(cur?.[0]?.data || {}) };
    data[kind] = { at: new Date().toISOString(), by: who, note };

    await sb("task_override?on_conflict=scope,key", {
      method: "POST",
      body: [{ scope: SCOPE, key: month, data, updated_at: new Date().toISOString() }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return NextResponse.json({ ok: true, month, data });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
