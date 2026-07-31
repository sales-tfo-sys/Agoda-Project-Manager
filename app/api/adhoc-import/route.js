import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase";
import { importAdhocFromSheet, readAdhocItems } from "@/lib/adhocStore";
import { denyUnlessPerm } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 取込済みの件数だけ返す（ボタンの状態表示用）
export async function GET() {
  try {
    const items = await readAdhocItems();
    return NextResponse.json({ count: items ? items.length : 0, imported: !!items });
  } catch (e) {
    return NextResponse.json({ count: 0, imported: false, error: String(e?.message || e) });
  }
}

// 進捗シートの Ad Hoc タスクを Supabase（adhoc_item）へ取り込む（手動）。
// タスク編集権限（owner / 許可された admin）が必要。
export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase が未設定です" }, { status: 200 });
  }
  try {
    const count = await importAdhocFromSheet();
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
