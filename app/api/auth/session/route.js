import { sb, supabaseConfigured } from "../../../../lib/supabase";
import {
  findAllowedPerson,
  SESSION_COOKIE,
  SESSION_DAYS,
  cookieOptions,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// メールリンクで得た access_token を検証し、自前のセッションCookieを発行する
export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase が未設定です" }, { status: 200 });
  }
  try {
    const { access_token } = await req.json();
    if (!access_token) {
      return Response.json({ error: "トークンがありません" }, { status: 200 });
    }

    // Supabase 側でトークンを検証（自前で署名検証しない＝取り違えを防ぐ）
    const KEY =
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ures = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: KEY, Authorization: `Bearer ${access_token}` },
      cache: "no-store",
    });
    if (!ures.ok) {
      return Response.json({ error: "ログインの確認に失敗しました" }, { status: 200 });
    }
    const user = await ures.json();
    const email = user?.email;
    if (!email) {
      return Response.json({ error: "メールアドレスを取得できません" }, { status: 200 });
    }

    // 許可リストを再確認（発行後に権限を外された場合に備える）
    const person = await findAllowedPerson(email);
    if (!person) {
      return Response.json(
        { error: "このアカウントはログインを許可されていません" },
        { status: 200 }
      );
    }

    // Google の写真・アカウント名・最終ログイン時刻を担当者マスタへ記録する
    const meta = user?.user_metadata || {};
    const avatar = meta.avatar_url || meta.picture || null;
    const loginName = meta.full_name || meta.name || null;
    const patch = { last_login_at: new Date().toISOString() };
    // 写真・アカウント名は毎回確認し、変わっていれば更新する
    if (avatar && avatar !== person.avatar_url) patch.avatar_url = avatar;
    if (loginName && loginName !== person.login_name) patch.login_name = loginName;
    await sb(`kosu_person?id=eq.${encodeURIComponent(person.id)}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=minimal",
    }).catch(() => null); // 列が未作成でもログインは通す

    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    const created = await sb("app_session", {
      method: "POST",
      body: { person_id: person.id, email, expires_at: expires },
      prefer: "return=representation",
    });
    const sid = Array.isArray(created) ? created[0]?.id : created?.id;
    if (!sid) {
      return Response.json({ error: "セッションを作成できませんでした" }, { status: 200 });
    }

    const res = Response.json({ ok: true, name: person.name, role: person.role });
    res.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sid}; ${cookieOptions(SESSION_DAYS * 86400)}`
    );
    return res;
  } catch (e) {
    // 未ログインでも叩ける経路なので、内部情報は返さずサーバーログにのみ残す
    console.error("auth/session error:", e);
    return Response.json(
      { error: "ログイン処理でエラーが発生しました。時間をおいてお試しください。" },
      { status: 200 }
    );
  }
}
