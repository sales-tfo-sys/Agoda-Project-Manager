import { NextResponse } from "next/server";
import { kintoneConfigured } from "@/lib/kintone";
import { supabaseConfigured } from "@/lib/supabase";
import {
  buildKintonePayload,
  writeSnapshot,
  readSnapshot,
} from "@/lib/kintoneSnapshot";
import { denyUnlessPerm } from "@/lib/auth";
import { invalidate } from "@/lib/cache";

export const dynamic = "force-dynamic";

// 最終取得時刻・件数だけを返す（ボタンの表示用）
export async function GET() {
  try {
    const snap = await readSnapshot();
    return NextResponse.json({
      fetchedAt: snap?.fetchedAt || null,
      count: snap?.data?.count ?? null,
    });
  } catch (e) {
    return NextResponse.json({ fetchedAt: null, error: String(e?.message || e) });
  }
}

// Kintone から取得して Supabase のスナップショットを更新する（手動同期）。
// タスク編集権限（owner / 許可された admin）を持つ人だけ実行できる。
export async function POST(req) {
  const denied = await denyUnlessPerm(req, "editTasks");
  if (denied) return denied;
  if (!kintoneConfigured()) {
    return NextResponse.json({ error: "Kintone が未設定です" }, { status: 200 });
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase が未設定です" }, { status: 200 });
  }
  try {
    const payload = await buildKintonePayload();
    await writeSnapshot(payload);
    // メモリキャッシュも捨てて、次の表示で新しいデータが反映されるようにする
    invalidate("kintone:records");
    return NextResponse.json({
      ok: true,
      count: payload.count,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
