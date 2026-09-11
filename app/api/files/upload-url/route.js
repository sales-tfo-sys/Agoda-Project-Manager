import { denyUnlessPageEdit } from "../../../../lib/auth";
import {
  exists,
  joinPath,
  MAX_FILE_BYTES,
  safeName,
  safePath,
  signUploadUrl,
} from "../../../../lib/storage";

export const dynamic = "force-dynamic";

// アップロード用の一時URLを発行する。
// ファイルの中身はここを通さず、ブラウザからストレージへ直接送る
// （自前のAPIを経由すると、置いているサーバーの本文サイズ上限に引っかかるため）。
// ここでやるのは、権限の確認・名前の検証・重複しない名前決めまで。
export async function POST(req) {
  const denied = await denyUnlessPageEdit(req, "files");
  if (denied) return denied;
  try {
    const b = await req.json();
    const dir = safePath(b?.path || "");
    const name = safeName(b?.name);
    const size = Number(b?.size);
    if (Number.isFinite(size) && size > MAX_FILE_BYTES) {
      return Response.json({
        error: `1ファイル ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB までです`,
      });
    }
    // 同じ名前があるときは上書きせず、末尾に (2) (3) … を付ける
    let finalName = name;
    for (let i = 2; i < 100 && (await exists(joinPath(dir, finalName))); i++) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      finalName = `${stem} (${i})${ext}`;
    }
    const url = await signUploadUrl(joinPath(dir, finalName));
    return Response.json({ url, name: finalName });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
