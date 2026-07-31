export const dynamic = "force-dynamic";

// Google ログインの入口。Supabase の認可エンドポイントへ転送するだけ。
// SUPABASE_URL はサーバー側にしか無いため、画面からはこのURLを開いてもらう。
export async function GET(req) {
  const base = process.env.SUPABASE_URL;
  if (!base) {
    return Response.redirect(
      new URL("/login?err=" + encodeURIComponent("Supabase が未設定です"), req.url),
      302
    );
  }
  const origin = new URL(req.url).origin;
  const authorize = new URL(`${base}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", `${origin}/auth/callback`);
  // 毎回アカウントを選べるようにする（共有PCでの取り違え防止）
  authorize.searchParams.set("prompt", "select_account");
  return Response.redirect(authorize.toString(), 302);
}
