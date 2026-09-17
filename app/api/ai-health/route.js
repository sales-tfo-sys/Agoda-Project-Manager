import { NextResponse } from "next/server";
import { sb, supabaseConfigured } from "@/lib/supabase";
import { denyUnlessPerm, getPerms } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 月1回の「AI健康診断」。
//   ボタンを押すと、データベースの点検（読み取りのみ）を実行して結果を自動で残す。
//   点検の中身は db/sys_advisor.sql の関数（Supabase に1回だけ貼って作る）。
//
//   GET                       … 直近の記録と、今月やったかどうか
//   POST { run: true }        … いま診断して、結果を記録する
//   POST { month, kind, note} … 手で書いたメモを残す（kind: security | performance）
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

    // ── いま診断する ──
    if (b?.run) {
      const { session } = await getPerms(req);
      const who = session?.name || session?.email || "";
      let res;
      try {
        res = await sb("rpc/sys_advisor", { method: "POST", body: {} });
      } catch (e) {
        const msg = String(e?.message || e);
        // 関数がまだ無いときは、やることをそのまま伝える
        if (/PGRST202|does not exist|Not Found|404/i.test(msg)) {
          return NextResponse.json({
            error:
              "点検用の関数がまだありません。db/sys_advisor.sql を Supabase の SQL Editor に貼って1回実行してください。",
          });
        }
        return NextResponse.json({ error: msg });
      }
      const out = Array.isArray(res) ? res[0] : res;
      const findings = out?.findings || [];
      const month = monthKey();
      const at = new Date().toISOString();
      const pick = (kind) => findings.filter((f) => f?.kind === kind);

      const cur = await sb(
        `task_override?scope=eq.${SCOPE}&key=eq.${encodeURIComponent(month)}&select=data`
      ).catch(() => []);
      const data = { ...(cur?.[0]?.data || {}) };
      for (const kind of ["security", "performance"]) {
        data[kind] = {
          ...(data[kind] || {}),
          at,
          by: who,
          auto: true,
          findings: pick(kind),
        };
      }
      await sb("task_override?on_conflict=scope,key", {
        method: "POST",
        body: [{ scope: SCOPE, key: month, data, updated_at: at }],
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      return NextResponse.json({ ok: true, month, data, total: findings.length });
    }
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
