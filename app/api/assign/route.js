import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// 作業ごとのアサイン（担当者）を取得。担当者マスタも同時に返す。
// scope: 'regular'（今年の案件タイプ）/ 'pending'（前年繰越）/ 'adhoc'（Ad Hocタスク名）
export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, items: [], persons: [] });
  }
  // task_assign が未作成でも担当者一覧は返す（SQL実行前でも画面が壊れないように）
  const [items, persons] = await Promise.all([
    sb("task_assign?select=scope,key,person_id,role&order=role,updated_at").catch(() => null),
    sb("kosu_person?active=eq.true&order=sort_order&select=id,name,role").catch(() => null),
  ]);
  return Response.json({
    configured: true,
    items: items || [],
    persons: persons || [],
    ready: items !== null, // false = task_assign テーブル未作成
  });
}

// アサインの設定。personIds の並び順そのままで保存し、先頭を主担当(main)にする。
// 空配列を送るとその作業のアサインを全解除。
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
    const ids = Array.isArray(b?.personIds)
      ? b.personIds.map((v) => String(v)).filter((v) => /^[0-9a-f-]{36}$/i.test(v))
      : [];

    // 差し替え方式（1作業あたり数件のため、消して入れ直すのが最も単純で確実）
    const q = `scope=eq.${encodeURIComponent(scope)}&key=eq.${encodeURIComponent(key)}`;
    await sb(`task_assign?${q}`, { method: "DELETE", prefer: "return=minimal" });

    if (ids.length) {
      const now = new Date().toISOString();
      const rows = ids.map((person_id, i) => ({
        scope,
        key,
        person_id,
        role: i === 0 ? "main" : "sub", // 先頭＝主担当
        updated_at: now,
      }));
      await sb("task_assign", { method: "POST", body: rows, prefer: "return=minimal" });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
