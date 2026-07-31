import { sb, supabaseConfigured } from "../../../../lib/supabase";
import { SESSION_COOKIE } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function POST(req) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false });
  }
  const sid = readCookie(req, SESSION_COOKIE);
  if (sid && /^[0-9a-f-]{36}$/i.test(sid)) {
    try {
      await sb(`app_session?id=eq.${encodeURIComponent(sid)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
    } catch {
      // Cookie は消すので握りつぶす
    }
  }
  const res = Response.json({ configured: true, ok: true });
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  return res;
}
