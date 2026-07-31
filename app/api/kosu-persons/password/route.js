import { supabaseConfigured } from "../../../../lib/supabase";
import { findAllowedPerson } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function adminFetch(path, init = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function findAuthUser(email) {
  const r = await adminFetch(`/auth/v1/admin/users?per_page=200`);
  if (!r.ok) return null;
  const list = r.data?.users || r.data || [];
  return (
    list.find(
      (u) => String(u?.email || "").toLowerCase() === String(email).toLowerCase()
    ) || null
  );
}

// 管理者が担当者のログインパスワードを設定/変更する。
// パスワードはサーバー経由で Supabase に渡すだけで、保存・記録は一切しない。
export async function POST(req) {
  if (!supabaseConfigured() || !SERVICE) {
    return Response.json(
      { error: "Supabase（service_role キー）が未設定です" },
      { status: 200 }
    );
  }
  try {
    const { email, password } = await req.json();
    if (!email) return Response.json({ error: "メールアドレスが必要です" }, { status: 200 });
    if (!password || String(password).length < 8) {
      return Response.json(
        { error: "パスワードは8文字以上にしてください" },
        { status: 200 }
      );
    }

    // 許可リストに載っている担当者のみ操作対象
    const person = await findAllowedPerson(email);
    if (!person) {
      return Response.json(
        { error: "先に「メール登録」と「ログイン許可」を行ってください" },
        { status: 200 }
      );
    }

    const existing = await findAuthUser(email);
    if (existing) {
      const r = await adminFetch(`/auth/v1/admin/users/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        return Response.json(
          { error: `パスワード更新に失敗しました (${r.status})` },
          { status: 200 }
        );
      }
      return Response.json({ ok: true, mode: "updated", name: person.name });
    }

    const r = await adminFetch(`/auth/v1/admin/users`, {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!r.ok) {
      const msg =
        typeof r.data === "object" ? JSON.stringify(r.data).slice(0, 200) : String(r.data).slice(0, 200);
      return Response.json(
        { error: `アカウント作成に失敗しました (${r.status}) ${msg}` },
        { status: 200 }
      );
    }
    return Response.json({ ok: true, mode: "created", name: person.name });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
