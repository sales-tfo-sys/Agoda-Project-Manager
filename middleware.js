import { NextResponse } from "next/server";
import { computePages, pageKeyForPath, PAGES } from "./lib/pages";

const SESSION_COOKIE = "agoda_sid";

// 認証を通さないパス
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/auth/login",
  "/api/auth/google",
  "/api/auth/session",
  "/api/auth/logout",
  "/api/auth/me",
];

function isPublic(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
// 本番用の強制保護。AUTH_REQUIRED=1 のときは、許可リスト照会が一時的に
// 失敗しても「保護オフ（全公開）」に落ちない。初期設定が済んだら必ず有効化する。
const FORCE_AUTH = /^(1|true|yes|on)$/i.test(process.env.AUTH_REQUIRED || "");

async function sbGet(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

// 保護を有効にする条件は「実際にログインできる状態になっていること」。
//   ① 許可リストに在籍中＋ログイン許可の担当者がいる
//   ② パスワードが設定済みのアカウント（Supabase Auth ユーザー）が1件以上ある
// ②を条件に入れないと「許可はしたがパスワード未設定」で全員が締め出される。
let enabledCache = { value: null, at: 0 };
async function authAccountExists() {
  try {
    const res = await fetch(`${URL_}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json();
    const list = data?.users || data || [];
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}
// 一度でも「保護が有効」と分かったら、その事実は記憶しておく。
// 問い合わせが失敗したときに保護を解除してしまう（＝誰でも見られる）のを防ぐ。
let everEnabled = false;
async function authEnabled() {
  if (!URL_ || !KEY) return false;
  // 強制保護：許可リストやSupabaseの状態に関わらず常に保護ON
  if (FORCE_AUTH) return true;
  const now = Date.now();
  if (enabledCache.value !== null && now - enabledCache.at < 300000) {
    return enabledCache.value;
  }
  try {
    const rows = await sbGet(
      "kosu_person?active=eq.true&can_login=eq.true&select=id&limit=1"
    );
    const allowed = Array.isArray(rows) && rows.length > 0;
    const v = allowed ? await authAccountExists() : false;
    if (v) everEnabled = true;
    enabledCache = { value: v, at: now };
    return v;
  } catch {
    // 通信エラー等。保護済みの環境では有効のまま（安全側）に倒す
    enabledCache = { value: everEnabled, at: now };
    return everEnabled;
  }
}

// セッション検証結果を短時間キャッシュ（同一Cookieの連続アクセスで毎回問い合わせない）
const sessionCache = new Map(); // sid -> { val, at }
const SESSION_TTL = 60000;

// セッション＋本人の役割/個別付与を返す（ページ閲覧権限の判定に使う）
async function getAccess(sid) {
  if (!sid || !/^[0-9a-f-]{36}$/i.test(sid)) return { ok: false };
  const hit = sessionCache.get(sid);
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.val;
  try {
    const rows = await sbGet(
      `app_session?id=eq.${encodeURIComponent(sid)}` +
        `&select=expires_at,kosu_person!inner(id,role,active,can_login,can_edit_accounts,can_edit_tasks)`
    );
    const s = rows?.[0];
    let val = { ok: false };
    if (s && new Date(s.expires_at).getTime() >= Date.now()) {
      const p = s.kosu_person;
      if (p?.active === true && p?.can_login === true) {
        val = {
          ok: true,
          personId: p.id,
          role: p.role,
          cea: !!p.can_edit_accounts,
          cet: !!p.can_edit_tasks,
        };
      }
    }
    sessionCache.set(sid, { val, at: Date.now() });
    if (sessionCache.size > 200) sessionCache.clear();
    return val;
  } catch {
    return { ok: false };
  }
}

// 本人のページ権限（保存済みの上書き）を短時間キャッシュ
const ppCache = new Map(); // personId -> { data, at }
async function pagePermsOf(personId) {
  const hit = ppCache.get(personId);
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.data;
  try {
    const rows = await sbGet(
      `task_override?scope=eq.pageperm&key=eq.${encodeURIComponent(personId)}&select=data`
    );
    const data = rows?.[0]?.data || null;
    ppCache.set(personId, { data, at: Date.now() });
    if (ppCache.size > 300) ppCache.clear();
    return data;
  } catch {
    return null;
  }
}

export async function middleware(req) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // ログイン利用者が未登録なら保護しない（初期設定中の締め出し防止）
  if (!(await authEnabled())) return NextResponse.next();

  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  const access = await getAccess(sid);

  if (!access.ok) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    const res = NextResponse.redirect(url);
    if (sid) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // ページ閲覧権限のチェック（画面のみ。API は各ルートの権限チェックに任せる）。
  // オーナーは常に全ページ閲覧可。閲覧不可なら、見れる先頭ページへ寄せる。
  if (!pathname.startsWith("/api/") && access.role !== "owner") {
    const key = pageKeyForPath(pathname);
    if (key) {
      const stored = await pagePermsOf(access.personId);
      const pages = computePages(access.role, access.cea, access.cet, stored);
      if (!pages[key]?.view) {
        const first = PAGES.find((pg) => pages[pg.key]?.view);
        const dest = first ? first.path : "/dashboard";
        if (dest !== pathname) {
          const url = req.nextUrl.clone();
          url.pathname = dest;
          url.search = "";
          return NextResponse.redirect(url);
        }
      }
    }
  }
  return NextResponse.next();
}

// 画像・静的ファイル・_next 配下は認証チェック不要（Supabaseへの問い合わせを減らす）
export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|woff|woff2|ttf)$).*)",
  ],
};
