import { supabaseConfigured, sb } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// 作業マスタ一覧
export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, tasks: [] });
  }
  try {
    const tasks = await sb(
      "kosu_task?active=eq.true&order=sort_order,created_at&select=*"
    );
    return Response.json({ configured: true, tasks: tasks || [] });
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
