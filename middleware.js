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

// Supabase への問い合わせ。応答が遅いときは待ち続けず、上限で打ち切る。
// （画面を1回開くと API が十数本同時に走り、そのたびにここを通るので、
//  混んでいると1本あたり数秒かかることがある）
async function sbGet(path, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
// 問い合わせに失敗したとき、この時間内に「有効」と確認できていれば、それを使う。
// ※ログイン許可を外した人がアクセスできてしまうのは、障害中のこの時間だけ。
const SESSION_STALE_MAX = 10 * 60000;

// セッション＋本人の役割/個別付与を返す（ページ閲覧権限の判定に使う）。
//   ok: true  … 有効
//   ok: false … Supabase が「無い／期限切れ／ログイン不可」と答えた（＝本当に無効）
//   ok: null  … 問い合わせ自体に失敗して確かめられなかった（無効とは限らない）
//
// 以前は失敗も ok:false にしていたため、Supabase が一瞬遅れただけで
// ログイン画面へ飛ばされ、しかも Cookie まで消されていた（しょっちゅう戻される原因）。
async function getAccess(sid) {
  if (!sid || !/^[0-9a-f-]{36}$/i.test(sid)) return { ok: false };
  const hit = sessionCache.get(sid);
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.val;

  // 一時的な失敗なら1回だけやり直す
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (sessionCache.size > 200) sessionCache.clear();
      sessionCache.set(sid, { val, at: Date.now() });
      return val;
    } catch {
      if (attempt === 0) await sleep(300);
    }
  }

  // 確かめられなかった。少し前に「有効」と確認できていれば、それで通す。
  if (hit && hit.val.ok === true && Date.now() - hit.at < SESSION_STALE_MAX) return hit.val;
  return { ok: null };
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

// ログイン状態を確かめられなかったときに一瞬だけ出す画面。
// 2秒後に同じページを読み直す（そのときに確認できれば、そのまま開く）。
const RETRY_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="2"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>接続を確認しています</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f7fd;color:#1a2540;
font:14px "Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",Meiryo,system-ui,sans-serif}
p{margin:0}small{display:block;margin-top:6px;color:#5a6a8c}</style></head>
<body><div><p>接続を確認しています…</p><small>自動で読み直します。ログインし直す必要はありません。</small></div></body></html>`;

export async function middleware(req) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // ログイン利用者が未登録なら保護しない（初期設定中の締め出し防止）
  if (!(await authEnabled())) return NextResponse.next();

  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  const access = await getAccess(sid);

  // 確かめられなかっただけのときは、ログアウト扱いにしない（Cookie も消さない）。
  // 通しもしない（本当に有効かは分からないため）。少し待ってやり直してもらう。
  if (access.ok === null) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "ログイン状態を一時的に確認できませんでした。もう一度お試しください" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    return new NextResponse(RETRY_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "2", "Cache-Control": "no-store" },
    });
  }

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
