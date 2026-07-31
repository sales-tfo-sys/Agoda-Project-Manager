import { supabaseConfigured, sb } from "../../../lib/supabase";
import { getPerms } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// アカウント管理の編集権限を確認。{ perms } を返す。編集不可なら { resp }。
async function checkEdit(req) {
  const { perms } = await getPerms(req);
  if (!perms) {
    return { resp: Response.json({ error: "ログインが必要です" }, { status: 401 }) };
  }
  if (!perms.editAccounts) {
    return {
      resp: Response.json(
        { error: "アカウントを編集する権限がありません" },
        { status: 403 }
      ),
    };
  }
  return { perms };
}

// 担当者一覧（?all=1 で退職者含む全件）
export async function GET(req) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, persons: [] });
  }
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "1";
  try {
    const q = all
      ? "kosu_person?order=active.desc,sort_order&select=*"
      : "kosu_person?active=eq.true&order=sort_order&select=*";
    const persons = await sb(q);
    return Response.json({ configured: true, persons: persons || [] });
  } catch (e) {
    return Response.json({ configured: true, persons: [], error: String(e?.message || e) });
  }
}

// 担当者の追加
export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  const { resp, perms } = await checkEdit(req);
  if (resp) return resp;
  try {
    const b = await req.json();
    if (!b?.name || !String(b.name).trim()) {
      return Response.json({ error: "氏名は必須です" }, { status: 200 });
    }
    // 役割・権限フラグを設定できるのはオーナー（grantPerms）だけ。
    // それ以外が作成した場合は必ずメンバー・権限なしにする（昇格防止）
    const wantRole = ["owner", "admin", "member"].includes(b.role) ? b.role : "member";
    const role = perms.grantPerms ? wantRole : "member";
    const row = {
      name: String(b.name).trim(),
      email: b.email ? String(b.email).trim() : null,
      can_login: Boolean(b.can_login),
      role,
      can_edit_accounts: perms.grantPerms ? Boolean(b.can_edit_accounts) : false,
      can_edit_tasks: perms.grantPerms ? Boolean(b.can_edit_tasks) : false,
      sort_order: Number.isFinite(b.sort_order) ? b.sort_order : 999,
      joined_on: b.joined_on || null,
      active: true,
    };
    const data = await sb("kosu_person", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    });
    return Response.json({ person: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    const msg = String(e?.message || e);
    return Response.json(
      { error: /duplicate|unique/i.test(msg) ? "同じ氏名の担当者が既にいます" : msg },
      { status: 200 }
    );
  }
}

// 担当者の更新（改名・並べ替え・退職(active=false)・復帰など）
export async function PATCH(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため保存できません" }, { status: 200 });
  }
  const { resp, perms } = await checkEdit(req);
  if (resp) return resp;
  try {
    const b = await req.json();
    if (!b?.id) return Response.json({ error: "id が必要です" }, { status: 200 });
    const patch = {};
    for (const k of [
      "name",
      "email",
      "can_login",
      "sort_order",
      "active",
      "joined_on",
      "left_on",
    ]) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    // 役割・権限フラグの変更はオーナーだけ（管理者による自己/他者の昇格を防ぐ）
    if (b.role !== undefined || b.can_edit_accounts !== undefined || b.can_edit_tasks !== undefined) {
      if (!perms.grantPerms) {
        return Response.json(
          { error: "役割・権限を変更できるのはオーナーだけです" },
          { status: 403 }
        );
      }
      if (b.role !== undefined) {
        patch.role = ["owner", "admin", "member"].includes(b.role) ? b.role : "member";
      }
      if (b.can_edit_accounts !== undefined) patch.can_edit_accounts = Boolean(b.can_edit_accounts);
      if (b.can_edit_tasks !== undefined) patch.can_edit_tasks = Boolean(b.can_edit_tasks);
    }
    // メール未設定のままログイン許可はできない
    if (patch.can_login === true) {
      const cur = await sb(
        `kosu_person?id=eq.${encodeURIComponent(b.id)}&select=email`
      );
      const email = patch.email ?? cur?.[0]?.email;
      if (!email || !String(email).trim()) {
        return Response.json(
          { error: "ログインを許可するにはメールアドレスの登録が必要です" },
          { status: 200 }
        );
      }
    }
    const data = await sb(`kosu_person?id=eq.${encodeURIComponent(b.id)}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    return Response.json({ person: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}

// 担当者アカウントの削除（完全削除）
// ・実績（kosu_entry）が1件でもあると参照制約で消せないため、その場合は拒否して
//   「退職」を案内する（履歴を壊さないため）
// ・アサイン・ログインセッション・Google のログインアカウントは併せて削除する
export async function DELETE(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase 未接続のため削除できません" }, { status: 200 });
  }
  const { resp } = await checkEdit(req);
  if (resp) return resp;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return Response.json({ error: "id が必要です" }, { status: 200 });
    }

    const cur = await sb(`kosu_person?id=eq.${encodeURIComponent(id)}&select=id,name,email`);
    const person = cur?.[0];
    if (!person) return Response.json({ error: "該当の担当者が見つかりません" }, { status: 200 });

    // 実績があるかを確認（1件でもあれば削除しない）
    const used = await sb(
      `kosu_entry?person_id=eq.${encodeURIComponent(id)}&select=id&limit=1`
    ).catch(() => []);
    if (Array.isArray(used) && used.length > 0) {
      return Response.json(
        {
          error:
            "この担当者には工数の実績が登録されているため削除できません。「退職」にすると一覧から外れ、実績は残ります。",
        },
        { status: 200 }
      );
    }

    // 参照しているものを先に外す
    await sb(`task_assign?person_id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    }).catch(() => null);
    await sb(`app_session?person_id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    }).catch(() => null);

    await sb(`kosu_person?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });

    // Google ログイン用のアカウントも消す（失敗しても担当者の削除は成立させる）
    let authRemoved = false;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (SERVICE && person.email) {
      try {
        const hdr = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
        const list = await fetch(
          `${process.env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
          { headers: hdr, cache: "no-store" }
        ).then((r) => (r.ok ? r.json() : null));
        const users = list?.users || list || [];
        const u = (Array.isArray(users) ? users : []).find(
          (x) => String(x?.email || "").toLowerCase() === String(person.email).toLowerCase()
        );
        if (u?.id) {
          const del = await fetch(
            `${process.env.SUPABASE_URL}/auth/v1/admin/users/${u.id}`,
            { method: "DELETE", headers: hdr, cache: "no-store" }
          );
          authRemoved = del.ok;
        }
      } catch {
        /* ログインアカウントの削除は best-effort */
      }
    }

    return Response.json({ ok: true, name: person.name, authRemoved });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
