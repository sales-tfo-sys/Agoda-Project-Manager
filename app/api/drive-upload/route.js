import { denyUnlessPerm } from "../../../lib/auth";
import {
  driveConfigured,
  driveUser,
  uploadAsSpreadsheet,
  DRIVE_FOLDERS,
} from "../../../lib/googleDrive";

export const dynamic = "force-dynamic";

// アップロードできる大きさの上限。Vercel のリクエスト上限（4.5MB）に収まる範囲。
const MAX_BYTES = 4 * 1024 * 1024;

// 画面が「アップロード機能を出してよいか」を判断するための状態
export async function GET() {
  return Response.json({
    configured: driveConfigured(),
    user: driveConfigured() ? driveUser() : null,
    folders: DRIVE_FOLDERS,
    maxBytes: MAX_BYTES,
  });
}

// Excel などを「アップ先」フォルダへ入れて Google スプレッドシートに変換する。
// 返した url をそのままタスクの sheetUrl として保存する想定。
export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!driveConfigured()) {
    return Response.json(
      {
        error:
          "Google ドライブ連携が未設定です（GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GOOGLE_DRIVE_USER）。",
      },
      { status: 200 }
    );
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return Response.json({ error: "ファイルが選ばれていません" }, { status: 200 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: `ファイルが大きすぎます（${Math.round(MAX_BYTES / 1024 / 1024)}MB まで）` },
        { status: 200 }
      );
    }
    // 名前はタスク名を優先し、無ければ元のファイル名（拡張子は落とす）
    const raw = String(form.get("name") || "").trim();
    const base = String(file.name || "作業シート").replace(/\.[^.]+$/, "");
    const name = (raw || base).slice(0, 200);

    const bytes = Buffer.from(await file.arrayBuffer());
    const out = await uploadAsSpreadsheet({
      name,
      bytes,
      mimeType: file.type,
      folderKey: "new",
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
