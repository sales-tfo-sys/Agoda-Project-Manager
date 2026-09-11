import { getPerms } from "../../../../lib/auth";
import { joinPath, safeName, safePath, signUrl } from "../../../../lib/storage";

export const dynamic = "force-dynamic";

// 閲覧・ダウンロード用の一時URLを発行する。
// バケットは非公開なので、ここを通らないとファイルは取れない。
// ?path=フォルダ&name=名前&dl=1（dl=1 なら添付として落とす）
export async function GET(req) {
  const { perms } = await getPerms(req);
  if (!perms) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!perms.pages?.files?.view) {
    return Response.json({ error: "このページを見る権限がありません" }, { status: 403 });
  }
  try {
    const q = new URL(req.url).searchParams;
    const dir = safePath(q.get("path") || "");
    const name = safeName(q.get("name"));
    const url = await signUrl(joinPath(dir, name), {
      expiresIn: 120,
      download: q.get("dl") === "1" ? name : null,
    });
    return Response.json({ url });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
