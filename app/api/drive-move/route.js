import { denyUnlessPerm } from "../../../lib/auth";
import {
  driveConfigured,
  fileIdFromUrl,
  moveToFolder,
  FOLDER_LABEL,
} from "../../../lib/googleDrive";

export const dynamic = "force-dynamic";

// 作業シートを「アップ先 / 完了 / 保留」のフォルダへ移す。
// body: { url または fileId, to: "new" | "done" | "hold" }
export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!driveConfigured()) {
    return Response.json({ error: "Google ドライブ連携が未設定です" }, { status: 200 });
  }
  try {
    const b = await req.json();
    const to = String(b?.to || "");
    if (!FOLDER_LABEL[to]) {
      return Response.json({ error: "移動先が不正です" }, { status: 200 });
    }
    const fileId = String(b?.fileId || "").trim() || fileIdFromUrl(b?.url);
    if (!fileId) {
      return Response.json(
        { error: "スプレッドシートのURLからファイルを特定できません" },
        { status: 200 }
      );
    }
    const out = await moveToFolder(fileId, to);
    return Response.json({ ok: true, ...out, label: FOLDER_LABEL[to] });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
