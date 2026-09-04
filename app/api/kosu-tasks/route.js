import { supabaseConfigured, sb } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// 作業マスタ一覧
export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, tasks: [] });
  }
  try {
    // プロジェクト管理で改名したタスクは task_override(scope=adhoc) の name に入る。
    // kosu_task.content は作成時の名前のままなので、ここで表示名を差し替えて
    // 工数入力・工数明細でもダッシュボードと同じ名前が出るようにする。
    const [tasks, ovr] = await Promise.all([
      sb("kosu_task?active=eq.true&order=sort_order,created_at&select=*"),
      sb("task_override?scope=eq.adhoc&select=key,data").catch(() => null),
    ]);
    const rows = tasks || [];
    const renamed = {};
    // グルーピング（kosuLink）：ダッシュボードで複数の名前に分かれている作業を
    // 工数側では「まとめ先」1つに集約する（元の行は工数入力・工数明細に出さない）。
    const linkTo = {};
    for (const o of ovr || []) {
      const n = o?.data?.name;
      if (n && n !== o.key) renamed[o.key] = n;
      const g = o?.data?.kosuLink;
      if (g && g !== o.key) linkTo[o.key] = g;
    }
    const out = rows.map((t) =>
      renamed[t.content] ? { ...t, content: renamed[t.content], original_content: t.content } : t
    );

    // まとめ先が実在するものだけを集約対象にする
    const origNames = new Set(rows.map((t) => t.content));
    const hide = new Set(
      Object.keys(linkTo).filter((k) => origNames.has(k) && origNames.has(linkTo[k]))
    );
    // すでに工数実績がある作業は、履歴が見えなくなるため集約しない（そのまま残す）
    if (hide.size) {
      const ids = rows.filter((t) => hide.has(t.content)).map((t) => t.id);
      if (ids.length) {
        const used = await sb(
          `kosu_entry?task_id=in.(${ids.join(",")})&select=task_id`
        ).catch(() => null);
        const usedIds = new Set((used || []).map((e) => e.task_id));
        for (const t of rows) if (usedIds.has(t.id)) hide.delete(t.content);
      }
    }
    const merged = out.filter((t) => !hide.has(t.original_content ?? t.content));
    return Response.json({ configured: true, tasks: merged });
  } catch (e) {
    return Response.json({ configured: true, tasks: [], error: String(e?.message || e) });
  }
}

// 作業内容の追加
export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  try {
    const b = await req.json();
    if (!b?.task_type || !b?.content) {
      return Response.json({ error: "タスク種別と作業内容は必須です" }, { status: 200 });
    }
    const row = {
      task_type: String(b.task_type).trim(),
      content: String(b.content).trim(),
      unit: b.unit === "time" ? "time" : "count",
      sort_order: Number.isFinite(b.sort_order) ? b.sort_order : 999,
      active: true,
    };
    const data = await sb("kosu_task", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    });
    return Response.json({ task: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}

// 作業内容の更新（並べ替え・単位変更・無効化など）
export async function PATCH(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  try {
    const b = await req.json();
    if (!b?.id) return Response.json({ error: "id が必要です" }, { status: 200 });
    const patch = {};
    for (const k of ["task_type", "content", "unit", "sort_order", "active", "completed"]) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (b.completed !== undefined) {
      patch.completed_on = b.completed ? new Date().toISOString().slice(0, 10) : null;
    }
    const data = await sb(`kosu_task?id=eq.${encodeURIComponent(b.id)}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    return Response.json({ task: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
