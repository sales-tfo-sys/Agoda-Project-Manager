// ログインセッション（不透明ID方式）のサーバー側ヘルパー。
// Cookie には推測不能なセッションIDのみを入れ、実体は Supabase の app_session に置く。
// → ログイン許可を外した瞬間にアクセスを止められる（JWTの有効期限待ちが不要）。
import { sb, supabaseConfigured } from "./supabase";
import { effectivePerms, FULL_PERMS } from "./perms";

export const SESSION_COOKIE = "agoda_sid";
export const SESSION_DAYS = 30; // 頻繁な再ログインを避ける

/** セッションIDから利用者情報を取得。無効なら null */
export async function getSession(sid) {
  if (!sid || !supabaseConfigured()) return null;
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return null;
  try {
    const rows = await sb(
      `app_session?id=eq.${encodeURIComponent(sid)}` +
        `&select=id,email,expires_at,kosu_person!inner(id,name,login_name,role,active,can_login,avatar_url,can_edit_accounts,can_edit_tasks)`
    );
    const s = rows?.[0];
    if (!s) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) return null;
    const p = s.kosu_person;
    if (!p || p.active !== true || p.can_login !== true) return null;
    return {
      sid: s.id,
      email: s.email,
      name: p.name,
      // ログイン時に取得した Google アカウント名（サイドバー表示用）
      loginName: p.login_name || null,
      role: p.role,
      personId: p.id,
      avatar: p.avatar_url || null,
      // 実効権限の算出に使う個別付与フラグ
      canEditAccounts: !!p.can_edit_accounts,
      canEditTasks: !!p.can_edit_tasks,
    };
  } catch {
    return null;
  }
}

/** 許可リストに載っている担当者を返す（在籍中＋ログイン許可） */
export async function findAllowedPerson(email) {
  if (!email || !supabaseConfigured()) return null;
  const e = String(email).trim();
  if (!e) return null;
  try {
    const rows = await sb(
      `kosu_person?email=ilike.${encodeURIComponent(e)}` +
        `&active=eq.true&can_login=eq.true&select=id,name,email,role,avatar_url,login_name`
    );
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * 保護を有効にしてよいか。
 * ①許可リストに担当者がいる ②パスワード設定済みアカウントが1件以上ある
 * の両方を満たすときだけ true（②が無いと締め出しになるため）。
 */
let enabledCache = { value: null, at: 0 };
// 本番用の強制保護（middleware と同じ）。AUTH_REQUIRED=1 で常に保護ON。
const FORCE_AUTH = /^(1|true|yes|on)$/i.test(process.env.AUTH_REQUIRED || "");
export async function authEnabled() {
  if (!supabaseConfigured()) return false;
  if (FORCE_AUTH) return true;
  // 5分キャッシュ（/api/auth/me はページ遷移ごとに呼ばれるため）
  if (enabledCache.value !== null && Date.now() - enabledCache.at < 300000) {
    return enabledCache.value;
  }
  try {
    const rows = await sb(
      "kosu_person?active=eq.true&can_login=eq.true&select=id&limit=1"
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      enabledCache = { value: false, at: Date.now() };
      return false;
    }
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json();
    const list = data?.users || data || [];
    const v = Array.isArray(list) && list.length > 0;
    enabledCache = { value: v, at: Date.now() };
    return v;
  } catch {
    return false;
  }
}

// リクエストの Cookie から現在の実効権限を返す。
//   保護オフ（未設定・許可リスト空）→ FULL_PERMS（デモが使えるように）
//   ログイン中 → その人の役割＋個別付与から算出
//   未ログイン（保護オン）→ perms は null
export async function getPerms(req) {
  const enabled = await authEnabled();
  if (!enabled) return { enabled: false, session: null, perms: FULL_PERMS };
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const sid = m ? decodeURIComponent(m[1]) : null;
  const session = await getSession(sid);
  const perms = session
    ? effectivePerms({
        role: session.role,
        can_edit_accounts: session.canEditAccounts,
        can_edit_tasks: session.canEditTasks,
      })
    : null;
  return { enabled: true, session, perms };
}

// 指定した権限キーが無ければ拒否レスポンスを返す（あれば null）。
// API ルートの先頭で `const d = await denyUnlessPerm(req, "editTasks"); if (d) return d;` の形で使う。
export async function denyUnlessPerm(req, key) {
  const { perms } = await getPerms(req);
  if (!perms) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!perms[key]) {
    return Response.json({ error: "編集する権限がありません" }, { status: 403 });
  }
  return null;
}

export function cookieOptions(maxAgeSec) {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAgeSec}`;
}
