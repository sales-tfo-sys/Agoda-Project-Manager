import { getSession, authEnabled, SESSION_COOKIE } from "../../../../lib/auth";
import { effectivePerms, FULL_PERMS } from "../../../../lib/perms";

export const dynamic = "force-dynamic";

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// 現在のログイン状態。enabled=false は「ログイン許可された利用者が未登録」＝保護オフ
export async function GET(req) {
  const enabled = await authEnabled();
  const session = await getSession(readCookie(req, SESSION_COOKIE));
  // 保護オフ（未ログインで運用）のときはフル権限として扱い、画面が使えなくならないようにする
  const perms = !enabled
    ? FULL_PERMS
    : session
    ? effectivePerms({
        role: session.role,
        can_edit_accounts: session.canEditAccounts,
        can_edit_tasks: session.canEditTasks,
      })
    : null;
  return Response.json({
    enabled,
    perms,
    user: session
      ? {
          // personId は本人の担当者ID。工数入力で自分の列だけを出すのに使う
          personId: session.personId,
          name: session.name,
          // ログイン時に取得した Google アカウント名（サイドバー表示用）
          loginName: session.loginName || null,
          email: session.email,
          role: session.role,
          avatar: session.avatar,
        }
      : null,
  });
}
