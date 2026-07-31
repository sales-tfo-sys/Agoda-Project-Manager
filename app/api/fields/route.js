import { NextResponse } from "next/server";
import { fetchFields, kintoneConfigured } from "@/lib/kintone";

export const dynamic = "force-dynamic";

// アプリのフィールド定義（コード・ラベル・種別）だけを軽量に返す。列マッピング確認用。
export async function GET() {
  if (!kintoneConfigured()) {
    return NextResponse.json({ configured: false });
  }
  try {
    const fields = await fetchFields();
    const list = Object.entries(fields || {}).map(([code, f]) => ({
      code,
      label: f.label,
      type: f.type,
    }));
    return NextResponse.json({ configured: true, count: list.length, fields: list });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
