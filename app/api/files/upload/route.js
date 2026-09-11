import { denyUnlessPageEdit } from "../../../../lib/auth";
import {
  exists,
  joinPath,
  MAX_FILE_BYTES,
  safeName,
  safePath,
  upload,
} from "../../../../lib/storage";

export const dynamic = "force-dynamic";

// アップロード。multipart/form-data で { path, file } を受け取る。
// 同じ名前があるときは上書きせず、末尾に (2) (3) … を付けて別名で置く。
export async function POST(req) {
  const denied = await denyUnlessPageEdit(req, "files");
  if (denied) return denied;
  try {
    const form = await req.formData();
    const dir = safePath(form.get("path") || "");
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return Response.json({ error: "ファイルがありません" });
    }
    const name = safeName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      return Response.json({
        error: `1ファイル ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB までです`,
      });
    }
    let finalName = name;
    for (let i = 2; i < 100 && (await exists(joinPath(dir, finalName))); i++) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      finalName = `${stem} (${i})${ext}`;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await upload(joinPath(dir, finalName), bytes, file.type || "application/octet-stream");
    return Response.json({ ok: true, name: finalName });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
