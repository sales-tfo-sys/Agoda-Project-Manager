import { NextResponse } from "next/server";
import { sb, supabaseConfigured } from "@/lib/supabase";
import { denyUnlessPerm, getPerms } from "@/lib/auth";
import { SCOPE, monthKey, projectRef, runAndSave } from "@/lib/aiHealth";

export const dynamic = "force-dynamic";

// 月1回の「AI健康診断」。
//   点検の中身は Supabase 公式の Advisors（lib/aiHealth.js）。
//   SUPABASE_ACCESS_TOKEN が無いときだけ、予備として自作SQL（db/sys_advisor.sql）で点検する。
//
//   GET                       … 直近の記録と、今月やったかどうか
//   POST { run: true }        … いま診断して、結果を記録する
//                               （security と performance の両方が取れたときだけ保存する）
//   POST { month, kind, note} … 手で書いたメモを残す（kind: security | performance）
//
// 置き場所は task_override（scope="aihealth", key="YYYY-MM"）。
// 月初の自動実行は /api/cron/ai-health（vercel.json の crons）。

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ items: [], ref: null });
  try {
    const rows = await sb(`task_override?scope=eq.${SCOPE}&select=key,data&order=key.desc&limit=12`).catch(
      () => []
    );
    const items = (rows || []).map((r) => ({ month: r.key, ...(r.data || {}) }));
    return NextResponse.json({
      items,
      month: monthKey(),
      ref: projectRef(),
      // 画面に「どちらで点検しているか」を出すため（トークンそのものは返さない）
      source: process.env.SUPABASE_ACCESS_TOKEN ? "advisors" : "sql",
    });
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
    const { session } = await getPerms(req);
    const who = session?.name || session?.email || "";

    // ── いま診断する ──
    if (b?.run) {
      try {
        const res = await runAndSave(who);
        return NextResponse.json({ ok: true, ...res });
      } catch (e) {
        // エラー文はこちらで作った意味だけ（トークンは含まれない）
        return NextResponse.json({ error: String(e?.message || e) });
      }
    }

    // ── 手で書いたメモ ──
    const month = /^\d{4}-\d{2}$/.test(String(b?.month || "")) ? String(b.month) : monthKey();
    const kind = b?.kind === "performance" ? "performance" : "security";
    const note = String(b?.note ?? "").slice(0, 2000);
    const cur = await sb(
      `task_override?scope=eq.${SCOPE}&key=eq.${encodeURIComponent(month)}&select=data`
    ).catch(() => []);
    const data = { ...(cur?.[0]?.data || {}) };
    data[kind] = { ...(data[kind] || {}), note, noteAt: new Date().toISOString(), noteBy: who };
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
