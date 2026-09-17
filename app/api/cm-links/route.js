import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase";
import { readResults } from "@/lib/cmImport";

export const dynamic = "force-dynamic";

// 施設一覧に「CM情報フォームから反映した」印を出すための、軽い一覧。
// レコード番号 → { at, by, labels, hid } を返す（読むだけ・計算はしない）。
export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ byRecord: {} });
  try {
    const results = await readResults();
    const byRecord = {};
    for (const [key, r] of Object.entries(results)) {
      if (!r?.recordId || !r?.wrote) continue; // 取り消したものは印を出さない
      const id = String(r.recordId);
      const labels = Object.values(r.labels || {});
      const cur = byRecord[id];
      // 同じレコードに複数の回答が入っていたら、新しい方を残して項目名はまとめる
      if (!cur) byRecord[id] = { at: r.at || "", by: r.by || "", labels, hid: r.hid || "", key };
      else {
        cur.labels = [...new Set([...cur.labels, ...labels])];
        if ((r.at || "") > (cur.at || "")) {
          cur.at = r.at || cur.at;
          cur.by = r.by || cur.by;
          cur.key = key;
        }
      }
    }
    return NextResponse.json({ byRecord });
  } catch (e) {
    return NextResponse.json({ byRecord: {}, error: String(e?.message || e) });
  }
}
