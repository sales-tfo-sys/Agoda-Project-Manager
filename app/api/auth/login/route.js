import { sb, supabaseConfigured } from "../../../../lib/supabase";
import {
  findAllowedPerson,
  SESSION_COOKIE,
  SESSION_DAYS,
  cookieOptions,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// パスワードログインは既定で無効（Google ログインのみ運用）。
// Google が使えない緊急時のみ PASSWORD_LOGIN=1 を設定して一時的に有効化する。
const PASSWORD_LOGIN = /^(1|true|yes|on)$/i.test(process.env.PASSWORD_LOGIN || "");

// メールアドレス＋パスワードでログインし、その場でセッションCookieを発行する
export async function POST(req) {
  if (!PASSWORD_LOGIN) {
    return Response.json(
      { error: "パスワードログインは無効です。Google でログインしてください。" },
      { status: 403 }
    );
  }
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase が未設定です" }, { status: 200 });
  }
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return Response.json(
        { error: "メールアドレスとパスワードを入力してください" },
        { status: 200 }
      );
    }

    // 許可リストの確認（在籍中＋ログイン許可）
    const person = await findAllowedPerson(email);
    if (!person) {
      return Response.json(
        { error: "このメールアドレスはログインを許可されていません。管理者にご確認ください。" },
        { status: 200 }
      );
    }

    // Supabase でパスワードを検証
    const KEY =
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(email).trim(), password }),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return Response.json(
        { error: "メールアドレスまたはパスワードが違います" },
        { status: 200 }
      );
    }

    // 自前のセッションを発行（許可を外すと即座に無効化できる）
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    const created = await sb("app_session", {
      method: "POST",
      body: { person_id: person.id, email: person.email || email, expires_at: expires },
      prefer: "return=representation",
    });
    const sid = Array.isArray(created) ? created[0]?.id : created?.id;
    if (!sid) {
      return Response.json({ error: "セッションを作成できませんでした" }, { status: 200 });
    }

    const out = Response.json({ ok: true, name: person.name, role: person.role });
    out.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sid}; ${cookieOptions(SESSION_DAYS * 86400)}`
    );
    return out;
  } catch (e) {
    // 未ログインでも叩ける経路なので、内部情報は返さずサーバーログにのみ残す
    console.error("auth/login error:", e);
    return Response.json(
      { error: "ログイン処理でエラーが発生しました。時間をおいてお試しください。" },
      { status: 200 }
    );
  }
}
