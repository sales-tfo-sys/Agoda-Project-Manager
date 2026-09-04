import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm, invalidatePagePerms } from "../../../lib/auth";
import { computePages, PAGES } from "../../../lib/pages";

export const dynamic = "force-dynamic";

// 対象ユーザーの実効ページ権限（既定＋保存済みの上書き）を返す。閲覧権限が必要。
export async function GET(req) {
  const denied = await denyUnlessPerm(req, "viewAccounts");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ configured: false });
  const personId = new URL(req.url).searchParams.get("personId");
  if (!personId) return Response.json({ error: "personId が必要です" }, { status: 200 });
  try {
    const prRows = await sb(
      `kosu_person?id=eq.${encodeURIComponent(personId)}&select=role,can_edit_accounts,can_edit_tasks`
    );
    const pr = prRows?.[0];
    const role = pr?.role || "member";
    const rows = await sb(
      `task_override?scope=eq.pageperm&key=eq.${encodeURIComponent(personId)}&select=data`
    );
    const stored = rows?.[0]?.data || null;
    const pages = computePages(role, !!pr?.can_edit_accounts, !!pr?.can_edit_tasks, stored);
    return Response.json({ role, pages });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}

// ページ権限を保存。アカウント編集権限が必要。オーナーは常に全権のため設定不可。
export async function PUT(req) {
  const denied = await denyUnlessPerm(req, "editAccounts");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未接続" }, { status: 200 });
  try {
    const b = await req.json();
    const personId = String(b?.personId || "").trim();
    const inPages = b?.pages && typeof b.pages === "object" ? b.pages : null;
    if (!personId || !inPages) {
      return Response.json({ error: "personId と pages が必要です" }, { status: 200 });
    }
    const prRows = await sb(`kosu_person?id=eq.${encodeURIComponent(personId)}&select=role`);
    if (prRows?.[0]?.role === "owner") {
      return Response.json({ error: "オーナーは常に全ページ権限を持ちます" }, { status: 200 });
    }
    // 既知のページキーのみに正規化。editable でないページの edit は常に false。
    const clean = {};
    for (const pg of PAGES) {
      const o = inPages[pg.key];
      clean[pg.key] = { view: !!(o && o.view), edit: pg.editable ? !!(o && o.edit) : false };
    }
    await sb("task_override?on_conflict=scope,key", {
      method: "POST",
      body: [{ scope: "pageperm", key: personId, data: { pages: clean }, updated_at: new Date().toISOString() }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    invalidatePagePerms(personId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
