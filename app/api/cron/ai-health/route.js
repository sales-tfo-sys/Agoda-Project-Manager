import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase";
import { monthKey, readMonth, runAndSave } from "@/lib/aiHealth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 月1回の「AI健康診断」を、毎月1日に自動で走らせる入口（Vercel の定期実行から呼ばれる）。
// ボタンの押し忘れで記録が空く月を無くすため。
//
//   ・合言葉 CRON_SECRET を確かめる（未設定なら実行しない）
//   ・その月の記録（security と performance の両方）がすでにあれば、何もしない
//   ・点検の中身は画面の「診断」と同じ（lib/aiHealth.js）
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, skipped: "CRON_SECRET が未設定のため実行しません" });
  }
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase が未設定です" });

  try {
    const month = monthKey();
    const cur = await readMonth(month);
    if (cur?.security?.findings && cur?.performance?.findings) {
      return NextResponse.json({ ok: true, month, skipped: "今月はもう記録があります" });
    }
    const res = await runAndSave("自動（月1回）");
    return NextResponse.json({ ok: true, month: res.month, total: res.total, source: res.source });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
