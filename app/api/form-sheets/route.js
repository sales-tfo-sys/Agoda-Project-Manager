import { randomUUID } from "node:crypto";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPerm } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// フォーム回答シートの登録一覧。新テーブルは作らず task_override(scope=form)に保存する。
//   data = { title, url, sort }
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ items: [] });
  try {
    const rows = await sb("task_override?scope=eq.form&select=key,data");
    const items = (rows || [])
      .map((r) => ({
        id: r.key,
        title: r.data?.title || "(無題)",
        url: r.data?.url || "",
        sort: r.data?.sort ?? 0,
      }))
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, "ja"));
    return Response.json({ items });
  } catch (e) {
    return Response.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}

export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const title = String(b?.title || "").trim();
    const url = String(b?.url || "").trim();
    if (!title || !url) return Response.json({ error: "名前とURLは必須です" }, { status: 200 });
    const rows = await sb("task_override?scope=eq.form&select=data");
    const maxSort = (rows || []).reduce((m, r) => Math.max(m, r.data?.sort || 0), 0);
    const key = randomUUID();
    await sb("task_override", {
      method: "POST",
      body: { scope: "form", key, data: { title, url, sort: maxSort + 1 } },
      prefer: "return=minimal",
    });
    return Response.json({ ok: true, id: key });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}

export async function PATCH(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const id = b?.id;
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    const rows = await sb(
      `task_override?scope=eq.form&key=eq.${encodeURIComponent(id)}&select=data`
    );
    const cur = rows?.[0]?.data || {};
    const next = { ...cur };
    if (b.title !== undefined) next.title = String(b.title).trim();
    if (b.url !== undefined) next.url = String(b.url).trim();
    if (b.sort !== undefined) next.sort = Number(b.sort);
    await sb(`task_override?scope=eq.form&key=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { data: next },
      prefer: "return=minimal",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}

export async function DELETE(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    await sb(`task_override?scope=eq.form&key=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
