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
      for (const [id, one] of Object.entries(r?.applied || {})) {
        if (!one?.wrote) continue;
        const labels = Object.values(one.labels || {});
        const cur = byRecord[id];
        if (!cur) byRecord[id] = { at: one.at || "", by: one.by || "", labels, hid: r.hid || "", key };
        else {
          cur.labels = [...new Set([...cur.labels, ...labels])];
          if ((one.at || "") > (cur.at || "")) {
            cur.at = one.at || cur.at;
            cur.by = one.by || cur.by;
            cur.key = key;
          }
        }
      }
    }
    return NextResponse.json({ byRecord });
  } catch (e) {
    return NextResponse.json({ byRecord: {}, error: String(e?.message || e) });
  }
}
