import { googleServiceConfigured, serviceAccountEmail } from "../../../lib/googleSheetsApi";

export const dynamic = "force-dynamic";

// フォーム回答の読み取り方式を返す。
//   service … サービスアカウントに閲覧共有すれば読める（非公開でOK）
//   public  … リンクを知っている全員が閲覧可 のシートのみ
export async function GET() {
  const service = googleServiceConfigured();
  return Response.json({
    mode: service ? "service" : "public",
    serviceEmail: service ? serviceAccountEmail() : null,
    // 診断用（値は返さない）：どの環境変数が読めているか
    hasEmail: !!process.env.GOOGLE_SA_EMAIL,
    hasKey: !!process.env.GOOGLE_SA_PRIVATE_KEY,
  });
}
