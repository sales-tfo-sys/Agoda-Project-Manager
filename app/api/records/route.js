import { NextResponse } from "next/server";
import { kintoneConfigured } from "@/lib/kintone";
import { mockRecords, mockFields } from "@/lib/mock";
import { supabaseConfigured } from "@/lib/supabase";
import { cached } from "@/lib/cache";
import {
  readSnapshot,
  buildKintonePayload,
  writeSnapshot,
} from "@/lib/kintoneSnapshot";

export const dynamic = "force-dynamic";

// スナップショットがまだ無いときの Kintone 直取得は、メモリに短時間ためる。
// 期限切れ後も古い値を即返して裏で更新するので、待たされるのは本当に初回だけ。
const TTL = 3 * 60 * 1000;

// Supabase のスナップショット（約7MB）はリクエストごとに読むと重い。
// メモリに短時間ためて、2回目以降（別ページ・自動更新・複数ウィジェット）は
// Supabase を叩かず即返す。取込（/api/kintone-sync）時に明示破棄する。
const SNAP_TTL = 60 * 1000;

const mockPayload = () => ({
  configured: false,
  source: "mock",
  count: mockRecords.length,
  fields: mockFields,
  records: mockRecords,
});

// Kintone を1回だけ叩いてメモリキャッシュしつつ、可能なら Supabase にも保存する。
const liveWithCache = () =>
  cached("kintone:records", TTL, async () => {
    const payload = await buildKintonePayload();
    // 保存できるなら次回以降は Supabase から読めるようにしておく（失敗は無視）
    writeSnapshot(payload).catch(() => {});
    return payload;
  });

// 案件データの取得。
//   通常は Supabase に保存済みのスナップショットを返す（Kintone は叩かない＝速い）。
//   スナップショットが無ければ、メモリキャッシュ付きで Kintone を取得する。
//   最新化は画面の「Kintone取込」ボタン（POST /api/kintone-sync）で行う。
export async function GET() {
  // ① Supabase に保存済みスナップショットがあれば最優先で返す（高速）
  if (supabaseConfigured()) {
    try {
      const snap = await cached("records:snapshot", SNAP_TTL, readSnapshot);
      if (snap) {
        return NextResponse.json({
          ...snap.data,
          stored: true,
          fetchedAt: snap.fetchedAt,
        });
      }
    } catch {
      /* 読み取り失敗時は下のフォールバックへ */
    }
  }

  // ② スナップショットが無い／Supabase 未設定 → Kintone をメモリキャッシュ付きで取得
  if (!kintoneConfigured()) {
    return NextResponse.json(mockPayload());
  }
  try {
    const payload = await liveWithCache();
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { configured: true, source: "kintone", error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
