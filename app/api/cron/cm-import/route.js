import { NextResponse } from "next/server";
import { kintoneConfigured } from "@/lib/kintone";
import { runImport } from "@/lib/cmImportRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 時間で動く反映（Vercel の定期実行から呼ばれる）。
// 誰もサイトを開いていなくても、新しい回答が施設一覧に入るようにするためのもの。
//
// 呼び出しの確認：
//   Vercel の定期実行は、環境変数 CRON_SECRET を設定しておくと
//   Authorization: Bearer <CRON_SECRET> を付けて呼んでくれる。
//   未設定のときは、外から叩かれても実害が無いよう「反映しない（予定だけ返す）」。
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret) {
    return NextResponse.json(
      { ok: false, skipped: "CRON_SECRET が未設定のため実行しません（Vercel の環境変数に設定してください）" },
      { status: 200 }
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!kintoneConfigured()) return NextResponse.json({ error: "Kintone が未設定です" }, { status: 200 });

  try {
    // 1回の実行で入れる上限。時間切れを避けるため、多いときは次の回に回す
    const res = await runImport("フォーム取込（自動）", { limit: 100 });
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...res });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
