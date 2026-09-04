import { randomUUID } from "node:crypto";
import { sb, supabaseConfigured } from "../../../lib/supabase";
import { denyUnlessPageEdit } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// HID新規発行依頼（すべて手動入力）。task_override(scope=hidreq)に1行=1レコードで保存する。
//   data = { fields:{...}, sort, createdAt }
export async function GET() {
  if (!supabaseConfigured()) return Response.json({ items: [] });
  try {
    const rows = await sb("task_override?scope=eq.hidreq&select=key,data");
    const items = (rows || [])
      .map((r) => ({
        id: r.key,
        fields: r.data?.fields || {},
        sort: r.data?.sort ?? 0,
        createdAt: r.data?.createdAt || 0,
      }))
      .sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ items: [], error: String(e?.message || e) }, { status: 200 });
  }
}

export async function POST(req) {
  const denied = await denyUnlessPageEdit(req, "hid");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const fields = b?.fields && typeof b.fields === "object" ? b.fields : {};
    const rows = await sb("task_override?scope=eq.hidreq&select=data");
    const maxSort = (rows || []).reduce((m, r) => Math.max(m, r.data?.sort || 0), 0);
    const key = randomUUID();
    await sb("task_override", {
      method: "POST",
      body: { scope: "hidreq", key, data: { fields, sort: maxSort + 1, createdAt: Date.now() } },
      prefer: "return=minimal",
    });
    return Response.json({ ok: true, id: key });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}

export async function PATCH(req) {
  const denied = await denyUnlessPageEdit(req, "hid");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const b = await req.json();
    const id = b?.id;
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    const rows = await sb(
      `task_override?scope=eq.hidreq&key=eq.${encodeURIComponent(id)}&select=data`
    );
    const cur = rows?.[0]?.data || {};
    const next = { ...cur };
    if (b.fields && typeof b.fields === "object") next.fields = { ...(cur.fields || {}), ...b.fields };
    if (b.sort !== undefined) next.sort = Number(b.sort);
    await sb(`task_override?scope=eq.hidreq&key=eq.${encodeURIComponent(id)}`, {
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
  const denied = await denyUnlessPageEdit(req, "hid");
  if (denied) return denied;
  if (!supabaseConfigured()) return Response.json({ error: "Supabase 未設定です" }, { status: 200 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id が必要です" }, { status: 200 });
    await sb(`task_override?scope=eq.hidreq&key=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
