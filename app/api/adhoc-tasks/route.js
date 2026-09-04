import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// サイトで追加した Ad Hoc タスク（スプレッドシート由来の分とは別に保持し、画面で結合する）
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ configured: false, tasks: [] });
  const tasks = await sb("adhoc_task?order=created_at&select=id,task").catch(() => null);
  return Response.json({
    configured: true,
    tasks: tasks || [],
    ready: tasks !== null, // false = adhoc_task テーブル未作成
  });
}

// タスクの追加
export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  try {
    const b = await req.json();
    const task = String(b?.task || "").trim();
    // プロジェクト管理で選んだ区分を工数側にも引き継ぐ。
    // Regular は「常時表示の作業」として工数入力に固定表示させる。
    const isRegular = String(b?.board || "") === "regular";
    if (!task) return Response.json({ error: "タスク名を入力してください" }, { status: 200 });
    if (task.length > 200) {
      return Response.json({ error: "タスク名が長すぎます" }, { status: 200 });
    }
    const data = await sb("adhoc_task", {
      method: "POST",
      body: { task },
      prefer: "return=representation",
    });

    // 工数明細・工数入力にも出るよう、作業マスタ（kosu_task）へ同じ名前で登録する。
    // 既に同名があれば何もしない。
    const dup = await sb(
      `kosu_task?content=eq.${encodeURIComponent(task)}&select=id&limit=1`
    ).catch(() => null);
    if (!dup || dup.length === 0) {
      const maxRow = await sb("kosu_task?select=sort_order&order=sort_order.desc&limit=1").catch(
        () => null
      );
      const order = (maxRow?.[0]?.sort_order || 0) + 1;
      await sb("kosu_task", {
        method: "POST",
        body: {
          task_type: isRegular ? "Regular task" : "Ad hoc task",
          content: task,
          unit: "count",
          sort_order: order,
          active: true,
        },
        prefer: "return=minimal",
      }).catch(() => null);
    }

    return Response.json({ task: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("duplicate")) {
      return Response.json({ error: "同じ名前のタスクが既にあります" }, { status: 200 });
    }
    return Response.json({ error: msg }, { status: 200 });
  }
}

// タスクの削除（サイトで追加した分のみ。優先順・担当・編集内容も併せて片付ける）
export async function DELETE(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため削除できません" }, { status: 200 });
  }
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const name = searchParams.get("task");
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    await sb(`adhoc_task?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    if (name) {
      const q = `scope=eq.adhoc&key=eq.${encodeURIComponent(name)}`;
      await Promise.all([
        sb(`task_override?${q}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => null),
        sb(`task_assign?${q}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => null),
        sb(`task_priority?${q}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => null),
      ]);
      // 作業マスタ側も片付ける。工数の入力が既にある場合は実績を残すため無効化にとどめる。
      const rows = await sb(
        `kosu_task?content=eq.${encodeURIComponent(name)}&select=id`
      ).catch(() => null);
      for (const t of rows || []) {
        const used = await sb(`kosu_entry?task_id=eq.${t.id}&select=id&limit=1`).catch(() => null);
        if (used && used.length) {
          await sb(`kosu_task?id=eq.${t.id}`, {
            method: "PATCH",
            body: { active: false },
            prefer: "return=minimal",
          }).catch(() => null);
        } else {
          await sb(`kosu_task?id=eq.${t.id}`, {
            method: "DELETE",
            prefer: "return=minimal",
          }).catch(() => null);
        }
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
